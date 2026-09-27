// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import holidayImport from '../src/automation/+holiday_import.automation.ts';
import { holidaySources } from '../src/lib/holiday-import.ts';

/**
 * The source is the entity's, not a settings version's: two entities in a country each get their own read. The
 * automation's own body runs over a fake `ctx`; reads answer in wire form, as the engine does.
 */
const company = {
	id: '11111111-1111-4111-8111-111111111111',
	name: 'Public Fixture Co',
	settings_code: 'TEST',
	holiday_source: { calendar_id: 'public-holidays', time_zone: 'Asia/Singapore', enabled: true }
};
const event = (id, date, next, summary = 'Festival') => ({
	id,
	etag: 'one',
	summary,
	start: { date },
	end: { date: next }
});

const harness = (pages, existing = [], http) => {
	const calls = [];
	const writes = [];
	const ctx = {
		todayIn: () => '2026-09-25',
		progress: async () => {},
		read: async (collection) => ({
			rows:
				collection === 'companies'
					? [company]
					: existing.map((row) => ({ ...row, date: { $d: row.date } })),
			next: null
		}),
		http: () => ({
			get:
				http ??
				(async (_path, request) => {
					calls.push(request.query.pageToken ?? 'first');
					assert.equal(writes.length, 0, 'every page is read before a row is written');
					return pages[request.query.pageToken == null ? 0 : Number(request.query.pageToken)];
				})
		}),
		act: async (callable, rows) => {
			assert.equal(callable, 'jurisdiction_holidays.create');
			writes.push(...rows);
			return { kind: 'committed', output: undefined, records: [] };
		}
	};
	return { run: (input) => holidayImport.body(input, ctx), calls, writes };
};

test('the annual job reads every page, adds the days the entity lacks, and never publishes', async () => {
	const { run, calls, writes } = harness(
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
	const result = await run({ company_id: '11111111-1111-4111-8111-111111111111', year: 2027 });
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
	const failing = harness([], [], async () => {
		throw { kind: 'upstream', status: 503, message: 'HTTP 503' };
	});
	await assert.rejects(failing.run({ company_id: company.id, year: 2027 }), {
		message: 'HTTP 503'
	});
	assert.equal(failing.writes.length, 0);
	await assert.rejects(
		harness([]).run({ company_id: '22222222-2222-4222-8222-222222222222', year: 2027 }),
		/No Google holiday calendar is known for this entity/
	);
});

test('an entity with no source of its own imports nothing, by name or on the schedule', () => {
	const bare = { ...company, settings_code: 'SG-norbital', holiday_source: null };
	assert.deepEqual(holidaySources([bare], '11111111-1111-4111-8111-111111111111'), []);
	assert.deepEqual(holidaySources([bare]), []);
});
