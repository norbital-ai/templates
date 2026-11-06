// The service reaches everyone: on a schedule, by hand, and from the events that change what someone is owed.
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
type Account = NonNullable<Seed['employee_balance']>[number]['account'];
const seedOf = (from: string, account: Account = {}, on = '2026-11-06'): Seed => {
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
const leaveOf = (t: Kit, employee?: string) =>
	t.storedQuery({ employee_balance: { limit: 10 } }).pipe(
		Effect.map(({ employee_balance }) => {
			const row = employee_balance.rows.find(
				(item) => employee === undefined || item.employee_id === employee
			);
			const account = Schema.decodeUnknownSync(JsonObject)(row?.account);
			return Schema.decodeUnknownSync(JsonObject)(account.leave ?? {});
		})
	);
const ledgerRows = (t: Kit) =>
	t
		.storedQuery({ ledger_entry: { where: { account: { eq: 'leave' } }, limit: 500 } })
		.pipe(Effect.map(({ ledger_entry }) => ledger_entry.rows));
const compute = (t: Kit) =>
	t.as(t.admin).start('leave_entitlement', {}).pipe(Effect.andThen(t.runDue()));

describe('run by hand', () => {
	it.live('computes everyone from the catalog', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const leave = yield* leaveOf(t);
			assert.equal(leave['MEDICAL_LEAVE'], 18);
			assert.equal(leave['HOSPITALIZATION_LEAVE'], 60);
			assert.equal(leave['ANNUAL_LEAVE'], 12);
			assert.equal(leave['UNPAID_LEAVE'], 36500);
			assert.equal(leave['MATERNITY_LEAVE'], 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a second run writes nothing', () => {
		const seed = seedOf('2023-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const first = yield* ledgerRows(t);
			const held = yield* leaveOf(t);
			const [before] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			yield* compute(t);
			yield* compute(t);
			assert.equal((yield* ledgerRows(t)).length, first.length);
			assert.deepEqual(yield* leaveOf(t), held);
			const [after] = (yield* t.storedQuery({ employee_balance: { limit: 1 } })).employee_balance
				.rows;
			assert.equal(after?.revision, before?.revision);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('days taken stay taken', () => {
		const seed = seedOf('2023-01-01');
		const version = seed.employee_contract?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === 'MEDICAL_LEAVE' && item.settings_id === version
		);
		assert.ok(row !== undefined);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			yield* t.as(t.admin).act('leave_catalog_entry.create', [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', String(row.id)),
					days: [
						{ date: PlainDate('2026-11-03'), part: 'AM' },
						{ date: PlainDate('2026-11-03'), part: 'PM' }
					]
				}
			]);
			yield* t.runDue();
			yield* compute(t);
			assert.equal((yield* leaveOf(t))['MEDICAL_LEAVE'], 17);
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

	it.live('an account from before keeps what it holds', () => {
		const seed = seedOf('2023-01-01', { leave: { ANNUAL_LEAVE: 7 } });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			const leave = yield* leaveOf(t);
			assert.equal(leave['ANNUAL_LEAVE'], 7);
			assert.equal(leave['MEDICAL_LEAVE'], 18);
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
				.start('leave_entitlement', { employees: [person] })
				.pipe(Effect.andThen(t.runDue()));
			yield* start;
			assert.equal((yield* leaveOf(t, uuid(4)))['MEDICAL_LEAVE'], 18);
			assert.equal((yield* leaveOf(t, OTHER))['MEDICAL_LEAVE'], undefined);
			const once = (yield* ledgerRows(t)).length;
			yield* start;
			assert.equal((yield* ledgerRows(t)).length, once);
			yield* compute(t);
			assert.equal((yield* leaveOf(t, OTHER))['MEDICAL_LEAVE'], 18);
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
			assert.equal((yield* leaveOf(t))['MEDICAL_LEAVE'], 18);
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
			const leave = yield* leaveOf(t, person.id);
			assert.equal(leave['MEDICAL_LEAVE'], 14);
			assert.equal(leave['UNPAID_LEAVE'], 36500);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a paid run picks up a band reached since', () => {
		const seed = seedOf('2024-10-15', {
			leave: { MEDICAL_LEAVE: 14 },
			leave_window: { MEDICAL_LEAVE: 2026, 'MEDICAL_LEAVE.granted': 14 }
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			yield* admin.act('payroll_run.create', [
				{ entity_id: ENTITY, period: '2026-10', kind: 'ON_CYCLE' }
			]);
			yield* t.runDue();
			const run = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(run !== undefined);
			yield* admin.act('payroll_run.update', [{ target: run.id, set: { state: 'PAID' } }]);
			yield* t.runDue();
			assert.equal((yield* leaveOf(t))['MEDICAL_LEAVE'], 18);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('1 January restores days used and carries annual leave', () => {
		const seed = seedOf(
			'2023-01-01',
			{
				leave: { MEDICAL_LEAVE: 3 },
				leave_window: { MEDICAL_LEAVE: 2026, 'MEDICAL_LEAVE.granted': 18 }
			},
			'2027-01-01'
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* compute(t);
			assert.equal((yield* leaveOf(t))['MEDICAL_LEAVE'], 18);
			const movement = (yield* ledgerRows(t)).find((row) => row.code === 'MEDICAL_LEAVE');
			assert.equal(movement?.operation, 'ADD');
			assert.equal(Number(String(movement?.amount)), 15);
		}).pipe(Effect.provide(workspace({ seed, now: '2027-01-01T02:00:00.000Z' })));
	});
});
