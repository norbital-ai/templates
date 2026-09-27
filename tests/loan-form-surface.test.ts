// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const representation = readFileSync(
	new URL('../src/data/collection/loans/+representation.svelte', import.meta.url),
	'utf8'
);

test('the loan form writes the schedule as explicit relation actions and asks only for the day and the amount', () => {
	// The canonical write: the table's rows reach the form's state as the relationship's actions.
	assert.match(representation, /form\.set\(\s*'loan_repayments',\s*loanScheduleActions\(/);
	assert.match(representation, /data-loan-schedule/);
	// `sequence` is the date order the write renumbers, never a column; stored rows arrive in date order.
	assert.doesNotMatch(representation, /field: 'sequence'/);
	assert.match(representation, /field: 'due_date'/);
	assert.match(representation, /field: 'amount_due'/);
	assert.match(representation, /orderBy: \{ due_date: 'asc' \}/);
});

test('the generate action is offered from the form and never rewrites a captured repayment', () => {
	assert.match(representation, /data-generate-schedule/);
	assert.match(
		representation,
		/generateLoanSchedule\(\{ principal, range, rows: schedule, lockedIds \}\)/
	);
	// The locked set is read from the repayment's own pin, not assumed.
	assert.match(representation, /row\.payslip_id != null/);
});
