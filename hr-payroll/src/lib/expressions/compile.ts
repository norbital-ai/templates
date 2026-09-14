/**
 * Compile-time checks for every CEL the catalogues carry (RFC 0001 §7).
 *
 * One compiler serves all five sites: it refuses an expression that names a member the context
 * does not carry, that uses an identifier the context does not declare, that fails to parse or
 * call an unknown function, or whose result is not the type the site requires. The check runs
 * with the context's blank instance, so a bad expression is refused when the catalogue is
 * written rather than discovered when a payroll is priced.
 */

import { createReckonEngine, type ComputationDefinition } from '@norbital-ai/std/reckon';
import {
	EXPRESSION_CONTEXTS,
	type ExpressionContext,
	type ExpressionSite,
	type ExpressionType
} from './contexts.js';

const KEYWORDS = new Set(['true', 'false', 'null', 'in']);

/**
 * The engine every expression site shares: the compile-time check below and the run-time
 * builders call the same factory, so a function an expression may call is callable in both.
 *
 * No custom binary `min`/`max`: cel-js refuses a `(dyn, dyn)` overload beside its own
 * `(dyn, string)` one, and its aggregate forms already cover lists. Clamp with a ternary
 * (`total_work_hours > limits.daily_total ? total_work_hours - limits.daily_total : 0`).
 */
function expressionEngine() {
	return createReckonEngine()
		.registerFunction('calendar_days', 'calendar_days(string): double', () => 31)
		.registerFunction('working_days', 'working_days(string): double', () => 22)
		.registerFunction('minimum_wage', 'minimum_wage(string): double', () => 1700)
		.registerFunction('limit', 'limit(string): double', () => 11)
		.registerFunction('bracket', 'bracket(dyn, dyn, dyn): double', (base) => Number(base))
		.registerFunction('ladder', 'ladder(dyn, list<dyn>): double', (base) => Number(base))
		.registerFunction('map.under', 'map.under(int): int', () => 0n)
		.registerFunction('map.days', 'map.days(string): double', () => 0)
		.registerFunction('map.balance', 'map.balance(string): double', () => 0);
}

/** Compile-time stand-ins; the engine builders supply the real values at run time. */
const engine = expressionEngine();

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
	const definition: ComputationDefinition = {
		id: `expression:${options.site}`,
		tables: {},
		exprs: { value: expression },
		outputs: ['value']
	};
	let value: unknown;
	try {
		value = engine.runComputation<Record<string, unknown>, { value: unknown }>(definition, {
			...context.blank
		}).outputs.value;
	} catch (error) {
		const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
		return `The ${options.site} expression does not compile: ${message}`;
	}
	const ok = options.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'number';
	if (!ok)
		return (
			`The ${options.site} expression must produce ${options.type === 'boolean' ? 'a boolean' : 'a number'}; ` +
			`this one produces ${describe(value)}.`
		);
	return null;
}
