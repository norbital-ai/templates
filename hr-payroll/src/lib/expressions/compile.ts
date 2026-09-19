/**
 * Compile-time checks for every CEL the catalogues carry.
 *
 * One compiler serves all five sites: it refuses an expression that names a member the context
 * does not carry, that uses an identifier the context does not declare, that fails to parse or
 * call an unknown function, or whose result is not the type the site requires. The check runs
 * with the context's blank instance, so a bad expression is refused when the catalogue is
 * written rather than discovered when a payroll is priced.
 *
 * The AST literal walk at the bottom serves the version-bound checks: an `assessed_on` formula's
 * `code('X')` is checked against the rows of the version the write carries, `year.earned.<code>`
 * the same way, and every `<PART>.ALLOWANCES`-shaped word against the parts the scheme declares.
 */

import { programFor } from './evaluate.js';
import {
	CATALOGUE_WORDS,
	EXPRESSION_CONTEXTS,
	openKeyMentions,
	type CatalogueWord,
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
	days: 'a number of days',
	number: 'a number'
};

/**
 * Compiled by the same environment the run evaluates with (`programFor`), so a function an
 * expression may call is callable in both and a stand-in list cannot drift from the real one.
 *
 * No custom binary `min`/`max`: cel-js refuses a `(dyn, dyn)` overload beside its own
 * `(dyn, string)` one, and its aggregate forms already cover lists. Clamp with a ternary
 * (`worked_hours > limits.daily_total ? worked_hours - limits.daily_total : 0`).
 */

