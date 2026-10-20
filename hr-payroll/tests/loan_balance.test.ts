/** The Loans page reports one outstanding balance per configured principal. */
import assert from 'node:assert/strict';
import { test } from '@effect/vitest';
import { Decimal } from '@norbital-ai/std/decimal';
import { loanBalances } from '../src/lib/ui/payroll/loan_balance.ts';

test('only captured repayments reduce their own principal; a captured reversal restores it', () => {
	const repayment = (amount: string, payslip_id?: string, activity = 'AWARD') => ({
		amount: Decimal.of(amount),
		payslip_id,
		activity
	});
	const balances = loanBalances([
		{
			id: 'first',
			principal_amount: Decimal.of('645'),
			repayments: [
				repayment('95', 'january'),
				repayment('75', 'february'),
				repayment('75', 'correction', 'REVERSAL'),
				repayment('75')
			]
		},
		{ id: 'second', principal_amount: Decimal.of('100'), repayments: [] },
		{ id: 'incomplete', repayments: [repayment('50', 'january')] }
	]);
	assert.deepEqual(
		[...balances],
		[
			['first', 550],
			['second', 100],
			['incomplete', null]
		]
	);
});

test('an unpinned recalculated repayment no longer reduces the balance and decimal amounts stay exact', () => {
	const loan = {
		id: 'loan',
		principal_amount: Decimal.of('0.30'),
		repayments: [
			{ amount: Decimal.of('0.10'), payslip_id: 'january' },
			{ amount: Decimal.of('0.20'), payslip_id: null }
		]
	};
	assert.equal(loanBalances([loan]).get('loan'), 0.2);
	assert.equal(
		loanBalances([
			{ ...loan, repayments: loan.repayments.map((row) => ({ ...row, payslip_id: null })) }
		]).get('loan'),
		0.3
	);
});
