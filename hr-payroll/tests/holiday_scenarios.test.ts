// A published holiday applies by date; the roster says whether the person was due to work. Holiday work pays the
// holiday bands, not the rest-day bands; no work on a holiday is a paid holiday, not an absence.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, REST, WORK, pack, uuid, workspace } from './kit.ts';

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

// RM 3,120 a month on a five-day week: 144 a day (× 12 ÷ (52 × 5)); a holiday worked pays two days' wages,
// Employment Act 1955 s.60D(3)
describe('a holiday on the roster', () => {
	it.live('rest day, worked: holiday bands replace the rest-day bands', () =>
		paid(REST, 8).pipe(
			Effect.map((lines) => {
				assert.equal(lines.HOLIDAY_WORK, 288, JSON.stringify(lines));
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
				assert.equal(lines.HOLIDAY_WORK, 288, JSON.stringify(lines));
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
	it.live('a holiday naming one person is theirs alone: a colleague works an ordinary day', () => {
		const base = seed(WORK, 8);
		const [contract] = base.employee_contract ?? [];
		const [day] = base.roster_entry ?? [];
		const two = {
			...base,
			sys_user: [
				...(base.sys_user ?? []),
				{ id: uuid(903), name: 'Second', email: 'second@example.test', kind: 'staff' }
			],
			employee_profile: [
				...(base.employee_profile ?? []),
				{ id: uuid(904), user_id: uuid(903), name: 'Second' }
			],
			employee_balance: [
				...(base.employee_balance ?? []),
				{ id: uuid(905), employee_id: uuid(904), account: {} }
			],
			employee_contract: [
				...(base.employee_contract ?? []),
				{ ...contract, id: uuid(906), employee_id: uuid(904), employee_number: 'W2' }
			],
			roster_entry: [
				...(base.roster_entry ?? []),
				{ ...day, id: uuid(907), employment_id: uuid(906) }
			],
			holiday: (base.holiday ?? []).map((holiday) => ({ ...holiday, employee_id: uuid(4) }))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
			yield* t.runDue();
			const { payslip } = yield* t.storedQuery({ payslip: { limit: 10 } });
			const linesOf = (employment: string) =>
				Object.fromEntries(
					Schema.decodeUnknownSync(PayslipBreakdown)(
						payslip.rows.find((row) => row.employment_id === employment)?.breakdown
					).lines.map((line) => [line.code, line.amount])
				);
			const own = linesOf(uuid(6));
			const colleague = linesOf(uuid(906));
			assert.equal(own.HOLIDAY_WORK, 288, JSON.stringify(own));
			assert.equal(colleague.HOLIDAY_WORK, undefined, JSON.stringify(colleague));
			assert.equal(colleague.OVERTIME, undefined, JSON.stringify(colleague));
		}).pipe(Effect.provide(workspace({ seed: two, now: '2026-02-20T02:00:00.000Z' })));
	});
});