/** Dotted paths as written, with `(args)` and `<key>` suffixes stripped. */
function declaredPaths(context: ExpressionContext): readonly string[] {
	return context.fields.map((field) => field.path.replace(/\(.*$/, '').replace(/<.*$/, '').trim());
}

const STRING_LITERAL = /(['"])(?:\\.|(?!\1).)*\1/g;
const CHAIN = /(?<![\w.])([a-z_][a-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
const BARE = /(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)(?![.\w(])/g;

/**
 * The assessment context of one scheme: the site's context with the scheme's parts as roots of
 * the catalogue words (`ORDINARY.ALLOWANCES`, `year.ADDITIONAL.CLAIMS`). A part is a bare
 * upper-case root, so it is declared as a bare name and given its blank.
 */
function withParts(context: ExpressionContext, parts: readonly string[]): ExpressionContext {
	if (parts.length === 0 || context.site !== 'assessment') return context;
	const words = Object.fromEntries(CATALOGUE_WORDS.map((word) => [word, 0]));
	const blank = structuredClone(context.blank) as Record<string, unknown>;
	const year = { ...((blank.year ?? {}) as Record<string, unknown>) };
	for (const part of parts) {
		blank[part] = { ...words };
		year[part] = { ...words };
	}
	blank.year = year;
	return {
		...context,
		fields: [
			...context.fields,
			...parts.flatMap((part) =>
				CATALOGUE_WORDS.map((word) => ({ path: `${part}.${word}`, description: '' }))
			)
		],
		bare: [...context.bare, ...parts],
		blank
	};
}

/** Whether a written chain sits under an open prefix, whose remaining segments are data keys. */
function underOpen(context: ExpressionContext, chain: string): boolean {
	return context.open.some((prefix) => chain === prefix || chain.startsWith(`${prefix}.`));
}

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
		if (underOpen(context, chain)) continue;
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

/** A declared election or entity fact: its key and the type of value it holds. */
export type DeclaredKey = {
	readonly key: string;
	readonly type: 'boolean' | 'number' | 'string';
};

/** The empty value of a declared type: an absent election is `false`, `0` or `''`, never null. */
export const EMPTY_OF: Readonly<Record<DeclaredKey['type'], boolean | number | string>> = {
	boolean: false,
	number: 0,
	string: ''
};

/**
 * The blank, with a placeholder under every open key the expression names.
 *
 * `produced.<code>`, `year.earned.<code>`, `person.company.facts.<key>` and `limits.<key>` are
 * data: the version supplies the keys at run time, and the check runs against the shape the run
 * will supply rather than refusing a legal mention the blank cannot know. A number is the
 * permissive placeholder: comparisons and arithmetic both accept it. A `scheme.elections.<key>`
 * is typed by the scheme row's declaration, so its placeholder is the declared type's empty value.
 */
function openKeyBlank(
	context: ExpressionContext,
	expression: string,
	elections: readonly DeclaredKey[]
): Record<string, unknown> {
	const blank = structuredClone(context.blank) as Record<string, any>;
	const zeroMap = (parent: Record<string, unknown>, key: string, mentions: readonly string[]) => {
		const existing = (parent[key] ?? {}) as Record<string, unknown>;
		for (const mention of mentions) if (!(mention in existing)) existing[mention] = 0;
		parent[key] = existing;
	};
	const produced = openKeyMentions(expression, 'produced');
	if (produced.length > 0)
		blank.produced = Object.fromEntries(
			produced.map((code) => [code, { base: 0, employee: 0, employee_this_period: 0, employer: 0 }])
		);
	const earned = openKeyMentions(expression, 'year.earned');
	if (earned.length > 0) {
		blank.year = { ...(blank.year ?? {}) };
		zeroMap(blank.year, 'earned', earned);
	}
	if (context.open.includes('person.company.facts')) {
		const facts = openKeyMentions(expression, 'person.company.facts');
		if (facts.length > 0) {
			blank.person = structuredClone(blank.person);
			zeroMap(blank.person.company, 'facts', facts);
		}
	}
	const ownFacts = openKeyMentions(expression, 'company.facts');
	if (ownFacts.length > 0 && blank.company != null && context.site === 'person') {
		blank.company = structuredClone(blank.company);
		zeroMap(blank.company, 'facts', ownFacts);
	}
	if (elections.length > 0) {
		blank.scheme = structuredClone(blank.scheme);
		blank.scheme.elections = Object.fromEntries(
			elections.map((election) => [election.key, EMPTY_OF[election.type]])
		);
	}
	const limits = openKeyMentions(expression, 'limits');
	if (limits.length > 0 && blank.limits != null) {
		blank.limits = structuredClone(blank.limits);
		for (const key of limits) if (!(key in blank.limits)) blank.limits[key] = 0;
	}
	return blank;
}

function describe(value: unknown): string {
	if (Array.isArray(value)) return 'a list';
	if (typeof value === 'bigint') return 'a number';
	return typeof value;
}

/**
 * The sentence that refuses a malformed expression, or null when it compiles and produces the
 * required type. An empty expression is null: the caller states whether it is required.
 *
 * A `scheme.elections.<key>` is typed by the scheme row, so a caller that holds the row passes
 * its declared `elections`: an undeclared key is refused, a declared one is typed. A caller that
 * does not (a datatype's own filter, a live field) checks the members and stops there, because a
 * value of a guessed type would refuse a well-typed rule; the scheme write compiles it fully.
 */
export function compileExpression(options: {
	readonly expression: string | null | undefined;
	readonly site: ExpressionSite;
	readonly type: ExpressionType;
	readonly elections?: readonly DeclaredKey[];
	/** The scheme's declared parts, each a root of the catalogue words: `ORDINARY.ALLOWANCES`. */
	readonly parts?: readonly string[];
}): string | null {
	const expression = (options.expression ?? '').trim();
	if (expression === '') return null;
	const context = withParts(EXPRESSION_CONTEXTS[options.site], options.parts ?? []);
	const memberFault = unknownMember(context, expression);
	if (memberFault != null) return memberFault;
	const electionMentions = openKeyMentions(expression, 'scheme.elections');
	if (electionMentions.length > 0 && options.elections == null) return null;
	const declared = new Set((options.elections ?? []).map((election) => election.key));
	for (const key of electionMentions)
		if (!declared.has(key))
			return (
				`The ${options.site} expression reads scheme.elections.${key}, which the scheme does not ` +
				'declare. Declare the election (its key and type) on the scheme first.'
			);
	const blank = openKeyBlank(context, expression, options.elections ?? []);
	let value: unknown;
	try {
		value = programFor(expression)(blank);
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

type AstNode = {
	readonly op: string;
	readonly args: unknown;
};

const isNode = (value: unknown): value is AstNode =>
	typeof value === 'object' && value != null && 'op' in value;

/**
 * The property chain of a member access, or null where the node is not one. Shared with
 * `mentions.ts`, which reads `produced.<code>` edges out of the same AST shape.
 */
export function memberChain(node: unknown): readonly string[] | null {
	if (!isNode(node)) return null;
	if (node.op === 'id' && typeof node.args === 'string') return [node.args];
	if (node.op !== '.' && node.op !== '.?') return null;
	const [object, property] = node.args as [unknown, unknown];
	if (typeof property !== 'string') return null;
	const chain = memberChain(object);
	return chain == null ? null : [...chain, property];
}

type AssessedOnMentions = {
	/** Every literal inside `code('X')`, in first-seen order. */
	readonly codes: readonly string[];
	/**
	 * Every catalogue word named, as written: `ALLOWANCES`, `ORDINARY.ALLOWANCES`,
	 * `year.CLAIMS`, `year.ADDITIONAL.ALLOWANCES`; in first-seen order.
	 */
	readonly words: readonly string[];
	/** Every `year.earned.<code>` member, in first-seen order. */
	readonly yearEarned: readonly string[];
	/** Every reserved line named as an identifier, in first-seen order. */
	readonly reserved: readonly string[];
};

const isCatalogueWord = (name: string): name is CatalogueWord =>
	(CATALOGUE_WORDS as readonly string[]).includes(name);
/** The reserved lines, read off the assessment site so the list cannot drift from it. */
const RESERVED_LINES = new Set(
	EXPRESSION_CONTEXTS.assessment.bare.filter((name) => !isCatalogueWord(name))
);

function stringsOf(node: unknown): string[] {
	if (!isNode(node)) return [];
	if (node.op === 'value' && typeof node.args === 'string') return [node.args];
	if (node.op === 'list') return (node.args as unknown[]).flatMap(stringsOf);
	return [];
}

function walkAssessedOn(
	node: unknown,
	mentions: AssessedOnMentions & {
		codes: string[];
		words: string[];
		yearEarned: string[];
		reserved: string[];
	}
): void {
	if (!isNode(node)) return;
	if (node.op === 'id' && typeof node.args === 'string' && RESERVED_LINES.has(node.args)) {
		if (!mentions.reserved.includes(node.args)) mentions.reserved.push(node.args);
	}
	if (node.op === 'id' && typeof node.args === 'string' && isCatalogueWord(node.args)) {
		if (!mentions.words.includes(node.args)) mentions.words.push(node.args);
	}
	if (node.op === 'call') {
		const [name, callArgs] = node.args as [unknown, unknown];
		const args = Array.isArray(callArgs) ? callArgs : [];
		if (name === 'code') {
			for (const literal of stringsOf(args[0]))
				if (!mentions.codes.includes(literal)) mentions.codes.push(literal);
		}
	}
	if (node.op === '.') {
		const chain = memberChain(node);
		if (chain != null && chain.length === 3 && chain[0] === 'year' && chain[1] === 'earned') {
			const code = chain[2]!;
			if (!mentions.yearEarned.includes(code)) mentions.yearEarned.push(code);
		}
		// `ORDINARY.ALLOWANCES`, `year.ALLOWANCES`, `year.ORDINARY.CLAIMS`: a chain ending in a
		// catalogue word is that word, part and year included. The walk below reaches the inner
		// `year.ORDINARY` chain too, which ends in no word and names nothing.
		const last = chain?.at(-1);
		if (chain != null && last != null && isCatalogueWord(last)) {
			const written = chain.join('.');
			if (!mentions.words.includes(written)) mentions.words.push(written);
			return;
		}
	}
	const args = Array.isArray(node.args) ? node.args : [node.args];
	for (const arg of args) {
		if (isNode(arg)) walkAssessedOn(arg, mentions);
		else if (Array.isArray(arg))
			for (const item of arg) if (isNode(item)) walkAssessedOn(item, mentions);
	}
}

/**
 * The version-bound literals one `assessed_on` formula names. Parsed by the same environment the
 * run evaluates with, so a formula that compiles here is read exactly as the engine reads it; a
 * malformed one is the compiler's to refuse, and declares nothing here.
 */
export function assessedOnMentions(expression: string): AssessedOnMentions {
	const mentions = {
		codes: [] as string[],
		words: [] as string[],
		yearEarned: [] as string[],
		reserved: [] as string[]
	};
	try {
		const ast = programFor(expression).ast;
		if (isNode(ast)) walkAssessedOn(ast, mentions as never);
	} catch {
		// A malformed expression is refused by `compileExpression`; here it simply names nothing.
	}
	return mentions;
}
