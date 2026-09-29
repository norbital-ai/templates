/**
 * Jurisdiction branches in shared code are enumerated here for review.
 *
 * Statutory pricing belongs in the seed. A small number of collection and validation guards
 * currently name the jurisdiction because their input shapes are jurisdiction-specific. Freeze
 * those exceptions so any additional branch is reviewed explicitly.
 *
 * Two branches had grown anyway, each for a real reason, and neither needed to be code:
 *
 *  - `=== 'PH'` substituted the 313-day factor for the 261-day one when an employee's week ran past
 *    forty hours. That is employee-level law, which is a reason for the Work to state one rate row
 *    per week shape — `ordinary_rate` is already a predicate list — not a reason for the engine to
 *    know about the Philippines.
 *  - `=== 'TW'` credited a day in lieu by the hour rather than by the day (勞基法 §32-1). Off-in-lieu
 *    is fully manual now: leave entered as an ordinary entry, no compensation column, so
 *    there is no branch left to keep and no `lieu_unit` grammar to carry.
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

test('jurisdiction-specific source guards are enumerated', () => {
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
			offenders.push(`${file.slice(root.length + 1)} — ${match[0]}`);
		}
	}
	assert.deepEqual(
		offenders,
		[
			"app/hr_controller/events/leave/+leave.page.svelte — === 'PH'",
			"data/collection/company_facts/+representation.svelte — === 'PH'",
			"data/collection/leave_catalogue/+collection.ts — === 'SG'",
			"data/collection/payment_events/+collection.ts — !== 'PH'",
			"data/collection/payment_events/+collection.ts — !== 'VN'",
			"data/collection/ph_maternity_cases/+collection.ts — !== 'PH'",
			"data/collection/vn_noncontract_settlements/+collection.ts — !== 'VN'",
			"data/collection/work_days/+collection.ts — === 'SG'",
			"data/collection/work_days/+collection.ts — === 'SG'",
			"data/collection/work_days/+representation.svelte — === 'SG'",
			"data/collection/work_days/+representation.svelte — === 'SG'",
			"data/collection/work_days/+representation.svelte — === 'SG'",
			"lib/leave/activity.ts — === 'PH'",
			"lib/leave/activity.ts — === 'SG'",
			"lib/leave/activity.ts — === 'SG'",
			"lib/leave/activity.ts — === 'SG'",
			"lib/leave/context.ts — === 'SG'",
			"lib/leave/payroll.ts — === 'SG'",
			"lib/payroll/contribution.ts — === 'MY'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'PH'",
			"lib/payroll/contribution.ts — === 'PH'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — !== 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/contribution.ts — === 'ID'",
			"lib/payroll/run/engine.ts — === 'MY'",
			"lib/payroll/work.ts — === 'MY'",
			"lib/ph/maternity-payroll-guard.ts — !== 'PH'",
			"lib/ui/contract/terms-fields.svelte — === 'ID'",
			"lib/ui/contract/terms-fields.svelte — === 'PH'",
			"lib/ui/contract/terms-fields.svelte — === 'PH'"
		],
		'new country-code conditions need a seeded rule or an explicit review of this exception list'
	);
});

test('the grammar carries what those two branches needed', () => {
	// The replacements, asserted by name: if either is removed the branch has to come back, and
	// this test is where that is noticed.
	const eligibility = readFileSync(`${root}/lib/expressions/contexts.ts`, 'utf8');
	assert.match(
		eligibility,
		/terms\.ordinary_hours_per_week/,
		'a rate row can read the working week'
	);
	const rules = readFileSync(`${root}/lib/payroll/work-rules-values.ts`, 'utf8');
	assert.doesNotMatch(
		rules,
		/lieu/,
		'OIL is fully manual: the grammar carries no lieu member at all'
	);
});
