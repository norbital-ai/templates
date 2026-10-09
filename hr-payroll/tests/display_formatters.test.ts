/** Amounts as the payslip and run views print them. */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { formatNumeric } from '../src/lib/ui/format/display_formatters.ts';

it('a zero prints unsigned: a slip with no deductions totals 0.00, not -0.00', () => {
	assert.doesNotMatch(formatNumeric(-0, 'PHP'), /^[-−]/);
	assert.doesNotMatch(formatNumeric(-0), /^[-−]/);
	assert.doesNotMatch(formatNumeric(-0.001, 'PHP'), /^[-−]/);
	assert.match(formatNumeric(-12.5, 'PHP'), /^[-−]/);
});
