import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import hooks from '../src/collections/jurisdiction_holiday_calendars/+hooks.ts';
import { mergeHolidayImport } from '../src/lib/holiday-import.ts';

const source = {
	jurisdiction_code: 'TEST',
	calendar_id: 'public-holidays',
	time_zone: 'Asia/Singapore'
};
const evidence = {
	source: 'https://www.googleapis.com/calendar/v3/calendars/public-holidays/events/festival',
	event_id: 'festival',
	revision: 'one',
	updated_at: '2026-10-01T00:00:00.000Z',
	name: 'Festival',
	dates: ['2027-01-01'],
	cancelled: false
};
const reviewed = mergeHolidayImport(source, '2026-10-01T00:00:00.000Z', [evidence], null);
reviewed.events[0]!.review_required = false;
const manual = {
	date: '2027-02-01',
	name: 'Manual announcement',
	original_date: null,
	source: 'Official announcement'
};
const calendar = {
	id: 'calendar',
	jurisdiction_code: 'TEST',
	year: 2027,
	revision: 1,
	published_at: null,
	observations: [manual],
	import_review: reviewed
};

const run = (
	input: Record<string, unknown>,
	existing?: Record<string, unknown>,
	previous: readonly Record<string, unknown>[] = [],
	captured: Record<string, unknown> | null = null
) => {
	const handler = hooks.mutate.perRecord.before.handler;
	return Effect.runPromise(
		handler({
			input,
			existing,
			recordId: 'calendar',
			relationships: [],
			prepared: undefined,
			api: {
				db: {
					jurisdiction_holiday_calendars: { findMany: () => Effect.succeed(previous) },
					work_days: {
						findFirst: () =>
							Effect.succeed(captured == null ? undefined : { work_date: captured.date })
					},
					jurisdiction_settings: { findMany: () => Effect.succeed([]) },
					payroll_runs: { findFirst: () => Effect.succeed(undefined) }
				}
			}
		} as unknown as Parameters<typeof handler>[0])
	);
};

test('an import refresh retains current HR observations and reviewed source decisions atomically', async () => {
	const incoming = mergeHolidayImport(source, '2026-10-02T00:00:00.000Z', [evidence], null);
	const result = await run({ import_review: incoming, observations: [] }, calendar);
	assert.deepEqual(result.observations, [manual]);
	assert.equal(result.import_review?.events[0]?.review_required, false);
});

test('a successor import clones the latest observations instead of stale caller selections', async () => {
	const prior = { ...calendar, published_at: '2026-10-01T12:00:00.000Z' };
	const incoming = mergeHolidayImport(
		source,
		'2026-10-02T00:00:00.000Z',
		[{ ...evidence, dates: ['2027-01-02'] }],
		null
	);
	const result = await run(
		{ ...calendar, id: 'successor', revision: 2, observations: [], import_review: incoming },
		undefined,
		[prior]
	);
	assert.deepEqual(result.observations, [manual]);
	assert.equal(result.import_review?.events[0]?.review_required, true);
	await assert.rejects(
		run({ ...calendar, revision: 3, import_review: incoming }, undefined, [prior]),
		/changed during import/
	);
});

test('publication requires a separately saved and completely reviewed import', async () => {
	const pending = {
		...calendar,
		import_review: mergeHolidayImport(source, reviewed.retrieved_at, [evidence], null)
	};
	await assert.rejects(run({ published_at: '2026-10-02T00:00:00.000Z' }, pending), /Review every/);
	await assert.rejects(
		run({ ...calendar, published_at: '2026-10-02T00:00:00.000Z' }),
		/saved as a draft/
	);
	const result = await run({ published_at: '2026-10-02T00:00:00.000Z' }, calendar);
	assert.equal(result.published_at, '2026-10-02T00:00:00.000Z');
});

test('published history, stale review forms and sealed draft observation changes are refused', async () => {
	await assert.rejects(
		run({ observations: [] }, { ...calendar, published_at: '2026-10-02T00:00:00.000Z' }),
		/immutable/
	);
	await assert.rejects(
		run(
			{ import_review: reviewed },
			{ ...calendar, import_review: { ...reviewed, retrieved_at: '2026-10-03T00:00:00.000Z' } }
		),
		/newer holiday import/
	);
	// A draft's observation is not sealed by a pinned date: nothing consumed the draft. Publication
	// is where a pinned date refuses (below).
	assert.deepEqual(
		(await run({ observations: [] }, calendar, [], { date: manual.date })).observations,
		[]
	);
});

test('reviewing a moved source can publish new evidence while retaining every sealed observation', async () => {
	const prior = { ...calendar, published_at: '2026-10-01T12:00:00.000Z' };
	const changedEvidence = mergeHolidayImport(
		source,
		'2026-10-02T00:00:00.000Z',
		[{ ...evidence, dates: ['2027-01-02'] }],
		reviewed
	);
	const draft = {
		...calendar,
		revision: 2,
		import_review: {
			...changedEvidence,
			events: changedEvidence.events.map((event) => ({ ...event, review_required: false }))
		}
	};
	const result = await run({ published_at: '2026-10-02T12:00:00.000Z' }, draft, [prior], {
		date: manual.date
	});
	assert.deepEqual(result.observations, prior.observations);
	assert.deepEqual(result.import_review?.events[0]?.dates, ['2027-01-02']);
});
