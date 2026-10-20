import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import { resolve } from 'node:path';
import { readSeedRows } from './seed_values.js';
import { classifyOvertime } from '../src/lib/payroll_engine/payslip/overtime.js';
import type { JsonObject } from '../src/lib/payroll_engine/foundation.js';

it.effect(
	'MY monthly overtime excludes rest days and paid holidays before assigning the 104-hour overflow band',
	Effect.fnUntraced(function* () {
		const row = readSeedRows(resolve('seed/jurisdiction/MY/version_9'), 'rule_set').find(
			(row) => row['family'] === 'PAYROLL' && row['code'] === 'overtime_classification'
		);
		assert.ok(row);
		const day = (
			date: string,
			day_type: string,
			holiday_kind: string,
			hours: number
		): JsonObject => ({
			date,
			day_type,
			holiday_kind,
			scheduled_hours: day_type === 'REST' ? 0 : 8,
			approved_overtime_hours: hours,
			overtime_hours: hours
		});
		const days = [
			day('2026-10-01', 'REST', '', 8),
			day('2026-10-02', 'WORK', 'PUBLIC_HOLIDAY', 4),
			day('2026-10-03', 'WORK', 'SUBSTITUTE', 4),
			day('2026-10-04', 'WORK', 'DOUBLE_HOLIDAY', 4),
			...Array.from({ length: 26 }, (_, index) =>
				day(`2026-10-${String(index + 5).padStart(2, '0')}`, 'WORK', '', 4)
			),
			day('2026-10-31', 'WORK', '', 2)
		];
		const classified = yield* classifyOvertime({
			policy: row['rules'],
			days,
			contextOf: (day) => Result.succeed({ day })
		});
		for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-30'])
			assert.deepEqual(classified.get(date), { incentive_hours: 0, payable_incentive_hours: 0 });
		assert.deepEqual(classified.get('2026-10-31'), {
			incentive_hours: 2,
			payable_incentive_hours: 2
		});
		assert.equal(
			[...classified.values()].reduce((sum, day) => sum + day.incentive_hours, 0),
			2
		);
	})
);
