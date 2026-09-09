import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { dedupeHolidayRows } from '../src/lib/holiday-rows.ts';
import { holidayImportPayload } from '../src/lib/holiday-workbook.ts';

const api = (existing: ReadonlyArray<{ jurisdiction_code: string; date: string }>) =>
	({
		db: { jurisdiction_holidays: { findMany: () => Effect.succeed(existing) } }
	}) as unknown as Parameters<typeof dedupeHolidayRows>[0];
const row = (date: string, name = 'Festival', jurisdiction_code = 'MY') => ({
	jurisdiction_code,
	date,
	name,
	original_date: null,
	source: null
});

test('a day the jurisdiction already has is skipped; within one file the last statement of a day wins', async () => {
	const result = await Effect.runPromise(
		dedupeHolidayRows(api([{ jurisdiction_code: 'MY', date: '2027-01-01' }]), [
			row('2027-01-01'),
			row('2027-02-01', 'Draft name'),
			row('2027-02-01', 'Final name'),
			row('2027-02-01', 'Elsewhere', 'SG')
		])
	);
	assert.deepEqual(
		result.inserts.map((insert) => [insert.jurisdiction_code, insert.date, insert.name]),
		[
			['MY', '2027-02-01', 'Final name'],
			['SG', '2027-02-01', 'Elsewhere']
		]
	);
	assert.equal(result.skipped, 1);
});

test('a row without a jurisdiction, a real day or a name refuses the whole import', async () => {
	for (const bad of [
		{ ...row('2027-01-01'), jurisdiction_code: ' ' },
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
				['jurisdiction_code', 'date', 'name', 'original_date'],
				['MY', '2027-01-01', "New Year's Day", null],
				['MY', new Date('2027-05-03T00:00:00Z'), 'Labour Day (in lieu)', '2027-05-01']
			]
		]
	]);
	const payload = holidayImportPayload(grids);
	assert.deepEqual(
		payload.rows.map((entry) => [entry.date, entry.name, entry.original_date, entry.source]),
		[
			['2027-01-01', "New Year's Day", null, 'spreadsheet'],
			['2027-05-03', 'Labour Day (in lieu)', '2027-05-01', 'spreadsheet']
		]
	);
	assert.throws(
		() => holidayImportPayload(new Map([['Holidays', [['jurisdiction_code', 'date', 'name']]]])),
		/no rows|no holidays/
	);
});
