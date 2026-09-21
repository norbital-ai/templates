import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import collection from '../src/collections/job_assignments/+collection.js';

const siteId = '10000000-0000-4000-8000-000000000001';
const secondSiteId = '10000000-0000-4000-8000-000000000002';
const assigneeUserId = '20000000-0000-4000-8000-000000000001';

type Input = Readonly<Record<string, unknown>>;
type Transform = (
	inputs: ReadonlyArray<Input>,
	context: { readonly existing: ReadonlyArray<Input | undefined>; readonly db: unknown }
) => Effect.Effect<ReadonlyArray<Input>, unknown>;
const transform = collection.transform as unknown as Transform;

const work = {
	site_id: siteId,
	title: 'Survey & Installation — 1F, PINE GROVE',
	nature: 'Survey & Installation',
	scheduled_for: '2026-08-12T00:00:00.000Z',
	description: 'Survey & Installation. Reported installation: SRT'
} as const;

/** What the transform reads, assembled here without a database: which sites exist, and which
 * source messages are already spoken for. */
function db(overrides: { readonly takenSources?: ReadonlyArray<string> } = {}) {
	return {
		sites: {
			findMany: () => Effect.succeed([{ id: siteId }, { id: secondSiteId }])
		},
		job_assignments: {
			findMany: () =>
				Effect.succeed((overrides.takenSources ?? []).map((id) => ({ source_message_id: id })))
		}
	};
}

const create = (inputs: ReadonlyArray<Input>, takenSources?: ReadonlyArray<string>) =>
	Effect.runPromise(
		transform(inputs, { existing: inputs.map(() => undefined), db: db({ takenSources }) })
	);

const update = (inputs: ReadonlyArray<Input>, stored: ReadonlyArray<Input>) =>
	Effect.runPromise(transform(inputs, { existing: stored, db: db() }));

test('files a batch in caller order, dispatching the rows that name a contractor', async () => {
	const inputs = [
		{ ...work, assignee_user_id: assigneeUserId, source_message_id: 'first' },
		{
			...work,
			site_id: secondSiteId,
			title: 'Survey Only — 3, RIDGEWOOD CLOSE',
			assignee_user_id: assigneeUserId,
			source_message_id: 'second',
			dispatched_at: '2026-08-12T00:00:00.000Z',
			status: 'completed'
		},
		{ ...work, site_id: secondSiteId, title: 'Unassigned work order' }
	];
	const result = await create(inputs);

	assert.deepEqual(
		result.map((assignment) => assignment.source_message_id),
		['first', 'second', undefined]
	);
	// A row that names a contractor is dispatched and stamped; one that names nobody waits.
	assert.equal(typeof result[0]?.dispatched_at, 'string');
	assert.equal(result[0]?.status, 'assigned');
	assert.equal(result[1]?.dispatched_at, '2026-08-12T00:00:00.000Z');
	assert.equal(result[1]?.status, 'completed');
	assert.equal(result[2]?.status, 'unassigned');
	assert.equal(result[2]?.dispatched_at, null);
});

test('rejects a batch that repeats a source message inside the same call', async () => {
	await assert.rejects(
		create([
			{ ...work, assignee_user_id: assigneeUserId, source_message_id: 'same-source' },
			{
				...work,
				site_id: secondSiteId,
				title: 'Second',
				assignee_user_id: assigneeUserId,
				source_message_id: 'same-source'
			}
		]),
		/source_message_id already exists/
	);
});

test('still refuses a source message an existing row already carries', async () => {
	await assert.rejects(
		create([{ ...work, assignee_user_id: assigneeUserId, source_message_id: 'taken' }], ['taken']),
		/source_message_id already exists/
	);
});

test('refuses a job filed against a site this workspace does not have', async () => {
	await assert.rejects(
		create([
			{
				...work,
				site_id: '10000000-0000-4000-8000-00000000ffff',
				assignee_user_id: assigneeUserId
			}
		]),
		/Referenced site does not exist/
	);
});

test('naming a contractor on an unassigned row stamps the dispatch once', async () => {
	const stored = { ...work, status: 'unassigned', dispatched_at: null };
	const [dispatched] = await update([{ assignee_user_id: assigneeUserId }], [stored]);
	assert.equal(typeof dispatched?.dispatched_at, 'string');
	assert.equal(dispatched?.status, undefined);

	// A row that already carries its dispatch is left alone.
	const [again] = await update(
		[{ assignee_user_id: assigneeUserId }],
		[{ ...stored, dispatched_at: '2026-08-01T00:00:00.000Z' }]
	);
	assert.equal('dispatched_at' in (again ?? {}), false);
});

test('completing stamps the completion once and only once', async () => {
	const [completed] = await update([{ status: 'completed' }], [{ ...work, completed_at: null }]);
	assert.equal(typeof completed?.completed_at, 'string');

	const [restated] = await update(
		[{ status: 'completed' }],
		[{ ...work, completed_at: '2026-08-01T00:00:00.000Z' }]
	);
	assert.equal('completed_at' in (restated ?? {}), false);
});
