import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';

export const PHOTO_SITE_IDENTITY_MODEL = 'stepfun/step-3.7-flash';

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

export interface PhotoEvidenceReviewRecord {
	readonly norbital_id: string;
	readonly job_assignment_id: string | null;
	readonly variation_request_id: string | null;
	readonly document_asset_id: string;
	readonly sha256: string;
	readonly flags: readonly string[];
	readonly matched_evidence_ids: readonly string[];
	readonly site_identity_status: 'pending' | 'match' | 'mismatch' | 'inconclusive' | 'failed';
	readonly site_identity_review_basis: string | null;
}

interface AssignmentContext {
	readonly norbital_id: string;
	readonly job_id: string;
	readonly status: string | null;
	readonly site_identity_mismatch: boolean;
}

interface JobContext {
	readonly norbital_id: string;
	readonly title: string;
	readonly site_id: string;
}

interface SiteContext {
	readonly norbital_id: string;
	readonly name: string;
	readonly location: { readonly formatted_address: string } | null;
}

export interface PhotoSiteIdentityContext {
	readonly evidence: PhotoEvidenceReviewRecord;
	readonly assignmentId: string | null;
	readonly assignment: AssignmentContext | null;
	readonly job: JobContext | null;
	readonly site: SiteContext | null;
}

function present(value: string | null): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : null;
}

function formattedAddress(location: SiteContext['location']): string | null {
	if (location == null) return null;
	const address = location.formatted_address;
	return address.trim() !== '' ? address.trim() : null;
}

export function photoSiteIdentityReviewBasis(context: PhotoSiteIdentityContext): string {
	return JSON.stringify({
		evidence: {
			document_asset_id: context.evidence.document_asset_id,
			sha256: context.evidence.sha256,
			job_assignment_id: context.evidence.job_assignment_id,
			variation_request_id: context.evidence.variation_request_id,
			flags: [...context.evidence.flags].sort(),
			matched_evidence_ids: [...context.evidence.matched_evidence_ids].sort()
		},
		assignment:
			context.assignment == null
				? null
				: {
						norbital_id: context.assignment.norbital_id,
						job_id: context.assignment.job_id
					},
		job:
			context.job == null
				? null
				: {
						norbital_id: context.job.norbital_id,
						title: context.job.title,
						site_id: context.job.site_id
					},
		site:
			context.site == null
				? null
				: {
						norbital_id: context.site.norbital_id,
						name: context.site.name,
						formatted_address: formattedAddress(context.site.location)
					}
	});
}

export function loadPhotoSiteIdentityContexts(
	api: Api,
	evidenceRows: readonly PhotoEvidenceReviewRecord[]
) {
	return Effect.gen(function* () {
		const variationIds = [
			...new Set(
				evidenceRows.flatMap((evidence) =>
					evidence.job_assignment_id == null && evidence.variation_request_id != null
						? [evidence.variation_request_id]
						: []
				)
			)
		];
		const variations = variationIds.length
			? yield* api.db.query.variation_requests.findMany({
					where: { norbital_id: { in: variationIds } },
					columns: { norbital_id: true, job_assignment_id: true },
					limit: variationIds.length
				})
			: [];
		const assignmentByVariation = new Map(
			variations.map((variation) => [variation.norbital_id, variation.job_assignment_id ?? null])
		);
		const assignmentIdByEvidence = new Map(
			evidenceRows.map((evidence) => [
				evidence.norbital_id,
				evidence.job_assignment_id ??
					(evidence.variation_request_id == null
						? null
						: (assignmentByVariation.get(evidence.variation_request_id) ?? null))
			])
		);
		const assignmentIds = [
			...new Set(
				[...assignmentIdByEvidence.values()].filter((value): value is string => value != null)
			)
		];
		const assignments = assignmentIds.length
			? yield* api.db.query.job_assignments.findMany({
					where: { norbital_id: { in: assignmentIds } },
					columns: {
						norbital_id: true,
						job_id: true,
						status: true,
						site_identity_mismatch: true
					},
					limit: assignmentIds.length
				})
			: [];
		const assignmentById = new Map(assignments.map((row) => [row.norbital_id, row]));
		const jobIds = [...new Set(assignments.map((assignment) => assignment.job_id))];
		const jobs = jobIds.length
			? yield* api.db.query.jobs.findMany({
					where: { norbital_id: { in: jobIds } },
					columns: { norbital_id: true, title: true, site_id: true },
					limit: jobIds.length
				})
			: [];
		const jobById = new Map(jobs.map((row) => [row.norbital_id, row]));
		const siteIds = [...new Set(jobs.map((job) => job.site_id))];
		const sites = siteIds.length
			? yield* api.db.query.sites.findMany({
					where: { norbital_id: { in: siteIds } },
					columns: { norbital_id: true, name: true, location: true },
					limit: siteIds.length
				})
			: [];
		const siteById = new Map(sites.map((row) => [row.norbital_id, row]));

		return evidenceRows.map((evidence): PhotoSiteIdentityContext => {
			const assignmentId = assignmentIdByEvidence.get(evidence.norbital_id) ?? null;
			const assignment = assignmentId == null ? null : (assignmentById.get(assignmentId) ?? null);
			const job = assignment == null ? null : (jobById.get(assignment.job_id) ?? null);
			const site = job == null ? null : (siteById.get(job.site_id) ?? null);
			return { evidence, assignmentId, assignment, job, site };
		});
	});
}

