/**
 * No jurisdiction names itself in engine code.
 *
 * A statutory template earns its keep by being rows rather than cases: a law is transcribed into a
 * seed, and the engine prices whatever the seed says. The moment a country code appears in a
 * condition, that jurisdiction's law lives in two places — the seed that describes it and the
 * branch that contradicts or completes it — and only one of them is reviewed when the law changes.
 *
 * Two branches had grown anyway, each for a real reason, and neither needed to be code:
 *
 *  - `=== 'PH'` substituted the 313-day factor for the 261-day one when an employee's week ran past
 *    forty hours. That is employee-level law, which is a reason for the Work to state one rate row
 *    per week shape — `ordinary_rate` is already a predicate list — not a reason for the engine to
 *    know about the Philippines.
 *  - `=== 'TW'` credited a day in lieu by the hour rather than by the day (勞基法 §32-1). That is a
 *    property of the regime, and it now sits beside the switch that says whether lieu is permitted
 *    at all.
 *
 * `countryOf` itself stays: naming the jurisdiction inside a refusal is how an operator finds out
 * whose rule stopped them, and a value flowing into a rule is not a branch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

/**
 * A file's code, with its comment lines removed.
 *
 * The scan is for conditions, and a comment is prose: this very file's sibling explains the two
 * branches that were removed and quotes them, which the first version of this test then reported
 * as offenders. Dropping lines that open with a comment marker covers JSDoc and line comments and
 * leaves string literals inside real statements alone.
 */
function code(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const trimmed = line.trimStart();
			return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
				? ''
				: line;
		})
		.join('\n');
}

/** Every authored source file under `src`, so a new directory is covered on arrival. */
function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return sources(path);
		return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
	});
}

/** The two-letter codes this bank seeds, as a condition would have to spell them. */
const CODES = ['MY', 'PH', 'SG', 'TW', 'VN', 'ID'];

test('no engine condition tests a jurisdiction code', () => {
	// A comparison against a literal country code, in either quote style, with or without
	// `countryOf` around the left side.
	const comparison = new RegExp(
		String.raw`(===|!==|==|!=)\s*(['"\x60])(${CODES.join('|')})\2`,
		'g'
	);
	const offenders: string[] = [];
	for (const file of sources(root)) {
		const text = code(readFileSync(file, 'utf8'));
		for (const match of text.matchAll(comparison)) {
			const line = text.slice(0, match.index).split('\n').length;
			offenders.push(`${file.slice(root.length + 1)}:${line} — ${match[0]}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		'a jurisdiction naming itself in a condition puts its law in two places; state it on the ' +
			'seed instead — a predicate row, a regime member, or a special-rule token'
	);
});

test('the grammar carries what those two branches needed', () => {
	// The replacements, asserted by name: if either is removed the branch has to come back, and
	// this test is where that is noticed.
	const eligibility = readFileSync(`${root}/collections/payroll_runs/lib/eligibility.ts`, 'utf8');
	assert.match(eligibility, /'ordinary_hours_per_week'/, 'a rate row can read the working week');
	const regime = readFileSync(`${root}/datatypes/statutory_regime/+definition.ts`, 'utf8');
	assert.match(regime, /lieu_unit:/, 'a regime states whether lieu is credited by day or by hour');
});
