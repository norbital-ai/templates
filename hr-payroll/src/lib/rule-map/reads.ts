/**
 * What one stored expression reads, as rule-map references: the inputs it names (declared facts
 * resolved to their declaration list), the tables it looks up, the lines it names by code and the
 * schemes whose results it reads. Shared by the rule map (edges) and the line trace (the values
 * read), so both name an input the same way.
 *
 * Inputs are read from the text, not the AST — the precedent of `openKeyMentions` and
 * `tableMentions`: a map is judged by its humans, and a ladder of thousands of band expressions
 * parses too slowly in a browser. Only chains rooted at a real site member count, so prose does not.
 */

import { EXPRESSION_CONTEXTS } from '../expressions/contexts.js';
import { tableMentions } from '../expressions/functions/tables.js';
import { producedMentionsOf } from '../payroll/run/mentions.js';
import * as Predicate from 'effect/Predicate';

/** The version's declared-input lists and the path prefix an expression reads each under. */
export const DECLARED_FACT_PREFIXES = [
	['facts', 'company.facts'],
	['terms_facts', 'terms.facts'],
	['work_day_facts', 'day_facts'],
	['payment_facts', 'payment.facts'],
	['settlement_facts', 'settlement.facts'],
	['worksite_facts', 'worksite.facts'],
	['person_facts', 'employee.facts'],
	['exit_facts', 'employment.exit_facts']
] as const;
export type DeclaredFactList = (typeof DECLARED_FACT_PREFIXES)[number][0];

export type ExpressionReads = {
	/** Declared facts, as `[list, key]`. */
	readonly facts: readonly (readonly [DeclaredFactList, string])[];
	/** Other site members read, normalised to two segments or to the key after `facts` (`employee.age`, `facts.<scheme>`). */
	readonly inputs: readonly string[];
	readonly tables: readonly string[];
	/** Line codes named: `code('X')`, `year.earned.X`, `lines.X`. */
	readonly lines: readonly string[];
	/** Scheme codes whose results are read (`produced.<code>.*`). */
	readonly produced: readonly string[];
	/** Work-limit keys read (`limits.<key>`). */
	readonly limits: readonly string[];
	/** Every normalised path read, facts included, in first-seen order: what a trace resolves. */
	readonly paths: readonly string[];
};

const EMPTY: ExpressionReads = {
	facts: [],
	inputs: [],
	tables: [],
	lines: [],
	produced: [],
	limits: [],
	paths: []
};

/** The roots a site member can start with, read off the contexts so the list cannot drift. */
const ROOTS = new Set(
	Object.values(EXPRESSION_CONTEXTS).flatMap((context) => [
		...context.fields.map((field) => field.path.split('.')[0]!),
		...context.open.map((prefix) => prefix.split('.')[0]!)
	])
);

const CHAIN = /(?<![\w.'"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/g;
const CODE_CALL = /\bcode\s*\(\s*(?:'([^']*)'|"([^"]*)")/g;

const push = <T>(list: T[], value: T, same: (a: T, b: T) => boolean = (a, b) => a === b) => {
	if (!list.some((item) => same(item, value))) list.push(value);
};

const cache = new Map<string, ExpressionReads>();
const CACHE_CAP = 50_000;

/** What one expression reads. Memoized: the map and every traced evaluation read the same text. */
export function expressionReads(expression: string | null | undefined): ExpressionReads {
	if (expression == null || expression.trim() === '') return EMPTY;
	const cached = cache.get(expression);
	if (cached !== undefined) return cached;
	const facts: [DeclaredFactList, string][] = [];
	const inputs: string[] = [];
	const lines: string[] = [];
	const limits: string[] = [];
	const paths: string[] = [];
	for (const match of expression.matchAll(CHAIN)) {
		let segments = match[1]!.split('.');
		if (segments[0] === 'person' && segments.length > 1) segments = segments.slice(1);
		if (segments[0] === 'produced') continue;
		if (segments[0] === 'limits') {
			push(limits, segments[1]!);
			push(paths, segments.slice(0, 2).join('.'));
			continue;
		}
		if (segments[0] === 'year' && segments[1] === 'earned' && segments[2] != null) {
			push(lines, segments[2]);
			push(paths, segments.slice(0, 3).join('.'));
			continue;
		}
		const lineAt = segments.indexOf('lines');
		if (lineAt >= 0 && segments[lineAt + 1] != null) {
			push(lines, segments[lineAt + 1]!);
			push(paths, segments.slice(0, lineAt + 2).join('.'));
			continue;
		}
		if (!ROOTS.has(segments[0]!)) continue;
		const path = segments.join('.');
		const declared = DECLARED_FACT_PREFIXES.find(
			([, prefix]) => path.startsWith(`${prefix}.`) && path.length > prefix.length + 1
		);
		if (declared != null) {
			const key = path.slice(declared[1].length + 1).split('.')[0]!;
			push(
				facts,
				[declared[0], key] as [DeclaredFactList, string],
				(a, b) => a[0] === b[0] && a[1] === b[1]
			);
			push(paths, `${declared[1]}.${key}`);
			continue;
		}
		const factsAt = segments.indexOf('facts');
		const input =
			factsAt >= 0 && segments[factsAt + 1] != null
				? segments.slice(0, factsAt + 2).join('.')
				: segments.slice(0, 2).join('.');
		push(inputs, input);
		push(paths, input);
	}
	for (const match of expression.matchAll(CODE_CALL)) push(lines, match[1] ?? match[2] ?? '');
	const reads: ExpressionReads = {
		facts,
		inputs,
		tables: [...new Set(tableMentions(expression).map((mention) => mention.name))],
		lines,
		produced: producedMentionsOf(expression),
		limits,
		paths
	};
	if (cache.size < CACHE_CAP) cache.set(expression, reads);
	return reads;
}

/** Keys whose strings are prose, codes or links, never an expression. */
const PROSE = new Set([
	'id',
	'code',
	'name',
	'label',
	'authority',
	'description',
	'message',
	'validation_message',
	'refusal',
	'refuse_message',
	'url',
	'urls',
	'key',
	'counts_toward',
	'settings_id',
	'short_name',
	'listing_group',
	'change_summary'
]);

/**
 * Every string a stored value holds where an expression can sit, with the dotted field it sits at
 * (`bands[0].amount`). A string that is not an expression names nothing, so over-collecting is
 * harmless; prose keys are skipped because a link would read as a chain.
 */
export function expressionsIn(
	value: unknown,
	at = ''
): readonly { readonly field: string; readonly expression: string }[] {
	if (Predicate.isString(value))
		return value.trim() === '' ? [] : [{ field: at, expression: value }];
	if (Array.isArray(value))
		return value.flatMap((item, index) => expressionsIn(item, `${at}[${index}]`));
	if (!Predicate.isObjectOrArray(value)) return [];
	return Object.entries(value).flatMap(([key, item]) =>
		PROSE.has(key) ? [] : expressionsIn(item, at === '' ? key : `${at}.${key}`)
	);
}
