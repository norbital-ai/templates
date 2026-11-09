// A published holiday applies by date; the roster says whether the person was due to work. Holiday work pays the
// holiday bands, not the rest-day bands; no work on a holiday is a paid holiday, not an absence.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, REST, WORK, pack, workspace } from './kit.ts';

const HOLIDAY = '2026-02-08';
const seed = (shift: string, hours: number) =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 3120, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 40,
			normal_days_per_week: 5,
			statutory_work_category: 'MANUAL_LABOUR',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[{ date: HOLIDAY, shift, hours }],
		[{ date: HOLIDAY, kind: 'PUBLIC_HOLIDAY' }]
	);

const paid = (shift: string, hours: number) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
		yield* t.runDue();
		const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
		const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
		return Object.fromEntries(breakdown.lines.map((line) => [line.code, line.amount]));
	}).pipe(Effect.provide(workspace({ seed: seed(shift, hours), now: '2026-02-20T02:00:00.000Z' })));

// RM 3,120 a month: 120 a day (÷ 26); a holiday worked pays two days' wages, Employment Act 1955 s.60D(3)
describe('a holiday on the roster', () => {
	it.live('rest day, worked: holiday bands replace the rest-day bands', () =>
		paid(REST, 8).pipe(
			Effect.map((lines) => {
				assert.equal(lines.HOLIDAY_WORK, 240, JSON.stringify(lines));
				assert.equal(lines.REST_DAY_WORK, undefined, JSON.stringify(lines));
			})
		)
	);
	it.live('rest day, not worked: paid holiday, no absence and no automatic OIL', () =>
		paid(REST, 0).pipe(
			Effect.map((lines) => {
				assert.equal(lines.BASIC, 3120, JSON.stringify(lines));
				assert.equal(lines.HOLIDAY_WORK, undefined, JSON.stringify(lines));
			})
		)
	);
	it.live('working day, worked: holiday bands replace ordinary work', () =>
		paid(WORK, 8).pipe(
			Effect.map((lines) => {
				assert.equal(lines.HOLIDAY_WORK, 240, JSON.stringify(lines));
				assert.equal(lines.OVERTIME, undefined, JSON.stringify(lines));
			})
		)
	);
	it.live('working day, not worked: paid holiday, still no absence', () =>
		paid(WORK, 0).pipe(
			Effect.map((lines) => {
				assert.equal(lines.BASIC, 3120, JSON.stringify(lines));
				assert.equal(lines.HOLIDAY_WORK, undefined, JSON.stringify(lines));
			})
		)
	);
	it.live('no OIL entry is raised for a rest-day holiday', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { leave_catalog_entry } = yield* t.storedQuery({
				leave_catalog_entry: { limit: 10 }
			});
			assert.equal(leave_catalog_entry.rows.length, 0);
		}).pipe(Effect.provide(workspace({ seed: seed(REST, 8), now: '2026-02-20T02:00:00.000Z' })))
	);
});
