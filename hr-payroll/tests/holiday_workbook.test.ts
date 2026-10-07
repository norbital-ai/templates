/** L-TPL-hr-payroll-115 skip existing unpublished holiday rows. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	parseEntityHolidaySheets,
	skipHeldHolidays
} from '../src/lib/ui/workbook/holiday_workbook.ts';

describe('holiday workbook', () => {
	it('L-TPL-hr-payroll-115 parses a named entity sheet and skips days already held', () => {
		const parsed = parseEntityHolidaySheets(
			[
				[
					'Omni',
					[
						['date', 'name', 'replaces'],
						['2026-01-01', 'New Year', ''],
						['2026-02-17', 'Holiday', '2026-02-16']
					]
				]
			],
			[{ id: 'c1', name: 'Omni' }]
		);
		assert.ok(!('error' in parsed));
		assert.equal(parsed.rows.length, 2);
		assert.equal(parsed.rows[1]?.replaces, '2026-02-16');
		const { insert, skipped } = skipHeldHolidays(parsed.rows, [
			{ company_id: 'c1', date: '2026-01-01' }
		]);
		assert.equal(skipped, 1);
		assert.deepEqual(insert, [
			{ company_id: 'c1', date: '2026-02-17', name: 'Holiday', replaces: '2026-02-16' }
		]);
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
			[{ id: 'c1', name: 'Omni' }]
		);
		assert.ok('error' in parsed);
		assert.match(parsed.error, /Unknown/);
	});
});
