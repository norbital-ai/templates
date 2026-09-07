// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const representation = readFileSync(
	new URL('../src/collections/loans/+representation.svelte', import.meta.url),
	'utf8'
);
const schedule = readFileSync(new URL('../src/lib/loan-schedule.ts', import.meta.url), 'utf8');

test('loan form nests repayments in a matrix and blocks an unbalanced schedule without rewriting amounts', () => {
	assert.match(representation, /MatrixRenderer/);
	assert.match(representation, /data-loan-schedule/);
	assert.match(representation, /data-invalid=\{imbalanced \? 'true' : undefined\}/);
	assert.match(representation, /loanScheduleImbalanced/);
	// The canonical write path: the form's default write carries the matrix, pushed into the
	// form's state as the relationship key — no onSubmit override, no inline mutation.
	assert.match(representation, /CollectionFormSemantic/);
	assert.match(representation, /repayment_loan: loanScheduleWriteRows\(rows\)/);
	assert.match(
		representation,
		/form\.setValues\(\{ repayment_loan: loanScheduleWriteRows\(rows\) \}\)/
	);
	assert.doesNotMatch(representation, /onSubmit/);
	assert.doesNotMatch(representation, /loans\.mutate\(\[/);
	assert.doesNotMatch(representation, /amount_due\s*=/);
	assert.match(schedule, /Amounts are never rewritten here/);
	// The write is the ordered plan: every path out of the module renumbers `sequence` from the
	// dates, so the form can drop the column without the stored key drifting from the schedule.
	assert.match(schedule, /return loanScheduleOrdered\(rows\)\.map\(/);
});

test('the schedule matrix asks for the two facts the operator owns, and not for the sort', () => {
	assert.doesNotMatch(representation, /key: 'sequence'/);
	assert.match(representation, /key: 'due_date'/);
	assert.match(representation, /key: 'amount_due'/);
	// Stored rows arrive in date order, not in stored-sequence order.
	assert.match(representation, /orderBy: \{ due_date: 'asc' \}/);
});

test('the generate action is offered from the form and never rewrites a captured repayment', () => {
	assert.match(representation, /data-generate-schedule/);
	assert.match(representation, /canGenerateLoanSchedule/);
	assert.match(representation, /generateLoanSchedule\(/);
	// The locked set is read from the payslip junction, not assumed.
	assert.match(representation, /payslip_loan_repayment_inputs\.findMany/);
	assert.match(representation, /lockedIds/);
});
