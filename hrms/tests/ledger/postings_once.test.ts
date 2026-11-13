// A posting can run again: the host dies as it ends, and the next boot runs it from the start. Whatever it posted stands,
// once. Every balance is its ledger: a movement and its balance commit as one write.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { Accounts } from '../../src/lib/ledger/core.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	lawAt,
	lawWith,
	ledgerRows,
	measureOf,
	pack,
	recordEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	flat,
	projection,
	storedQuery,
	decimalNumber
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const EMPLOYMENT = idOf('employment', uuid(6));
const terms = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
/** EMERGENCY_LEAVE is varied to draw on ANNUAL_LEAVE's balance (`lookup.accounts`): a row that counts against another. */
const DRAWS = 'EMERGENCY_LEAVE';
const seedOf = (account: Accounts): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
	return {
		...lawWith(seed, {
			leave_catalog: {
				[DRAWS]: {
					lookup: {
						...objectValue(
							lawAt('MY', '2026-08-15').rows.leave_catalog.find((row) => row.code === DRAWS)?.lookup
						),
						accounts: [{ account: 'leave', code: 'ANNUAL_LEAVE', measure: 'used' }]
					}
				}
			}
		}),
		// a married woman, so a birth opens leave
		employee_profile: (seed.employee_profile ?? []).map((row) => ({ ...row, gender: 'FEMALE' })),
		statutory_parameters: (seed.statutory_parameters ?? []).map((row) => ({
			...row,
			marital_status: 'MARRIED'
		})),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
// the service year the stint's start on 1 January 2025 reaches in 2026
const WINDOW = 'MY.S.2026-01-01';
const HOLDS = seedOf({ leave: { ANNUAL_LEAVE: { [WINDOW]: { entitled: 12 } } } });
const EMPTY = seedOf({});
const take = (t: Kit, code: string, ...dates: string[]) =>
	Effect.flatMap(t.as(t.admin), (admin) =>
		admin.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					catalog_code: code,
					days: wholeDays(...dates)
				})
			]
		})
	);
const used = (t: Kit) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => accounts.leave?.['ANNUAL_LEAVE']?.[WINDOW]?.['used'])
	);
const leaveRows = (t: Kit, code: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.account === 'leave' && row.code === code)
				.map((row) => `${row.operation} ${row.measure} ${decimalNumber(row.amount)}`)
				.toSorted()
		)
	);
const firstEntry = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { limit: 1 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => {
			const row = leave_catalog_entry.rows[0];
			assert.ok(row !== undefined);
			return row;
		})
	);
/** A run that prices the entry's slots: while it is unpaid, it holds the entry. */
const price = (t: Kit) =>
	Effect.flatMap(t.as(t.admin), (admin) =>
		admin.act({
			'payroll_run.create': [{ entity_id: ENTITY, period: '2026-09', kind: 'ON_CYCLE' }]
		})
	).pipe(Effect.andThen(t.run_due()));
/** Lets each queued effect and posting finish its work, kills the host as it ends, then runs it again. */
const crashEach = (t: Kit) =>
	Effect.gen(function* () {
		const killed = new Set<string>();
		for (;;) {
			const [queued] = yield* t.db.read([
				{
					text: `SELECT id::text AS id FROM sys_run WHERE state = 'queued' AND (automation LIKE '%.effect.%' OR automation = 'ledger')`,
					params: []
				}
			]);
			const id = (queued?.rows ?? [])
				.map((row) => String(row['id']))
				.find((run) => !killed.has(run));
			if (id === undefined) break;
			killed.add(id);
			yield* t.crash(id);
		}
		assert.ok(killed.size > 0, 'nothing queued');
		yield* t.run_due();
	});
