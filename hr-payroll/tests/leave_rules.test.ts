// Limits a statute sets across rows or years: joint leave draws on annual leave, Taiwan's hospital pool spans two years.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { Accounts } from '../src/lib/ledger/core.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, catalogRow, measureOf, pack, uuid, workspace } from './kit.ts';

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
const take = (t: Kit, seed: Seed, code: string, from: string, count: number, is_reversal = false) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: dates(from, count),
			is_reversal
		}
	]);
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
			yield* take(t, seed, 'JOINT_LEAVE', '2026-11-16', 1, true);
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

describe('Taiwan hospitalised sick leave', () => {
	const seed = seedOf('TW', 'Asia/Taipei', {});
	it.live('allows a year within any two years', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'SICK_LEAVE_UNPAID', '2025-11-01', 340);
			yield* t.runDue();
			yield* take(t, seed, 'HOSPITALISED_SICK_LEAVE', '2026-10-10', 20);
			yield* t.runDue();
			const refused = yield* Effect.flip(take(t, seed, 'HOSPITALISED_SICK_LEAVE', '2026-11-02', 6));
			assert.match(String(refused), /365 days allowed within two years/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
