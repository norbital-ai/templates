import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import {
	photoSiteIdentityReviewBasis,
	type PhotoSiteIdentityContext
} from '../../automations/photo-site-identity.js';
import hooks from './+hooks.js';

/** A `file()` value, which is what `photo` holds — the whole file, not a pointer to one. */
const photoFile = (name: string) => ({
	storage_key: `photos/${name}.jpg`,
	file_name: `${name}.jpg`,
	file_size: 1024,
	mime_type: 'image/jpeg'
});

function context(): PhotoSiteIdentityContext {
	return {
		evidence: {
			norbital_id: 'evidence-a',
			job_assignment_id: 'assignment-a',
			variation_request_id: null,
			photo: photoFile('asset-a'),
			sha256: 'abc123',
			flags: ['visual_duplicate', 'missing_geolocation'],
			matched_evidence_ids: ['evidence-c', 'evidence-b'],
			site_identity_status: 'match',
			site_identity_review_basis: null
		},
		assignmentId: 'assignment-a',
		assignment: {
			norbital_id: 'assignment-a',
			job_id: 'job-a',
			status: 'completed',
			site_identity_mismatch: false
		},
		job: { norbital_id: 'job-a', title: 'Install grab bars', site_id: 'site-a' },
		site: {
			norbital_id: 'site-a',
			name: '58 Kismis Avenue',
			location: { formatted_address: '58 Kismis Avenue, Singapore 598235' }
		}
	};
}

test('keeps the semantic review basis stable across set and status ordering noise', () => {
	const original = context();
	const reordered: PhotoSiteIdentityContext = {
		...original,
		evidence: {
			...original.evidence,
			flags: [...original.evidence.flags].reverse(),
			matched_evidence_ids: [...original.evidence.matched_evidence_ids].reverse(),
			site_identity_status: 'inconclusive'
		},
		// A different status, to prove the review basis does not turn on it. `suspect` used to be the
		// value here and is no longer a status at all — suspicion is a `suspicious_activity_logs` row.
		assignment: original.assignment == null ? null : { ...original.assignment, status: 'completed' }
	};

	assert.equal(photoSiteIdentityReviewBasis(reordered), photoSiteIdentityReviewBasis(original));
});

test('changes the semantic review basis when evidence or assigned-site facts change', () => {
	const original = context();
	const evidenceChanged: PhotoSiteIdentityContext = {
		...original,
		evidence: { ...original.evidence, flags: [...original.evidence.flags, 'location_mismatch'] }
	};
	const siteChanged: PhotoSiteIdentityContext = {
		...original,
		site:
			original.site == null
				? null
				: {
						...original.site,
						location: { formatted_address: '17D Neo Pee Teck Lane, Singapore 119048' }
					}
	};

	assert.notEqual(
		photoSiteIdentityReviewBasis(evidenceChanged),
		photoSiteIdentityReviewBasis(original)
	);
	assert.notEqual(
		photoSiteIdentityReviewBasis(siteChanged),
		photoSiteIdentityReviewBasis(original)
	);
});

test('returns changed deterministic integrity inputs to pending reconciliation', async () => {
	const handler = hooks.update?.perRecord?.before?.handler;
	assert.ok(handler);
	const result = await Effect.runPromise(
		handler({
			input: { flags: ['missing_geolocation', 'location_mismatch'] },
			existing: {
				job_assignment_id: 'assignment-a',
				variation_request_id: null,
				photo: photoFile('asset-a'),
				source_key: 'workspace:asset-a',
				source: { kind: 'workspace_upload' },
				flags: ['missing_geolocation'],
				matched_evidence_ids: [],
				site_identity_status: 'match',
				site_identity_checked_at: new Date('2026-08-20T00:00:00Z'),
				site_identity_error: null,
				site_identity_review_basis: '{"reviewed":true}',
				site_identity_reconciled_at: new Date('2026-08-20T00:00:00Z')
			}
		} as never)
	);

	assert.deepEqual(result, {
		flags: ['missing_geolocation', 'location_mismatch'],
		site_identity_status: 'pending',
		site_identity_checked_at: null,
		site_identity_error: null,
		site_identity_review_basis: null,
		site_identity_reconciled_at: null
	});
});
