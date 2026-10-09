/** The Loans page's outstanding balance: each loan's principal less its instalments to date. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loanBalances } from '../src/lib/ui/payroll/loan_balance.ts';

test('each instalment shows what the loan still owes once it is recovered; a reversal gives one back', () => {
	const row = (
		id: string,
		occurred_on: string,
		amount: number,
		facts: object,
		activity = 'AWARD'
	) => ({
		id,
		employment_id: 'k1',
		catalog_id: 'loan',
		occurred_on,
		activity,
		amount,
		facts
	});
	const loan = { loan_id: 'L1', principal: 645 };
	const balances = loanBalances([
		row('b', '2026-02-01', 75, loan),
		row('a', '2026-01-01', 95, loan),
		row('r', '2026-02-15', 75, loan, 'REVERSAL'),
		row('x', '2026-01-01', 50, { loan_id: 'L2' })
	]);
	assert.deepEqual(
		['a', 'b', 'r', 'x'].map((id) => balances.get(id)),
		[550, 475, 550, null]
	);
	// brought over at its tenth instalment of ten: nothing left
	assert.equal(
		loanBalances([
			row('t', '2026-01-01', 104, { loan_id: 'L3', principal: 1040, sequence: 10 })
		]).get('t'),
		0
	);
});
