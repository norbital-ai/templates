/**
 * The CEL AST as the settings linter reads it: the tree the run evaluates (`programFor`), walked
 * generically. A node is `{ op, args }`; `args` is a node, a list, or (a macro's comprehension) an
 * object of nodes.
 */

import { serialize } from '@marcbachmann/cel-js';
import { memberChain } from '../expressions/compile.js';
import { programFor } from '../expressions/evaluate.js';
import * as Predicate from 'effect/Predicate';

export type Node = { readonly op: string; readonly args: unknown };

export const isNode = (value: unknown): value is Node =>
	Predicate.isObject(value) && !Array.isArray(value) && Predicate.isString((value as Node).op);

/** The parsed tree, or null where the expression does not parse (the compiler's to refuse). */
export function parse(expression: string): Node | null {
	try {
		const ast: unknown = programFor(expression).ast;
		return isNode(ast) ? ast : null;
	} catch {
		return null;
	}
}

/** A node's direct child nodes, whatever shape its `args` takes. */
export function children(node: Node): readonly Node[] {
	const out: Node[] = [];
	const visit = (value: unknown): void => {
		if (isNode(value)) out.push(value);
		else if (Array.isArray(value)) value.forEach(visit);
		else if (Predicate.isObject(value)) Object.values(value).forEach(visit);
	};
	visit(node.args);
	return out;
}

/** Every node of a tree, the root first. */
export function* nodes(root: Node): Generator<Node> {
	yield root;
	for (const child of children(root)) yield* nodes(child);
}

/** A member access's path (`person.terms.facts.x`), or null where the node is not one. */
export const chainOf = (node: Node): readonly string[] | null => memberChain(node);

/** Every maximal member path a tree reads: `a.b.c` once, never also `a.b`. */
export function chainsOf(root: Node): readonly (readonly string[])[] {
	const out: (readonly string[])[] = [];
	const visit = (node: Node): void => {
		const chain = node.op === 'id' || node.op === '.' || node.op === '.?' ? chainOf(node) : null;
		if (chain != null) out.push(chain);
		else children(node).forEach(visit);
	};
	visit(root);
	return out;
}

/** A literal's value (a negated number included), or undefined where the node is not a literal. */
export function literalOf(node: Node): unknown {
	if (node.op === 'value') return Predicate.isBigInt(node.args) ? Number(node.args) : node.args;
	if (node.op === '-_' && isNode(node.args)) {
		const inner = literalOf(node.args);
		return Predicate.isNumber(inner) ? -inner : undefined;
	}
	return undefined;
}

export const numberOf = (node: Node): number | null => {
	const value = literalOf(node);
	return Predicate.isNumber(value) ? value : null;
};

/** A call's function name, or null: `f(x)` and `x.f()` both. */
export const callName = (node: Node): string | null =>
	(node.op === 'call' || node.op === 'rcall') &&
	Array.isArray(node.args) &&
	Predicate.isString(node.args[0])
		? node.args[0]
		: null;

/** A call's argument nodes, the receiver excluded. */
export function callArgs(node: Node): readonly Node[] {
	const args = node.args as readonly unknown[];
	const list = node.op === 'call' ? args[1] : node.op === 'rcall' ? args[2] : null;
	return Array.isArray(list) ? list.filter(isNode) : [];
}

/** A node's canonical text, so two rules spelling one condition differently still compare equal. */
export function textOf(node: Node): string {
	try {
		return serialize(node as Parameters<typeof serialize>[0]);
	} catch {
		const source = node as {
			readonly input?: string;
			readonly start?: number;
			readonly end?: number;
		};
		return (source.input ?? '').slice(source.start ?? 0, source.end ?? 0);
	}
}
