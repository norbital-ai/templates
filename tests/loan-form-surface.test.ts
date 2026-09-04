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
	assert.match(representation, /semantic:/);
	assert.match(representation, /repayment_loan: loanScheduleWriteRows\(schedule\)/);
	assert.match(representation, /loans\.mutate\(\[/);
	assert.doesNotMatch(representation, /amount_due\s*=/);
	assert.match(schedule, /Amounts are never rewritten here/);
	assert.match(schedule, /return rows\.map\(\(row\) => \(\{/);
});
