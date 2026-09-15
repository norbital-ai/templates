/**
 * Dependency edges between statutory schemes (RFC 0002).
 *
 * A rule names another scheme's result as `produced.<code>.employee` or
 * `produced.<code>.employer`. That mention is the whole dependency declaration: there is no
 * sequence column and no relief junction. The engine reads the mentions out of the compiled rule
 * expressions, orders the schemes so every producer runs before its consumers, and refuses a loop.
 *
 * The mentions are read from the CEL AST, never from the raw source: a string literal that happens
 * to spell a mention is not one, and a mention inside a branch is one whether the branch runs or
 * not. The AST is cached per rules array, so a run parses each expression once however many
 * employees it charges.
 */

import { programFor } from '../../../lib/expressions/evaluate.js';
import type { ContributionRule } from './configuration.js';

type AstNode = {
	readonly op: string;
	readonly args: unknown;
};

const isNode = (value: unknown): value is AstNode =>
	typeof value === 'object' && value != null && 'op' in value;

/** The property chain of a member access, or null where the node is not one. */
function memberChain(node: unknown): readonly string[] | null {
	if (!isNode(node)) return null;
	if (node.op === 'id' && typeof node.args === 'string') return [node.args];
	if (node.op !== '.' && node.op !== '.?') return null;
	const [object, property] = node.args as [unknown, unknown];
	if (typeof property !== 'string') return null;
	const chain = memberChain(object);
	return chain == null ? null : [...chain, property];
}

function walk(node: AstNode, mentions: string[]): void {
	if (node.op === '.' || node.op === '.?') {
		const [object, property] = node.args as [unknown, unknown];
		if (property === 'employee' || property === 'employer') {
			const chain = memberChain(object);
			const code = chain != null && chain.length === 2 && chain[0] === 'produced' ? chain[1] : null;
			if (code != null && !mentions.includes(code)) mentions.push(code);
		}
	}
	const args = Array.isArray(node.args) ? node.args : [node.args];
	for (const arg of args) {
		if (isNode(arg)) walk(arg, mentions);
		else if (Array.isArray(arg)) for (const item of arg) if (isNode(item)) walk(item, mentions);
	}
}

/** The codes one expression mentions, appended to `mentions` in first-seen order. */
function mentionsIn(expression: string, mentions: string[]): void {
	// No `produced.` in the text, no mention in the tree: a band ladder is tens of thousands of
	// expressions that name no scheme, and parsing each to prove it cost more than the payroll.
	// The text test only skips; whatever it lets through is still judged by the AST.
	if (!expression.includes('produced.')) return;
	let ast: unknown;
	try {
		// The same compiled environment the run evaluates with: parsed once, read here first.
		ast = programFor(expression).ast;
	} catch {
		// A malformed expression is the compiler's to refuse; here it simply declares no edge.
		return;
	}
	if (isNode(ast)) walk(ast, mentions);
}

const cache = new WeakMap<readonly ContributionRule[], readonly string[]>();

/** The scheme codes one scheme's rules name, in first-mention order. */
export function producedMentions(rules: readonly ContributionRule[]): readonly string[] {
	const cached = cache.get(rules);
	if (cached != null) return cached;
	const mentions: string[] = [];
	for (const rule of rules)
		for (const expression of [rule.when, rule.employee, rule.employer])
			mentionsIn(expression, mentions);
	cache.set(rules, mentions);
	return mentions;
}

/**
 * Order schemes so every mentioned producer precedes its consumer; ties break by `code`, so the
 * order is deterministic. A mention of a code not in force refuses, as does a cycle.
 */
export function orderSchemes<
	T extends {
		readonly row: { readonly code: string; readonly rules: readonly ContributionRule[] };
	}
>(entries: readonly T[]): readonly T[] {
	const byCode = new Map(entries.map((entry) => [entry.row.code, entry]));
	const dependencies = new Map<string, ReadonlySet<string>>();
	for (const entry of entries) {
		const deps = producedMentions(entry.row.rules).filter((code) => code !== entry.row.code);
		for (const code of deps)
			if (!byCode.has(code))
				throw new Error(
					`${entry.row.code} names produced.${code}, but ${code} is not a statutory scheme in this version.`
				);
		dependencies.set(entry.row.code, new Set(deps));
	}
	const ordered: T[] = [];
	const done = new Set<string>();
	const remaining = new Set(byCode.keys());
	while (remaining.size > 0) {
		const ready = [...remaining]
			.filter((code) => [...dependencies.get(code)!].every((dependency) => done.has(dependency)))
			.toSorted();
		if (ready.length === 0)
			throw new Error(
				`Statutory schemes form a dependency loop: ${[...remaining].toSorted().join(' → ')}.`
			);
		for (const code of ready) {
			ordered.push(byCode.get(code)!);
			remaining.delete(code);
			done.add(code);
		}
	}
	return ordered;
}
