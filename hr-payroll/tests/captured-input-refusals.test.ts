/**
 * Nothing a payroll run has already priced may be changed underneath it.
 *
 * Twelve handlers enforce that — update and delete on `work_days`, `component_entries`,
 * `leave_requests` and `loan_repayments`, plus update on each of the four `payslip_*_inputs`
 * junctions — and exactly one of them, `work_days` update, was ever driven by a test
 * (`lock.test.ts`). The other eleven are the guards that stop somebody rewriting money a draft has
 * already settled, and a change that removed any of them would have left the suite green.
 *
 * Each case calls the authored handler, not `refuseIfCaptured` underneath it: the question is
 * whether the hook asks, on the right path, against the right junction. A test of the shared
 * helper cannot answer that, and the helper already has one.
 *
 * Each family is also driven with no capture standing, because a guard that refuses everything is
 * as broken as one that refuses nothing — and reads identically from the refusing case alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import componentEntryHooks from '../src/collections/component_entries/+hooks.ts';
import leaveRequestHooks from '../src/collections/leave_requests/+hooks.ts';
import loanRepaymentHooks from '../src/collections/loan_repayments/+hooks.ts';
import workDayInputHooks from '../src/collections/payslip_work_day_inputs/+hooks.ts';
import componentEntryInputHooks from '../src/collections/payslip_component_entry_inputs/+hooks.ts';
import leaveRequestInputHooks from '../src/collections/payslip_leave_request_inputs/+hooks.ts';
import loanRepaymentInputHooks from '../src/collections/payslip_loan_repayment_inputs/+hooks.ts';

const PERIOD = '2026-07';

/**
 * A database double whose only surface is the junction read each guard makes.
 *
 * Narrow on purpose. A broader fake would be a second description of the authoring api, free to
 * drift from the real one — the same reason the attendance lock tests keep theirs narrow.
 */
const capturedBy = (junction: string, captured: boolean) => ({
	db: {
		[junction]: {
			findFirst: () => Effect.succeed(captured ? { period: PERIOD } : undefined)
		},
		// The component-entry guard runs after the catalogue checks, so the candidate has to survive
		// them to reach it. A claimable component with no evidence requirement is the shortest route.
		component_catalogue: {
			findFirst: () =>
				Effect.succeed({
					code: 'TRANSPORT',
					definition: { source: 'ENTRY', unit: 'MONEY', evidence: 'NONE', settlement: 'PAYROLL' },
					// The arm the candidate declares has to be the one the component takes, or the
					// pairing rule refuses before the capture guard is ever reached.
					entry_kind: 'ALLOWANCE'
				})
		}
	}
});

/** The lock sentence, which is what each guard is being asked to produce — or not to. */
const LOCKED = new RegExp(`payroll ${PERIOD} has already taken this record into account`);

const run = <A>(effect: Effect.Effect<A, unknown, never> | A): A =>
	Effect.isEffect(effect) ? Effect.runSync(effect as Effect.Effect<A, never, never>) : effect;

type Family = {
	readonly label: string;
	readonly junction: string;
	readonly update: (api: unknown) => unknown;
	readonly remove: (api: unknown) => unknown;
	readonly updateAction: RegExp;
	readonly deleteAction: RegExp;
};

const families: readonly Family[] = [
	{
		label: 'component entry',
		junction: 'payslip_component_entry_inputs',
		// The update handler asks this first, so it refuses before any component read.
		update: (api) =>
			componentEntryHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'entry-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					event: {
						kind: 'ALLOWANCE',
						recurrence: { kind: 'RECURRING', from: '2026-07-01', to: '2026-07-31' }
					}
				},
				api
			} as never),
		remove: (api) =>
			componentEntryHooks.delete.perRecord.before.handler({
				existing: { id: 'entry-1' },
				api
			} as never),
		updateAction: /Changing this component entry is locked/,
		deleteAction: /Deleting this component entry is locked/
	},
	{
		label: 'leave request',
		junction: 'payslip_leave_request_inputs',
		update: (api) =>
			leaveRequestHooks.mutate.perRecord.before.handler({
				input: {},
				existing: { id: 'request-1', approval_id: null },
				recordId: 'request-1',
				prepared: { typeCodes: new Map() },
				api
			} as never),
		remove: (api) =>
			leaveRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1', approval_id: null },
				api
			} as never),
		updateAction: /Changing a leave request is locked/,
		deleteAction: /Deleting a leave request is locked/
	},
	{
		label: 'loan repayment',
		junction: 'payslip_loan_repayment_inputs',
		update: (api) =>
			loanRepaymentHooks.mutate.perRecord.before.handler({
				input: { amount_due: 100, sequence: 1, due_date: '2026-07-31' },
				existing: { id: 'repayment-1', amount_due: 100, sequence: 1, due_date: '2026-07-31' },
				api
			} as never),
		remove: (api) =>
			loanRepaymentHooks.delete.perRecord.before.handler({
				existing: { id: 'repayment-1' },
				api
			} as never),
		updateAction: /Changing this repayment is locked/,
		deleteAction: /Deleting this repayment is locked/
	}
];

for (const family of families) {
	test(`a captured ${family.label} refuses an edit, naming the run that holds it`, () => {
		const api = capturedBy(family.junction, true);
		assert.throws(() => run(family.update(api) as never), family.updateAction);
		assert.throws(() => run(family.update(api) as never), LOCKED);
	});

	test(`a captured ${family.label} refuses a delete`, () => {
		const api = capturedBy(family.junction, true);
		assert.throws(() => run(family.remove(api) as never), family.deleteAction);
	});

	/**
	 * The negative control.
	 *
	 * A guard that refuses everything reads exactly like a guard that works, from the refusing case
	 * alone. With no capture standing, neither path may produce the lock sentence — a handler is
	 * still free to refuse for its own reasons (a leave request with no employment is one), and that
	 * is a different sentence about a different thing.
	 */
	test(`an uncaptured ${family.label} is not locked`, () => {
		const api = capturedBy(family.junction, false);
		for (const attempt of [family.update, family.remove]) {
			try {
				run(attempt(api) as never);
			} catch (error) {
				assert.doesNotMatch(
					error instanceof Error ? error.message : String(error),
					LOCKED,
					`${family.label} reported a settlement lock with nothing captured`
				);
			}
		}
	});
}

/**
 * The captures themselves.
 *
 * All four junction hooks are byte-identical and none was imported by any test. They are the
 * second lock: the engine replaces a capture by deleting and creating, never by patching, so an
 * update is always somebody moving the settlement lock a run holds over its own inputs.
 */
const junctionHooks = {
	payslip_work_day_inputs: workDayInputHooks,
	payslip_component_entry_inputs: componentEntryInputHooks,
	payslip_leave_request_inputs: leaveRequestInputHooks,
	payslip_loan_repayment_inputs: loanRepaymentInputHooks
};

for (const [name, hooks] of Object.entries(junctionHooks)) {
	test(`${name} refuses an edit of a stored capture and admits the engine's create`, () => {
		assert.throws(
			() =>
				run(
					hooks.mutate.perRecord.before.handler({
						input: { period: PERIOD },
						existing: { id: 'capture-1' },
						api: {}
					} as never) as never
				),
			/A captured input is engine output and cannot be edited/
		);
		assert.doesNotThrow(() =>
			run(
				hooks.mutate.perRecord.before.handler({
					input: { period: PERIOD },
					existing: undefined,
					api: {}
				} as never) as never
			)
		);
	});
}
