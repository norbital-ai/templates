import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import {
	loadPhotoSiteIdentityContexts,
	photoEvidenceReviewRecordSchema,
	reconcilePhotoSiteIdentity
} from './photo-site-identity.js';

const MAX_DAILY_EVIDENCE = 5_000;

export default defineAutomation(
	{ schedule: '0 2 * * *' },
	{
		/**
		 * The authority every run of this automation acts under.
		 *
		 * Its own, not its trigger's. This used to inherit whoever tripped it — so the same nightly
		 * sweep ran as an administrator when an administrator happened to start it, and as a contractor
		 * otherwise, over a different set of rows each time. Naming it here is what makes "what can this
		 * automation touch" a question with an answer that does not depend on the day.
		 */
		policies: ['field_ops_controller'],
		description:
			'Every day reconciles up to 5,000 photos against their current assignment and site, prioritizing pending and failed work before a least-recently checked terminal round-robin; unchanged review bases are marked reconciled without another vision call, while changed evidence is reviewed again.',
		handler: (api) =>
			Effect.gen(function* () {
				const columns = {
					id: true,
					job_assignment_id: true,
					variation_request_id: true,
					photo: true,
					sha256: true,
					flags: true,
					matched_evidence_ids: true,
					site_identity_status: true,
					site_identity_review_basis: true
				} as const;
				// PostgreSQL sorts null timestamps last for ascending order. Keep the queues disjoint so
				// pending work cannot be hidden behind terminal rows, failed work rotates by its last
				// attempt, and pre-migration terminal rows with no basis are reviewed before the stable
				// terminal round-robin.
				const pendingEvidence = yield* api.db.query.photo_evidence.findMany({
					where: { site_identity_status: { eq: 'pending' } },
					columns,
					limit: MAX_DAILY_EVIDENCE
				});
				let remaining = MAX_DAILY_EVIDENCE - pendingEvidence.length;
				const failedEvidence = remaining
					? yield* api.db.query.photo_evidence.findMany({
							where: { site_identity_status: { eq: 'failed' } },
							columns,
							orderBy: { site_identity_checked_at: 'asc' },
							limit: remaining
						})
					: [];
				remaining -= failedEvidence.length;
				const unbasedTerminalEvidence = remaining
					? yield* api.db.query.photo_evidence.findMany({
							where: {
								site_identity_status: { in: ['match', 'mismatch', 'inconclusive'] },
								OR: [
									{ site_identity_review_basis: { isNull: true } },
									{ site_identity_reconciled_at: { isNull: true } }
								]
							},
							columns,
							limit: remaining
						})
					: [];
				remaining -= unbasedTerminalEvidence.length;
				const terminalEvidence = remaining
					? yield* api.db.query.photo_evidence.findMany({
							where: {
								site_identity_status: { in: ['match', 'mismatch', 'inconclusive'] },
								site_identity_review_basis: { isNull: false },
								site_identity_reconciled_at: { isNull: false }
							},
							columns,
							orderBy: { site_identity_reconciled_at: 'asc' },
							limit: remaining
						})
					: [];
				const evidence = [
					...pendingEvidence,
					...failedEvidence,
					...unbasedTerminalEvidence,
					...terminalEvidence
				];
				const reviewRecords = yield* Schema.decodeUnknownEffect(
					Schema.Array(photoEvidenceReviewRecordSchema)
				)(evidence);
				const contexts = yield* loadPhotoSiteIdentityContexts(api, reviewRecords);
				const results = yield* Effect.forEach(
					contexts,
					(context) => reconcilePhotoSiteIdentity(api, context),
					{ concurrency: 4 }
				);
				const counts = results.reduce<Record<string, number>>((summary, result) => {
					summary[result.status] = (summary[result.status] ?? 0) + 1;
					return summary;
				}, {});
				return {
					automation_key: 'photo_site_identity_reconciliation',
					reconciled_at: new Date(yield* Clock.currentTimeMillis).toISOString(),
					evidence_count: evidence.length,
					counts
				};
			})
	}
);
