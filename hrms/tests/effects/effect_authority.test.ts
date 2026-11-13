// The law's effects are raised under the system identity, once, and only once their record stands: a leave entry's
// whoever keyed it and not while it waits for approval, a contract's once per person however many versions or writes
// follow. A contract's exit effects fire on an exit, never on the version a pay bump closes. The fixture law's rows are
// varied where a mechanism needs a shape it does not seed: a notice on a leave entry, a registration keyed by the person.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	sealEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from '../kit.ts';

const terms = {
	rate: { amount: 5000, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-03-15');
const LEAVE = 'ANNUAL_LEAVE';
const contract = base.employee_contract?.[0];
const leave = base.leave_catalog?.find(
	(row) =>
		row.code === LEAVE &&
		row.settings_id === base.entity_profile_version?.[0]?.input_schema_version_id
);
assert.ok(contract !== undefined && leave !== undefined);
/** A notice the law raises on every entry of one leave row, due on its first day. */
const notice = (settings_id: string, index: number): JsonObject => ({
	id: uuid(60 + index),
	settings_id,
	code: 'LEAVE_NOTICE',
	name: 'LEAVE_NOTICE',
	lookup: {},
	source_collection: 'leave_catalog_entry',
	events: ['create'],
	reads: {
		leave_catalog: { where: { code: { eq: LEAVE } }, fields: ['id'], limit: 100 },
		leave_catalog_entry_day: {
			where: { leave_entry_id: { eq: { var: 'ctx.entry.id' } } },
			fields: ['incurred_on'],
			limit: 100
		}
	},
	condition: 'return ctx.reads.leave_catalog.some((row) => row.id === ctx.entry.catalog_id);',
	target_collection: 'obligation',
	target_action: 'create',
	effects: `return [{
	entity_id: ctx.entry.entity_id,
	employment_id: ctx.entry.employment_id,
	title: 'Leave notice',
	due_on: first(ctx.reads.leave_catalog_entry_day.map((slot) => slot.incurred_on).toSorted()),
	occurrence_key: 'LEAVE_NOTICE:' + ctx.entry.id
}];`
});
const staff = (id: number, name: string, team: string) => ({
	id: uuid(id),
	name,
	email: `${name.toLowerCase()}@example.test`,
	kind: 'staff',
	team
});
const seed = {
	...base,
	registered_effect: [
		...(base.registered_effect ?? []),
		...(base.jurisdiction_settings ?? []).map((row, index) => notice(String(row.id), index))
	],
	sys_user: [
		...(base.sys_user ?? []),
		staff(40, 'Lead', 'supervisor'),
		staff(41, 'Payroll', 'hr_controller')
	]
};
const live = workspace({ seed, now: '2026-03-20T02:00:00.000Z' });
type Caller = Effect.Success<ReturnType<Kit['as']>>;
const ask = (by: Caller, date: string) =>
	by.act({
		'leave_catalog_entry.create': [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: idOf('employee_contract', String(contract.id)),
				catalog_id: idOf('leave_catalog', String(leave.id)),
				days: wholeDays(date)
			})
		]
	});
/** The notices the law raised on leave entries. */
const notices = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 1000 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => row.occurrence_key.startsWith('LEAVE_NOTICE:'))
		)
	);
/** The queue drained with nothing failed: an effect that cannot read the law fails here. */
const settle = (t: Kit) => t.run_due().pipe(Effect.map((due) => assert.deepEqual(due.failed, [])));

