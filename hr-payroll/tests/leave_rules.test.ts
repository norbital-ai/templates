// Limits a statute sets across rows or years: joint leave draws on annual leave, Taiwan's hospital pool spans two years.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

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
type Account = NonNullable<Seed['employee_balance']>[number]['account'];
const seedOf = (code: string, zone: string, account: Account): Seed => {
	const seed = pack(code, zone, terms, {}, [], [], '2026-11-06');
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
const rowOf = (seed: Seed, code: string) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const row = seed.leave_catalog?.find(
		(item) => item.code === code && item.settings_id === version
	);
	assert.ok(row !== undefined, code);
	return idOf('leave_catalog', String(row.id));
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
			catalog_id: rowOf(seed, code),
			days: dates(from, count),
			is_reversal
		}
	]);
const leaveOf = (t: Kit) =>
	t.storedQuery({ employee_balance: { limit: 1 } }).pipe(
		Effect.map(({ employee_balance }) => {
			const account = Schema.decodeUnknownSync(JsonObject)(employee_balance.rows[0]?.account);
			return Schema.decodeUnknownSync(JsonObject)(account.leave ?? {});
		})
	);

describe('Indonesian joint leave', () => {
	const seed = seedOf('ID', 'Asia/Jakarta', {
		leave: { ANNUAL_LEAVE: 3, JOINT_LEAVE: 36500 }
	});
	it.live('draws on annual leave, and a reversal gives it back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'JOINT_LEAVE', '2026-11-02', 2);
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['ANNUAL_LEAVE'], 1);
			yield* take(t, seed, 'JOINT_LEAVE', '2026-11-16', 1, true);
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['ANNUAL_LEAVE'], 2);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('is refused past what annual leave holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, seed, 'JOINT_LEAVE', '2026-11-02', 4));
			assert.match(String(refused), /Only 3 days of ANNUAL_LEAVE/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('Taiwan hospitalised sick leave', () => {
	const seed = seedOf('TW', 'Asia/Taipei', {
		leave: { HOSPITALISED_SICK_LEAVE: 36500, SICK_LEAVE_UNPAID: 36500 }
	});
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
