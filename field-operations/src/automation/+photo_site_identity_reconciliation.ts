import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import {
	loadPhotoSiteIdentityContexts,
	reconcilePhotoSiteIdentity,
	type PhotoEvidenceReviewRecord
} from './photo-site-identity.js';

const MAX_DAILY_EVIDENCE = 5_000;

export default defineAutomation(
	{ schedule: '0 2 * * *' },
	{
		description:
			'Every day reconciles up to 5,000 least-recently checked photos against their current assignment and site, reusing the immediate review logic; unchanged review bases are marked reconciled without another vision call, while pending, failed, or changed evidence is reviewed again.',
		handler: (api) =>
			Effect.gen(function* () {
				const evidence = yield* api.db.query.photo_evidence.findMany({
					columns: {
						norbital_id: true,
						job_assignment_id: true,
						variation_request_id: true,
						document_asset_id: true,
						sha256: true,
						flags: true,
						matched_evidence_ids: true,
						site_identity_status: true,
						site_identity_review_basis: true
					},
					orderBy: { site_identity_reconciled_at: 'asc' },
					limit: MAX_DAILY_EVIDENCE
				});
				const contexts = yield* loadPhotoSiteIdentityContexts(
					api,
					evidence as PhotoEvidenceReviewRecord[]
				);
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
					reconciled_at: new Date().toISOString(),
					evidence_count: evidence.length,
					counts
				};
			})
	}
);
