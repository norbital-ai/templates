// A posting can run again: the host dies as it ends, and the next boot runs it from the start. Whatever it posted stands,
// once. Every balance is its ledger: a movement and its balance commit as one write.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { Accounts } from '../src/lib/ledger/core.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	ledgerRows,
	measureOf,
	pack,
	sealEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const NOW = '2026-12-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 11_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const REGION = 'Provinsi Aceh/Kabupaten Aceh Barat';
type Seed = ReturnType<typeof pack>;
const seedOf = (account: Accounts): Seed => {
	const seed = pack('ID', 'Asia/Jakarta', terms, { work_region: REGION }, [], [], '2026-06-15');
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { risk_class: 'I' }
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null },
			payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
		})),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
// the service year 1 January 2025's start reaches in 2026
const WINDOW = 'ID.S.2026-01-01';
const HOLDS = seedOf({ leave: { ANNUAL_LEAVE: { [WINDOW]: { entitled: 12 } } } });
const EMPTY = seedOf({});
const take = (t: Kit, seed: Seed, code: string, ...dates: string[]) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(...dates)
		}
	]);
const used = (t: Kit) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => accounts.leave?.['ANNUAL_LEAVE']?.[WINDOW]?.['used'])
	);
const leaveRows = (t: Kit, code: string) =>
	ledgerRows(t).pipe(
		Effect.map((rows) =>
			rows
				.filter((row) => row.account === 'leave' && row.code === code)
				.map((row) => `${row.operation} ${row.measure} ${row.amount?.toNumber()}`)
				.toSorted()
		)
	);
const firstEntry = (t: Kit) =>
	t.storedQuery({ leave_catalog_entry: { limit: 1 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => {
			const row = leave_catalog_entry.rows[0];
			assert.ok(row !== undefined);
			return row.id;
		})
	);
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
		yield* t.runDue();
	});
const line = (key: string, value: number) =>
	Math.abs(value) < 1e-6 ? [] : [`${key} ${value.toFixed(6)}`];
/** What the ledger says every key holds, summed by hand. */
const projection = (t: Kit) =>
	ledgerRows(t).pipe(
		Effect.map((rows) => {
			const sums = new Map<string, number>();
			for (const row of rows) {
				const key = [row.account, row.code, row.period, row.measure].join('/');
				const amount = row.amount?.toNumber() ?? 0;
				sums.set(key, (sums.get(key) ?? 0) + (row.operation === 'DEDUCT' ? -amount : amount));
			}
			return [...sums].flatMap(([key, value]) => line(key, value)).toSorted();
		})
	);
const flat = (accounts: Accounts) =>
	Object.entries(accounts)
		.flatMap(([family, codes]) =>
			Object.entries(codes).flatMap(([code, periods]) =>
				Object.entries(periods).flatMap(([period, measures]) =>
					Object.entries(measures).flatMap(([measure, value]) =>
						line([family, code, period, measure].join('/'), value)
					)
				)
			)
		)
		.toSorted();

