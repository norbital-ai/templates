/**
 * The leave engine states no number of its own: an overdraw, a carry depth, a rolling span or what an unplanned range
 * charges is a leave_catalog field. What remains is mechanics — identities, halves, a year's months and the fixed widths
 * of ISO dates. A `??` default is the empty 0 only. A new literal here is a policy that belongs in the seed (or a named
 * read bound marked `ponytail:`), so this list is closed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';

const MECHANICS = new Set([
	'0', // identity, start index
	'1', // identity, one day
	'2', // the two ends of a range; half a scheduled day
	'0.5', // a half day
	'4', // an ISO year's width
	'7', // an ISO month key's width
	'10', // an ISO date's width
	'12', // the months of a year
	'100' // hours kept to two decimals
]);
const FILES = ['src/lib/payroll_engine/leave.ts', 'src/lib/payroll_engine/leave_days.ts'];

describe('leave engine numeric literals', () => {
	it.each(FILES)('%s holds mechanics only, and defaults nothing but the empty 0', (file) => {
		const code = readFileSync(resolve(process.cwd(), file), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^.*ponytail:.*\n.*$/gm, '')
			.replace(/\/\/.*$/gm, '')
			.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
		const found = new Set(code.match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g) ?? []);
		assert.deepEqual(
			[...found].filter((literal) => !MECHANICS.has(literal)),
			[],
			`a numeric literal in ${file} outside the mechanics list`
		);
		const defaults = [...code.matchAll(/\?\?\s*(-?\d+(?:\.\d+)?)/g)].map((match) => match[1]);
		assert.deepEqual(
			defaults.filter((literal) => literal !== '0'),
			[],
			`a numeric \`??\` default in ${file}: state it on the row`
		);
	});
});
