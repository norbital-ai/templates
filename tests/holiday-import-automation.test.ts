import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { runHolidayImport } from '../src/automations/+holiday_import.ts';
import { holidaySources } from '../src/lib/holiday-import.ts';

const version = {
	jurisdiction_code: 'TEST',
	sealed_at: '2025-01-01T00:00:00.000Z',
	voided_at: null,
	effective_range: { start: '2025-01-01T00:00:00.000Z', end: null },
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
	existing: ReadonlyArray<{ jurisdiction_code: string; date: string }> = []
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
			jurisdiction_settings: { findMany: () => Effect.succeed([version]) },
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

test('the annual job reads every page, adds the days the jurisdiction lacks, and never publishes', async () => {
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
		[{ jurisdiction_code: 'TEST', date: '2027-02-02' }]
	);
	const result = await Effect.runPromise(
		runHolidayImport(api, { jurisdiction_code: 'TEST', year: 2027 })
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
		{ jurisdiction_code: 'TEST', year: 2027, inserted: 2, skipped: 1 }
	]);
});

test('a named jurisdiction imports off its version even when disabled; a provider failure writes nothing', async () => {
	const disabled = { ...version, holiday_source: { ...version.holiday_source, enabled: false } };
	assert.equal(holidaySources([disabled]).length, 0);
	assert.equal(holidaySources([disabled], 'TEST').length, 1);
	const { api, writes } = harness([]);
	(api as { connection: unknown }).connection = {
		get: () => Effect.succeed({ status: 503, headers: {}, body: {} })
	};
	await assert.rejects(
		Effect.runPromise(runHolidayImport(api, { jurisdiction_code: 'TEST', year: 2027 })),
		/HTTP 503/
	);
	assert.equal(writes.length, 0);
	await assert.rejects(
		Effect.runPromise(
			runHolidayImport(harness([]).api, { jurisdiction_code: 'NOWHERE', year: 2027 })
		),
		/Configure a Google holiday source for NOWHERE/
	);
});
