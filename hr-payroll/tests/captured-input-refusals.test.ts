/**
 * Nothing a payroll run has already priced may be changed underneath it.
 *
 * Twenty-four handlers enforce that — update and delete on `work_days`, `leave_requests`,
 * `loan_repayments` and each of the five pay-request families, plus update on each of the eight
 * `payslip_*_inputs` junctions — and exactly one of them, `work_days` update, was ever driven by a
 * test (`lock.test.ts`). The rest are the guards that stop somebody rewriting money a draft has
 * already settled, and a change that removed any of them would have left the suite green.
 *
 * The five families are driven separately rather than through one shared case. They share
 * `assertPayRequestAdmissible`, but each states its own junction and its own dating column, and
 * those two lines are exactly what a copy-paste between families gets wrong.
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
import claimRequestHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceRequestHooks from '../src/collections/allowance_requests/+hooks.ts';
import bonusRequestHooks from '../src/collections/bonus_requests/+hooks.ts';
import arrearsRequestHooks from '../src/collections/arrears_requests/+hooks.ts';
import correctionRequestHooks from '../src/collections/correction_requests/+hooks.ts';
import leaveRequestHooks from '../src/collections/leave_requests/+hooks.ts';
import loanRepaymentHooks from '../src/collections/loan_repayments/+hooks.ts';
import workDayInputHooks from '../src/collections/payslip_work_day_inputs/+hooks.ts';
import claimRequestInputHooks from '../src/collections/payslip_claim_request_inputs/+hooks.ts';
import allowanceRequestInputHooks from '../src/collections/payslip_allowance_request_inputs/+hooks.ts';
import bonusRequestInputHooks from '../src/collections/payslip_bonus_request_inputs/+hooks.ts';
import arrearsRequestInputHooks from '../src/collections/payslip_arrears_request_inputs/+hooks.ts';
import correctionRequestInputHooks from '../src/collections/payslip_correction_request_inputs/+hooks.ts';
import leaveRequestInputHooks from '../src/collections/payslip_leave_request_inputs/+hooks.ts';
import loanRepaymentInputHooks from '../src/collections/payslip_loan_repayment_inputs/+hooks.ts';

const PERIOD = '2026-07';

/**
 * A database double whose only surface is the junction read each guard makes.
 *
 * Narrow on purpose. A broader fake would be a second description of the authoring api, free to
 * drift from the real one — the same reason the attendance lock tests keep theirs narrow.
 */
const capturedBy = (family: Family, captured: boolean) => ({
	db: {
		[family.junction]: {
			findFirst: () => Effect.succeed(captured ? { period: PERIOD } : undefined)
		},
		// A pay request's capture guard runs *after* the catalogue checks, so the candidate has to
		// survive them to reach it. A component with no evidence requirement and no cap is the
		// shortest route — and `entry_kind` has to be this family's, or the pairing rule refuses
		// first and the test would pass while proving nothing about the lock.
		component_catalogue: {
			findFirst: () =>
				Effect.succeed({
					code: 'TRANSPORT',
					definition: { source: 'ENTRY', unit: 'MONEY', evidence: 'NONE', settlement: 'PAYROLL' },
					entry_kind: family.entryKind ?? null
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
	/** The `component_catalogue.entry_kind` a request of this family must be raised against. */
	readonly entryKind?: string;
	readonly update: (api: unknown) => unknown;
	readonly remove: (api: unknown) => unknown;
	readonly updateAction: RegExp;
	readonly deleteAction: RegExp;
};

const families: readonly Family[] = [
	{
		label: 'claim',
		junction: 'payslip_claim_request_inputs',
		entryKind: 'CLAIM',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			claimRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					incurred_on: '2026-07-10'
				},
				api
			} as never),
		remove: (api) =>
			claimRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this claim is locked/,
		deleteAction: /Deleting this claim is locked/
	},
	{
		label: 'allowance',
		junction: 'payslip_allowance_request_inputs',
		entryKind: 'ALLOWANCE',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			allowanceRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					recurrence: { kind: 'RECURRING', from: '2026-07-01', to: '2026-07-31' }
				},
				api
			} as never),
		remove: (api) =>
			allowanceRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this allowance is locked/,
		deleteAction: /Deleting this allowance is locked/
	},
	{
		label: 'bonus',
		junction: 'payslip_bonus_request_inputs',
		entryKind: 'BONUS',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			bonusRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					awarded_on: '2026-07-10'
				},
				api
			} as never),
		remove: (api) =>
			bonusRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this bonus is locked/,
		deleteAction: /Deleting this bonus is locked/
	},
	{
		label: 'arrears',
		junction: 'payslip_arrears_request_inputs',
		entryKind: 'ARREARS',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			arrearsRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					settled_on: '2026-07-10'
				},
				api
			} as never),
		remove: (api) =>
			arrearsRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this arrears is locked/,
		deleteAction: /Deleting this arrears is locked/
	},
	{
		label: 'correction',
		junction: 'payslip_correction_request_inputs',
		entryKind: 'CORRECTION',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			correctionRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					amount: 310,
					component_catalogue_id: 'component-1',
					corrected_on: '2026-07-10'
				},
				api
			} as never),
		remove: (api) =>
			correctionRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this correction is locked/,
		deleteAction: /Deleting this correction is locked/
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
		const api = capturedBy(family, true);
		assert.throws(() => run(family.update(api) as never), family.updateAction);
		assert.throws(() => run(family.update(api) as never), LOCKED);
	});

	test(`a captured ${family.label} refuses a delete`, () => {
		const api = capturedBy(family, true);
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
		const api = capturedBy(family, false);
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
 * All eight junction hooks are byte-identical and none was imported by any test. They are the
 * second lock: the engine replaces a capture by deleting and creating, never by patching, so an
 * update is always somebody moving the settlement lock a run holds over its own inputs.
 */
const junctionHooks = {
	payslip_work_day_inputs: workDayInputHooks,
	payslip_claim_request_inputs: claimRequestInputHooks,
	payslip_allowance_request_inputs: allowanceRequestInputHooks,
	payslip_bonus_request_inputs: bonusRequestInputHooks,
	payslip_arrears_request_inputs: arrearsRequestInputHooks,
	payslip_correction_request_inputs: correctionRequestInputHooks,
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
