// The law's effects on a leave entry are raised under the system identity, once, and only once the entry stands:
// whoever keyed it, and not while it waits for approval.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, add_days } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	leaveCreate,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from './kit.ts';

const base = pack(
	'TH',
	'Asia/Bangkok',
	{
		rate: { amount: 30_000, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'ORDINARY',
		work_classification: 'EA_COVERED',
		residency_status: 'RESIDENT',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2026-03-15'
);
const contract = base.employee_contract?.[0];
const injury = base.leave_catalog?.find((row) => row.code === 'WORK_INJURY_LEAVE');
assert.ok(contract !== undefined && injury !== undefined);
const staff = (id: number, name: string, team: string) => ({
	id: uuid(id),
	name,
	email: `${name.toLowerCase()}@example.test`,
	kind: 'staff',
	team
});
const seed = {
	...base,
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
				catalog_id: idOf('leave_catalog', String(injury.id)),
				days: wholeDays(date)
			})
		]
	});
/** The duties the law raised on work-injury leave. */
const duties = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 1000 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => row.occurrence_key.includes('WORK_INJURY'))
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
			const raised = yield* duties(t);
			assert.ok(raised.length > 0);
			yield* (yield* t.as(t.admin)).run(
				'registered_effects',
				{
					collection: 'leave_catalog_entry',
					operation: 'create',
					ids: (yield* storedQuery(t, {
						leave_catalog_entry: { limit: 10 }
					})).leave_catalog_entry.rows.map((row) => String(row.id))
				},
				JobResult
			);
			yield* settle(t);
			assert.equal((yield* duties(t)).length, raised.length);
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
			assert.deepEqual(yield* duties(t), []);
			yield* (yield* t.as(yield* t.sign_in('lead@example.test'))).approvals.decide(
				asked.request_id,
				{ decision: 'approve' }
			);
			yield* settle(t);
			assert.deepEqual(yield* duties(t), []);
			yield* (yield* t.as(yield* t.sign_in('payroll@example.test'))).approvals.decide(
				asked.request_id,
				{ decision: 'approve' }
			);
			yield* settle(t);
			assert.ok((yield* duties(t)).length > 0);
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
				{ decision: 'reject', reason: 'Not a work injury' }
			);
			yield* settle(t);
			assert.deepEqual(yield* duties(t), []);
		}).pipe(Effect.provide(live))
	);
});

// A contract's effects raise a person's registration tasks once, keyed by the person. A later version of the same
// person fires them again: the task already on file is found by its key and nothing more is raised. The Philippine
// pack is the fixture because its effects test the task's key in their condition.
describe("the law's effects on a contract version", () => {
	const philippines = pack(
		'PH',
		'Asia/Manila',
		{
			rate: { amount: 60_000, unit: 'MONTHLY' },
			statutory_work_category: 'NON_FIELD',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[],
		[],
		'2026-03-15'
	);
	const tasks = (t: Kit) =>
		storedQuery(t, { obligation: { limit: 1000 } }).pipe(
			Effect.map(({ obligation }) => obligation.rows.map((row) => row.occurrence_key).toSorted())
		);
	/** The next version of the person from a day, made the way HR makes one: a draft, the last version ended, the seal. */
	const nextVersion = (t: Kit, from: string) =>
		Effect.gen(function* () {
			const admin = yield* t.as(t.admin);
			const { employee_contract } = yield* storedQuery(t, {
				employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 10 }
			});
			const held = employee_contract.rows
				.toSorted((a, b) =>
					String(a.effective_range.from).localeCompare(String(b.effective_range.from))
				)
				.at(-1);
			assert.ok(held !== undefined);
			yield* admin.act({
				'employee_contract.create': [
					{
						employee_id: held.employee_id,
						entity_id: held.entity_id,
						engagement: held.engagement,
						employee_number: held.employee_number,
						terms: held.terms,
						payroll: held.payroll,
						bank: held.bank,
						employee_extension_data: held.employee_extension_data,
						service_started_on: held.service_started_on,
						effective_range: { from: PlainDate(from), to: null },
						status: 'DRAFT',
						reason: 'A new version'
					}
				]
			});
			const drafts = yield* storedQuery(t, {
				employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
			});
			const [draft] = drafts.employee_contract.rows;
			assert.ok(draft !== undefined);
			yield* admin.act({
				'employee_contract.update': [
					{
						target: held,
						set: {
							effective_range: {
								from: held.effective_range.from,
								to: add_days(PlainDate(from), -1)
							}
						}
					}
				]
			});
			yield* admin.act({
				'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
			});
			yield* settle(t);
		});

	it.live('a second version of the same person raises nothing more and fails nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* nextVersion(t, '2026-04-01');
			const raised = yield* tasks(t);
			assert.ok(raised.some((key) => key.startsWith('SSS_EMPLOYEE_REPORT:')));
			yield* nextVersion(t, '2026-05-01');
			const after = yield* tasks(t);
			assert.equal(new Set(after).size, after.length, 'each task once');
			assert.deepEqual(
				after.filter((key) => key.startsWith('SSS_EMPLOYEE_REPORT:')),
				raised.filter((key) => key.startsWith('SSS_EMPLOYEE_REPORT:'))
			);
		}).pipe(Effect.provide(workspace({ seed: philippines, now: '2026-03-20T02:00:00.000Z' })))
	);
});
