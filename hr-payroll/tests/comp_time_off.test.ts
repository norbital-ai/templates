// 勞動基準法 §32-1: overtime the worker takes as time off is not also paid as overtime, and the time off is owed by the
// hour. A roster day's planned overtime is marked as time off; the run prices none of it and its payslip posts the
// hours to the leave row that takes overtime as time off, an hour-unit row taken and adjusted in hours.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	WORK,
	accountsIn,
	catalogRow,
	leaveCreate,
	ledgerRows,
	measureOf,
	pack,
	uuid,
	workspace
} from './kit.ts';

const CODE = 'COMPENSATORY_TIME_OFF';
const BALANCE = idOf('employee_balance', uuid(5));
const base = pack(
	'TW',
	'Asia/Taipei',
	{
		rate: { amount: 48_000, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{
		statutory: {
			INCOME_TAX: {
				tax_residency_reviews: {
					2026: { resident_from: '2025-01-01', valid_through: '2026-12-31' }
				}
			}
		}
	},
	[
		{ date: '2026-06-02', shift: WORK, hours: 10, overtime: 2 },
		{ date: '2026-06-03', shift: WORK, hours: 10, overtime: 2 }
	],
	[],
	'2026-06-15'
);
/** The row takes overtime as time off, in hours; the first day's overtime is marked when `marked`. */
const seedOf = (marked: boolean) => ({
	...base,
	leave_catalog: (base.leave_catalog ?? []).map((row) =>
		row.code === CODE
			? {
					...row,
					lookup: {
						...(isJsonObject(row.lookup) ? row.lookup : {}),
						unit: 'HOUR',
						overtime_as_time_off: true
					}
				}
			: row
	),
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null }
	})),
	roster_entry: (base.roster_entry ?? []).map((row) => ({
		...row,
		overtime_as_time_off: marked && row.work_date === '2026-06-02'
	}))
});
const live = (marked: boolean) =>
	workspace({ seed: seedOf(marked), now: '2026-07-01T02:00:00.000Z' });
const runJune = (t: Kit) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const overtimePaid = Effect.fnUntraced(function* () {
	const t = yield* TestWorkspace;
	yield* runJune(t);
	const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
	const { lines } = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
	return lines.find((line) => line.code === 'OVERTIME')?.amount ?? 0;
});
const owed = (t: Kit, measure: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', CODE, measure)));
const halfDay = (t: Kit) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: idOf('employee_contract', uuid(6)),
			catalog_id: idOf('leave_catalog', catalogRow(seedOf(true), 'leave_catalog', CODE)),
			days: [{ date: PlainDate('2026-07-06'), part: 'AM' }]
		})
	]);
const adjust = (t: Kit, unit: 'DAY' | 'HOUR', amount: number) =>
	t.as(t.member(['hr_controller'])).act('ledger_entry.create', [
		{
			balance_id: BALANCE,
			operation: 'ADD',
			account: 'leave',
			code: CODE,
			measure: 'entitled',
			amount,
			unit,
			effective_on: PlainDate('2026-07-01'),
			note: 'overtime of 30 June taken as time off'
		}
	]);

describe('overtime taken as time off', () => {
	it.live('pays no overtime for the marked day and owes its hours', () =>
		Effect.gen(function* () {
			const paid = yield* overtimePaid().pipe(Effect.provide(live(false)));
			const marked = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const amount = yield* overtimePaid();
				assert.equal(yield* owed(t, 'entitled'), 2);
				const posted = (yield* ledgerRows(t)).filter(
					(row) => String(row.source).startsWith('payroll_run:') && row.code === CODE
				);
				assert.deepEqual(
					posted.map((row) => [row.measure, row.unit, row.amount?.toNumber()]),
					[['entitled', 'HOUR', 2]]
				);
				return amount;
			}).pipe(Effect.provide(live(true)));
			assert.ok(paid > 0);
			// one of two equal days is paid: the marked day's overtime is owed as time off instead
			assert.ok(Math.abs(marked * 2 - paid) <= 1, `${marked} of ${paid}`);
		})
	);

	it.live('a half day off takes half the normal day in hours; HR adjusts the row in hours', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* runJune(t);
			// 2 hours owed, a half day is 4
			assert.match(String(yield* Effect.flip(halfDay(t))), /insufficient balance/);
			assert.match(String(yield* Effect.flip(adjust(t, 'DAY', 0.5))), /hours where the row/);
			assert.equal((yield* adjust(t, 'HOUR', 2)).kind, 'committed');
			assert.equal(yield* owed(t, 'entitled'), 4);
			assert.equal((yield* halfDay(t)).kind, 'committed');
			yield* t.runDue();
			assert.equal(yield* owed(t, 'used'), 4);
		}).pipe(Effect.provide(live(true)))
	);
});