describe('a posting that runs again', () => {
	it.live('a leave entry is posted once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, HOLDS, 'ANNUAL_LEAVE', '2026-03-03', '2026-03-04');
			yield* crashEach(t);
			assert.equal(yield* used(t), 2);
			assert.deepEqual(yield* leaveRows(t, 'ANNUAL_LEAVE'), ['ADD used 2']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('an edit is posted once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, HOLDS, 'ANNUAL_LEAVE', '2026-03-03', '2026-03-04');
			yield* t.runDue();
			yield* t
				.as(t.admin)
				.act('leave_catalog_entry.update', [
					{ target: yield* firstEntry(t), set: { days: wholeDays('2026-03-03') } }
				]);
			yield* crashEach(t);
			assert.equal(yield* used(t), 1);
			assert.deepEqual(yield* leaveRows(t, 'ANNUAL_LEAVE'), ['ADD used 2', 'DEDUCT used 1']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('a deletion gives the days back once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, HOLDS, 'ANNUAL_LEAVE', '2026-03-03', '2026-03-04');
			yield* t.runDue();
			yield* t.as(t.admin).act('leave_catalog_entry.delete', [{ target: yield* firstEntry(t) }]);
			yield* crashEach(t);
			assert.equal(yield* used(t), 0);
			assert.deepEqual(yield* leaveRows(t, 'ANNUAL_LEAVE'), ['ADD used 2', 'DEDUCT used 2']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('a sealed fact opens its days once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-03-02', [{ kind: 'CHILD_BIRTH', on: '2026-03-02' }]);
			yield* crashEach(t);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MATERNITY_LEAVE', 'entitled'), 90);
			assert.deepEqual(yield* leaveRows(t, 'MATERNITY_LEAVE'), ['ADD entitled 90']);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('joint leave draws on annual leave once, and gives it back with the entry', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, HOLDS, 'JOINT_LEAVE', '2026-03-03');
			yield* crashEach(t);
			assert.equal(yield* used(t), 1);
			assert.deepEqual(yield* leaveRows(t, 'JOINT_LEAVE'), []);
			yield* t.as(t.admin).act('leave_catalog_entry.delete', [{ target: yield* firstEntry(t) }]);
			yield* crashEach(t);
			assert.equal(yield* used(t), 0);
		}).pipe(Effect.provide(workspace({ seed: HOLDS, now: NOW })))
	);
	it.live('a payslip posts once, and a run deleted after it posts its inverse once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]);
			yield* crashEach(t);
			const year = (yield* accountsIn(t)).pay?.['BASIC']?.['ID.Y.2026-01-01']?.['total'];
			assert.equal(year, 11_000_000);
			const { payroll_run: runs } = yield* t.storedQuery({ payroll_run: { limit: 1 } });
			const run = runs.rows[0];
			assert.ok(run !== undefined);
			yield* t.as(t.admin).act('payroll_run.delete', [{ target: run.id }]);
			yield* crashEach(t);
			assert.deepEqual((yield* accountsIn(t)).pay?.['BASIC']?.['ID.Y.2026-01-01'], { total: 0 });
		}).pipe(Effect.provide(workspace({ seed: EMPTY, now: NOW })))
	);
});

describe('a balance is its ledger', () => {
	it.live('from nothing, through a year of entries, facts, runs and corrections', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			yield* syncAll(t);
			yield* take(t, EMPTY, 'ANNUAL_LEAVE', '2026-01-06', '2026-01-07');
			yield* t.runDue();
			const first = yield* firstEntry(t);
			yield* admin.act('leave_catalog_entry.update', [
				{ target: first, set: { days: wholeDays('2026-01-06') } }
			]);
			yield* t.runDue();
			yield* take(t, EMPTY, 'ANNUAL_LEAVE', '2026-01-08');
			yield* t.runDue();
			const { leave_catalog_entry: later } = yield* t.storedQuery({
				leave_catalog_entry: { limit: 2 }
			});
			const second = later.rows.find((row) => row.id !== first);
			assert.ok(second !== undefined);
			yield* admin.act('leave_catalog_entry.delete', [{ target: second.id }]);
			yield* t.runDue();
			yield* sealEvents(t, '2026-02-02', [
				{ kind: 'LONG_ILLNESS', on: '2026-02-02', ended_on: '2026-02-20' },
				{ kind: 'CHILD_BIRTH', on: '2026-02-03' }
			]);
			yield* t.runDue();
			yield* sealEvents(t, '2026-02-03', [{ kind: 'CHILD_BIRTH', on: '2026-02-03' }]);
			yield* t.runDue();
			const pay = (period: string) =>
				admin
					.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
					.pipe(Effect.andThen(t.runDue()));
			const onlyRun = t.storedQuery({ payroll_run: { limit: 1 } }).pipe(
				Effect.map(({ payroll_run }) => {
					const row = payroll_run.rows[0];
					assert.ok(row !== undefined);
					return row.id;
				})
			);
			yield* pay('2026-02');
			yield* admin.act('payroll_run.delete', [{ target: yield* onlyRun }]);
			yield* t.runDue();
			yield* pay('2026-02');
			yield* admin.act('payroll_run.update', [{ target: yield* onlyRun, set: { state: 'PAID' } }]);
			yield* t.runDue();
			assert.ok((yield* ledgerRows(t)).length > 0);
			assert.deepEqual(flat(yield* accountsIn(t)), yield* projection(t));
		}).pipe(Effect.provide(workspace({ seed: EMPTY, now: NOW })))
	);
});
