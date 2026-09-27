import assert from 'node:assert/strict';
import test from 'node:test';
import {
	holidayBulkImportPayload,
	holidayCompanyImportPayload
} from '../src/lib/holiday-workbook.ts';

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
