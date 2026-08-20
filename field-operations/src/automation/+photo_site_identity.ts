import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import {
	loadPhotoSiteIdentityContexts,
	reconcilePhotoSiteIdentity,
	type PhotoEvidenceReviewRecord
} from './photo-site-identity.js';

const reviewColumns = {
	norbital_id: true,
	job_assignment_id: true,
	variation_request_id: true,
	document_asset_id: true,
	sha256: true,
	flags: true,
	matched_evidence_ids: true,
	site_identity_status: true,
	site_identity_review_basis: true
} as const;

export default defineAutomation(
	{ trigger: { collection: 'photo_evidence', event: 'created' } },
	{
		description:
			'Immediately runs the shared site-identity reconciliation for newly filed evidence; the daily sweep retries failures and catches seed/import paths that do not emit collection events.',
		handler: (api, { scope }) =>
			Effect.gen(function* () {
				const evidence = yield* api.db.query.photo_evidence.findFirst({
					where: { norbital_id: { eq: scope.incoming_record.norbital_id } },
					columns: reviewColumns
				});
				if (evidence == null) {
					return { status: 'skipped', reason: 'photo evidence no longer exists' };
				}
				const [context] = yield* loadPhotoSiteIdentityContexts(api, [
					evidence as PhotoEvidenceReviewRecord
				]);
				if (context == null) return { status: 'skipped', reason: 'review context unavailable' };
				return yield* reconcilePhotoSiteIdentity(api, context);
			})
	}
);