export function reconcilePhotoSiteIdentity(api: Api, context: PhotoSiteIdentityContext) {
	return Effect.gen(function* () {
		const { evidence, assignmentId, assignment, job, site } = context;
		const basis = photoSiteIdentityReviewBasis(context);
		const reconciledAt = new Date();
		const settleEvidence = (
			status: 'match' | 'mismatch' | 'inconclusive' | 'failed',
			error: string | null = null
		) =>
			api.db.photo_evidence.update(evidence.norbital_id, {
				site_identity_status: status,
				site_identity_checked_at: reconciledAt,
				site_identity_error: error,
				site_identity_review_basis: basis,
				site_identity_reconciled_at: reconciledAt
			});

		if (
			evidence.site_identity_review_basis === basis &&
			evidence.site_identity_status !== 'pending' &&
			evidence.site_identity_status !== 'failed'
		) {
			yield* api.db.photo_evidence.update(evidence.norbital_id, {
				site_identity_reconciled_at: reconciledAt
			});
			return { status: 'unchanged', evidence_id: evidence.norbital_id };
		}

		if (assignmentId == null) {
			yield* settleEvidence('inconclusive');
			return { status: 'inconclusive', evidence_id: evidence.norbital_id };
		}
		if (assignment == null) {
			yield* settleEvidence('inconclusive');
			return { status: 'inconclusive', evidence_id: evidence.norbital_id };
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
							limit: 5_000
						}),
						api.db.query.variation_requests.findMany({
							where: { job_assignment_id: { eq: assignmentId } },
							columns: { norbital_id: true },
							limit: 5_000
						})
					],
					{ concurrency: 'unbounded' }
				);
				const variationIds = variations.map((variation) => variation.norbital_id);
				const variationEvidence = variationIds.length
					? yield* api.db.query.photo_evidence.findMany({
							where: { variation_request_id: { in: variationIds } },
							columns: { site_identity_status: true },
							limit: 5_000
						})
					: [];
				const unsettled = [...directEvidence, ...variationEvidence].some(
					(photo) =>
						photo.site_identity_status === 'pending' || photo.site_identity_status === 'failed'
				);
				if (!unsettled) {
					yield* api.db.job_assignments.update(assignmentId, { status: 'completed' });
				}
			});

		if (job == null || site == null) {
			yield* settleEvidence('inconclusive');
			yield* finalizeCompletedAssignmentIfSettled();
			return { status: 'inconclusive', evidence_id: evidence.norbital_id };
		}

		const expectedAddress = formattedAddress(site.location);
		const integrityFlags = [...evidence.flags];
		const matchedEvidenceCount = evidence.matched_evidence_ids.length;

		return yield* Effect.gen(function* () {
			const inferred = yield* api.infer({
				model: PHOTO_SITE_IDENTITY_MODEL,
				schema: siteIdentitySchema,
				images: [{ assetId: evidence.document_asset_id, detail: 'high' }],
				prompt: [
					'Inspect the attached job-site photo and compare it with the transcript-assigned site below.',
					`Assigned job: ${job.title}.`,
					`Assigned site: ${site.name}.`,
					...(expectedAddress == null ? [] : [`Assigned mapped address: ${expectedAddress}.`]),
					`Deterministic evidence attributes: ${integrityFlags.length > 0 ? integrityFlags.join(', ') : 'none'}.`,
					`Cross-assignment similarity matches: ${matchedEvidenceCount}.`,
					'The transcript association is authoritative: never move or reinterpret the parent job from',
					'the image. Your task is only to identify evidence that makes that filing suspicious.',
					'Judge the naturally photographed scene: signs and addresses, building or site type,',
					'architecture, surrounding landmarks, access points, unit layout, and visible work context.',
					'Extract any naturally present site/building name, street or block sign, address plaque, and',
					'unit, lot, or door number that is legible.',
					'Treat synthetic overlays asymmetrically. A matching overlay, caption, watermark, timestamp,',
					'filename, border, or badge is never proof of a match because it can be fabricated. A clearly',
					'contradictory location claim in an overlay is suspicious evidence and must be explained; use',
					'mismatch when that contradiction or the natural scene clearly identifies another site.',
					'Use multimodal judgement rather than exact string matching. Mark mismatch when the photographed',
					'location is visibly a different house, unit, block, street, named site, building type, or work',
					'setting; mark match when the natural scene supports the assigned site; otherwise inconclusive.',
					'Missing GPS by itself is neutral because messaging services commonly strip EXIF metadata.',
					'Exact or visual similarity is also an attribute, not a verdict: weigh suspicious reuse across',
					'unrelated work against legitimate repeated views. A concrete GPS mismatch is strong evidence.',
					'Set evidence_available true when enough visual evidence exists for the judgement, even if no',
					'text identifier can be extracted. Explain decisive evidence and conflicts briefly for audit.',
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
					site_identity_checked_at: reconciledAt,
					site_identity_rationale: inferred.rationale
				});
				/**
				 * The suspicion is a log, not a status.
				 *
				 * `status: 'suspect'` used to be written here, which put a *finding* into the field that
				 * says where the work has got to — so a mismatched photo erased whether the job was
				 * assigned or completed, and the two questions could never be asked separately. Dispatch
				 * lost the ability to see a suspicious job that was nonetheless finished.
				 *
				 * The reason names what was seen rather than restating the verdict: an identifier that
				 * does not match is a sentence a controller can act on, where "suspect" is one they have
				 * to go and interpret.
				 */
				yield* api.db.suspicious_activity_logs.create({
					job_assignment_id: assignmentId,
					reason:
						`A photograph of this job shows ${unitNumber ?? siteName ?? 'an identifier'} ` +
						`which does not match the assigned site. ${inferred.rationale}`
				});
				return { status: 'mismatch', evidence_id: evidence.norbital_id };
			}

			if (available && inferred.relation_to_assigned_site === 'match') {
				yield* settleEvidence('match');
				yield* api.db.job_assignments.update(
					assignmentId,
					assignment.site_identity_mismatch
						? { site_identity_unverified: false, site_identity_checked_at: reconciledAt }
						: {
								site_identity_unverified: false,
								site_identity_evidence_id: evidence.norbital_id,
								extracted_site_name: siteName,
								extracted_site_location: siteLocation,
								extracted_unit_number: unitNumber,
								site_identity_confidence: inferred.confidence,
								site_identity_checked_at: reconciledAt,
								site_identity_rationale: inferred.rationale
							}
				);
				yield* finalizeCompletedAssignmentIfSettled();
				return { status: 'match', evidence_id: evidence.norbital_id };
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
					site_identity_checked_at: reconciledAt,
					site_identity_rationale: inferred.rationale
				});
			}
			yield* finalizeCompletedAssignmentIfSettled();
			return { status: 'inconclusive', evidence_id: evidence.norbital_id };
		}).pipe(
			Effect.catch((error: unknown) =>
				Effect.gen(function* () {
					const message = error instanceof Error ? error.message : String(error);
					yield* settleEvidence('failed', message);
					return { status: 'failed', evidence_id: evidence.norbital_id, error: message };
				})
			)
		);
	});
}
