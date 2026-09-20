/**
 * Dependency edges between statutory schemes.
 *
 * A rule or an `assessed_on` formula names another scheme's result as
 * `produced.<code>.employee`, `produced.<code>.employee_this_period` or `produced.<code>.employer`. That mention is the whole dependency
 * declaration: there is no sequence column and no relief junction. The engine reads the mentions
 * out of the compiled expressions, orders the schemes so every producer runs before its consumer,
 * and refuses a loop.
 *
 * The mentions are read from the CEL AST, never from the raw source: a string literal that happens
 * to spell a mention is not one, and a mention inside a branch is one whether the branch runs or
 * not. The AST is cached per rules array, so a run parses each expression once however many
 * employees it charges.
 */

import { memberChain } from '../../../lib/expressions/compile.js';
import { programFor } from '../../../lib/expressions/evaluate.js';
import type { ContributionRule } from './configuration.js';

type AstNode = {
	readonly op: string;
	readonly args: unknown;
};

const isNode = (value: unknown): value is AstNode =>
	typeof value === 'object' && value != null && 'op' in value;

function walk(node: AstNode, mentions: string[]): void {
	if (node.op === '.' || node.op === '.?') {
		const path = memberChain(node);
		if (
			path != null &&
			path.length === 3 &&
			path[0] === 'produced' &&
			(path[2] === 'employee' ||
				path[2] === 'employee_this_period' ||
				path[2] === 'employer' ||
				path[2] === 'base') &&
			!mentions.includes(path[1]!)
		)
			mentions.push(path[1]!);
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

/** The scheme codes one standalone expression names, in first-mention order. */
export function producedMentionsOf(expression: string): readonly string[] {
	const mentions: string[] = [];
	mentionsIn(expression, mentions);
	return mentions;
}

const cache = new WeakMap<readonly ContributionRule[], readonly string[]>();

/**
 * The scheme codes one scheme's rules — and its `assessed_on` formula — name, in first-mention
 * order. The formula is read too: a base that reads `produced.<code>` is a dependency exactly as
 * a rule that reads it, and the ordered loop is what makes the read answerable.
 */
export function producedMentions(
	rules: readonly ContributionRule[],
	assessedOn?: string
): readonly string[] {
	let cached = cache.get(rules);
	if (cached == null) {
		const mentions: string[] = [];
		for (const rule of rules)
			for (const expression of [
				rule.when,
				rule.employee,
				rule.employer,
				rule.rebate ?? '0.0',
				rule.deduction ?? '0.0'
			])
				mentionsIn(expression, mentions);
		cached = mentions;
		cache.set(rules, cached);
	}
	if (assessedOn == null) return cached;
	const mentions = [...cached];
	mentionsIn(assessedOn, mentions);
	return mentions;
}

/**
 * Order schemes so every mentioned producer precedes its consumer; ties break by `code`, so the
 * order is deterministic. A mention of a code not in force refuses, as does a cycle.
 */
export function orderSchemes<
	T extends {
		readonly row: {
			readonly code: string;
			readonly rules: readonly ContributionRule[];
			readonly assessed_on?: string | null;
			readonly ordinary_on?: string | null;
			readonly elections?: readonly { readonly required_when?: string }[];
		};
	}
>(entries: readonly T[]): readonly T[] {
	const byCode = new Map(entries.map((entry) => [entry.row.code, entry]));
	const dependencies = new Map<string, ReadonlySet<string>>();
	for (const entry of entries) {
		const deps = [
			...producedMentions(entry.row.rules, entry.row.assessed_on ?? undefined),
			...producedMentionsOf(entry.row.ordinary_on ?? ''),
			...(entry.row.elections ?? []).flatMap((field) =>
				producedMentionsOf(field.required_when ?? '')
			)
		].filter((code) => code !== entry.row.code);
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
