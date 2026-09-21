import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import collection from '../src/collections/job_assignments/+collection.js';
import { carryAssignmentProgressToJob } from '../src/automations/job-progress.js';

type Input = Readonly<Record<string, unknown>>;
type Transform = (
	inputs: ReadonlyArray<Input>,
	context: { readonly existing: ReadonlyArray<Input | undefined>; readonly db: unknown }
) => Effect.Effect<ReadonlyArray<Input>, unknown>;
const transform = collection.transform as unknown as Transform;

const stored = {
	id: '019f6f10-3000-7000-8000-000000000008',
	job_id: '019f6f10-2000-7000-8000-000000000008',
	assignee_user_id: '019f6f10-0003-7000-8000-000000000012',
	status: 'assigned',
	completed_at: null,
	search_text: 'Installation — 112, Hillview Crescent'
};

/** An update reads nothing: every read is keyed by creates, and there are none. */
const update = (input: Input) =>
	Effect.runPromise(transform([{ ...input, id: stored.id }], { existing: [stored], db: {} })).then(
		(payloads) => payloads[0]
	);

/** A job double that records what the rollup writes. */
function jobs(status: string) {
	const writes: Array<Input> = [];
	const api = {
		db: { jobs: { findFirst: () => Effect.succeed({ id: stored.job_id, status }) } },
		collection: {
			jobs: {
				update: (id: string, input: Input) => {
					writes.push({ id, ...input });
					return Effect.succeed({ id, ...input });
				}
			}
		}
	};
	return { api: api as never, writes };
}

test('a system-only checked flag update does not rewrite status or touch the parent job', async () => {
	const prepared = await update({ suspicion_checked_at: '2026-08-24T08:30:14.312Z' });
	assert.deepEqual(prepared, { id: stored.id, suspicion_checked_at: '2026-08-24T08:30:14.312Z' });

	// The updated-event rollup reads the job and leaves it alone when it already agrees.
	const { api, writes } = jobs('assigned');
	const outcome = await Effect.runPromise(carryAssignmentProgressToJob(api, stored));
	assert.equal(outcome.written, false);
	assert.equal(writes.length, 0);
});

test('an update cannot move a dispatched assignment or replace its board search label', () => {
	for (const column of ['job_id', 'assignee_user_id', 'source_message_id', 'search_text']) {
		assert.equal(column in collection.update.input.columns, false, column);
	}
});

test('a kanban drop to completed stamps completion and carries it onto the job', async () => {
	const prepared = await update({ status: 'completed' });
	assert.equal(prepared?.status, 'completed');
	assert.equal(typeof prepared?.completed_at, 'string');
	assert.ok(String(prepared?.completed_at).length > 0);

	const { api, writes } = jobs('assigned');
	const outcome = await Effect.runPromise(
		carryAssignmentProgressToJob(api, { ...stored, status: 'completed' })
	);
	assert.equal(outcome.written, true);
	assert.deepEqual(writes, [{ id: stored.job_id, status: 'completed' }]);
});

test('the first dispatch promotes an unassigned job', async () => {
	const { api, writes } = jobs('unassigned');
	await Effect.runPromise(carryAssignmentProgressToJob(api, stored));
	assert.deepEqual(writes, [{ id: stored.job_id, status: 'assigned' }]);
});
