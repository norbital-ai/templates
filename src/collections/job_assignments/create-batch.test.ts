import test from 'node:test';
import assert from 'node:assert/strict';
import {
	assignmentCreateValues,
	repeatedWithinBatch,
	type AssignmentCreateBatchLookup,
	type AssignmentCreateInput
} from './+hooks.js';

const jobId = '10000000-0000-4000-8000-000000000001';
const secondJobId = '10000000-0000-4000-8000-000000000002';
const assigneeUserId = '20000000-0000-4000-8000-000000000001';
const siteId = '40000000-0000-4000-8000-000000000001';

/**
 * What `create.prepare` hands every record's hook, assembled here without a database.
 *
 * The reads are gone from the rule, so this is the whole of the rule's input: five facts read once
 * for the batch, plus the two "this call repeats itself" sets derived from the inputs.
 */
function lookup(
	inputs: readonly AssignmentCreateInput[],
	overrides: Partial<AssignmentCreateBatchLookup> = {}
): AssignmentCreateBatchLookup {
	const repeated = repeatedWithinBatch(inputs);
	return {
		jobs: new Map([
			[jobId, { site_id: siteId }],
			[secondJobId, { site_id: siteId }]
		]),
		assigneeUserIds: new Set([assigneeUserId]),
		occupiedJobIds: new Set(),
		occupiedSourceMessageIds: new Set(),
		sites: new Map([
			[
				siteId,
				{
					geometry: { lat: 1.3, lon: 103.8 },
					formatted_address: 'Site',
					type: 'Point',
					srid: 4326
				}
			]
		]),
		repeatedJobIds: repeated.jobIds,
		repeatedSourceMessageIds: repeated.sourceMessageIds,
		...overrides
	};
}

test('prepares assignments in caller order with the same defaults and location semantics', () => {
	const dispatchedAt = new Date('2026-08-13T00:00:00.000Z');
	const inputs = [
		{
			job_id: jobId,
			assignee_user_id: assigneeUserId,
			source_message_id: 'first',
			location: { geometry: { lat: 1.3, lon: 103.8 } }
		},
		{
			job_id: secondJobId,
			assignee_user_id: assigneeUserId,
			source_message_id: 'second',
			dispatched_at: '2026-08-12T00:00:00.000Z',
			status: 'in_progress',
			location: { geometry: { lat: 2, lon: 104 } }
		}
	];
	const prepared = lookup(inputs);
	const result = inputs.map((input) => assignmentCreateValues(input, prepared, () => dispatchedAt));

	assert.deepEqual(
		result.map((assignment) => assignment.source_message_id),
		['first', 'second']
	);
	assert.equal(result[0]?.dispatched_at, dispatchedAt);
	// A row that says nothing about its state is assigned: somebody holds the work.
	assert.equal(result[0]?.status, 'assigned');
	assert.equal(result[1]?.dispatched_at, '2026-08-12T00:00:00.000Z');
	// `in_progress` is one of the two old spellings of "somebody holds this", and lands on `assigned`.
	//
	// The second row's location is far outside the site's tolerance, which used to make this
	// `'suspect'` — a finding written into the column that says where the work got to, erasing it.
	// The state now survives the finding: a suspicion about this row is a `suspicious_activity_logs`
	// entry raised by the `after` hook, and dispatch can see a job that is both suspicious and
	// finished, which it previously could not.
	assert.equal(result[1]?.status, 'assigned');
});

/**
 * The one rule a per-record hook cannot see on its own, and the one whose shape changed.
 *
 * The refusal used to spare the first claimant and refuse the second, because the batch handler
 * accumulated as it went. It now refuses both, because the set of repeated ids is decided before any
 * record is judged. A batch is one transaction either way, so nothing is written either way.
 */
test('rejects every row that repeats a job or a source id inside the same call', () => {
	const base = {
		assignee_user_id: assigneeUserId,
		location: { geometry: { lat: 1.3, lon: 103.8 } }
	};
	const sameJob = [
		{ ...base, job_id: jobId, source_message_id: 'first' },
		{ ...base, job_id: jobId, source_message_id: 'second' }
	];
	const preparedJob = lookup(sameJob);
	for (const input of sameJob) {
		assert.throws(
			() => assignmentCreateValues(input, preparedJob),
			/This job already has an assignment/
		);
	}

	const sameSource = [
		{ ...base, job_id: jobId, source_message_id: 'same-source' },
		{ ...base, job_id: secondJobId, source_message_id: 'same-source' }
	];
	const preparedSource = lookup(sameSource);
	for (const input of sameSource) {
		assert.throws(
			() => assignmentCreateValues(input, preparedSource),
			/source_message_id already exists/
		);
	}
});

/** A row that repeats nothing is still judged against what is already stored. */
test('still refuses a job an existing assignment already holds', () => {
	const inputs = [{ job_id: jobId, assignee_user_id: assigneeUserId }];
	assert.throws(
		() => assignmentCreateValues(inputs[0]!, lookup(inputs, { occupiedJobIds: new Set([jobId]) })),
		/This job already has an assignment/
	);
});
