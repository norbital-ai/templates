import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/foundation.js';
import { classifyOvertime } from '../src/lib/payroll_engine/payslip/overtime.js';

const day = (date: string, approved: number, banked = 0, worked = 0): JsonObject => ({
	date,
	approved_overtime_hours: approved,
	overtime_hours: approved - banked,
	banked_hours: banked,
	worked_hours: worked,
	scheduled_hours: 8,
	day_type: 'WORK',
	holiday_kind: ''
});
const monthly = {
	code: 'MONTHLY',
	from: 'month_start(day.date)',
	limit: '104.0',
	applies: 'true',
	hours: 'day.approved_overtime_hours'
};
const classify = (days: readonly JsonObject[], limits: readonly (typeof monthly)[]) =>
	classifyOvertime({
		policy: { limits },
		days,
		contextOf: (day) => Result.succeed({ day })
	});

it.effect(
	'carries the full approved month across pay periods, resets the calendar month and preserves banked hours',
	Effect.fnUntraced(function* () {
		const days = [
			day('2026-09-30', 20),
			day('2026-10-01', 100),
			day('2026-10-16', 10, 2),
			day('2026-11-01', 10)
		];
		const before = structuredClone(days);
		const got = yield* classify(days, [monthly]);
		assert.deepEqual(got.get('2026-10-16'), { incentive_hours: 6, payable_incentive_hours: 6 });
		assert.deepEqual(got.get('2026-11-01'), { incentive_hours: 0, payable_incentive_hours: 0 });
		assert.deepEqual(days, before);
		const banked = yield* classify([day('2026-10-01', 104), day('2026-10-16', 10, 8)], [monthly]);
		assert.deepEqual(banked.get('2026-10-16'), { incentive_hours: 10, payable_incentive_hours: 2 });
	})
);

it.effect(
	'counts an approved hour once when daily and rolling-week ceilings overlap',
	Effect.fnUntraced(function* () {
		const daily = { ...monthly, code: 'DAILY', from: 'day.date', limit: '4.0' };
		const weekly = { ...monthly, code: 'WEEKLY', from: 'add_days(day.date, -6)', limit: '18.0' };
		const got = yield* classify(
			[
				day('2026-10-12', 6),
				day('2026-10-13', 6),
				day('2026-10-14', 6),
				day('2026-10-15', 6),
				day('2026-10-22', 4)
			],
			[daily, weekly]
		);
		assert.deepEqual(
			[...got.values()].map((entry) => entry.incentive_hours),
			[2, 2, 2, 6, 0]
		);
	})
);

it.effect(
	'classification depends on planned approval and never actual attendance duration',
	Effect.fnUntraced(function* () {
		for (const worked of [0, 1, 8, 24]) {
			const got = yield* classify(
				[day('2026-10-01', 104), day('2026-10-16', 8, 0, worked)],
				[monthly]
			);
			assert.deepEqual(got.get('2026-10-16'), { incentive_hours: 8, payable_incentive_hours: 8 });
		}
	})
);

it.effect(
	'refuses malformed policies and any counted quantity greater than planned approval',
	Effect.fnUntraced(function* () {
		const bad = yield* Effect.flip(
			classify([day('2026-10-16', 2)], [{ ...monthly, hours: '3.0' }])
		);
		assert.match(bad.message, /only planned approved overtime/);
		const malformed = yield* Effect.flip(
			classifyOvertime({
				policy: { limits: [{ code: 'MISSING' }] },
				days: [],
				contextOf: (day) => Result.succeed({ day })
			})
		);
		assert.match(malformed.message, /policy is invalid/);
	})
);
