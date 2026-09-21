import assert from 'node:assert/strict';
import test from 'node:test';
import collection from '../src/collections/job_assignments/+collection.js';

/**
 * What an update may say.
 *
 * The work order's identity keys are create-only — a redelivery or a re-import may not restate which
 * job a row is — while naming the contractor *is* the dispatch, so `assignee_user_id` is an update
 * input.
 */
test('the update selection carries the dispatch and the progress, never the identity keys', () => {
	for (const column of ['external_ref', 'source_message_id']) {
		assert.equal(column in collection.update.input.columns, false, column);
	}
	for (const column of ['assignee_user_id', 'dispatched_at', 'status', 'completed_at']) {
		assert.equal(column in collection.update.input.columns, true, column);
	}
});
