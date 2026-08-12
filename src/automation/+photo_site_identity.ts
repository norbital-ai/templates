import { defineAutomation } from '@norbital-ai/pod/authoring';
import { z } from 'zod';

const FAST_VISION_MODEL = 'stepfun/step-3.7-flash';

const siteIdentitySchema = z
	.object({
		evidence_available: z.boolean(),
		site_name: z.string().nullable(),
		site_location: z.string().nullable(),
		unit_number: z.string().nullable(),
		relation_to_assigned_site: z.enum(['match', 'mismatch', 'inconclusive']),
		rationale: z.string().trim().min(1),
		confidence: z.enum(['low', 'medium', 'high'])
	})
	.strict();

function present(value: string | null): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : null;
}

function formattedAddress(value: unknown): string | null {
	if (value == null || typeof value !== 'object') return null;
	const address = Reflect.get(value, 'formatted_address');
	return typeof address === 'string' && address.trim() !== '' ? address.trim() : null;
}

export default defineAutomation(
	{ trigger: { collection: 'photo_evidence', event: 'created' } },
	{
		kind: 'deterministic',
		description:
			'Reads a newly filed job-site photo with a vision model, judges the whole photographed scene against the assigned site, and records a matching identity or a one-way wrong-location finding with the model rationale.',
		handler: async (api, { scope }) => {
			const evidence = scope.incoming_record;
			const settleEvidence = async (
				status: 'match' | 'mismatch' | 'inconclusive' | 'failed',
				error: string | null = null
			) =>
				api.db.photo_evidence.update(evidence.norbital_id, {
					site_identity_status: status,
					site_identity_checked_at: new Date(),
					site_identity_error: error
				});
			let assignmentId = evidence.job_assignment_id;
			if (assignmentId == null && evidence.variation_request_id != null) {
				const variation = await api.db.query.variation_requests.findFirst({
					where: { norbital_id: { eq: evidence.variation_request_id } },
					columns: { job_assignment_id: true }
				});
				assignmentId = variation?.job_assignment_id ?? null;
			}
			if (assignmentId == null) {
				await settleEvidence('inconclusive');
				return { status: 'skipped', reason: 'photo evidence has no resolvable job assignment' };
			}

			const assignment = await api.db.query.job_assignments.findFirst({
				where: { norbital_id: { eq: assignmentId } },
				columns: { norbital_id: true, job_id: true, status: true, site_identity_mismatch: true }
			});
			if (assignment == null) {
				await settleEvidence('inconclusive');
				return { status: 'skipped', reason: 'linked job assignment no longer exists' };
			}
			const finalizeCompletedAssignmentIfSettled = async () => {
				const currentAssignment = await api.db.query.job_assignments.findFirst({
					where: { norbital_id: { eq: assignmentId } },
					columns: { status: true }
				});
				if (currentAssignment?.status !== 'completed') return;
				const [directEvidence, variations] = await Promise.all([
					api.db.query.photo_evidence.findMany({
						where: { job_assignment_id: { eq: assignmentId } },
						columns: { site_identity_status: true },
						limit: 1000
					}),
					api.db.query.variation_requests.findMany({
						where: { job_assignment_id: { eq: assignmentId } },
						columns: { norbital_id: true },
						limit: 1000
					})
				]);
				const variationIds = variations.map((variation) => variation.norbital_id);
				const variationEvidence =
					variationIds.length === 0
						? []
						: await api.db.query.photo_evidence.findMany({
								where: { variation_request_id: { in: variationIds } },
								columns: { site_identity_status: true },
								limit: 1000
							});
				const unsettled = [...directEvidence, ...variationEvidence].some(
					(photo) =>
						photo.site_identity_status === 'pending' || photo.site_identity_status === 'failed'
				);
				if (!unsettled) {
					await api.db.job_assignments.update(assignmentId, { status: 'completed' });
				}
			};
			const job = await api.db.query.jobs.findFirst({
				where: { norbital_id: { eq: assignment.job_id } },
				columns: { title: true, site_id: true }
			});
			if (job == null) {
				await settleEvidence('inconclusive');
				await finalizeCompletedAssignmentIfSettled();
				return { status: 'skipped', reason: 'linked job no longer exists' };
			}
			const site = await api.db.query.sites.findFirst({
				where: { norbital_id: { eq: job.site_id } },
				columns: { name: true, location: true }
			});
			if (site == null) {
				await settleEvidence('inconclusive');
				await finalizeCompletedAssignmentIfSettled();
				return { status: 'skipped', reason: 'assigned site no longer exists' };
			}
			const expectedAddress = formattedAddress(site.location);

			const checkedAt = new Date();
			try {
				const inferred = await api.ai({
					model: FAST_VISION_MODEL,
					schema: siteIdentitySchema,
					images: [{ assetId: evidence.document_asset_id, detail: 'high' }],
					prompt: [
						'Inspect the attached job-site photo and compare it with the assigned site below.',
						`Assigned job: ${job.title}.`,
						`Assigned site: ${site.name}.`,
						...(expectedAddress == null ? [] : [`Assigned mapped address: ${expectedAddress}.`]),
						'Judge the whole naturally photographed scene: signs and addresses, building or site type,',
						'architecture, surrounding landmarks, access points, unit layout, and visible work context.',
						'Also extract any site or building name, street or block sign, address plaque, and unit, lot,',
						'or door number that is naturally present and legible.',
						'Ignore every synthetic overlay, caption, watermark, timestamp, filename, border, badge,',
						'or other text added on top of the photo, even when it states the expected address.',
						'Use multimodal judgement rather than exact string matching. A single expected indicator does',
						'not override a clearly incompatible broader scene. Mark mismatch when the photographed location',
						'is visibly a different house, unit, block, street, named site, building type, or work setting;',
						'mark match when the scene as a whole supports the assigned site; otherwise use inconclusive.',
						'Set evidence_available true when the scene contains enough visual evidence for that judgement,',
						'even if no text identifier can be extracted. Explain the decisive evidence and conflicts briefly',
						'in rationale so a human reviewer can audit the verdict.',
						'Use null for every extracted value that is absent or uncertain.'
					].join(' ')
				});

				const siteName = present(inferred.site_name);
				const siteLocation = present(inferred.site_location);
				const unitNumber = present(inferred.unit_number);
				const available = inferred.evidence_available;

				if (available && inferred.relation_to_assigned_site === 'mismatch') {
					await settleEvidence('mismatch');
					await api.db.job_assignments.update(assignmentId, {
						site_identity_unverified: false,
						site_identity_mismatch: true,
						site_identity_evidence_id: evidence.norbital_id,
						extracted_site_name: siteName,
						extracted_site_location: siteLocation,
						extracted_unit_number: unitNumber,
						site_identity_confidence: inferred.confidence,
						site_identity_checked_at: checkedAt,
						site_identity_rationale: inferred.rationale,
						status: 'suspect'
					});
					return {
						status: 'mismatch',
						model: FAST_VISION_MODEL,
						confidence: inferred.confidence,
						rationale: inferred.rationale
					};
				}

				if (available && inferred.relation_to_assigned_site === 'match') {
					await settleEvidence('match');
					await api.db.job_assignments.update(
						assignmentId,
						assignment.site_identity_mismatch
							? { site_identity_unverified: false, site_identity_checked_at: checkedAt }
							: {
									site_identity_unverified: false,
									site_identity_evidence_id: evidence.norbital_id,
									extracted_site_name: siteName,
									extracted_site_location: siteLocation,
									extracted_unit_number: unitNumber,
									site_identity_confidence: inferred.confidence,
									site_identity_checked_at: checkedAt,
									site_identity_rationale: inferred.rationale
								}
					);
					await finalizeCompletedAssignmentIfSettled();
					return {
						status: 'match',
						model: FAST_VISION_MODEL,
						confidence: inferred.confidence,
						rationale: inferred.rationale
					};
				}

				await settleEvidence('inconclusive');
				if (!assignment.site_identity_mismatch) {
					await api.db.job_assignments.update(assignmentId, {
						site_identity_unverified: true,
						site_identity_evidence_id: evidence.norbital_id,
						extracted_site_name: siteName,
						extracted_site_location: siteLocation,
						extracted_unit_number: unitNumber,
						site_identity_confidence: inferred.confidence,
						site_identity_checked_at: checkedAt,
						site_identity_rationale: inferred.rationale
					});
				}
				await finalizeCompletedAssignmentIfSettled();
				return {
					status: 'unavailable',
					model: FAST_VISION_MODEL,
					confidence: inferred.confidence,
					rationale: inferred.rationale
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await settleEvidence('failed', message);
				throw error;
			}
		}
	}
);
