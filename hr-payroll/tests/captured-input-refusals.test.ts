/**
 * Captured sources refuse changes; uncaptured sources remain writable.
 *
 * The junction collections are gone (RFC 0001 decision 3): the lock is the source row's own
 * nullable `payslip_id`. Four families carry it — the claim, allowance and payment requests and the
 * loan repayments — and each family's update and delete hook consults the same `settledClaim`
 * decision. The engine writes the pin; every operator path refuses to disturb it, and an
 * uncaptured row is the control that proves the refusal is the pin and not the hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import claimRequestHooks from '../src/collections/claim_requests/+hooks.ts';
import allowanceRequestHooks from '../src/collections/allowance_requests/+hooks.ts';
import paymentRequestHooks from '../src/collections/payment_requests/+hooks.ts';
import loanRepaymentHooks from '../src/collections/loan_repayments/+hooks.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi, refusalMessage } from './fixtures/memory-payroll-api.ts';

const PERIOD = '2026-07';

type Family = {
	readonly label: string;
	readonly update: (
		api: unknown,
		existing: Record<string, unknown>,
		input: Record<string, unknown>
	) => unknown;
	readonly remove: (api: unknown, existing: Record<string, unknown>) => unknown;
	readonly updateAction: RegExp;
	readonly deleteAction: RegExp;
};

const repayment = {
	id: 'repayment-1',
	loan_id: 'loan-1',
	employment_id: EMPLOYMENT_ID,
	amount_due: 100,
	sequence: 1,
	due_date: '2026-07-31'
};

const families: readonly Family[] = [
	{
		label: 'claim',
		update: (api, existing, input) =>
			claimRequestHooks.mutate.perRecord.before.handler({ input, existing, api } as never),
		remove: (api, existing) =>
			claimRequestHooks.delete.perRecord.before.handler({ existing, api } as never),
		updateAction: /Changing this claim/,
		deleteAction: /Deleting this claim/
	},
	{
		label: 'allowance',
		update: (api, existing, input) =>
			allowanceRequestHooks.mutate.perRecord.before.handler({ input, existing, api } as never),
		remove: (api, existing) =>
			allowanceRequestHooks.delete.perRecord.before.handler({ existing, api } as never),
		updateAction: /Changing this allowance/,
		deleteAction: /Deleting this allowance/
	},
	{
		label: 'payment',
		update: (api, existing, input) =>
			paymentRequestHooks.mutate.perRecord.before.handler({ input, existing, api } as never),
		remove: (api, existing) =>
			paymentRequestHooks.delete.perRecord.before.handler({ existing, api } as never),
		updateAction: /Changing this payment/,
		deleteAction: /Deleting this payment/
	},
	{
		label: 'loan repayment',
		update: (api, existing, input) =>
			loanRepaymentHooks.mutate.perRecord.before.handler({
				input,
				existing,
				prepared: {
					candidates: [{ ...repayment, amount_due: 400 }],
					stored: [repayment],
					loans: [
						{
							id: 'loan-1',
							employment_id: EMPLOYMENT_ID,
							principal: 400,
							effective_range: { start: '2026-07-01', end: '2026-07-31' }
						}
					]
				},
				api
			} as never),
		remove: (api, existing) =>
			loanRepaymentHooks.delete.perRecord.before.handler({ existing, api } as never),
		updateAction: /settled by a payroll/,
		deleteAction: /settled by a payroll/
	}
];

/** Loans refuse with their own sentence, so they carry their own locked assertion. */
const lockedFor = (label: string) =>
	label === 'loan repayment' ? /settled by a payroll/ : /already taken this record into account/;

/** The row each family's guard reads: the source itself, with the pin under test. */
function existingFor(family: string, captured: boolean): Record<string, unknown> {
	const base = {
		id: 'request-1',
		employment_id: EMPLOYMENT_ID,
		amount: 310,
		as_adjustment_entry: false,
		payslip_id: captured ? 'paid-slip' : null
	};
	switch (family) {
		case 'claim':
			return { ...base, catalogue_id: 'claim-component', incurred_on: '2026-07-10' };
		case 'allowance':
			return {
				...base,
				catalogue_id: 'allowance-component',
				recurrence: { kind: 'ONE_OFF', on: '2026-07-15' }
			};
		case 'payment':
			return {
				...base,
				catalogue_id: 'payment-component',
				effective_on: '2026-07-10',
				reason: 'Agreed payment'
			};
		default:
			return { ...repayment, payslip_id: captured ? 'paid-slip' : null };
	}
}

const LOCKED = /already taken this record into account/;

const run = <A>(effect: Effect.Effect<A, unknown, never> | A): A =>
	Effect.isEffect(effect)
		? Effect.runSync(effect as Effect.Effect<A, never, never>)
		: (effect as A);

for (const family of families) {
	const changed = (existing: Record<string, unknown>) =>
		family.label === 'loan repayment'
			? { ...existing, amount_due: 400 }
			: { ...existing, amount: 400 };
	/** The delete guard reads the row from the database, so the world has to hold it. */
	const seed = (existing: Record<string, unknown>) => {
		const world = createPublicPayrollWorld();
		const collection =
			family.label === 'loan repayment'
				? 'loan_repayments'
				: (`${family.label}_requests` as
						'claim_requests' | 'allowance_requests' | 'payment_requests');
		(world[collection] as Record<string, unknown>[]).push({ ...existing });
		return { api: memoryPayrollApi(world) };
	};

	test(`a captured ${family.label} refuses an edit, naming the run that holds it`, () => {
		// The lock is the pin, so no other read has to answer: the row it owns says it was taken.
		const existing = existingFor(family.label, true);
		const { api } = seed(existing);
		assert.throws(() => run(family.update(api, existing, changed(existing))), family.updateAction);
		assert.throws(
			() => run(family.update(api, existing, changed(existing))),
			lockedFor(family.label)
		);
	});

	test(`a captured ${family.label} refuses a delete`, () => {
		const existing = existingFor(family.label, true);
		const { api } = seed(existing);
		try {
			run(family.remove(api, existing));
			assert.fail('expected the captured row to refuse deletion');
		} catch (error) {
			assert.match(refusalMessage(error), family.deleteAction);
		}
	});

	test(`an uncaptured ${family.label} remains writable`, () => {
		const existing = existingFor(family.label, false);
		const { api } = seed(existing);
		assert.doesNotThrow(() => run(family.update(api, existing, changed(existing))));
		if (family.label === 'loan repayment') {
			// A repayment is never deleted directly: an uncaptured one leaves through a valid
			// replacement schedule on its agreement (`loan-schedule-invariants` proves that path).
			assert.throws(() => run(family.remove(api, existing)), /complete repayment schedule/);
			return;
		}
		assert.doesNotThrow(() => run(family.remove(api, existing)));
	});
}

test('the period a lock names is the run’s own, and the pin carries no copy of it', () => {
	// The source row stores only the payslip that took it — the period is derived where it is
	// displayed, never stored twice.
	const world = createPublicPayrollWorld();
	const api = memoryPayrollApi(world);
	const existing = existingFor('payment', true);
	assert.equal(existing.payslip_id, 'paid-slip');
	try {
		run(families[2]!.update(api, existing, { ...existing, amount: 400 }));
		void PERIOD;
		assert.fail('expected the pin to refuse');
	} catch (error) {
		assert.doesNotMatch(refusalMessage(error), new RegExp(PERIOD));
	}
});
