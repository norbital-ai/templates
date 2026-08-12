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
			'Reads a newly filed job-site photo with a vision model, compares naturally photographed identifiers with the assigned site, and records a matching identity or a one-way wrong-location finding with the model rationale.',
		handler: async (api, { scope }) => {
			const evidence = scope.incoming_record;
			let assignmentId = evidence.job_assignment_id;
			if (assignmentId == null && evidence.variation_request_id != null) {
				const variation = await api.db.query.variation_requests.findFirst({
					where: { norbital_id: { eq: evidence.variation_request_id } },
					columns: { job_assignment_id: true }
				});
				assignmentId = variation?.job_assignment_id ?? null;
			}
			if (assignmentId == null) {
				return { status: 'skipped', reason: 'photo evidence has no resolvable job assignment' };
			}

			const assignment = await api.db.query.job_assignments.findFirst({
				where: { norbital_id: { eq: assignmentId } },
				columns: { norbital_id: true, job_id: true, site_identity_mismatch: true }
			});
			if (assignment == null) {
				return { status: 'skipped', reason: 'linked job assignment no longer exists' };
			}
			const job = await api.db.query.jobs.findFirst({
				where: { norbital_id: { eq: assignment.job_id } },
				columns: { title: true, site_id: true }
			});
			if (job == null) return { status: 'skipped', reason: 'linked job no longer exists' };
			const site = await api.db.query.sites.findFirst({
				where: { norbital_id: { eq: job.site_id } },
				columns: { name: true, location: true }
			});
			if (site == null) return { status: 'skipped', reason: 'assigned site no longer exists' };
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
						'Extract site identity that is naturally present in the photographed scene: a site or',
						'building name, street or block sign, address plaque, and a unit, lot, or door number.',
						'Ignore every synthetic overlay, caption, watermark, timestamp, filename, border, badge,',
						'or other text added on top of the photo, even when it states the expected address.',
						'Do not infer from visual style, metadata, or unstated context. Use your judgement about',
						'whether an explicit photographed identifier matches or contradicts the assigned site;',
						'do not use a parser or require exact string formatting.',
						'Set evidence_available true only when at least one extracted identifier is explicit and legible.',
						'Set relation_to_assigned_site to mismatch when that natural identifier points to a different',
						'house, unit, block, street, or named site; match when it supports the assigned site; otherwise',
						'use inconclusive. Explain the visual evidence and comparison briefly in rationale.',
						'Use null for every extracted value that is absent or uncertain.'
					].join(' ')
				});

				const siteName = present(inferred.site_name);
				const siteLocation = present(inferred.site_location);
				const unitNumber = present(inferred.unit_number);
				const hasIdentifier = siteName != null || siteLocation != null || unitNumber != null;
				const available =
					inferred.evidence_available && hasIdentifier && inferred.confidence !== 'low';

				if (available && inferred.relation_to_assigned_site === 'mismatch') {
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
									site_identity_checked_at: checkedAt
								}
					);
					return {
						status: 'match',
						model: FAST_VISION_MODEL,
						confidence: inferred.confidence,
						rationale: inferred.rationale
					};
				}

				// The assignment defaults to unverified. An inconclusive photo deliberately does not write:
				// that keeps the flag true for a new assignment without letting a later weak photo undo a
				// previous verified result.
				return { status: 'unavailable', model: FAST_VISION_MODEL };
			} catch (error) {
				return {
					status: 'failed',
					model: FAST_VISION_MODEL,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}
);
