// Employment Act 1955 s.60D(1): a public holiday on a weekly rest day gives the next working day in substitution. The
// day stays a manual OIL entry; the template refuses one the employee's own week cannot support.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { restDaySubstitutions, weeklyRestDays } from '../src/lib/payroll_engine/rest_days.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, leaveCreate, pack, uuid, wholeDays, workspace } from './kit.ts';

const terms = {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const HOLIDAYS = [
	{ date: '2026-06-07', kind: 'PUBLIC_HOLIDAY' },
	{ date: '2026-06-13', kind: 'PUBLIC_HOLIDAY' }
];
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], HOLIDAYS, '2026-06-15');
const sixDay = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{ ...terms, normal_hours_per_week: 48, normal_days_per_week: 6 },
	{},
	[],
	HOLIDAYS,
	'2026-06-15'
);
const CONTRACT = idOf('employee_contract', uuid(6));
const leave = (t: Kit, source: ReturnType<typeof pack>, date: string) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(source, 'leave_catalog', 'PUBLIC_HOLIDAY_IN_LIEU')),
			days: wholeDays(date)
		})
	]);

describe('a day in lieu of a rest-day holiday', () => {
	it('follows the employee week', () => {
		const six = weeklyRestDays(6);
		assert.deepEqual([...six], [0]);
		assert.deepEqual([...restDaySubstitutions(HOLIDAYS, six)], ['2026-06-08']);
		const five = weeklyRestDays(5);
		assert.deepEqual([...restDaySubstitutions(HOLIDAYS, five)], [
			'2026-06-08',
			'2026-06-15'
		]);
		assert.equal(restDaySubstitutions(HOLIDAYS, weeklyRestDays(7)).size, 0);
	});

	it.live('accepts the working day after a rest-day holiday', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const made = yield* leave(t, seed, '2026-06-08');
			assert.equal(made.kind, 'committed');
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-16T02:00:00.000Z' })))
	);

	it.live('a six-day week takes Sunday only, not the Saturday it works', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const sunday = yield* leave(t, sixDay, '2026-06-08');
			assert.equal(sunday.kind, 'committed');
			const refused = yield* Effect.flip(leave(t, sixDay, '2026-06-15'));
			assert.match(String(refused), /rest day/);
		}).pipe(Effect.provide(workspace({ seed: sixDay, now: '2026-06-16T02:00:00.000Z' })))
	);

	it.live('refuses a day no rest-day holiday substitutes', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(leave(t, seed, '2026-06-09'));
			assert.match(String(refused), /rest day/);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-16T02:00:00.000Z' })))
	);
});
