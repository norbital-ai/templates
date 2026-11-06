// The service reaches everyone: on a schedule, by hand, and from the events that change what someone is owed.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { leftOn, type Accounts } from '../src/lib/ledger/core.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	ledgerRows as allLedgerRows,
	measureOf,
	pack,
	syncAll as compute,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

const NOW = '2026-11-06T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seed = ReturnType<typeof pack>;
const seedOf = (from: string, account: Accounts = {}, on = '2026-11-06'): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], on);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			service_started_on: from,
			effective_range: { from, to: null }
		})),
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account }))
	};
};
const entitled = (t: Kit, code: string, employee?: string) =>
	accountsIn(t, employee).pipe(
		Effect.map((accounts) => measureOf(accounts, 'leave', code, 'entitled'))
	);
const ledgerRows = (t: Kit) =>
	allLedgerRows(t).pipe(Effect.map((rows) => rows.filter((row) => row.account === 'leave')));
const take = (t: Kit, seed: Seed, code: string, date: string, as = t.admin) =>
	t.as(as).act('leave_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(date)
		}
	]);

describe('run by hand', () => {
	it.live(
		'computes everyone from the catalog, and opens no account for a row with no limit',
		() => {
			const seed = seedOf('2023-01-01');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* compute(t);
				assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), 18);
				assert.equal(yield* entitled(t, 'HOSPITALIZATION_LEAVE'), 60);
				assert.equal(yield* entitled(t, 'ANNUAL_LEAVE'), 12);
				const { leave = {} } = yield* accountsIn(t);
				assert.equal(leave['UNPAID_LEAVE'], undefined);
				assert.equal(leave['MATERNITY_LEAVE'], undefined);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);

	it.live('a second run writes nothing', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const first = yield* ledgerRows(t);
			const held = yield* accountsIn(t);
			const [before] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			yield* compute(t);
			yield* compute(t);
			assert.equal((yield* ledgerRows(t)).length, first.length);
			assert.deepEqual(yield* accountsIn(t), held);
			const [after] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.equal(after?.revision, before?.revision);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('days taken stay taken', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, seed, 'MEDICAL_LEAVE', '2026-11-03');
			yield* t.runDue();
			yield* compute(t);
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MEDICAL_LEAVE', 'entitled'), 18);
			assert.equal(measureOf(accounts, 'leave', 'MEDICAL_LEAVE', 'used'), 1);
			assert.equal(
				leftOn(
					accounts,
					'leave',
					'MEDICAL_LEAVE',
					{ window: 'CALENDAR_YEAR' },
					{ scope: 'MY', started: '2023-01-01', events: [] },
					'2026-11-06'
				),
				17
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a leaver is left alone', () => {
		const base = seedOf('2023-01-01');
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2023-01-01', to: '2026-06-30' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			assert.equal((yield* ledgerRows(t)).length, 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a window held from before stands, and carries what it left', () => {
		const seed = seedOf('2023-01-01', {
			leave: { ANNUAL_LEAVE: { 'MY.S.2025-01-01': { entitled: 12, used: 5 } } }
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			assert.deepEqual((yield* accountsIn(t)).leave?.['ANNUAL_LEAVE'], {
				'MY.S.2025-01-01': { entitled: 12, used: 5 },
				'MY.S.2026-01-01': { entitled: 12, carried: 7 }
			});
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), 18);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('run for one person', () => {
	const OTHER = uuid(800);
	const two = (): Seed => {
		const seed = seedOf('2023-01-01');
		const profile = seed.employee_profile?.[0] ?? {};
		const contract = seed.employee_contract?.[0] ?? {};
		const balance = seed.employee_balance?.[0] ?? {};
		return {
			...seed,
			employee_profile: [
				...(seed.employee_profile ?? []),
				{ ...profile, id: OTHER, name: 'Other', user_id: null, email: 'other@example.test' }
			],
			employee_contract: [
				...(seed.employee_contract ?? []),
				{ ...contract, id: uuid(801), employee_id: OTHER, employee_number: 'W2' }
			],
			employee_balance: [
				...(seed.employee_balance ?? []),
				{ ...balance, id: uuid(802), employee_id: OTHER }
			]
		};
	};
	it.live('moves that person and nobody else, and repeats safely', () => {
		const seed = two();
		const person = idOf('employee_profile', uuid(4));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const start = t
				.as(t.admin)
				.start('ledger', { employees: [person] })
				.pipe(Effect.andThen(t.runDue()));
			yield* start;
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', uuid(4)), 18);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', OTHER), 0);
			const once = (yield* ledgerRows(t)).length;
			yield* start;
			assert.equal((yield* ledgerRows(t)).length, once);
			yield* compute(t);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', OTHER), 18);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('a contract change', () => {
	it.live('computes that person only', () => {
		const base = seedOf('2023-01-01');
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2023-01-01', to: '2026-12-31' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.equal((yield* ledgerRows(t)).length, 0);
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [{ target: CONTRACT, set: { reason: 'Terms reviewed' } }]);
			yield* t.runDue();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), 18);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('the events that call it', () => {
	it.live('a newcomer has their leave once their contract seals', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			yield* admin.act('employee_profile.create', [{ name: 'New', email: 'new@example.test' }]);
			const person = (yield* t.storedQuery({
				employee_profile: { where: { name: { eq: 'New' } }, limit: 1 }
			})).employee_profile.rows[0];
			const [held] = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows;
			assert.ok(person !== undefined && held !== undefined);
			yield* admin.act('employee_contract.create', [
				{
					employee_id: person.id,
					entity_id: held.entity_id,
					engagement: held.engagement,
					employee_number: 'W2',
					terms: held.terms,
					payroll: held.payroll,
					bank: held.bank,
					input_schema_version_id: held.input_schema_version_id,
					employee_extension_data: held.employee_extension_data,
					service_started_on: PlainDate('2026-11-02'),
					effective_range: { from: PlainDate('2026-11-02'), to: null },
					signed_contract_period: held.signed_contract_period,
					status: 'DRAFT',
					reason: 'Joined'
				}
			]);
			const contract = (yield* t.storedQuery({
				employee_contract: { where: { employee_id: { eq: person.id } }, limit: 1 }
			})).employee_contract.rows[0];
			assert.ok(contract !== undefined);
			yield* admin.act('employee_contract.update', [
				{ target: contract.id, set: { status: 'SEALED' } }
			]);
			yield* t.runDue();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE', person.id), 14);
			assert.equal(yield* entitled(t, 'UNPAID_LEAVE', person.id), 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a paid run picks up a band reached since', () => {
		const seed = seedOf('2024-10-15');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			t.clock.set('2026-10-01T02:00:00.000Z');
			yield* compute(t);
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), 14);
			t.clock.set(NOW);
			yield* admin.act('payroll_run.create', [
				{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }
			]);
			yield* t.runDue();
			const run = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(run !== undefined);
			yield* admin.act('payroll_run.update', [{ target: run.id, set: { state: 'PAID' } }]);
			yield* t.runDue();
			assert.equal(yield* entitled(t, 'MEDICAL_LEAVE'), 18);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-10-01T02:00:00.000Z' })));
	});

	it.live('1 January opens a new key, and the old window stays', () => {
		const seed = seedOf('2023-01-01', {}, '2027-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, seed, 'MEDICAL_LEAVE', '2026-11-03');
			yield* t.runDue();
			t.clock.set('2027-01-01T02:00:00.000Z');
			yield* compute(t);
			const held = (yield* accountsIn(t)).leave?.['MEDICAL_LEAVE'];
			assert.deepEqual(held, {
				'MY.Y.2026-01-01': { entitled: 18, used: 1 },
				'MY.Y.2027-01-01': { entitled: 18 }
			});
			const movement = (yield* ledgerRows(t)).find(
				(row) => row.code === 'MEDICAL_LEAVE' && row.period === 'MY.Y.2027-01-01'
			);
			assert.equal(movement?.operation, 'ADD');
			assert.equal(movement?.measure, 'entitled');
			assert.equal(movement?.amount?.toNumber(), 18);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('posting', () => {
	const seed = seedOf('2023-01-01');
	it.live('a real HR controller’s leave posts', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* take(t, seed, 'MEDICAL_LEAVE', '2026-11-03', t.member(['hr_controller']));
			assert.deepEqual(yield* t.runDue(), { failed: [] });
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'MEDICAL_LEAVE', 'used'), 1);
			const [row] = (yield* ledgerRows(t)).filter((item) => item.measure === 'used');
			assert.equal(row?.operation, 'ADD');
			assert.match(String(row?.source), /^leave_catalog_entry:/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('leaves a reversal to the HR controller', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const reversal = {
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'MEDICAL_LEAVE')),
				days: wholeDays('2026-11-03'),
				is_reversal: true
			};
			const refused = yield* Effect.flip(
				t.as(t.member(['hr_manager'])).act('leave_catalog_entry.create', [reversal])
			);
			assert.match(String(refused), /Only the HR controller makes a reversal/);
			yield* t.as(t.member(['hr_controller'])).act('leave_catalog_entry.create', [reversal]);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('never runs as the writer, who holds no write to the ledger or the balance', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const member = t.member(['hr_controller']);
			const hr = t.as(member);
			yield* compute(t);
			yield* take(t, seed, 'MEDICAL_LEAVE', '2026-11-03', member);
			yield* t.runDue();
			const [entry] = (yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			const [posted] = (yield* ledgerRows(t)).filter((row) => row.measure === 'used');
			const [balance] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.ok(entry !== undefined && posted !== undefined && balance !== undefined);
			assert.equal(entry.created_by, member.id);
			assert.notEqual(posted.created_by, member.id);
			assert.notEqual(balance.updated_by, member.id);
			assert.equal(
				yield* Effect.isFailure(
					hr.act('employee_balance.update', [{ target: balance.id, set: { account: {} } }])
				),
				true
			);
			assert.equal(
				yield* Effect.isFailure(
					hr.act('ledger_entry.create', [
						{
							balance_id: balance.id,
							operation: 'ADD',
							account: 'leave',
							code: 'MEDICAL_LEAVE',
							effective_on: PlainDate('2026-11-03')
						}
					])
				),
				true
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});
