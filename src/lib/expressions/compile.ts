/**
 * Compile-time checks for every CEL the catalogues carry (RFC 0001 §7).
 *
 * One compiler serves all five sites: it refuses an expression that names a member the context
 * does not carry, that uses an identifier the context does not declare, that fails to parse or
 * call an unknown function, or whose result is not the type the site requires. The check runs
 * with the context's blank instance, so a bad expression is refused when the catalogue is
 * written rather than discovered when a payroll is priced.
 */

import { programFor } from './evaluate.js';
import {
	EXPRESSION_CONTEXTS,
	type ExpressionContext,
	type ExpressionSite,
	type ExpressionType
} from './contexts.js';

const KEYWORDS = new Set(['true', 'false', 'null', 'in']);

/** How a refusal names what the field returns. */
const RETURNS: Readonly<Record<ExpressionType, string>> = {
	boolean: 'a boolean',
	money: 'a money amount',
	hours: 'a number of hours',
	minutes: 'a number of minutes',
	days: 'a number of days'
};

/**
 * Compiled by the same environment the run evaluates with (`programFor`), so a function an
 * expression may call is callable in both and a stand-in list cannot drift from the real one.
 *
 * No custom binary `min`/`max`: cel-js refuses a `(dyn, dyn)` overload beside its own
 * `(dyn, string)` one, and its aggregate forms already cover lists. Clamp with a ternary
 * (`total_work_hours > limits.daily_total ? total_work_hours - limits.daily_total : 0`).
 */

/** Dotted paths as written, with `(args)` and `<key>` suffixes stripped. */
function declaredPaths(context: ExpressionContext): readonly string[] {
	return context.fields.map((field) => field.path.replace(/\(.*$/, '').replace(/<.*$/, '').trim());
}

const STRING_LITERAL = /(['"])(?:\\.|(?!\1).)*\1/g;
const CHAIN = /(?<![\w.])([a-z_][a-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
const BARE = /(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)(?![.\w(])/g;

function unknownMember(context: ExpressionContext, expression: string): string | null {
	const paths = declaredPaths(context);
	const available = paths.join(', ');
	const source = expression.replace(STRING_LITERAL, "''");
	for (const match of source.matchAll(CHAIN)) {
		const chain = match[1];
		if (chain == null) continue;
		// A call (`name(`, method or global) is validated by evaluation, not by the member list.
		if (source[match.index + match[0].length] === '(') continue;
		if (KEYWORDS.has(chain)) continue;
		const root = chain.split('.')[0]!;
		if (context.open.includes(root)) continue;
		const known = paths.some((path) => path === chain || path.startsWith(`${chain}.`));
		if (!known)
			return (
				`The ${context.site} expression names ${chain}, which the ${context.site} context does not carry. ` +
				`Available: ${available}.`
			);
	}
	for (const match of source.matchAll(BARE)) {
		const identifier = match[1]!;
		if (KEYWORDS.has(identifier) || context.bare.includes(identifier)) continue;
		return (
			`The ${context.site} expression names ${identifier}, which the context does not declare. ` +
			`Available: ${available}.`
		);
	}
	return null;
}

function describe(value: unknown): string {
	if (Array.isArray(value)) return 'a list';
	if (typeof value === 'bigint') return 'a number';
	return typeof value;
}

/**
 * The sentence that refuses a malformed expression, or null when it compiles and produces the
 * required type. An empty expression is null: the caller states whether it is required.
 */
export function compileExpression(options: {
	readonly expression: string | null | undefined;
	readonly site: ExpressionSite;
	readonly type: ExpressionType;
}): string | null {
	const expression = (options.expression ?? '').trim();
	if (expression === '') return null;
	const context = EXPRESSION_CONTEXTS[options.site];
	const memberFault = unknownMember(context, expression);
	if (memberFault != null) return memberFault;
	// `produced.<code>` is an open map: the blank carries a zero row for every code the expression
	// names, so the check runs against the shape the run will supply rather than refusing a legal
	// mention of a scheme this expression cannot see declared anywhere.
	const mentioned = [...expression.matchAll(/produced\.([A-Za-z_][A-Za-z0-9_]*)\./g)].map(
		(match) => match[1]!
	);
	const blank = {
		...context.blank,
		produced: Object.fromEntries(
			mentioned.map((code) => [code, { employee: 0, employer: 0 }])
		) as Record<string, { employee: number; employer: number }>
	};
	let value: unknown;
	try {
		value = programFor(expression)({ ...blank });
	} catch (error) {
		const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
		return `The ${options.site} expression does not compile: ${message}`;
	}
	// cel-js types an integral literal as a bigint. It is still a number for every site here —
	// `evaluateNumber` converts it — so the check is on the value's kind, not its representation.
	const ok =
		options.type === 'boolean'
			? typeof value === 'boolean'
			: typeof value === 'number' || typeof value === 'bigint';
	if (!ok)
		return (
			`The ${options.site} expression must produce ${RETURNS[options.type]}; ` +
			`this one produces ${describe(value)}.`
		);
	return null;
}
