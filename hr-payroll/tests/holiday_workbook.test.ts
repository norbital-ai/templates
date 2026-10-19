/** L-TPL-hr-payroll-115 skip existing unpublished holiday rows. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	parseEntityHolidaySheets,
	skipHeldHolidays
} from '../src/lib/ui/workbook/holiday_workbook.ts';

const company = nativeId('entity', fixtureId('c1'));

describe('holiday workbook', () => {
	it('L-TPL-hr-payroll-115 parses a named entity sheet and skips days already held', () => {
		const parsed = parseEntityHolidaySheets(
			[
				[
					'Omni',
					[
						['date', 'name', 'kind', 'replaces'],
						['2026-01-01', 'New Year', 'PUBLIC_HOLIDAY', ''],
						['2026-02-17', 'Holiday', 'SUBSTITUTE', '2026-02-16']
					]
				]
			],
			[{ id: company, name: 'Omni' }]
		);
		assert.ok(!('error' in parsed));
		assert.equal(parsed.rows.length, 2);
		assert.equal(parsed.rows[1]?.replaces, '2026-02-16');
		const { insert, skipped } = skipHeldHolidays(parsed.rows, [
			{ company_id: company, date: '2026-01-01' }
		]);
		assert.equal(skipped, 1);
		assert.deepEqual(insert, [
			{
				company_id: company,
				date: '2026-02-17',
				name: 'Holiday',
				kind: 'SUBSTITUTE',
				replaces: '2026-02-16'
			}
		]);
	});

	it('refuses a sheet without a kind column or a holiday without a kind: no kind is defaulted', () => {
		const parse = (rows: (readonly string[])[]) =>
			parseEntityHolidaySheets([['Omni', rows]], [{ id: company, name: 'Omni' }]);
		assert.ok(
			'error' in
				parse([
					['date', 'name'],
					['2026-01-01', 'X']
				])
		);
		assert.ok(
			'error' in
				parse([
					['date', 'name', 'kind'],
					['2026-01-01', 'X', '']
				])
		);
	});

	it('L-TPL-hr-payroll-115 refuses a sheet that names no entity', () => {
		const parsed = parseEntityHolidaySheets(
			[
				[
					'Unknown',
					[
						['date', 'name'],
						['2026-01-01', 'X']
					]
				]
			],
			[{ id: company, name: 'Omni' }]
		);
		assert.ok('error' in parsed);
		assert.match(parsed.error, /Unknown/);
	});
});
