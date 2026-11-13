// The ledger checked from outside its service: a balance is the sum of its ledger rows (H1), what a ledger source still
// holds has its record (H3), an entry a run sealed has that run's payslip (H6), an open exit task names an exit that
// stands (H9), and nothing entitled or left is below zero (W1, a watch). Each is broken by a seed no act could have written; the check finds exactly that and changes
// nothing. A manual deduction stops at what is left, and the database refuses a ledger row that names no source.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Cause, Effect, Exit } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { leftIn, type Accounts } from '../../src/lib/ledger/core.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	PAY_GROUP,
	accountsIn,
	flat,
	leaveCreate,
	ledgerRows,
	pack,
	projection,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery,
	storedReader
} from '../kit.ts';

// between two changes of the law the template holds (8 July to 31 December 2026)
const NOW = '2026-11-20T02:00:00.000Z';
const TODAY = NOW.slice(0, 10);
const YEAR = 'MY.Y.2026-01-01';
const BALANCE = uuid(5);
const CONTRACT = idOf('employee_contract', uuid(6));
const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
const seed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[]
);
type Seed = typeof seed;
const holding = (account: Accounts, more: Seed = {}): Seed => ({
	...seed,
	...more,
	employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
});
/** One ledger row as the service would have written it, restored without it. */
const ledgerRow = (id: number, row: Seed[string][number]) => ({
	id: uuid(id),
	balance_id: BALANCE,
	operation: 'ADD',
	unit: 'DAY',
	effective_on: '2026-08-10',
	...row
});
const found = (t: Kit) =>
	verify(storedReader(t), TODAY).pipe(
		Effect.map((rows) => rows.map((row) => [row.invariant, row.subject]))
	);
const tasks = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 1000 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows
				.filter((row) => row.occurrence_key.startsWith('integrity:'))
				.map((row) => ({ id: row.id, key: row.occurrence_key, state: row.state }))
				.toSorted((left, right) => left.key.localeCompare(right.key))
		)
	);
const check = (t: Kit) =>
	t.as(t.admin).pipe(
		Effect.andThen((admin) => admin.run('ledger', {}, JobResult)),
		Effect.andThen(t.run_due())
	);
const entry = (quantity: number, on: string) => ({
	entity_id: ENTITY,
	employment_id: CONTRACT,
	quantity: String(quantity),
	incurred_on: on
});
/** A manual adjustment as the profile sends it: signed days. */
const adjust = (t: Kit, code: string, days: number, on: string) =>
	t.as(t.member(['hr_controller'])).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'ledger_entry.create': [
					{
						balance_id: idOf('employee_balance', BALANCE),
						operation: days < 0 ? 'DEDUCT' : 'ADD',
						account: 'leave',
						code,
						measure: 'entitled',
						amount: String(Math.abs(days)),
						unit: 'DAY',
						effective_on: on,
						note: 'keyed by hand'
					}
				]
			})
		)
	);

const H1 = holding({ leave: { ANNUAL_LEAVE: { [YEAR]: { used: 2 } } } });
const H1_SUBJECT = `${BALANCE}/leave/ANNUAL_LEAVE/${YEAR}/used`;

