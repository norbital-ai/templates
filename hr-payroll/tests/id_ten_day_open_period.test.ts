// A ten-day run with a cutoff prices [previous cutoff, current cutoff − 1]. A no-pay day keyed in that window after the
// part is paid leaves that part to be worked out again, even when the day's calendar part number is different. Indonesia
// is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	catalogRow,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 10_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seedOf = (cutoff: number) => {
	const base = pack('ID', 'Asia/Jakarta', terms, {}, [], [], '2026-02-15');
	return {
		...base,
		entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { risk_class: 'I' }
		})),
		pay_group: (base.pay_group ?? []).map((row) => ({
			...row,
			payment_schedule: {
				frequency: 'TEN_DAY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_days: [10, 20, 31],
				pay_cutoff_day: cutoff
			}
		}))
	};
};
const live = (cutoff: number) =>
	workspace({ seed: seedOf(cutoff), now: '2026-02-15T02:00:00.000Z' });
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		);
const noPay = (t: Kit, date: string) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', catalogRow(seedOf(1), 'leave_catalog', 'NPL')),
						days: wholeDays(date)
					})
				]
			})
		)
	);

describe('a ten-day schedule with a cutoff', () => {
	for (const [cutoff, day] of [
		[1, '2026-02-03'],
		[25, '2026-02-12']
	] as const)
		it.live(
			`cutoff ${cutoff}: a no-pay day in the attendance the first part paid leaves that part to be worked out again`,
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* run(t, '2026-02-1');
					yield* t.run_due();
					const [first] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
					assert.ok(first !== undefined);
					yield* t
						.as(t.admin)
						.pipe(
							Effect.andThen((caller) =>
								caller.act({ 'payroll_run.update': [{ target: first, set: { state: 'PAID' } }] })
							)
						);
					yield* t.run_due();
					yield* noPay(t, day);
					const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
					assert.deepEqual(
						pay_amendment.rows.map((row) => [row.period, row.payroll_run_id ?? null]),
						[['2026-02-1', null]]
					);
				}).pipe(Effect.provide(live(cutoff)))
		);
});