describe('a posting that runs again', () => {
	it.live('a leave entry is posted once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, 'ANNUAL_LEAVE', '2026-09-08', '2026-09-09');
			yield* crashEach(t);
			assert.equal(yield* used(t), 2);
			assert.deepEqual(yield* leaveRows(t, 'ANNUAL_LEAVE'), ['ADD used 2']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('an entry an unpaid run priced is held under that run, and its posting stands', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, 'ANNUAL_LEAVE', '2026-09-08', '2026-09-09');
			yield* crashEach(t);
			yield* price(t);
			const admin = yield* t.as(t.admin);
			const failed = yield* Effect.flip(
				admin.act({ 'leave_catalog_entry.delete': [{ target: yield* firstEntry(t) }] })
			);
			assert.match(String(failed), /Run \d+ holds this person and is not paid yet/);
			assert.equal(yield* used(t), 2);
			assert.deepEqual(yield* leaveRows(t, 'ANNUAL_LEAVE'), ['ADD used 2']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('a recorded fact opens its days once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* recordEvents(t, [{ kind: 'CHILD_BIRTH', on: '2026-09-02' }]);
			yield* crashEach(t);
			const opened = measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'entitled');
			assert.ok(opened > 0);
			assert.deepEqual(yield* leaveRows(t, 'MATERNITY_LEAVE'), [`ADD entitled ${opened}`]);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live(
		'a row that draws on another row posts there once, and gives it back with the entry',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, DRAWS, '2026-09-08');
				yield* crashEach(t);
				assert.equal(yield* used(t), 1);
				assert.deepEqual(yield* leaveRows(t, DRAWS), []);
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.delete': [{ target: yield* firstEntry(t) }]
				});
				yield* crashEach(t);
				assert.equal(yield* used(t), 0);
			}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('a payslip posts once, and a run deleted after it posts its inverse once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-09', kind: 'ON_CYCLE' }]
			});
			yield* crashEach(t);
			const year = (yield* accountsIn(t)).pay?.['BASIC']?.['MY.Y.2026-01-01']?.['total'];
			assert.equal(year, terms.rate.amount);
			const { payroll_run: runs } = yield* storedQuery(t, { payroll_run: { limit: 1 } });
			const run = runs.rows[0];
			assert.ok(run !== undefined);
			yield* admin.act({ 'payroll_run.delete': [{ target: run }] });
			yield* crashEach(t);
			assert.deepEqual((yield* accountsIn(t)).pay?.['BASIC']?.['MY.Y.2026-01-01'], { total: 0 });
		}).pipe(Effect.provide(workspace({ seed: EMPTY, now: NOW })))
	);
});

describe('a balance is its ledger', () => {
	it.live('from nothing, through a year of entries, facts, runs and corrections', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* syncAll(t);
			yield* take(t, 'ANNUAL_LEAVE', '2026-08-04', '2026-08-05');
			yield* t.run_due();
			const first = yield* firstEntry(t);
			yield* take(t, 'ANNUAL_LEAVE', '2026-08-06');
			const { leave_catalog_entry: later } = yield* storedQuery(t, {
				leave_catalog_entry: { limit: 2 }
			});
			const second = later.rows.find((row) => row.id !== first.id);
			assert.ok(second !== undefined);
			yield* admin.act({ 'leave_catalog_entry.delete': [{ target: second }] });
			yield* t.run_due();
			yield* recordEvents(t, [
				{ kind: 'CHILD_BIRTH', on: '2026-09-02' },
				{ kind: 'CHILD_BIRTH_NO_ALLOWANCE', on: '2026-09-03' }
			]);
			yield* t.run_due();
			yield* recordEvents(t, [{ kind: 'CHILD_BIRTH', on: '2026-09-02' }]);
			yield* t.run_due();
			const pay = (period: string) =>
				admin
					.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
					.pipe(Effect.andThen(t.run_due()));
			const onlyRun = storedQuery(t, { payroll_run: { limit: 1 } }).pipe(
				Effect.map(({ payroll_run }) => {
					const row = payroll_run.rows[0];
					assert.ok(row !== undefined);
					return row;
				})
			);
			yield* pay('2026-09');
			yield* admin.act({ 'payroll_run.delete': [{ target: yield* onlyRun }] });
			yield* t.run_due();
			yield* pay('2026-09');
			yield* admin.act({
				'payroll_run.update': [{ target: yield* onlyRun, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			assert.ok((yield* ledgerRows(t)).length > 0);
			assert.deepEqual(flat(yield* accountsIn(t)), yield* projection(t));
		}).pipe(Effect.provide(workspace({ seed: EMPTY, now: NOW })))
	);
});
