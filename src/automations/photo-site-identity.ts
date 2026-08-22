import { Clock, Effect, Schema } from 'effect';
import type { Api } from './$types.js';

const PHOTO_SITE_IDENTITY_MODEL = 'stepfun/step-3.7-flash';

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

export const photoEvidenceReviewRecordSchema = Schema.Struct({
	id: Schema.String,
	job_assignment_id: Schema.NullOr(Schema.String),
	variation_request_id: Schema.NullOr(Schema.String),
	photo: Schema.Struct({
		storage_key: Schema.String,
		file_name: Schema.String,
		file_size: Schema.Number,
		mime_type: Schema.String
	}),
	sha256: Schema.String,
	flags: Schema.Array(Schema.String),
	matched_evidence_ids: Schema.Array(Schema.String),
	site_identity_status: Schema.Literals(['pending', 'match', 'mismatch', 'inconclusive', 'failed']),
	site_identity_review_basis: Schema.NullOr(Schema.String)
});

type PhotoEvidenceReviewRecord = Schema.Schema.Type<typeof photoEvidenceReviewRecordSchema>;

const assignmentContextSchema = Schema.Struct({
	id: Schema.String,
	job_id: Schema.String,
	status: Schema.NullOr(Schema.String),
	site_identity_mismatch: Schema.Boolean
});
type AssignmentContext = Schema.Schema.Type<typeof assignmentContextSchema>;

const jobContextSchema = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	site_id: Schema.String
});
type JobContext = Schema.Schema.Type<typeof jobContextSchema>;

const siteContextSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	location: Schema.NullOr(Schema.Struct({ formatted_address: Schema.String }))
});
type SiteContext = Schema.Schema.Type<typeof siteContextSchema>;

const photoSiteIdentityContextSchema = Schema.Struct({
	evidence: photoEvidenceReviewRecordSchema,
	assignmentId: Schema.NullOr(Schema.String),
	assignment: Schema.NullOr(assignmentContextSchema),
	job: Schema.NullOr(jobContextSchema),
	site: Schema.NullOr(siteContextSchema)
});

export type PhotoSiteIdentityContext = Schema.Schema.Type<typeof photoSiteIdentityContextSchema>;

/**
 * Which evidence fields the review basis turns on: the file's key and the deterministic facts the
 * verdict exists to explain. The projection is what `photoSiteIdentityReviewBasis` serializes.
 */
const reviewBasisEvidenceSchema = Schema.Struct({
	sha256: Schema.String,
	job_assignment_id: Schema.NullOr(Schema.String),
	variation_request_id: Schema.NullOr(Schema.String),
	flags: Schema.Array(Schema.String),
	matched_evidence_ids: Schema.Array(Schema.String)
});

const decodeReviewBasisEvidence = Schema.decodeUnknownSync(reviewBasisEvidenceSchema);

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
	const basisEvidence = decodeReviewBasisEvidence(context.evidence);
	return JSON.stringify({
		evidence: {
			// The storage key, not the whole value: `file_name` and `file_size` are description, and a
			// review basis that changed when a file was renamed would re-run every verdict for nothing.
			photo: context.evidence.photo.storage_key,
			...basisEvidence,
			// Stored as one canonical ordering, so a set re-ordered by a mapper cannot re-run a verdict.
			flags: [...basisEvidence.flags].sort(),
			matched_evidence_ids: [...basisEvidence.matched_evidence_ids].sort()
		},
		assignment:
			context.assignment == null
				? null
				: {
						id: context.assignment.id,
						job_id: context.assignment.job_id
					},
		job:
			context.job == null
				? null
				: {
						id: context.job.id,
						title: context.job.title,
						site_id: context.job.site_id
					},
		site:
			context.site == null
				? null
				: {
						id: context.site.id,
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
					where: { id: { in: variationIds } },
					columns: { id: true, job_assignment_id: true },
					limit: variationIds.length
				})
			: [];
		const assignmentByVariation = new Map(
			variations.map((variation) => [variation.id, variation.job_assignment_id ?? null])
		);
		const assignmentIdByEvidence = new Map(
			evidenceRows.map((evidence) => [
				evidence.id,
				evidence.job_assignment_id ??
					(evidence.variation_request_id == null
						? null
						: (assignmentByVariation.get(evidence.variation_request_id) ?? null))
			])
		);
		const assignmentIds = [
			...new Set(
				evidenceRows.flatMap((evidence) => {
					const assignmentId =
						evidence.job_assignment_id ??
						(evidence.variation_request_id == null
							? null
							: (assignmentByVariation.get(evidence.variation_request_id) ?? null));
					return assignmentId == null ? [] : [assignmentId];
				})
			)
		];
		const assignments = assignmentIds.length
			? yield* api.db.query.job_assignments.findMany({
					where: { id: { in: assignmentIds } },
					columns: {
						id: true,
						job_id: true,
						status: true,
						site_identity_mismatch: true
					},
					limit: assignmentIds.length
				})
			: [];
		const assignmentById = new Map(assignments.map((row) => [row.id, row]));
		const jobIds = [...new Set(assignments.map((assignment) => assignment.job_id))];
		const jobs = jobIds.length
			? yield* api.db.query.jobs.findMany({
					where: { id: { in: jobIds } },
					columns: { id: true, title: true, site_id: true },
					limit: jobIds.length
				})
			: [];
		const jobById = new Map(jobs.map((row) => [row.id, row]));
		const siteIds = [...new Set(jobs.map((job) => job.site_id))];
		const sites = siteIds.length
			? yield* api.db.query.sites.findMany({
					where: { id: { in: siteIds } },
					columns: { id: true, name: true, location: true },
					limit: siteIds.length
				})
			: [];
		const siteById = new Map(sites.map((row) => [row.id, row]));

		return evidenceRows.map((evidence): PhotoSiteIdentityContext => {
			const assignmentId = assignmentIdByEvidence.get(evidence.id) ?? null;
			const assignment = assignmentId == null ? null : (assignmentById.get(assignmentId) ?? null);
			const job = assignment == null ? null : (jobById.get(assignment.job_id) ?? null);
			const site = job == null ? null : (siteById.get(job.site_id) ?? null);
			return { evidence, assignmentId, assignment, job, site };
		});
	});
}

