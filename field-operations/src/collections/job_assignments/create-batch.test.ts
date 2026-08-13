import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAssignmentCreateBatch, type AssignmentCreateBatchLookup } from './+hooks.js';

const jobId = '10000000-0000-4000-8000-000000000001';
const secondJobId = '10000000-0000-4000-8000-000000000002';
const contractorId = '20000000-0000-4000-8000-000000000001';
const siteId = '40000000-0000-4000-8000-000000000001';

function lookup(overrides: Partial<AssignmentCreateBatchLookup> = {}): AssignmentCreateBatchLookup {
	return {
		jobs: new Map([
			[jobId, { site_id: siteId }],
			[secondJobId, { site_id: siteId }]
		]),
		contractorIds: new Set([contractorId]),
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
		...overrides
	};
}

test('prepares assignments in caller order with the same defaults and location semantics', () => {
	const dispatchedAt = new Date('2026-08-13T00:00:00.000Z');
	const result = prepareAssignmentCreateBatch(
		[
			{
				job_id: jobId,
				contractor_profile_id: contractorId,
				source_message_id: 'first',
				location: { geometry: { lat: 1.3, lon: 103.8 } }
			},
			{
				job_id: secondJobId,
				contractor_profile_id: contractorId,
				source_message_id: 'second',
				dispatched_at: '2026-08-12T00:00:00.000Z',
				status: 'in_progress',
				location: { geometry: { lat: 2, lon: 104 } }
			}
		],
		lookup(),
		() => dispatchedAt
	);

	assert.deepEqual(
		result.map((assignment) => assignment.source_message_id),
		['first', 'second']
	);
	assert.equal(result[0]?.dispatched_at, dispatchedAt);
	assert.equal(result[0]?.status, 'dispatched');
	assert.equal(result[1]?.dispatched_at, '2026-08-12T00:00:00.000Z');
	assert.equal(result[1]?.status, 'suspect');
});

test('rejects duplicate jobs and source ids introduced inside the batch', () => {
	const base = {
		contractor_profile_id: contractorId,
		location: { geometry: { lat: 1.3, lon: 103.8 } }
	};
	assert.throws(
		() =>
			prepareAssignmentCreateBatch(
				[
					{ ...base, job_id: jobId, source_message_id: 'first' },
					{ ...base, job_id: jobId, source_message_id: 'second' }
				],
				lookup()
			),
		/This job already has an assignment/
	);
	assert.throws(
		() =>
			prepareAssignmentCreateBatch(
				[
					{ ...base, job_id: jobId, source_message_id: 'same-source' },
					{ ...base, job_id: secondJobId, source_message_id: 'same-source' }
				],
				lookup()
			),
		/source_message_id already exists/
	);
});