describe('a workspace worked through its real acts', () => {
	it.live('has no finding, and its check raises nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* syncAll(t);
			yield* admin.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_code: 'ANNUAL_LEAVE',
						days: wholeDays('2026-08-11')
					})
				]
			});
			yield* admin.act({
				'claim_catalog_entry.create': [
					{ ...entry(50, '2026-08-10'), catalog_code: 'MEDICAL_CLAIM' }
				]
			});
			yield* admin.act({
				'adhoc_catalog_entry.create': [
					{
						...entry(500, '2026-08-10'),
						catalog_code: 'BONUS',
						description: 'BONUS'
					}
				]
			});
			yield* t.run_due();
			yield* adjust(t, 'ANNUAL_LEAVE', 1, '2026-08-18');
			// a claim keyed and taken back leaves its source at nothing
			yield* admin.act({
				'claim_catalog_entry.create': [
					{ ...entry(20, '2026-09-10'), catalog_code: 'MEDICAL_CLAIM' }
				]
			});
			const { claim_catalog_entry: claims } = yield* storedQuery(t, {
				claim_catalog_entry: { limit: 10 }
			});
			const later = claims.rows.find((row) => String(row.incurred_on) === '2026-09-10');
			assert.ok(later !== undefined);
			yield* admin.act({ 'claim_catalog_entry.delete': [{ target: later }] });
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-08', kind: 'ON_CYCLE' }]
			});
			yield* t.run_due();
			const { payroll_run: runs } = yield* storedQuery(t, { payroll_run: { limit: 1 } });
			const run = runs.rows[0];
			assert.ok(run !== undefined);
			// paying a run starts the whole-workspace ledger pass, which ends with the check
			yield* admin.act({ 'payroll_run.update': [{ target: run, set: { state: 'PAID' } }] });
			assert.deepEqual((yield* t.run_due()).failed, []);
			const sources = new Set(
				(yield* ledgerRows(t)).map((row) => String(row.source).split(':')[0])
			);
			for (const kind of [
				'entitlement',
				'leave_catalog_entry',
				'claim_catalog_entry',
				'manual',
				'payroll_run'
			])
				assert.ok(sources.has(kind), `nothing posted by ${kind}`);
			assert.deepEqual(flat(yield* accountsIn(t)), yield* projection(t));
			assert.deepEqual(yield* verify(storedReader(t), TODAY), []);
			yield* check(t);
			assert.deepEqual(yield* tasks(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a broken invariant yields exactly its finding', () => {
	it.live('H1: a balance figure its ledger rows do not sum to', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), [['H1', H1_SUBJECT]]);
		}).pipe(Effect.provide(workspace({ seed: H1, now: NOW })))
	);
	it.live('H3: a ledger source that holds something and has no record', () => {
		const source = `claim_catalog_entry:${uuid(777)}`;
		const gone = holding(
			{ claim: { MEDICAL_CLAIM: { [YEAR]: { used: 50 } } } },
			{
				ledger_entry: [
					ledgerRow(700, {
						account: 'claim',
						code: 'MEDICAL_CLAIM',
						period: YEAR,
						measure: 'used',
						amount: 50,
						unit: 'MONEY',
						source
					})
				]
			}
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), [['H3', source]]);
		}).pipe(Effect.provide(workspace({ seed: gone, now: NOW })));
	});
	it.live('H3: a source that nets to nothing needs no record', () => {
		const source = `claim_catalog_entry:${uuid(777)}`;
		const key = { account: 'claim', code: 'MEDICAL_CLAIM', period: YEAR, measure: 'used' };
		const undone = holding(
			{},
			{
				ledger_entry: [
					ledgerRow(700, { ...key, amount: 50, unit: 'MONEY', source }),
					ledgerRow(701, { ...key, amount: 50, unit: 'MONEY', source, operation: 'DEDUCT' })
				]
			}
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), []);
		}).pipe(Effect.provide(workspace({ seed: undone, now: NOW })));
	});
	it.live('H6: an entry sealed by an unpaid run that holds no payslip for its person', () => {
		const sealed = holding(
			{},
			{
				payroll_run: [
					{
						id: uuid(720),
						run_number: 1,
						entity_id: ENTITY,
						pay_group_id: PAY_GROUP,
						period: '2026-10',
						kind: 'ON_CYCLE',
						salary_coverage: { from: '2026-10-01', to: '2026-10-31' },
						pay_date: '2026-10-23',
						state: 'UNPAID'
					}
				],
				claim_catalog_entry: [
					{
						id: uuid(721),
						entity_id: ENTITY,
						employment_id: uuid(6),
						catalog_code: 'MEDICAL_CLAIM',
						quantity: 40,
						incurred_on: '2026-10-05',
						payroll_run_id: uuid(720)
					}
				]
			}
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), [['H6', `claim_catalog_entry:${uuid(721)}`]]);
		}).pipe(Effect.provide(workspace({ seed: sealed, now: NOW })));
	});
	// the exit dependants routine keeps this one; here it never ran, and the task has a twin whose exit stands
	const LAST = '2026-10-31';
	const MOVED = '2026-09-30';
	const exited = (more: Seed): Seed =>
		holding(
			{},
			{
				employee_contract: (seed.employee_contract ?? []).map((row) => ({
					...row,
					effective_range: { from: '2025-01-01', to: LAST }
				})),
				...more
			}
		);
	it.live('H9: an open exit task whose exit moved to another last day', () => {
		const task = (id: number, day: string) => ({
			id: uuid(id),
			entity_id: ENTITY,
			employee_id: uuid(4),
			employment_id: uuid(6),
			title: 'An exit duty',
			occurrence_key: `DUTY:${uuid(6)}:exit:${day}`,
			state: 'OPEN'
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), [['H9', `obligation:${uuid(740)}`]]);
		}).pipe(
			Effect.provide(
				workspace({ seed: exited({ obligation: [task(740, MOVED), task(741, LAST)] }), now: NOW })
			)
		);
	});
	it.live('W1: an entitlement below zero, which its ledger agrees with', () => {
		const below = holding(
			{ leave: { ANNUAL_LEAVE: { [YEAR]: { entitled: -1 } } } },
			{
				ledger_entry: [
					ledgerRow(710, {
						account: 'leave',
						code: 'ANNUAL_LEAVE',
						period: YEAR,
						measure: 'entitled',
						amount: 1,
						operation: 'DEDUCT',
						source: `manual:${uuid(710)}`,
						note: 'restored'
					})
				]
			}
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.deepEqual(yield* found(t), [['W1', `${BALANCE}/leave/ANNUAL_LEAVE/${YEAR}`]]);
		}).pipe(Effect.provide(workspace({ seed: below, now: NOW })));
	});
});

