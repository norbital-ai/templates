import assert from 'node:assert/strict';
import test from 'node:test';
import suspicionReviews from '../src/collections/suspicion_reviews/+collection.js';

test('the immutable review ledger accepts its automated create and nothing else', () => {
	assert.deepEqual(Object.keys(suspicionReviews.create.input.columns), [
		'job_assignment_id',
		'basis_hash',
		'basis',
		'suspicious',
		'reason',
		'evidence_id',
		'model',
		'reviewed_at',
		'source_key'
	]);
	// No update and no delete endpoint: a review cannot be changed after inference.
	assert.equal(suspicionReviews.update, undefined);
	assert.equal(suspicionReviews.delete, undefined);
	assert.equal(suspicionReviews.transform, undefined);
});
