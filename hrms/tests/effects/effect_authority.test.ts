// The law's effects are raised under the system identity, once, and only once their record stands: a leave entry's
// whoever keyed it and not while it waits for approval, an employment's once per person however many dated changes or
// writes follow. An employment's exit effects fire on an exit, never on a pay bump. The fixture law's rows are
// varied where a mechanism needs a shape it does not seed: a notice on a leave entry, a registration keyed by the person.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	lawAt,
	lawWith,
	leaveCreate,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery,
	packTerms
} from '../kit.ts';

const base = pack('MY', 'Asia/Kuala_Lumpur', packTerms(5000), {}, [], []);
const LEAVE = 'ANNUAL_LEAVE';
const EMPLOYMENT = idOf('employment', uuid(6));
/** A notice the law raises on every entry of one leave row, due on its first day. */
const notice: JsonObject = {
	name: 'LEAVE_NOTICE',
	lookup: {},
	source_collection: 'leave_catalog_entry',
	events: ['create'],
	reads: {
		leave_catalog: { where: { code: { eq: LEAVE } }, fields: ['code'], limit: 100 },
		leave_catalog_entry_day: {
			where: { leave_entry_id: { eq: { var: 'ctx.entry.id' } } },
			fields: ['incurred_on'],
			limit: 100
		}
	},
	condition: 'return ctx.reads.leave_catalog.some((row) => row.code === ctx.entry.catalog_code);',
	target_collection: 'obligation',
	target_action: 'create',
	effects: `return [{
	entity_id: ctx.entry.entity_id,
	employment_id: ctx.entry.employment_id,
	title: 'Leave notice',
	due_on: first(ctx.reads.leave_catalog_entry_day.map((slot) => slot.incurred_on).toSorted()),
	occurrence_key: 'LEAVE_NOTICE:' + ctx.entry.id
}];`
};
const staff = (id: number, name: string, team: string) => ({
	id: uuid(id),
	name,
	email: `${name.toLowerCase()}@example.test`,
	kind: 'staff',
	team
});
const seed = {
	...lawWith(base, { registered_effect: { LEAVE_NOTICE: notice } }),
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
				employment_id: EMPLOYMENT,
				catalog_code: LEAVE,
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

describe("the law's effects on an employment", () => {
	const REGISTRATION = 'EPF_EMPLOYEE_REGISTRATION';
	const registration = lawAt('MY', '2026-03-15').rows.registered_effect.find(
		(row) => row.code === REGISTRATION
	);
	assert.ok(registration !== undefined);
	const effects = String(registration.effects).replace(
		`'MY:${REGISTRATION}:' + r.id`,
		"'REGISTRATION:' + r.employee_id"
	);
	assert.notEqual(effects, registration.effects);
	/** The registration task keyed by the person, not by the stint. */
	const contracts = workspace({
		seed: lawWith(base, {
			registered_effect: {
				[REGISTRATION]: {
					reads: {
						obligation: {
							where: { occurrence_key: { eq: { var: "'REGISTRATION:' + ctx.entry.employee_id" } } },
							limit: 10
						}
					},
					effects
				}
			}
		}),
		now: '2026-03-20T02:00:00.000Z'
	});
	const keys = (t: Kit) =>
		storedQuery(t, { obligation: { limit: 1000 } }).pipe(
			Effect.map(({ obligation }) => obligation.rows.map((row) => row.occurrence_key).toSorted())
		);
	const registrations = (all: readonly string[]) =>
		all.filter((key) => key.startsWith('REGISTRATION:'));
	/** A pay bump from the first of a month: one dated row of what was agreed. */
	const bump = (t: Kit, from: string, amount: number) =>
		t.as(t.admin).pipe(
			Effect.andThen((admin) =>
				admin.act({
					'contract_terms.create': [
						{ employment_id: EMPLOYMENT, effective_from: from, rate: { amount, unit: 'MONTHLY' } }
					]
				})
			)
		);

	it.live('raises its duties once, and a second write of the same change raises nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* bump(t, '2026-03-01', 5500);
			yield* settle(t);
			const first = yield* keys(t);
			assert.equal(registrations(first).length, 1);
			assert.equal(new Set(first).size, first.length);
			const { contract_terms } = yield* storedQuery(t, {
				contract_terms: { where: { effective_from: { eq: '2026-03-01' } }, limit: 10 }
			});
			const [change] = contract_terms.rows;
			assert.ok(change !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'contract_terms.update': [{ target: change, set: { job_title: 'Details confirmed' } }]
			});
			yield* settle(t);
			assert.deepEqual(yield* keys(t), first);
		}).pipe(Effect.provide(contracts))
	);

	it.live('a later change of the same person raises nothing more and fails nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* bump(t, '2026-04-01', 5500);
			yield* settle(t);
			const raised = registrations(yield* keys(t));
			assert.equal(raised.length, 1);
			yield* bump(t, '2026-05-01', 6000);
			yield* settle(t);
			const after = yield* keys(t);
			assert.equal(new Set(after).size, after.length, 'each task once');
			assert.deepEqual(registrations(after), raised);
		}).pipe(Effect.provide(contracts))
	);

	it.live('a pay bump fires no exit effect: it ends no stint', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* bump(t, '2026-03-01', 5500);
			yield* settle(t);
			// every exit duty names its exit: none was raised for the terms the bump replaced
			assert.deepEqual(
				(yield* keys(t)).filter((key) => key.includes(':exit:')),
				[]
			);
		}).pipe(Effect.provide(contracts))
	);
});