describe("the law's effects on a leave entry", () => {
	it.live('keyed by HR, are raised once, and a second pass raises nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			assert.equal((yield* ask(yield* t.as(t.admin), '2026-03-02')).kind, 'committed');
			yield* settle(t);
			const raised = yield* notices(t);
			assert.equal(raised.length, 1);
			assert.equal(String(raised[0]?.due_on), '2026-03-02');
			// a second save of the same entry runs the law's effects again: they find the notice already raised
			const [entry] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(entry !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'leave_catalog_entry.update': [
					{ target: entry, set: { evidence_file: entry.evidence_file } }
				]
			});
			yield* settle(t);
			assert.equal((yield* notices(t)).length, 1);
		}).pipe(Effect.provide(live))
	);

	it.live('asked by the employee, wait for approval, then are raised once under the system', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const me = yield* t.as(t.member(['employee'], { id: uuid(3) }));
			const asked = yield* ask(me, '2026-03-03');
			assert.ok(asked.kind === 'pending_approval');
			// the employee cannot read the law: nothing fails, and nothing is raised while the request waits
			yield* settle(t);
			assert.deepEqual(yield* notices(t), []);
			yield* (yield* t.as(yield* t.sign_in('lead@example.test'))).approvals.decide(
				asked.request_id,
				{ decision: 'approve' }
			);
			yield* settle(t);
			assert.deepEqual(yield* notices(t), []);
			yield* (yield* t.as(yield* t.sign_in('payroll@example.test'))).approvals.decide(
				asked.request_id,
				{ decision: 'approve' }
			);
			yield* settle(t);
			assert.equal((yield* notices(t)).length, 1);
		}).pipe(Effect.provide(live))
	);

	it.live('of a request that is rejected are never raised', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const asked = yield* ask(yield* t.as(t.member(['employee'], { id: uuid(3) })), '2026-03-04');
			assert.ok(asked.kind === 'pending_approval');
			yield* (yield* t.as(yield* t.sign_in('lead@example.test'))).approvals.decide(
				asked.request_id,
				{ decision: 'reject', reason: 'Not this week' }
			);
			yield* settle(t);
			assert.deepEqual(yield* notices(t), []);
		}).pipe(Effect.provide(live))
	);
});

describe("the law's effects on a contract version", () => {
	const REGISTRATION = 'EPF_EMPLOYEE_REGISTRATION';
	/** The registration task keyed by the person, not by the contract version. */
	const byPerson = (row: JsonObject): JsonObject => {
		if (row.code !== REGISTRATION) return row;
		const effects = String(row.effects).replace(
			`'MY:${REGISTRATION}:' + r.id`,
			"'REGISTRATION:' + r.employee_id"
		);
		assert.notEqual(effects, row.effects);
		return {
			...row,
			reads: {
				obligation: {
					where: { occurrence_key: { eq: { var: "'REGISTRATION:' + ctx.entry.employee_id" } } },
					limit: 10
				}
			},
			effects
		};
	};
	const contracts = workspace({
		seed: { ...base, registered_effect: (base.registered_effect ?? []).map(byPerson) },
		now: '2026-03-20T02:00:00.000Z'
	});
	const keys = (t: Kit) =>
		storedQuery(t, { obligation: { limit: 1000 } }).pipe(
			Effect.map(({ obligation }) => obligation.rows.map((row) => row.occurrence_key).toSorted())
		);
	const registrations = (all: readonly string[]) =>
		all.filter((key) => key.startsWith('REGISTRATION:'));

	it.live('raises its duties once, and a second write of the same version raises nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-03-02', []);
			yield* settle(t);
			const first = yield* keys(t);
			assert.equal(registrations(first).length, 1);
			assert.equal(new Set(first).size, first.length);
			const { employee_contract } = yield* storedQuery(t, {
				employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 10 }
			});
			const version = employee_contract.rows.find((row) => row.effective_range.to === null);
			assert.ok(version !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'employee_contract.update': [{ target: version, set: { reason: 'Details confirmed' } }]
			});
			yield* settle(t);
			assert.deepEqual(yield* keys(t), first);
		}).pipe(Effect.provide(contracts))
	);

	it.live('a later version of the same person raises nothing more and fails nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-04-01', []);
			yield* settle(t);
			const raised = registrations(yield* keys(t));
			assert.equal(raised.length, 1);
			yield* sealEvents(t, '2026-05-01', []);
			yield* settle(t);
			const after = yield* keys(t);
			assert.equal(new Set(after).size, after.length, 'each task once');
			assert.deepEqual(registrations(after), raised);
		}).pipe(Effect.provide(contracts))
	);

	it.live('a pay bump fires no exit effect for the version it closes', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-03-02', []);
			yield* settle(t);
			// every exit duty names its exit: none was raised for the version the bump closed
			assert.deepEqual(
				(yield* keys(t)).filter((key) => key.includes(':exit:')),
				[]
			);
		}).pipe(Effect.provide(contracts))
	);
});
