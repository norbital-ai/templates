/** Captured sources refuse changes; uncaptured sources and new engine captures remain writable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import claimRequestHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceRequestHooks from '../src/collections/allowance_requests/+hooks.ts';
import paymentRequestHooks from '../src/collections/payment_requests/+hooks.ts';
import loanRepaymentHooks from '../src/collections/loan_repayments/+hooks.ts';
import allowanceRequestInputHooks from '../src/collections/payslip_allowance_request_inputs/+hooks.ts';
import leaveRequestInputHooks from '../src/collections/payslip_leave_inputs/+hooks.ts';
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
		// A single-use source answers with its own pin; a multi-capture family with its junction.
		[family.junction]: {
			findFirst: () =>
				Effect.succeed(
					family.pinned
						? { settled_period: captured ? PERIOD : null }
						: captured
							? { period: PERIOD }
							: undefined
				)
		},
		// A pay request's capture guard runs *after* the catalogue checks, so the candidate has to
		// survive them to reach it — a component with no evidence requirement and no cap is the
		// shortest route. The pairing rule `entry_kind` used to carry is a foreign key now, so the
		// double only has to answer on this family's own catalogue.
		//
		// Leave and loan repayments read no catalogue at all on this path, and a key they never ask
		// for would prove nothing, so they get none.
		...(family.family == null
			? {}
			: {
					[`${family.family.toLowerCase()}_catalogue`]: {
						findFirst: () =>
							Effect.succeed({ code: 'TRANSPORT', evidence: 'NONE', cap: null, eligibility: '' })
					}
				})
	}
});

/** The lock sentence, which is what each guard is being asked to produce — or not to. */
const LOCKED = new RegExp(`payroll ${PERIOD} has already taken this record into account`);

const run = <A>(effect: Effect.Effect<A, unknown, never> | A): A =>
	Effect.isEffect(effect) ? Effect.runSync(effect as Effect.Effect<A, never, never>) : effect;

type Family = {
	readonly label: string;
	/** The collection whose `findFirst` the guard asks: the source itself, or its capture junction. */
	readonly junction: string;
	readonly pinned?: boolean;
	/** Which of the three request families this row drives, and therefore which catalogue it reads. */
	readonly family?: string;
	readonly update: (api: unknown) => unknown;
	readonly remove: (api: unknown) => unknown;
	readonly updateAction: RegExp;
	readonly deleteAction: RegExp;
};

const repayment = {
	id: 'repayment-1',
	loan_id: 'loan-1',
	employment_id: 'employment-1',
	amount_due: 100,
	sequence: 1,
	due_date: '2026-07-31'
};

const families: readonly Family[] = [
	{
		label: 'claim',
		junction: 'claim_requests',
		pinned: true,
		family: 'CLAIM',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			claimRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					employment_id: 'employment-1',
					amount: 310,
					claim_catalogue_id: 'component-1',
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
		family: 'ALLOWANCE',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			allowanceRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					employment_id: 'employment-1',
					amount: 310,
					allowance_catalogue_id: 'component-1',
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
		label: 'payment',
		junction: 'payment_requests',
		pinned: true,
		family: 'PAYMENT',
		// The update handler asks this last, after the catalogue reads — which is why the api below
		// answers every read with nothing: a family that reached the capture check by accident,
		// before its own component rules, would pass this test and refuse a legal write in
		// production.
		update: (api) =>
			paymentRequestHooks.mutate.perRecord.before.handler({
				input: { amount: 310 },
				existing: {
					id: 'request-1',
					employment_id: 'employment-1',
					amount: 310,
					payment_catalogue_id: 'component-1',
					effective_on: '2026-07-10',
					reason: 'Agreed payment'
				},
				api
			} as never),
		remove: (api) =>
			paymentRequestHooks.delete.perRecord.before.handler({
				existing: { id: 'request-1' },
				api
			} as never),
		updateAction: /Changing this payment is locked/,
		deleteAction: /Deleting this payment is locked/
	},
	{
		label: 'loan repayment',
		junction: 'payslip_loan_repayment_inputs',
		update: (api) =>
			loanRepaymentHooks.mutate.perRecord.before.handler({
				input: { amount_due: 100, sequence: 1, due_date: '2026-07-30' },
				existing: repayment,
				prepared: {
					candidates: [{ ...repayment, due_date: '2026-07-30' }],
					stored: [repayment],
					loans: [
						{
							id: 'loan-1',
							employment_id: 'employment-1',
							principal: 100,
							effective_range: { start: '2026-07-01', end: '2026-07-31' }
						}
					]
				},
				api
			} as never),
		remove: (api) =>
			loanRepaymentHooks.delete.perRecord.before.handler({
				existing: repayment,
				parent: {
					collection: 'loans',
					id: 'loan-1',
					column: 'loan_id',
					action: 'delete',
					values: {
						id: 'loan-1',
						employment_id: 'employment-1',
						principal: 100,
						effective_range: { start: '2026-07-01', end: '2026-07-31' }
					}
				},
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

	test(`an uncaptured ${family.label} remains writable`, () => {
		const api = capturedBy(family, false);
		for (const attempt of [family.update, family.remove])
			assert.doesNotThrow(() => run(attempt(api) as never));
	});
}

/**
 * The captures themselves.
 *
 * The engine replaces a capture by deleting and creating, never by patching, so an
 * update is always somebody moving the settlement lock a run holds over its own inputs.
 */
const junctionHooks = {
	payslip_allowance_request_inputs: allowanceRequestInputHooks,
	payslip_leave_inputs: leaveRequestInputHooks,
	payslip_loan_repayment_inputs: loanRepaymentInputHooks
};

for (const [name, hooks] of Object.entries(junctionHooks)) {
	test(`${name} refuses an edit of a stored capture`, () => {
		assert.throws(
			() =>
				run(
					hooks.mutate.perRecord.before.handler({
						input: { period: PERIOD },
						existing: { id: 'capture-1' },
						api: {}
					} as never) as never
				),
			/A captured input.*cannot be edited/
		);
	});
}
