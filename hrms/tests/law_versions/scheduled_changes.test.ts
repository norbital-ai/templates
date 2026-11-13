// A change filed ahead of its day is knowledge: nothing reads it until its day seals it into a new version, of the
// contract or of the employer. A fact that arrives late goes straight onto a new contract version, dated when it happened.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { changesBetween, withChange } from '../../src/lib/payroll_engine/contract_change.ts';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	pack,
	sealEvents,
	uuid,
	workspace,
	storedQuery
} from '../kit.ts';

const PROFILE = idOf('employee_profile', uuid(4));
const terms = {
	rate: { amount: 3000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-06-15');
const seed: ReturnType<typeof pack> = {
	...base,
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null },
		payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
	}))
};
/** The days a birth opens: the fixture's own maternity row, keyed by the law's code and the event's date. */
const maternity = (base.leave_catalog ?? []).find(
	(row) => row.id === catalogRow(base, 'leave_catalog', 'MATERNITY_LEAVE')
);
const GRANT = isJsonObject(maternity?.lookup) ? Number(maternity.lookup.grant_days) : NaN;
const opened = (on: string) => ({ [`MY.E.${on}`]: { entitled: GRANT } });
const birth = { kind: 'CHILD_BIRTH', on: '2026-03-02' };
const PATH = 'events';
const file = (t: Kit, set: Partial<{ on: string; from: string; value: typeof birth }> = {}) =>
	Effect.flatMap(t.as(t.member(['hr_controller'])), (caller) =>
		caller.act({
			'contract_change.create': [
				{
					employee_id: PROFILE,
					field_path: PATH,
					new_value: set.value ?? birth,
					effective_from: set.from ?? '2026-02-01'
				}
			]
		})
	);
const versions = (t: Kit) =>
	storedQuery(t, { employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 10 } }).pipe(
		Effect.map(({ employee_contract }) => employee_contract.rows)
	);
const periods = (t: Kit) =>
	accountsIn(t).pipe(Effect.map((accounts) => accounts.leave?.MATERNITY_LEAVE ?? {}));
const reach = (t: Kit, instant: string) =>
	Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.run_due()));

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
		assert.deepEqual(added.events, [birth]);
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

