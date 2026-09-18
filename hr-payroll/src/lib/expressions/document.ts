/**
 * The expression catalogue as prose: one section per site, every member with its description,
 * the bare names, the open prefixes and the functions. `docs/expression-context.md` is this
 * render, and a test holds the file to it — so what the engine evaluates is documented once, in
 * `contexts.ts`, and the document cannot drift from it.
 */

import { EXPRESSION_CONTEXTS, type ExpressionContext } from './contexts.js';

const SITE_USE: Readonly<Record<ExpressionContext['site'], string>> = {
	person:
		'catalogue eligibility, a scheme’s person conditions, `wages.applies_when`, `overtime_when`',
	entry: 'catalogue bands and entitlement amounts — one claim, allowance or loan entry',
	work_day: 'work bands, breaks, limits and the night premium — one priced person-day',
	assessment: '`statutory_contributions.assessed_on` and `ordinary_on` — one scheme’s wage',
	scheme: 'contribution rules — the `when`, `employee` and `employer` of each rung',
	leave_day: '`leave_catalogue.pay_fraction` — one charged leave day'
};

/** A table cell: the pipe is the table's own character. */
const cell = (text: string) => text.replace(/\|/g, '\\|');

export function renderExpressionContexts(): string {
	const lines: string[] = [
		'# What the payroll engine evaluates',
		'',
		'Rendered from `src/lib/expressions/contexts.ts` — do not edit by hand; `pnpm exec node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs scripts/render-expression-context.ts` rewrites it and `tests/expression-context-doc.test.ts` holds it current.',
		'',
		'Every expression in a sealed version is CEL over one of six sites. A site carries the roots listed here and nothing else: a member the site does not declare is refused at write. Open prefixes (`limits.<key>`, `year.earned.<code>`, `produced.<code>`, `scheme.elections.<key>`, `person.company.facts.<key>`) are keys the version itself declares.',
		''
	];
	for (const context of Object.values(EXPRESSION_CONTEXTS)) {
		lines.push(
			`## \`${context.site}\` — ${context.description}`,
			'',
			`Used by: ${SITE_USE[context.site]}.`,
			''
		);
		if (context.bare.length > 0)
			lines.push(`Bare names: ${context.bare.map((name) => `\`${name}\``).join(', ')}.`, '');
		if (context.open.length > 0)
			lines.push(
				`Open prefixes: ${context.open.map((name) => `\`${name}.<key>\``).join(', ')}.`,
				''
			);
		lines.push('| Member | Meaning |', '| --- | --- |');
		for (const field of context.fields)
			lines.push(`| \`${field.path}\` | ${cell(field.description)} |`);
		lines.push('');
		if (context.functions.length > 0) {
			lines.push('| Function | Meaning |', '| --- | --- |');
			for (const fn of context.functions)
				lines.push(`| \`${fn.path}\` | ${cell(fn.description)} |`);
			lines.push('');
		}
	}
	return lines.join('\n');
}
