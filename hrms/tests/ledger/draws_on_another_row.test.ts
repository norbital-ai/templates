// A limit set across rows: a row whose `lookup.accounts` names another row's account draws on that row's balance,
// never its own. EMERGENCY_LEAVE is varied to draw on ANNUAL_LEAVE.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { Accounts } from '../../src/lib/ledger/core.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	current,
	lawAt,
	lawWith,
	measureOf,
	pack,
	sealedLeave,
	uuid,
	workspace,
	leaveCreate,
	storedQuery
} from '../kit.ts';

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
const DRAWS = 'EMERGENCY_LEAVE';
const seedOf = (account: Accounts): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
	return {
		...lawWith(seed, {
			leave_catalog: {
				[DRAWS]: {
					lookup: {
						...objectValue(
							lawAt('MY', '2026-10-01').rows.leave_catalog.find((row) => row.code === DRAWS)?.lookup
						),
						accounts: [{ account: 'leave', code: 'ANNUAL_LEAVE', measure: 'used' }]
					}
				}
			}
		}),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
const dates = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => {
		const at = new Date(`${from}T00:00:00Z`);
		at.setUTCDate(at.getUTCDate() + index);
		return at.toISOString().slice(0, 10);
	}).flatMap((date) => [
		{ date, part: 'AM' as const },
		{ date, part: 'PM' as const }
	]);
const take = (t: Kit, code: string, from: string, count: number) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_code: code,
						days: dates(from, count)
					})
				]
			})
		)
	);
const usedOf = (t: Kit, code: string) =>
	accountsIn(t).pipe(Effect.map((accounts) => measureOf(accounts, 'leave', code, 'used')));

describe('a row that draws on another', () => {
	// the service year a start of 1 January 2025 is in
	const seed = seedOf({ leave: { ANNUAL_LEAVE: { 'MY.S.2026-01-01': { entitled: 3 } } } });
	it.live(
		'draws on the other row, never its own, and a day taken off a paid entry gives it back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, DRAWS, '2026-10-05', 2);
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
	it.live('is refused past what the other row holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(take(t, DRAWS, '2026-10-05', 4));
			assert.match(String(refused), /ANNUAL_LEAVE: insufficient balance/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
