// The law's effects on a leave entry are raised under the system identity, once, and only once the entry stands:
// whoever keyed it, and not while it waits for approval.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, leaveCreate, pack, syncAll, uuid, wholeDays, workspace } from './kit.ts';

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
type Caller = ReturnType<Kit['as']>;
const ask = (by: Caller, date: string) =>
	by.act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: idOf('employee_contract', String(contract.id)),
			catalog_id: idOf('leave_catalog', String(injury.id)),
			days: wholeDays(date)
		})
	]);
/** The duties the law raised on work-injury leave. */
const duties = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 1000 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) => row.occurrence_key.includes('WORK_INJURY'))
			)
		);
/** The queue drained with nothing failed: an effect that cannot read the law fails here. */
const settle = (t: Kit) => t.runDue().pipe(Effect.map((due) => assert.deepEqual(due.failed, [])));

describe("the law's effects on a leave entry", () => {
	it.live('keyed by HR, are raised once, and a second pass raises nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			assert.equal((yield* ask(t.as(t.admin), '2026-03-02')).kind, 'committed');
			yield* settle(t);
			const raised = yield* duties(t);
			assert.ok(raised.length > 0);
			yield* t.as(t.admin).start('registered_effects', {
				collection: 'leave_catalog_entry',
				operation: 'create',
				ids: (yield* t.storedQuery({
					leave_catalog_entry: { limit: 10 }
				})).leave_catalog_entry.rows.map((row) => String(row.id))
			});
			yield* settle(t);
			assert.equal((yield* duties(t)).length, raised.length);
		}).pipe(Effect.provide(live))
	);

	it.live('asked by the employee, wait for approval, then are raised once under the system', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const me = t.as(t.member(['employee'], { id: uuid(3) }));
			const asked = yield* ask(me, '2026-03-03');
			assert.ok(asked.kind === 'pendingApproval');
			// the employee cannot read the law: nothing fails, and nothing is raised while the request waits
			yield* settle(t);
			assert.deepEqual(yield* duties(t), []);
			yield* t
				.as(yield* t.signIn('lead@example.test'))
				.approvals.decide(asked.requestId, { decision: 'approve' });
			yield* settle(t);
			assert.deepEqual(yield* duties(t), []);
			yield* t
				.as(yield* t.signIn('payroll@example.test'))
				.approvals.decide(asked.requestId, { decision: 'approve' });
			yield* settle(t);
			assert.ok((yield* duties(t)).length > 0);
		}).pipe(Effect.provide(live))
	);

	it.live('of a request that is rejected are never raised', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const asked = yield* ask(t.as(t.member(['employee'], { id: uuid(3) })), '2026-03-04');
			assert.ok(asked.kind === 'pendingApproval');
			yield* t
				.as(yield* t.signIn('lead@example.test'))
				.approvals.decide(asked.requestId, { decision: 'reject', reason: 'Not a work injury' });
			yield* settle(t);
			assert.deepEqual(yield* duties(t), []);
		}).pipe(Effect.provide(live))
	);
});
