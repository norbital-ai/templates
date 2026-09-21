import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import collection from '../src/collections/job_assignments/+collection.js';

const jobId = '10000000-0000-4000-8000-000000000001';
const secondJobId = '10000000-0000-4000-8000-000000000002';
const assigneeUserId = '20000000-0000-4000-8000-000000000001';

type Input = Readonly<Record<string, unknown>>;
type Transform = (
	inputs: ReadonlyArray<Input>,
	context: { readonly existing: ReadonlyArray<Input | undefined>; readonly db: unknown }
) => Effect.Effect<ReadonlyArray<Input>, unknown>;
const transform = collection.transform as unknown as Transform;

/**
 * What the transform reads, assembled here without a database: the jobs the batch names, which
 * of them an assignment already holds, and which source messages are already spoken for.
 */
function db(overrides: { readonly occupiedJobIds?: ReadonlyArray<string> } = {}) {
	return {
		jobs: {
			findMany: () =>
				Effect.succeed([
					{ id: jobId, title: 'Survey & Installation — 1F, PINE GROVE' },
					{ id: secondJobId, title: 'Survey Only — 3, RIDGEWOOD CLOSE' }
				])
		},
		job_assignments: {
			findMany: (input: { readonly where: Readonly<Record<string, unknown>> }) =>
				Effect.succeed(
					'job_id' in input.where
						? (overrides.occupiedJobIds ?? []).map((job_id) => ({ job_id }))
						: []
				)
		}
	};
}

const create = (inputs: ReadonlyArray<Input>, occupiedJobIds?: ReadonlyArray<string>) =>
	Effect.runPromise(
		transform(inputs, { existing: inputs.map(() => undefined), db: db({ occupiedJobIds }) })
	);

test('prepares assignments in caller order with progression defaults independent of location facts', async () => {
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
			status: 'completed',
			location: { geometry: { lat: 2, lon: 104 } }
		}
	];
	const result = await create(inputs);

	assert.deepEqual(
		result.map((assignment) => assignment.source_message_id),
		['first', 'second']
	);
	assert.equal(typeof result[0]?.dispatched_at, 'string');
	// A row that says nothing about its state is assigned: somebody holds the work.
	assert.equal(result[0]?.status, 'assigned');
	assert.equal(result[0]?.search_text, 'Survey & Installation — 1F, PINE GROVE');
	assert.equal(result[1]?.dispatched_at, '2026-08-12T00:00:00.000Z');
	// Location remains a fact. Only the dedicated AI/human review process may create a judgement.
	assert.equal(result[1]?.status, 'completed');
	assert.equal(result[1]?.search_text, 'Survey Only — 3, RIDGEWOOD CLOSE');
});

test('the board search label is derived from the job, never accepted from a caller', async () => {
	// Not a create input at all: the selection is what keeps a forged label off the wire.
	assert.equal('search_text' in collection.create.input.columns, false);
	assert.equal('search_text' in collection.update.input.columns, false);
	const [result] = await create([{ job_id: jobId, assignee_user_id: assigneeUserId }]);
	assert.equal(result?.search_text, 'Survey & Installation — 1F, PINE GROVE');
});

/**
 * The one rule a per-record check cannot see on its own: a batch is one transaction, so a job
 * claimed twice inside it is refused and nothing is written.
 */
test('rejects a batch that repeats a job or a source id inside the same call', async () => {
	const base = { assignee_user_id: assigneeUserId };
	await assert.rejects(
		create([
			{ ...base, job_id: jobId, source_message_id: 'first' },
			{ ...base, job_id: jobId, source_message_id: 'second' }
		]),
		/This job already has an assignment/
	);
	await assert.rejects(
		create([
			{ ...base, job_id: jobId, source_message_id: 'same-source' },
			{ ...base, job_id: secondJobId, source_message_id: 'same-source' }
		]),
		/source_message_id already exists/
	);
});

/** A row that repeats nothing is still judged against what is already stored. */
test('still refuses a job an existing assignment already holds', async () => {
	await assert.rejects(
		create([{ job_id: jobId, assignee_user_id: assigneeUserId }], [jobId]),
		/This job already has an assignment/
	);
});

test('refuses a job this workspace does not have', async () => {
	await assert.rejects(
		create([{ job_id: '10000000-0000-4000-8000-00000000ffff', assignee_user_id: assigneeUserId }]),
		/Referenced job does not exist/
	);
});
