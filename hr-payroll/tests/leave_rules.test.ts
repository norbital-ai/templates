// A limit set across rows: joint leave draws on annual leave.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Option, Schema } from 'effect';
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
	storedQuery
} from './kit.ts';

const NOW = '2026-10-06T02:00:00.000Z';
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
const seedOf = (code: string, zone: string, on: string, account: Accounts): Seed => {
	const seed = pack(code, zone, terms, {}, [], [], on);
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
const take = (t: Kit, seed: Seed, code: string, from: string, count: number) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
						days: dates(from, count)
					})
				]
			})
		)
	);
const usedOf = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', code, 'used')));

/** A record as a write targets it: its id at its current revision. */
const current = <C extends string>(t: Kit, model: C, id: Id<C>) =>
	t.db
		.one(Schema.Struct({ revision: Schema.Int }), {
			text: `SELECT revision FROM ${model} WHERE id = $1`,
			params: [id]
		})
		.pipe(
			Effect.map((found) => {
				assert.ok(Option.isSome(found), `No ${model} ${id}`);
				return { id, revision: found.value.revision };
			})
		);
describe('Indonesian joint leave', () => {
	// the service year a start of 1 January 2025 is in; UU 27/2026 stops cuti bersama drawing on annual leave from 2026-10-28, so the days fall before it
	const seed = seedOf('ID', 'Asia/Jakarta', '2026-10-01', {
		leave: { ANNUAL_LEAVE: { 'ID.S.2026-01-01': { entitled: 3 } } }
	});
	it.live('draws on annual leave, and a day taken off a paid entry gives it back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'JOINT_LEAVE', '2026-10-05', 2);
			yield* t.run_due();
			assert.equal(yield* usedOf(t, 'ANNUAL_LEAVE'), 2);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }]
			});
			yield* t.run_due();
			const [paying] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(paying !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: paying, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			const entry = yield* sealedLeave(t);
			const { leave_catalog_entry_day } = yield* storedQuery(t, {
				leave_catalog_entry_day: {
					where: { leave_entry_id: { eq: entry } },
					fields: ['id', 'revision', 'incurred_on'],
					limit: 10
				}
			});
			const second = leave_catalog_entry_day.rows
				.filter((row) => String(row.incurred_on) === '2026-10-06')
				.map(({ id, revision }) => ({ id, revision }));
			assert.equal(second.length, 2);
			yield* (yield* t.as(t.admin)).act({
				'leave_catalog_entry.update': [
					{
						target: yield* current(t, 'leave_catalog_entry', entry),
						set: { leave_catalog_entry_day: { delete: second } }
					}
				]
			});
			yield* t.run_due();
			assert.equal(yield* usedOf(t, 'ANNUAL_LEAVE'), 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('is refused past what annual leave holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, seed, 'JOINT_LEAVE', '2026-10-05', 4));
			assert.match(String(refused), /ANNUAL_LEAVE: insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
