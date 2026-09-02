import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewCandidatesFrom } from '../../src/collections/job_assignments/suspicion-evidence.js';

test('reads and deduplicates the exact cross-assignment candidates stored in review bases', () => {
	const candidate = {
		id: 'candidate-photo',
		storage_key: 'evidence/candidate.jpg',
		distance: 0.126,
		matched_photo_ids: ['submitted-photo']
	};
	assert.deepEqual(
		reviewCandidatesFrom([
			JSON.stringify({ candidates: [candidate], unrelated: true }),
			JSON.stringify({ candidates: [{ ...candidate, distance: 0.2 }] })
		]),
		[
			{
				id: 'candidate-photo',
				storageKey: 'evidence/candidate.jpg',
				distance: 0.126,
				matchedPhotoIds: ['submitted-photo']
			}
		]
	);
});

test('ignores malformed historical review bases without hiding valid evidence', () => {
	assert.deepEqual(
		reviewCandidatesFrom([
			'{not-json',
			JSON.stringify({ candidates: [{ id: 'incomplete' }] }),
			JSON.stringify({
				candidates: [
					{
						id: 'valid',
						storage_key: 'evidence/valid.jpg',
						distance: 0.1,
						matched_photo_ids: []
					}
				]
			})
		]),
		[
			{
				id: 'valid',
				storageKey: 'evidence/valid.jpg',
				distance: 0.1,
				matchedPhotoIds: []
			}
		]
	);
});
