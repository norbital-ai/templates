/**
 * Captured sources refuse changes; uncaptured sources remain writable.
 *
 * The junction collections are gone: the lock is the source row's own nullable `payslip_id`.
 * Claims and loan repayments carry it, and each family's transform refuses to disturb it, while
 * the direct delete is the grant's `authorize` reading the same pin. A standing allowance is
 * never pinned — its entries are — so what freezes it is an entry a payslip priced from it. An
 * uncaptured row is the control that proves the refusal is the pin and not the rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import claimRequests from '../src/collections/claim_requests/+collection.ts';
import allowances from '../src/collections/allowances/+collection.ts';
import { Effect } from 'effect';
import loans from '../src/collections/loans/+collection.ts';
import { requestGrants } from '../src/lib/policy_grants.ts';
import { EMPLOYMENT_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { transformOne } from './helpers/transform.ts';

const PERIOD = '2026-07';

const repayment = {
	id: 'repayment-1',
	loan_id: 'loan-1',
	employment_id: EMPLOYMENT_ID,
	amount_due: 100,
	sequence: 1,
	due_date: '2026-07-31'
};
const loan = {
	id: 'loan-1',
	employment_id: EMPLOYMENT_ID,
	loan_catalogue_id: 'loan-line',
	principal: 400,
	effective_range: { start: '2026-07-01', end: '2026-07-31' }
};

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
		default:
			return { ...repayment, payslip_id: captured ? 'paid-slip' : null };
	}
}

/** The delete grant's decision on one stored row, as the runtime asks it. */
const deleteAuthorized = (collection: string, record: Record<string, unknown>) => {
	const grant = (
		requestGrants() as Record<string, { delete?: { authorize?: (context: unknown) => unknown } }>
	)[collection];
	return grant?.delete?.authorize?.({ record }) === true;
};

for (const family of ['claim'] as const) {
	const collection = claimRequests;
	const table = `${family}_requests` as const;
	const seed = (existing: Record<string, unknown>) => {
		const world = createPublicPayrollWorld();
		world[table].push({ ...existing });
		return memoryPayrollApi(world).db;
	};

	test(`a captured ${family} refuses an edit, naming what holds it`, () => {
		// The lock is the pin, so no other read has to answer: the row it owns says it was taken.
		const existing = existingFor(family, true);
		const db = seed(existing);
		assert.throws(
			() => transformOne(collection, { amount: 400 }, existing, db),
			new RegExp(`Changing this ${family}`)
		);
		assert.throws(
			() => transformOne(collection, { amount: 400 }, existing, db),
			/already taken this record into account/
		);
	});

	test(`a captured ${family} is not deletable; an uncaptured one is`, () => {
		assert.equal(deleteAuthorized(table, existingFor(family, true)), false);
		assert.equal(deleteAuthorized(table, existingFor(family, false)), true);
	});

	test(`an uncaptured ${family} remains writable`, () => {
		const existing = existingFor(family, false);
		assert.doesNotThrow(() => transformOne(collection, { amount: 400 }, existing, seed(existing)));
	});
}

const loanDb = (stored: Record<string, unknown>) => {
	const world = createPublicPayrollWorld();
	world.loan_repayments.push({ ...stored });
	world.loan_catalogue.push({ id: 'loan-line', code: 'ADVANCE', eligibility: '' });
	return memoryPayrollApi(world).db;
};

test('a captured loan repayment refuses a change or a delete through its agreement, and a direct delete', () => {
	const captured = existingFor('loan repayment', true);
	assert.throws(
		() =>
			transformOne(
				loans,
				{ repayment_loan: { update: [{ id: 'repayment-1', set: { amount_due: 400 } }] } },
				loan,
				loanDb(captured)
			),
		/settled by a payroll and cannot be changed/
	);
	assert.throws(
		() =>
			transformOne(
				loans,
				{
					repayment_loan: {
						delete: [{ id: 'repayment-1' }],
						create: [{ ...repayment, id: undefined }]
					}
				},
				loan,
				loanDb(captured)
			),
		/settled by a payroll and cannot be deleted/
	);
	assert.equal(deleteAuthorized('loan_repayments', captured), false);
	assert.equal(deleteAuthorized('loan_repayments', existingFor('loan repayment', false)), true);
});

test('an uncaptured loan repayment is re-priced through its agreement', () => {
	const free = existingFor('loan repayment', false);
	assert.doesNotThrow(() =>
		transformOne(
			loans,
			{ repayment_loan: { update: [{ id: 'repayment-1', set: { amount_due: 400 } }] } },
			loan,
			loanDb(free)
		)
	);
});

/** A standing allowance of the public world, and the entry a payslip priced from it. */
const allowanceWorld = (priced: boolean) => {
	const world = createPublicPayrollWorld();
	const allowance = world.allowances[0]!;
	if (priced)
		(world.allowance_entries ??= []).push({
			id: 'entry-1',
			derived_from_id: allowance.id,
			payslip_id: 'paid-slip',
			employment_id: allowance.employment_id,
			catalogue_id: allowance.catalogue_id,
			from: '2026-01-01',
			to: '2026-01-31',
			basis: { by: 'CALENDAR_DAYS' },
			days: 31,
			denominator: 31,
			unpaid_days: 0,
			contract_amount: 310,
			amount: 310,
			approval_id: null
		});
	return { allowance, db: memoryPayrollApi(world).db };
};

test('a priced allowance freezes everything but its closing day, which may only move forward', () => {
	const { allowance, db } = allowanceWorld(true);
	for (const change of [
		{ amount: 400 },
		{ effective_from: '2026-02-01' },
		{ catalogue_id: 'another-component' }
	])
		assert.throws(() => transformOne(allowances, change, allowance, db), /A payslip has priced/);
	assert.throws(
		() => transformOne(allowances, { effective_to: '2026-01-15' }, allowance, db),
		/cannot end before that day/
	);
	assert.doesNotThrow(() =>
		transformOne(allowances, { effective_to: '2026-02-28' }, allowance, db)
	);
	assert.doesNotThrow(() =>
		transformOne(allowances, { reason: 'ends in February' }, allowance, db)
	);
});

test('an unpriced allowance remains writable, and only an unpriced one is deletable', () => {
	const free = allowanceWorld(false);
	assert.doesNotThrow(() => transformOne(allowances, { amount: 400 }, free.allowance, free.db));
	const grant = (requestGrants() as Record<string, { delete?: { authorize?: Function } }>)
		.allowances;
	const authorized = (world: ReturnType<typeof allowanceWorld>) =>
		Effect.runSync(grant.delete!.authorize!({ record: world.allowance }, { db: world.db }));
	assert.equal(authorized(free), true);
	assert.equal(authorized(allowanceWorld(true)), false);
});
