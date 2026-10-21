/**
 * The payslip line engine states no number of its own: a rounding step, a divisor, a cap or a window is a row field.
 * What remains is mechanics — identities and the fixed widths of ISO dates and stored precisions. A new literal here is
 * a policy that belongs in the seed (or a named read bound marked `ponytail:`), so this list is closed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';

const MECHANICS = new Set([
	'0', // identity, start index
	'1', // identity, unit fraction
	'4', // a leave share's stored precision; an ISO year's width
	'6', // a line quantity's stored precision
	'7', // an ISO month key's width; the days of a week
	'10' // an ISO date's width
]);

describe('payslip/lines.ts numeric literals', () => {
	it('are mechanics only', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/payroll_engine/payslip/lines.ts'),
			'utf8'
		);
		const code = source
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '')
			.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
		const found = new Set(code.match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g) ?? []);
		assert.deepEqual(
			[...found].filter((literal) => !MECHANICS.has(literal)),
			[],
			'a numeric literal in payslip/lines.ts outside the mechanics list'
		);
	});
});
