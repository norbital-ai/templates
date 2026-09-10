import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { runHolidayImport } from '../src/automations/+holiday_import.ts';
import { holidaySources } from '../src/lib/holiday-import.ts';

/**
 * The source is the entity's, not a settings version's.
 *
 * It used to hang off `jurisdiction_settings` and the reader had to rank sealed/voided/effective
 * versions to decide which one's source was in force. An entity has exactly one, and two entities
 * in a country each get their own read — which is the point of an entity-owned calendar.
 */
const company = {
	id: '11111111-1111-4111-8111-111111111111',
	name: 'Public Fixture Co',
	settings_code: 'TEST',
	holiday_source: { calendar_id: 'public-holidays', time_zone: 'Asia/Singapore', enabled: true }
};
const event = (id: string, date: string, next: string, summary = 'Festival') => ({
	id,
	etag: 'one',
	summary,
	start: { date },
	end: { date: next }
});

const harness = (
	pages: ReadonlyArray<unknown>,
	existing: ReadonlyArray<{ company_id: string; date: string }> = []
) => {
	const calls: string[] = [];
	const writes: Record<string, unknown>[] = [];
	const api = {
		progress: () => Effect.void,
		connection: {
			get: (request: { query: { pageToken?: string } }) => {
				calls.push(request.query.pageToken ?? 'first');
				assert.equal(writes.length, 0, 'every page is read before a row is written');
				const index = request.query.pageToken == null ? 0 : Number(request.query.pageToken);
				return Effect.succeed({ status: 200, headers: {}, body: pages[index] });
			}
		},
		db: {
			companies: { findMany: () => Effect.succeed([company]) },
			jurisdiction_holidays: {
				findMany: () => Effect.succeed(existing),
				mutate: (rows: Record<string, unknown>[]) =>
					Effect.sync(() => {
						writes.push(...rows);
					})
			}
		}
	} as unknown as Parameters<typeof runHolidayImport>[0];
	return { api, calls, writes };
};

test('the annual job reads every page, adds the days the entity lacks, and never publishes', async () => {
	const { api, calls, writes } = harness(
		[
			{ kind: 'calendar#events', items: [], nextPageToken: '1' },
			{
				kind: 'calendar#events',
				items: [
					event('festival', '2027-01-01', '2027-01-02'),
					event('long', '2027-02-01', '2027-02-03', 'Two days'),
					{ ...event('gone', '2027-03-01', '2027-03-02'), status: 'cancelled' }
				]
			}
		],
		[{ company_id: '11111111-1111-4111-8111-111111111111', date: '2027-02-02' }]
	);
	const result = await Effect.runPromise(
		runHolidayImport(api, { company_id: '11111111-1111-4111-8111-111111111111', year: 2027 })
	);
	assert.deepEqual(calls, ['first', '1']);
	assert.deepEqual(
		writes.map((row) => [row.date, row.name, row.published_at]),
		[
			['2027-01-01', 'Festival', undefined],
			['2027-02-01', 'Two days', undefined]
		]
	);
	assert.deepEqual(result.imports, [
		{ company_id: '11111111-1111-4111-8111-111111111111', year: 2027, inserted: 2, skipped: 1 }
	]);
});

test('a named entity imports even when its source is disabled; a provider failure writes nothing', async () => {
	const disabled = { ...company, holiday_source: { ...company.holiday_source, enabled: false } };
	assert.equal(holidaySources([disabled]).length, 0, 'the scheduled job runs enabled sources only');
	assert.equal(
		holidaySources([disabled], '11111111-1111-4111-8111-111111111111').length,
		1,
		'a named entity runs regardless'
	);
	const { api, writes } = harness([]);
	(api as { connection: unknown }).connection = {
		get: () => Effect.succeed({ status: 503, headers: {}, body: {} })
	};
	await assert.rejects(
		Effect.runPromise(
			runHolidayImport(api, { company_id: '11111111-1111-4111-8111-111111111111', year: 2027 })
		),
		/HTTP 503/
	);
	assert.equal(writes.length, 0);
	await assert.rejects(
		Effect.runPromise(
			runHolidayImport(harness([]).api, {
				company_id: '22222222-2222-4222-8222-222222222222',
				year: 2027
			})
		),
		/No Google holiday calendar is known for this entity/
	);
});

test("an entity with no source of its own reads its country's Google calendar; the schedule never does", () => {
	// The one place a country legitimately survives the move: the fallback is chosen by the country
	// half of the entity's settings lineage, so `SG-norbital` and `SG` fall back alike.
	const bare = { ...company, settings_code: 'SG-norbital', holiday_source: null };
	assert.deepEqual(holidaySources([bare], '11111111-1111-4111-8111-111111111111'), [
		{
			company_id: '11111111-1111-4111-8111-111111111111',
			company_name: 'Public Fixture Co',
			calendar_id: 'en.singapore#holiday@group.v.calendar.google.com',
			time_zone: 'Asia/Singapore'
		}
	]);
	assert.deepEqual(holidaySources([bare]), [], 'the 1 October job runs only configured sources');
	assert.deepEqual(
		holidaySources([{ ...bare, settings_code: 'XX' }], '11111111-1111-4111-8111-111111111111'),
		[],
		'a country Google has no calendar for falls back to nothing'
	);
	assert.equal(
		holidaySources([company], '11111111-1111-4111-8111-111111111111')[0]!.calendar_id,
		'public-holidays'
	);
});
