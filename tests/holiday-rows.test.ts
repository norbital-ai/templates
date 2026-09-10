import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { dedupeHolidayRows } from '../src/lib/holiday-rows.ts';
import { holidayImportPayload } from '../src/lib/holiday-workbook.ts';

const api = (existing: ReadonlyArray<{ company_id: string; date: string }>) =>
	({
		db: { jurisdiction_holidays: { findMany: () => Effect.succeed(existing) } }
	}) as unknown as Parameters<typeof dedupeHolidayRows>[0];
const row = (date: string, name = 'Festival', company_id = 'MY') => ({
	company_id,
	date,
	name,
	original_date: null,
	source: null
});

test('a day the entity already has is skipped; within one file the last statement of a day wins', async () => {
	const result = await Effect.runPromise(
		dedupeHolidayRows(api([{ company_id: 'MY', date: '2027-01-01' }]), [
			row('2027-01-01'),
			row('2027-02-01', 'Draft name'),
			row('2027-02-01', 'Final name'),
			row('2027-02-01', 'Elsewhere', 'SG')
		])
	);
	assert.deepEqual(
		result.inserts.map((insert) => [insert.company_id, insert.date, insert.name]),
		[
			['MY', '2027-02-01', 'Final name'],
			['SG', '2027-02-01', 'Elsewhere']
		]
	);
	assert.equal(result.skipped, 1);
});

test('a row without an entity, a real day or a name refuses the whole import', async () => {
	for (const bad of [
		{ ...row('2027-01-01'), company_id: ' ' },
		row('2027-02-30'),
		row('2027-01-01', ' '),
		{ ...row('2027-01-01'), original_date: 'yesterday' }
	])
		await assert.rejects(Effect.runPromise(dedupeHolidayRows(api([]), [bad])));
});

test('the holidays sheet reads one long-form row per day, with an optional original date', () => {
	const grids = new Map([
		[
			'Holidays',
			[
				['legal_entity', 'date', 'name', 'original_date'],
				['Public Fixture Co', '2027-01-01', "New Year's Day", null],
				[
					'Public Fixture Co',
					new Date('2027-05-03T00:00:00Z'),
					'Labour Day (in lieu)',
					'2027-05-01'
				]
			]
		]
	]);
	const payload = holidayImportPayload(grids);
	assert.deepEqual(
		payload.rows.map((entry) => [
			entry.legal_entity,
			entry.date,
			entry.name,
			entry.original_date,
			entry.source
		]),
		[
			['Public Fixture Co', '2027-01-01', "New Year's Day", null, 'spreadsheet'],
			['Public Fixture Co', '2027-05-03', 'Labour Day (in lieu)', '2027-05-01', 'spreadsheet']
		]
	);
	assert.throws(
		() => holidayImportPayload(new Map([['Holidays', [['legal_entity', 'date', 'name']]]])),
		/no rows|no holidays/
	);
});
