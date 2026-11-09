// A holiday kept on a Saturday, with the weekday in lieu given only to those off that Saturday: a six-day week works the
// weekday at its normal rate and keeps the Saturday, a five-day week is on holiday that weekday. Nobody has a roster
// entry on the Saturday, so the gate reads the contract's own week.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, WORK, pack, uuid, workspace } from './kit.ts';

const SATURDAY = '2026-02-07';
const WEEKDAY = '2026-02-04';

const seedFor = (daysPerWeek: number) => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 3120, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: daysPerWeek * 8,
			normal_days_per_week: daysPerWeek,
			statutory_work_category: 'MANUAL_LABOUR',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[{ date: WEEKDAY, shift: WORK, hours: 8 }],
		[]
	);
	const holiday = {
		entity_id: ENTITY,
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2025-12-01T00:00:00.000Z'
	};
	return {
		...seed,
		holiday: [
			{ ...holiday, id: uuid(20), date: SATURDAY, name: 'Kept on Saturday', given_to: 'EVERYONE' },
			{
				...holiday,
				id: uuid(21),
				date: WEEKDAY,
				name: 'Off in lieu',
				given_to: 'ONLY_IF_OFF_ON_REPLACED_DATE',
				replaces: SATURDAY
			}
		]
	};
};

const lines = Effect.fnUntraced(function* (t: Kit) {
	yield* t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
	yield* t.runDue();
	const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
	const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
	return Object.fromEntries(breakdown.lines.map((line) => [line.code, line.amount]));
});

const paid = (daysPerWeek: number) =>
	Effect.gen(function* () {
		return yield* lines(yield* TestWorkspace);
	}).pipe(
		Effect.provide(workspace({ seed: seedFor(daysPerWeek), now: '2026-02-20T02:00:00.000Z' }))
	);

describe('a weekday in lieu of a Saturday holiday', () => {
	it.live('is no holiday for a six-day week, which works the Saturday', () =>
		paid(6).pipe(
			Effect.map((lines) => assert.equal(lines.HOLIDAY_WORK, undefined, JSON.stringify(lines)))
		)
	);

	// RM 3,120 a month: 120 a day (÷ 26); a holiday worked pays two days' wages, Employment Act 1955 s.60D(3)
	it.live('is the holiday of a five-day week, which is off that Saturday', () =>
		paid(5).pipe(
			Effect.map((lines) => assert.equal(lines.HOLIDAY_WORK, 240, JSON.stringify(lines)))
		)
	);
});
