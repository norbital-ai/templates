// A limit set across rows: joint leave draws on annual leave.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { Accounts } from '../src/lib/ledger/core.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	sealedLeave,
	uuid,
	workspace,
	leaveCreate,
	reversalSlots
} from './kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
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
type Seed = ReturnType<typeof pack>;
const seedOf = (code: string, zone: string, account: Accounts): Seed => {
	const seed = pack(code, zone, terms, {}, [], [], '2026-11-06');
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
const dates = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => {
		const at = new Date(`${from}T00:00:00Z`);
		at.setUTCDate(at.getUTCDate() + index);
		return at.toISOString().slice(0, 10);
	}).flatMap((date) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	]);
const take = (
	t: Kit,
	seed: Seed,
	code: string,
	from: string,
	count: number,
	reverses: Id<'leave_catalog_entry'> | null = null
) =>
	Effect.gen(function* () {
		const days =
			reverses == null
				? dates(from, count)
				: (yield* reversalSlots(t, reverses))
						.toSorted(
							(left, right) =>
								left.date.localeCompare(right.date) || left.part.localeCompare(right.part)
						)
						.slice(0, count * 2);
		yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
				days,
				reverses
			})
		]);
	});
const usedOf = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', code, 'used')));

describe('Indonesian joint leave', () => {
	// the service year a start of 1 January 2025 is in
	const seed = seedOf('ID', 'Asia/Jakarta', {
		leave: { ANNUAL_LEAVE: { 'ID.S.2026-01-01': { entitled: 3 } } }
	});
	it.live('draws on annual leave, and a reversal gives it back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'JOINT_LEAVE', '2026-11-02', 2);
			yield* t.runDue();
			assert.equal(yield* usedOf(t, 'ANNUAL_LEAVE'), 2);
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-11', kind: 'ON_CYCLE' }]);
			yield* t.runDue();
			yield* take(t, seed, 'JOINT_LEAVE', '2026-12-07', 1, yield* sealedLeave(t));
			yield* t.runDue();
			assert.equal(yield* usedOf(t, 'ANNUAL_LEAVE'), 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('is refused past what annual leave holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, seed, 'JOINT_LEAVE', '2026-11-02', 4));
			assert.match(String(refused), /ANNUAL_LEAVE: insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
