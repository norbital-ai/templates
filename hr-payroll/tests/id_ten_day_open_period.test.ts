// A ten-day run with a cutoff prices [previous cutoff, current cutoff − 1]. A no-pay day in that window is closed as
// soon as the part's run exists, even when the day's calendar part number is different.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, leaveCreate, pack, uuid, wholeDays, workspace } from './kit.ts';

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
		entity: (base.entity ?? []).map((row) => ({
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
const run = (t: import('@norbital-ai/bolt-cli/test').Kit, period: string) =>
	t.as(t.admin).act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
const noPay = (t: import('@norbital-ai/bolt-cli/test').Kit, date: string) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seedOf(1), 'leave_catalog', 'UNPAID_LEAVE')),
			days: wholeDays(date)
		})
	]);

describe('ID ten-day no-pay open period', () => {
	it('a cutoff of 1 closes the calendar part that ran', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02-1');
			yield* t.runDue();
			const refused = yield* Effect.flip(noPay(t, '2026-02-03'));
			assert.match(String(refused), /already run/);
		}).pipe(Effect.provide(live(1))));
	it('a cutoff of 25 closes 12 February once the first part ran', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02-1');
			yield* t.runDue();
			const refused = yield* Effect.flip(noPay(t, '2026-02-12'));
			assert.match(String(refused), /already run/);
		}).pipe(Effect.provide(live(25))));
});
