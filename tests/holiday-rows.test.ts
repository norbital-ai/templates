import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { dedupeHolidayRows } from '../src/lib/holiday-rows.ts';
import {
	holidayBulkImportPayload,
	holidayCompanyImportPayload
} from '../src/lib/holiday-workbook.ts';

const api = (existing: ReadonlyArray<{ company_id: string; date: string }>) =>
	({
		db: { jurisdiction_holidays: { findMany: () => Effect.succeed(existing) } }
	}) as unknown as Parameters<typeof dedupeHolidayRows>[0];
const row = (date: string, name = 'Festival', company_id = 'MY') => ({
	company_id,
	date,
	name,
	replaces: null,
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
		{ ...row('2027-01-01'), replaces: 'yesterday' }
	])
		await assert.rejects(Effect.runPromise(dedupeHolidayRows(api([]), [bad])));
});

test('each entity sheet reads its days under the sheet name; a readme sheet is ignored', () => {
	const grids = new Map([
		[
			'Read me first',
			[['Holidays import — one sheet per entity'], [], ['Name each sheet for its entity.']]
		],
		[
			'Public Fixture Co',
			[
				['date', 'name', 'replaces'],
				['2027-01-01', "New Year's Day", null],
				[new Date('2027-05-03T00:00:00Z'), 'Labour Day (in lieu)', '2027-05-01']
			]
		],
		[
			'Second Entity Sdn Bhd',
			[
				['date', 'name'],
				['2027-02-01', 'Federal Territory Day']
			]
		]
	]);
	const payload = holidayBulkImportPayload(grids);
	assert.deepEqual(
		payload.rows.map((entry) => [
			entry.legal_entity,
			entry.date,
			entry.name,
			entry.replaces,
			entry.source
		]),
		[
			['Public Fixture Co', '2027-01-01', "New Year's Day", null, 'spreadsheet'],
			['Public Fixture Co', '2027-05-03', 'Labour Day (in lieu)', '2027-05-01', 'spreadsheet'],
			['Second Entity Sdn Bhd', '2027-02-01', 'Federal Territory Day', null, 'spreadsheet']
		]
	);
	assert.throws(
		() => holidayBulkImportPayload(new Map([['Read me first', [['Holidays import']]]])),
		/no holidays/
	);
});

test('one entity reads whichever sheet carries its days and owns every row', () => {
	const grids = new Map([
		['Read me first', [['Holidays import']]],
		[
			'Public Fixture Co',
			[
				['date', 'name', 'replaces'],
				['2027-01-01', "New Year's Day", null]
			]
		]
	]);
	const payload = holidayCompanyImportPayload('Public Fixture Co')(grids);
	assert.deepEqual(
		payload.rows.map((entry) => [entry.legal_entity, entry.date, entry.name]),
		[['Public Fixture Co', '2027-01-01', "New Year's Day"]]
	);
	assert.throws(
		() =>
			holidayCompanyImportPayload('Public Fixture Co')(
				new Map([
					['Public Fixture Co', [['date', 'name']]],
					[
						'Second Entity Sdn Bhd',
						[
							['date', 'name'],
							['2027-02-01', 'Federal Territory Day']
						]
					]
				])
			),
		/no "Holidays" sheet/
	);
});
