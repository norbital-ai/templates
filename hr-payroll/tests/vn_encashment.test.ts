// Labour Code art.113(3) and Decree 145/2020 art.67(3): untaken annual leave is paid on exit at the contractual daily
// wage of the month before the exit month, which the exit review records.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import type { Id } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { jsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, leaveCreate, pack, uuid, wholeDays, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 20_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NORMAL',
	work_classification: 'ORDINARY',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Review = {
	readonly month: string;
	readonly reference: string;
	readonly daily_wage_vnd: number;
};
const seedWith = (review: Review): ReturnType<typeof pack> => {
	const base = pack(
		'VN',
		'Asia/Ho_Chi_Minh',
		terms,
		{ encashment_review: review },
		[],
		[],
		'2026-01-15'
	);
	return {
		...base,
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2025-01-01', to: '2026-01-31' },
			final_pay_due_on: '2026-02-15'
		})),
		employee_balance: (base.employee_balance ?? []).map((row) => ({
			...row,
			account: { leave: { ANNUAL_LEAVE: { 'VN.Y.2026-01-01': { entitled: 12 } } } }
		}))
	};
};
const REVIEW = { month: '2025-12', reference: 'December payslip', daily_wage_vnd: 500_000 };
// a mid-month cutoff puts the last attendance day before the exit, so some cash-out slots fall after it
const midMonthCutoff = (seed: ReturnType<typeof seedWith>): ReturnType<typeof seedWith> => ({
	...seed,
	employee_contract: (seed.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2025-01-01', to: '2026-02-15' },
		final_pay_due_on: '2026-03-15'
	})),
	pay_group: (seed.pay_group ?? []).map((row) => ({
		...row,
		payment_schedule: { ...jsonObject(row.payment_schedule), pay_cutoff_day: 10 }
	}))
});
const entry = (seed: ReturnType<typeof seedWith>, extra: object = {}) =>
	leaveCreate({
		entity_id: ENTITY,
		employment_id: CONTRACT,
		catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'ANNUAL_LEAVE')),
		encashment: true,
		days: wholeDays('2026-01-05', '2026-01-06'),
		...extra
	});
const approved = (t: Kit) =>
	Effect.gen(function* () {
		const { leave_catalog_entry } = yield* t.storedQuery({
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		});
		const requestId = leave_catalog_entry.rows[0]?.$approval?.requestId;
		// an administrator supersedes the review: the entry commits directly
		if (requestId === undefined) return;
		yield* t.as(t.member(['hr_controller'])).approvals.decide(requestId, {
			decision: 'approve'
		});
	});
const line = (t: Kit) =>
	t
		.storedQuery({ payslip: { limit: 10 } })
		.pipe(
			Effect.map(({ payslip }) =>
				payslip.rows
					.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines)
					.filter((row) => row.code === 'ANNUAL_LEAVE')
			)
		);

describe('a VN exit cash-out', () => {
	it.live(
		'prices every slot of the cash-out up to the last day, including those past the run window',
		() => {
			const seed = midMonthCutoff(seedWith({ ...REVIEW, month: '2026-01' }));
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t
					.as(t.admin)
					.act('leave_catalog_entry.create', [
						entry(seed, { days: wholeDays('2026-01-29', '2026-02-12') })
					]);
				yield* approved(t);
				yield* t
					.as(t.admin)
					.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
				// model effects run after the write: capture is due work
				yield* t.runDue();
				const lines = yield* line(t);
				const paid = lines.find((row) => row.direction === 'ADD');
				assert.ok(paid !== undefined);
				assert.equal(Number(paid.quantity), 2);
				assert.equal(Number(paid.amount), 1_000_000);
				const { leave_catalog_entry } = yield* t.storedQuery({
					leave_catalog_entry: { where: { encashment: { eq: true } }, fields: ['id'], limit: 10 }
				});
				const source = `leave_catalog_entry:${String(leave_catalog_entry.rows[0]?.id)}`;
				const { ledger_entry } = yield* t.storedQuery({
					ledger_entry: {
						where: { source: { eq: source } },
						fields: ['operation', 'amount', 'measure'],
						limit: 100
					}
				});
				const used = ledger_entry.rows
					.filter((row) => row.measure === 'used')
					.reduce(
						(total, row) =>
							total + (row.operation === 'DEDUCT' ? -1 : 1) * (row.amount?.toNumber() ?? 0),
						0
					);
				assert.equal(used, Number(paid.quantity));
				// the run priced all four slots, so all four carry its stamp: two fall after its attendance, which ends on 9 February
				const { leave_catalog_entry_day } = yield* t.storedQuery({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: leave_catalog_entry.rows[0]?.id } },
						fields: ['payroll_run_id'],
						limit: 100
					}
				});
				assert.equal(
					leave_catalog_entry_day.rows.filter((row) => row.payroll_run_id != null).length,
					leave_catalog_entry_day.rows.length
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-24T02:00:00.000Z' })));
		}
	);
	it.live('pays the days at the recorded daily wage in final pay', () => {
		const seed = seedWith(REVIEW);
		const finalPay = idOf<'subtotal'>(
			'subtotal',
			String(
				(seed.subtotal ?? []).find(
					(row) =>
						row.code === 'FINAL_PAY' &&
						row.settings_id === seed.entity_profile_version?.[0]?.input_schema_version_id
				)?.id
			)
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.as(t.admin).act('leave_catalog_entry.create', [entry(seed)]);
			yield* approved(t);
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-01', kind: 'ON_CYCLE' }]);
			const lines = yield* line(t);
			const paid = lines.find((row) => row.direction === 'ADD');
			assert.ok(paid !== undefined);
			assert.equal(Number(paid.amount), 1_000_000);
			assert.equal(Number(paid.quantity), 2);
			assert.equal(String(paid.subtotal_id), String(finalPay));
		}).pipe(Effect.provide(workspace({ seed, now: '2026-01-20T02:00:00.000Z' })));
	});
});
