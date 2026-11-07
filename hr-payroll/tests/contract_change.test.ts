// A change filed ahead of its day is knowledge: nothing reads it until its day seals it into a new contract version. A
// fact that arrives late goes straight onto a new version, dated when it happened.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { changesBetween, withChange } from '../src/lib/payroll_engine/contract_change.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, pack, sealEvents, uuid, workspace } from './kit.ts';

const PROFILE = idOf('employee_profile', uuid(4));
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
const base = pack(
	'ID',
	'Asia/Jakarta',
	terms,
	{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
	[],
	[],
	'2026-06-15'
);
const seed = {
	...base,
	entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
		...row,
		entity_extension_data: { risk_class: 'I' }
	})),
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null },
		payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
	}))
};
const birth = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const PATH = 'employee_extension_data.events';
const file = (t: Kit, set: Partial<{ on: string; from: string; value: typeof birth }> = {}) =>
	t.as(t.member(['hr_controller'])).act('contract_change.create', [
		{
			employee_id: PROFILE,
			field_path: PATH,
			new_value: set.value ?? birth,
			effective_from: PlainDate(set.from ?? '2026-02-01')
		}
	]);
const versions = (t: Kit) =>
	t
		.storedQuery({ employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 10 } })
		.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
const periods = (t: Kit) =>
	accountsIn(t).pipe(Effect.map((accounts) => accounts.leave?.MATERNITY_LEAVE ?? {}));
const reach = (t: Kit, instant: string) =>
	Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.runDue()));

describe('the pure rules', () => {
	const contract = { terms: { rate: { amount: 100 } }, employee_extension_data: {} };
	it('sets a leaf and starts a list', () => {
		const raised = withChange(contract, {
			field_path: 'terms.rate.amount',
			old_value: 100,
			new_value: 120
		});
		assert.deepEqual(raised.terms, { rate: { amount: 120 } });
		const added = withChange(contract, { field_path: PATH, old_value: null, new_value: birth });
		assert.deepEqual(added.employee_extension_data, { events: [birth] });
	});
	it('refuses where the contract moved since the change was filed', () => {
		assert.throws(() =>
			withChange(contract, { field_path: 'terms.rate.amount', old_value: 90, new_value: 120 })
		);
		assert.throws(() =>
			withChange(
				{ employee_extension_data: { events: [] } },
				{ field_path: PATH, old_value: birth, new_value: null }
			)
		);
	});
	it('a moved date is one item out and one in, and replays to the same list', () => {
		const held = { events: [birth] };
		const after = { events: [{ ...birth, on: '2026-02-27' }] };
		const changes = changesBetween(held, after, 'employee_extension_data');
		assert.equal(changes.length, 2);
		assert.deepEqual(
			changes.reduce(withChange, { employee_extension_data: held }).employee_extension_data,
			after
		);
	});
	it('finds nothing where nothing changed', () => {
		assert.deepEqual(changesBetween({ a: 1 }, { a: 1 }, 'terms'), []);
	});
});

describe('a child known ahead of time', () => {
	const NOW = '2026-01-20T02:00:00.000Z';
	it.live('stays knowledge until its day, then seals, and sync opens the window', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			yield* t.runDue();
			assert.equal((yield* versions(t)).length, 1);
			assert.deepEqual(yield* periods(t), {});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 200 } });
			assert.deepEqual(
				obligation.rows.filter((row) => /failed/.test(row.title)).map((row) => row.title),
				[]
			);
			assert.equal((yield* versions(t)).length, 2);
			assert.deepEqual(yield* periods(t), { 'ID.E.2026-03-02': { entitled: 90 } });
			const { contract_change } = yield* t.storedQuery({ contract_change: { limit: 1 } });
			assert.notEqual(contract_change.rows[0]?.applied_version_id, null);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a date that moves before its day is an edit, and leaves nothing behind', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			const { contract_change } = yield* t.storedQuery({ contract_change: { limit: 1 } });
			const [filed] = contract_change.rows;
			assert.ok(filed !== undefined);
			yield* t
				.as(t.member(['hr_controller']))
				.act('contract_change.update', [
					{ target: filed.id, set: { new_value: { ...birth, on: '2026-02-25' } } }
				]);
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.deepEqual(yield* periods(t), { 'ID.E.2026-02-25': { entitled: 90 } });
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a cancelled change never reaches the contract', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			const { contract_change } = yield* t.storedQuery({ contract_change: { limit: 1 } });
			const [filed] = contract_change.rows;
			assert.ok(filed !== undefined);
			yield* t
				.as(t.member(['hr_controller']))
				.act('contract_change.delete', [{ target: filed.id }]);
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* versions(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a change that can no longer seal stays filed and raises a task', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t.as(t.member(['hr_controller'])).act('contract_change.create', [
				{
					employee_id: PROFILE,
					field_path: 'terms.rate.amount',
					old_value: 1,
					new_value: 2,
					effective_from: PlainDate('2026-02-01')
				}
			]);
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* versions(t)).length, 1);
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 200 } });
			assert.ok(obligation.rows.some((row) => /Contract change failed/.test(row.title)));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('refuses a change due today, and anything but a term or a fact', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const due = yield* Effect.flip(file(t, { from: '2026-01-20' }));
			assert.match(String(due), /new contract version/);
			const moved = yield* Effect.flip(
				t.as(t.member(['hr_controller'])).act('contract_change.create', [
					{
						employee_id: PROFILE,
						field_path: 'entity_id',
						new_value: 'elsewhere',
						effective_from: PlainDate('2026-02-01')
					}
				])
			);
			assert.match(String(moved), /transfer/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the first of a month', () => {
	const NOW = '2026-01-20T02:00:00.000Z';
	it.live('is when a contract changes; a hire or an exit keeps its real date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_controller']));
			const [open] = yield* versions(t);
			assert.ok(open !== undefined);
			const { id: _id, ...row } = open;
			const midMonth = yield* Effect.flip(
				hr.act('employee_contract.create', [
					{
						employee_id: row.employee_id,
						entity_id: row.entity_id,
						engagement: row.engagement,
						employee_number: row.employee_number,
						terms: row.terms,
						payroll: row.payroll,
						bank: row.bank,
						input_schema_version_id: row.input_schema_version_id,
						employee_extension_data: row.employee_extension_data,
						service_started_on: row.service_started_on,
						effective_range: { from: PlainDate('2026-02-16'), to: null },
						signed_contract_period: row.signed_contract_period,
						status: 'DRAFT',
						reason: 'Promotion'
					}
				])
			);
			assert.match(String(midMonth), /first of a month/);
			const filed = yield* Effect.flip(file(t, { from: '2026-02-16' }));
			assert.match(String(filed), /first of a month/);
			yield* hr.act('employee_contract.update', [
				{
					target: open.id,
					set: {
						effective_range: { from: open.effective_range.from, to: PlainDate('2026-02-13') }
					}
				}
			]);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a version a run captured', () => {
	const NOW = '2026-07-20T02:00:00.000Z';
	it.live('ends after the run, and never inside it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]);
			const inside = yield* Effect.flip(sealEvents(t, '2026-06-15', [birth]));
			assert.match(String(inside), /already captured/);
			yield* sealEvents(t, '2026-07-16', [birth]);
			assert.equal((yield* versions(t)).length, 2);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a child registered late', () => {
	it.live('a birth months ago opens its real date, and the entitlement stands', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-01', [birth], t.member(['hr_controller']));
			yield* t.runDue();
			assert.deepEqual(yield* periods(t), { 'ID.E.2026-03-02': { entitled: 90 } });
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});
