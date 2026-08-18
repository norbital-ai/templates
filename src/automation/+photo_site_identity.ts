import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';

const FAST_VISION_MODEL = 'stepfun/step-3.7-flash';

const siteIdentitySchema = Schema.toStandardSchemaV1(
	Schema.Struct({
		evidence_available: Schema.Boolean,
		site_name: Schema.NullOr(Schema.String),
		site_location: Schema.NullOr(Schema.String),
		unit_number: Schema.NullOr(Schema.String),
		relation_to_assigned_site: Schema.Literals(['match', 'mismatch', 'inconclusive']),
		rationale: Schema.String.check(Schema.isPattern(/^\s*\S[\s\S]*$/)),
		confidence: Schema.Literals(['low', 'medium', 'high'])
	}),
	{ parseOptions: { onExcessProperty: 'error' } }
);

function present(value: string | null): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : null;
}

function formattedAddress(
	location: { readonly formatted_address: string } | null | undefined
): string | null {
	if (location == null) return null;
	const address = location.formatted_address;
	return address.trim() !== '' ? address.trim() : null;
}

export default defineAutomation(
	{ trigger: { collection: 'photo_evidence', event: 'created' } },
	{
		description:
			'Reads a newly filed job-site photo with a vision model, judges the whole photographed scene together with deterministic integrity attributes, and records an auditable site verdict.',
		handler: (api, { scope }) =>
			Effect.gen(function* () {
				// The created-event snapshot predates the duplicate after-hook. Read the settled row so the
				// judgement sees reuse and geolocation attributes without turning any one attribute into a
				// verdict by itself.
				const settledEvidence = yield* api.db.query.photo_evidence.findFirst({
					where: { norbital_id: { eq: scope.incoming_record.norbital_id } },
					columns: {
						norbital_id: true,
						job_assignment_id: true,
						variation_request_id: true,
						document_asset_id: true,
						flags: true,
						matched_evidence_ids: true
					}
				});
				const evidence = settledEvidence ?? scope.incoming_record;
				const settleEvidence = (
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
					const variation = yield* api.db.query.variation_requests.findFirst({
						where: { norbital_id: { eq: evidence.variation_request_id } },
						columns: { job_assignment_id: true }
					});
					assignmentId = variation?.job_assignment_id ?? null;
				}
				if (assignmentId == null) {
					yield* settleEvidence('inconclusive');
					return { status: 'skipped', reason: 'photo evidence has no resolvable job assignment' };
				}

				const assignment = yield* api.db.query.job_assignments.findFirst({
					where: { norbital_id: { eq: assignmentId } },
					columns: {
						norbital_id: true,
						job_id: true,
						status: true,
						site_identity_mismatch: true
					}
				});
				if (assignment == null) {
					yield* settleEvidence('inconclusive');
					return { status: 'skipped', reason: 'linked job assignment no longer exists' };
				}
				const finalizeCompletedAssignmentIfSettled = () =>
					Effect.gen(function* () {
						const currentAssignment = yield* api.db.query.job_assignments.findFirst({
							where: { norbital_id: { eq: assignmentId } },
							columns: { status: true }
						});
						if (currentAssignment?.status !== 'completed') return;
						const [directEvidence, variations] = yield* Effect.all(
							[
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
							],
							{ concurrency: 'unbounded' }
						);
						const variationIds = variations.map((variation) => variation.norbital_id);
						const variationEvidence =
							variationIds.length === 0
								? []
								: yield* api.db.query.photo_evidence.findMany({
										where: { variation_request_id: { in: variationIds } },
										columns: { site_identity_status: true },
										limit: 1000
									});
						const unsettled = [...directEvidence, ...variationEvidence].some(
							(photo) =>
								photo.site_identity_status === 'pending' || photo.site_identity_status === 'failed'
						);
						if (!unsettled) {
							yield* api.db.job_assignments.update(assignmentId, { status: 'completed' });
						}
					});
				const job = yield* api.db.query.jobs.findFirst({
					where: { norbital_id: { eq: assignment.job_id } },
					columns: { title: true, site_id: true }
				});
				if (job == null) {
					yield* settleEvidence('inconclusive');
					yield* finalizeCompletedAssignmentIfSettled();
					return { status: 'skipped', reason: 'linked job no longer exists' };
				}
				const site = yield* api.db.query.sites.findFirst({
					where: { norbital_id: { eq: job.site_id } },
					columns: { name: true, location: true }
				});
				if (site == null) {
					yield* settleEvidence('inconclusive');
					yield* finalizeCompletedAssignmentIfSettled();
					return { status: 'skipped', reason: 'assigned site no longer exists' };
				}
				const expectedAddress = formattedAddress(site.location);
				const integrityFlags = [...evidence.flags];
				const matchedEvidenceCount = evidence.matched_evidence_ids.length;

				const checkedAt = new Date();
				return yield* Effect.gen(function* () {
					const inferred = yield* api.infer({
						model: FAST_VISION_MODEL,
						schema: siteIdentitySchema,
						images: [{ assetId: evidence.document_asset_id, detail: 'high' }],
						prompt: [
							'Inspect the attached job-site photo and compare it with the assigned site below.',
							`Assigned job: ${job.title}.`,
							`Assigned site: ${site.name}.`,
							...(expectedAddress == null ? [] : [`Assigned mapped address: ${expectedAddress}.`]),
							`Deterministic evidence attributes: ${integrityFlags.length > 0 ? integrityFlags.join(', ') : 'none'}.`,
							`Cross-assignment similarity matches: ${matchedEvidenceCount}.`,
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
							'Missing GPS by itself is neutral because WhatsApp and other messaging services commonly strip',
							'EXIF metadata. Exact or visual similarity is also an attribute, not a verdict: weigh whether it',
							'shows suspicious reuse across unrelated work or a legitimate repeated view. A concrete GPS',
							'location mismatch is strong contradictory evidence, but still explain it with the visible scene.',
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
						yield* settleEvidence('mismatch');
						yield* api.db.job_assignments.update(assignmentId, {
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
						yield* settleEvidence('match');
						yield* api.db.job_assignments.update(
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
						yield* finalizeCompletedAssignmentIfSettled();
						return {
							status: 'match',
							model: FAST_VISION_MODEL,
							confidence: inferred.confidence,
							rationale: inferred.rationale
						};
					}

					yield* settleEvidence('inconclusive');
					if (!assignment.site_identity_mismatch) {
						yield* api.db.job_assignments.update(assignmentId, {
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
					yield* finalizeCompletedAssignmentIfSettled();
					return {
						status: 'unavailable',
						model: FAST_VISION_MODEL,
						confidence: inferred.confidence,
						rationale: inferred.rationale
					};
				}).pipe(
					Effect.catch((error: unknown) =>
						Effect.gen(function* () {
							const message = error instanceof Error ? error.message : String(error);
							yield* settleEvidence('failed', message);
							return yield* Effect.fail(error);
						})
					)
				);
			})
	}
);