export function reconcilePhotoSiteIdentity(api: Api, context: PhotoSiteIdentityContext) {
	return Effect.gen(function* () {
		const basis = photoSiteIdentityReviewBasis(context);
		const reconciledAt = new Date(yield* Clock.currentTimeMillis);
		const settleEvidence = (
			status: 'match' | 'mismatch' | 'inconclusive' | 'failed',
			error: string | null = null
		) =>
			api.db.photo_evidence.update(context.evidence.id, {
				site_identity_status: status,
				site_identity_checked_at: reconciledAt,
				site_identity_error: error,
				site_identity_review_basis: basis,
				site_identity_reconciled_at: reconciledAt
			});

		if (
			context.evidence.site_identity_review_basis === basis &&
			context.evidence.site_identity_status !== 'pending' &&
			context.evidence.site_identity_status !== 'failed'
		) {
			yield* api.db.photo_evidence.update(context.evidence.id, {
				site_identity_reconciled_at: reconciledAt
			});
			return { status: 'unchanged', evidence_id: context.evidence.id };
		}

		if (context.assignmentId == null) {
			yield* settleEvidence('inconclusive');
			return { status: 'inconclusive', evidence_id: context.evidence.id };
		}
		const assignmentId = context.assignmentId;
		if (context.assignment == null) {
			yield* settleEvidence('inconclusive');
			return { status: 'inconclusive', evidence_id: context.evidence.id };
		}
		const assignment = context.assignment;

		const finalizeCompletedAssignmentIfSettled = () =>
			Effect.gen(function* () {
				const currentAssignment = yield* api.db.query.job_assignments.findFirst({
					where: { id: { eq: assignmentId } },
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
							columns: { id: true },
							limit: 5_000
						})
					],
					{ concurrency: 'unbounded' }
				);
				const variationIds = variations.map((variation) => variation.id);
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

		if (context.job == null || context.site == null) {
			yield* settleEvidence('inconclusive');
			yield* finalizeCompletedAssignmentIfSettled();
			return { status: 'inconclusive', evidence_id: context.evidence.id };
		}
		const job = context.job;
		const site = context.site;

		const expectedAddress = formattedAddress(site.location);
		const integrityFlags = [...context.evidence.flags];
		const matchedEvidenceCount = context.evidence.matched_evidence_ids.length;

		return yield* Effect.gen(function* () {
			const inferred = yield* api.infer({
				model: PHOTO_SITE_IDENTITY_MODEL,
				schema: siteIdentitySchema,
				images: [{ file: context.evidence.photo, detail: 'high' }],
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
					site_identity_evidence_id: context.evidence.id,
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
				return { status: 'mismatch', evidence_id: context.evidence.id };
			}

			if (available && inferred.relation_to_assigned_site === 'match') {
				yield* settleEvidence('match');
				yield* api.db.job_assignments.update(
					assignmentId,
					assignment.site_identity_mismatch
						? { site_identity_unverified: false, site_identity_checked_at: reconciledAt }
						: {
								site_identity_unverified: false,
								site_identity_evidence_id: context.evidence.id,
								extracted_site_name: siteName,
								extracted_site_location: siteLocation,
								extracted_unit_number: unitNumber,
								site_identity_confidence: inferred.confidence,
								site_identity_checked_at: reconciledAt,
								site_identity_rationale: inferred.rationale
							}
				);
				yield* finalizeCompletedAssignmentIfSettled();
				return { status: 'match', evidence_id: context.evidence.id };
			}

			yield* settleEvidence('inconclusive');
			if (!assignment.site_identity_mismatch) {
				yield* api.db.job_assignments.update(assignmentId, {
					site_identity_unverified: true,
					site_identity_evidence_id: context.evidence.id,
					extracted_site_name: siteName,
					extracted_site_location: siteLocation,
					extracted_unit_number: unitNumber,
					site_identity_confidence: inferred.confidence,
					site_identity_checked_at: reconciledAt,
					site_identity_rationale: inferred.rationale
				});
			}
			yield* finalizeCompletedAssignmentIfSettled();
			return { status: 'inconclusive', evidence_id: context.evidence.id };
		}).pipe(
			Effect.catch((error: unknown) =>
				Effect.gen(function* () {
					const message = error instanceof Error ? error.message : String(error);
					yield* settleEvidence('failed', message);
					return { status: 'failed', evidence_id: context.evidence.id, error: message };
				})
			)
		);
	});
}