describe('a contract change filed ahead of its day', () => {
	const NOW = '2026-01-20T02:00:00.000Z';
	it.live('stays knowledge until its day, then seals, and sync opens the window', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			yield* t.run_due();
			assert.equal((yield* versions(t)).length, 1);
			assert.deepEqual(yield* periods(t), {});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			const { obligation } = yield* storedQuery(t, { obligation: { limit: 200 } });
			assert.deepEqual(
				obligation.rows.filter((row) => /failed/.test(row.title)).map((row) => row.title),
				[]
			);
			assert.equal((yield* versions(t)).length, 2);
			assert.deepEqual(yield* periods(t), opened('2026-03-02'));
			const { contract_change } = yield* storedQuery(t, { contract_change: { limit: 1 } });
			assert.notEqual(contract_change.rows[0]?.applied_version_id, null);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a date that moves before its day is an edit, and leaves nothing behind', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			const { contract_change } = yield* storedQuery(t, { contract_change: { limit: 1 } });
			const [filed] = contract_change.rows;
			assert.ok(filed !== undefined);
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'contract_change.update': [
					{ target: filed, set: { new_value: { ...birth, on: '2026-02-25' } } }
				]
			});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.deepEqual(yield* periods(t), opened('2026-02-25'));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a cancelled change never reaches the contract', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			const { contract_change } = yield* storedQuery(t, { contract_change: { limit: 1 } });
			const [filed] = contract_change.rows;
			assert.ok(filed !== undefined);
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'contract_change.delete': [{ target: filed }]
			});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* versions(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('a change that can no longer seal stays filed and raises a task', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'contract_change.create': [
					{
						employee_id: PROFILE,
						field_path: 'terms.rate.amount',
						old_value: 1,
						new_value: 2,
						effective_from: '2026-02-01'
					}
				]
			});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* versions(t)).length, 1);
			const { obligation } = yield* storedQuery(t, { obligation: { limit: 200 } });
			assert.ok(obligation.rows.some((row) => /Contract change failed/.test(row.title)));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('with several companies, the failure still raises its one task', () => {
		const companies = {
			...seed,
			entity: [
				...(seed.entity ?? []),
				...[901, 902, 903].map((n) => ({
					id: uuid(n),
					code: `E${String(n)}`,
					name: `Company ${String(n)}`,
					settings_code: 'MY'
				}))
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.member(['hr_controller']))).act({
				'contract_change.create': [
					{
						employee_id: PROFILE,
						field_path: 'terms.rate.amount',
						old_value: 1,
						new_value: 2,
						effective_from: '2026-02-01'
					}
				]
			});
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			const { obligation } = yield* storedQuery(t, { obligation: { limit: 200 } });
			assert.equal(
				obligation.rows.filter((row) => /Contract change failed/.test(row.title)).length,
				1
			);
		}).pipe(Effect.provide(workspace({ seed: companies, now: NOW })));
	});
	it.live('refuses a change due today, and anything but a term or a fact', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const due = yield* Effect.flip(file(t, { from: '2026-01-20' }));
			assert.ok(due._tag === 'ActRefused');
			assert.equal(due.key, 'errors.contract_change_effective_from');
			const moved = yield* Effect.flip(
				Effect.flatMap(t.as(t.member(['hr_controller'])), (caller) =>
					caller.act({
						'contract_change.create': [
							{
								employee_id: PROFILE,
								field_path: 'entity_id',
								new_value: 'elsewhere',
								effective_from: '2026-02-01'
							}
						]
					})
				)
			);
			assert.ok(moved._tag === 'ActRefused');
			assert.equal(moved.key, 'errors.contract_change_field_path');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('the first of a month', () => {
	const NOW = '2026-01-20T02:00:00.000Z';
	it.live('is when a contract changes; a hire or an exit keeps its real date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = yield* t.as(t.member(['hr_controller']));
			const [open] = yield* versions(t);
			assert.ok(open !== undefined);
			const { id: _id, ...row } = open;
			const midMonth = yield* Effect.flip(
				hr.act({
					'employee_contract.create': [
						{
							employee_id: row.employee_id,
							entity_id: row.entity_id,
							engagement: row.engagement,
							employee_number: row.employee_number,
							terms: row.terms,
							payroll: row.payroll,
							bank: row.bank,
							employee_extension_data: row.employee_extension_data,
							service_started_on: row.service_started_on,
							effective_range: { from: '2026-02-16', to: null },
							signed_contract_period: row.signed_contract_period,
							status: 'DRAFT',
							reason: 'Promotion'
						}
					]
				})
			);
			assert.ok(midMonth._tag === 'ActRefused');
			assert.equal(midMonth.key, 'errors.employee_contract_mid_month');
			const filed = yield* Effect.flip(file(t, { from: '2026-02-16' }));
			assert.ok(filed._tag === 'ActRefused');
			assert.equal(filed.key, 'errors.contract_change_effective_from');
			yield* hr.act({
				'employee_contract.update': [
					{
						target: open,
						set: {
							effective_range: { from: open.effective_range.from, to: '2026-02-13' }
						}
					}
				]
			});
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('refuses service that starts after the version that records it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = yield* t.as(t.member(['hr_controller']));
			const [open] = yield* versions(t);
			assert.ok(open !== undefined);
			yield* hr.act({
				'employee_contract.update': [
					{
						target: open,
						set: {
							effective_range: { from: open.effective_range.from, to: '2026-01-31' }
						}
					}
				]
			});
			const refused = yield* Effect.flip(
				hr.act({
					'employee_contract.create': [
						{
							employee_id: open.employee_id,
							entity_id: open.entity_id,
							engagement: open.engagement,
							employee_number: open.employee_number,
							terms: open.terms,
							payroll: open.payroll,
							bank: open.bank,
							employee_extension_data: open.employee_extension_data,
							service_started_on: '2026-02-02',
							effective_range: { from: '2026-02-01', to: null },
							signed_contract_period: open.signed_contract_period,
							status: 'DRAFT',
							reason: 'A replacement'
						}
					]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.employee_contract_service_after_start');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a version under a run', () => {
	const NOW = '2026-07-20T02:00:00.000Z';
	const june = (t: Kit) =>
		Effect.flatMap(t.as(t.admin), (caller) =>
			caller.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]
			})
		);
	it.live('does not end inside an unpaid run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			const inside = yield* Effect.flip(sealEvents(t, '2026-06-15', [birth]));
			assert.match(String(inside), /Run 1 holds this person and is not paid yet/);
			assert.equal((yield* versions(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('ends after an unpaid run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			yield* sealEvents(t, '2026-07-16', [birth]);
			assert.equal((yield* versions(t)).length, 2);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	it.live('ends inside a paid run, and leaves its period to be worked out again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* june(t);
			yield* t.run_due();
			const [ran] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(ran !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			yield* sealEvents(t, '2026-06-15', [birth]);
			assert.equal((yield* versions(t)).length, 2);
			const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
			assert.deepEqual(
				pay_amendment.rows.map((row) => [row.employee_id, row.period, row.payroll_run_id]),
				[[PROFILE, '2026-06', null]]
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a fact keyed late', () => {
	it.live('a birth months ago opens its real date, and the entitlement stands', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-01', [birth], t.member(['hr_controller']));
			yield* t.run_due();
			assert.deepEqual(yield* periods(t), opened('2026-03-02'));
		}).pipe(Effect.provide(workspace({ seed, now: '2026-11-20T02:00:00.000Z' })))
	);
});

// the employer's own fixture: the law in force in January, the open employer version its only one
const employer = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-01-15');
const employerVersions = (t: Kit) =>
	storedQuery(t, {
		entity_profile_version: {
			where: { entity_id: { eq: ENTITY } },
			fields: ['id', 'name', 'representative_name', 'effective_range', 'status'],
			limit: 10
		}
	}).pipe(Effect.map(({ entity_profile_version }) => entity_profile_version.rows));

const fileEmployer = (t: Kit, field: string, value: string) =>
	t.as(t.member(['hr_controller'])).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'entity_change.create': [
					{
						entity_id: ENTITY,
						field_path: field,
						new_value: value,
						effective_from: '2026-02-01',
						notes: 'Scheduled employer update'
					}
				]
			})
		)
	);

describe('an employer change filed ahead of its day', () => {
	it.live('stays knowledge until its day, then merges into one sealed version', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* fileEmployer(t, 'name', 'Renamed Sdn. Bhd.');
			yield* fileEmployer(t, 'representative_name', 'New Representative');
			yield* t.run_due();
			assert.equal((yield* employerVersions(t)).length, 1);

			t.clock.set('2026-02-01T02:00:00.000Z');
			yield* t.run_due();
			const sealed = (yield* employerVersions(t)).filter((row) => row.status === 'SEALED');
			assert.equal(sealed.length, 2);
			const [old, next] = sealed.toSorted((left, right) =>
				String(left.effective_range.from).localeCompare(String(right.effective_range.from))
			);
			assert.ok(old !== undefined && next !== undefined);
			assert.equal(String(old.effective_range.to), '2026-01-31');
			assert.equal(String(next.effective_range.from), '2026-02-01');
			assert.equal(next.effective_range.to, null);
			assert.equal(next.name, 'Renamed Sdn. Bhd.');
			assert.equal(next.representative_name, 'New Representative');

			const { entity_change } = yield* storedQuery(t, {
				entity_change: { fields: ['applied_version_id'], limit: 10 }
			});
			assert.equal(entity_change.rows.length, 2);
			assert.ok(
				entity_change.rows.every((row) => String(row.applied_version_id) === String(next.id))
			);
		}).pipe(Effect.provide(workspace({ seed: employer, now: '2026-01-20T02:00:00.000Z' })))
	);

	it.live('refuses a field that is not an employer fact', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.member(['hr_controller'])).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'entity_change.create': [
								{
									entity_id: ENTITY,
									field_path: 'settings_code',
									new_value: 'SG',
									effective_from: '2026-02-01'
								}
							]
						})
					)
				)
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.entity_change_field_path');
		}).pipe(Effect.provide(workspace({ seed: employer, now: '2026-01-20T02:00:00.000Z' })))
	);
});