describe('the integrity check', () => {
	it.live(
		'raises one task a finding, nothing again while it is open, and a dated one when it comes back',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// the check rides the sync's whole pass: what the sync itself posts is in place first
				yield* syncAll(t);
				const before = { ledger: yield* ledgerRows(t), balance: yield* accountsIn(t) };
				yield* check(t);
				const [task, ...more] = yield* tasks(t);
				assert.ok(task !== undefined);
				assert.deepEqual(more, []);
				assert.deepEqual([task.key, task.state], [`integrity:H1:${H1_SUBJECT}`, 'OPEN']);
				yield* check(t);
				assert.deepEqual(yield* tasks(t), [task]);
				// it reports and repairs nothing: the ledger and the balance stand as they were
				assert.deepEqual(yield* ledgerRows(t), before.ledger);
				assert.deepEqual(yield* accountsIn(t), before.balance);
				assert.deepEqual(yield* found(t), [['H1', H1_SUBJECT]]);
				// closed without a repair, the finding is raised again under its date, once
				const [open] = (yield* storedQuery(t, {
					obligation: { where: { id: { eq: task.id } }, limit: 1 }
				})).obligation.rows;
				assert.ok(open !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'obligation.update': [
						{ target: open, set: { state: 'WAIVED', waiver_reason: 'Looked at, not repaired' } }
					]
				});
				yield* t.run_due();
				yield* check(t);
				yield* check(t);
				assert.deepEqual(
					(yield* tasks(t)).map((row) => [row.key, row.state]),
					[
						[`integrity:H1:${H1_SUBJECT}`, 'WAIVED'],
						[`integrity:H1:${H1_SUBJECT}@${TODAY}`, 'OPEN']
					]
				);
			}).pipe(Effect.provide(workspace({ seed: H1, now: NOW })))
	);
});

describe('a manual deduction', () => {
	it.live('past what is left stands, as HR meant it, and is watched', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			assert.equal((yield* adjust(t, IN_LIEU, 1, '2026-11-02')).kind, 'committed');
			// days taken stay taken: HR may take back more than is left, and the check reports the window
			assert.equal((yield* adjust(t, IN_LIEU, -1.5, '2026-11-02')).kind, 'committed');
			assert.equal(leftIn((yield* accountsIn(t)).leave?.[IN_LIEU]?.[YEAR]), -0.5);
			assert.deepEqual(
				(yield* verify(storedReader(t), TODAY)).map((finding) => finding.invariant),
				['W1']
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a ledger row', () => {
	it.live('that names no source is refused by the database', () => {
		const sourceless = holding(
			{},
			{
				ledger_entry: [
					ledgerRow(730, {
						account: 'leave',
						code: 'ANNUAL_LEAVE',
						period: YEAR,
						measure: 'entitled',
						amount: 1
					})
				]
			}
		);
		return Effect.gen(function* () {
			const restored = yield* Effect.exit(
				Effect.gen(function* () {
					yield* TestWorkspace;
				}).pipe(Effect.provide(workspace({ seed: sourceless, now: NOW })))
			);
			assert.ok(Exit.isFailure(restored), 'a sourceless ledger row was stored');
			assert.match(
				Cause.pretty(restored.cause),
				/ledger_entry__ck|names_its_movement|names its source/
			);
		});
	});
});
