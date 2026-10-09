/**
 * Code as people read it: a CEL expression broken over lines, a stored value as indented lines, and a line diff
 * of two such texts. The settings editors and the snapshot compare share them.
 */
import * as Predicate from 'effect/Predicate';

/** Fields whose text is a CEL expression, wherever they sit in a catalogue row or its json shapes. */
export const CEL_KEYS: ReadonlySet<string> = new Set([
	'eligibility',
	'qualifies_when',
	'pay_fraction',
	'days',
	'window_key',
	'carry_forward',
	'due',
	'population',
	'when',
	'amount',
	'quantity',
	'rate',
	'assessment',
	'employee',
	'employer',
	'contribution'
]);

type Node = string | { open: string; close: string; items: Node[] };
const PAIRS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const WIDTH = 72;
const STEP = '  ';

function parse(source: string): Node[] {
	const stack: { open: string; items: Node[] }[] = [{ open: '', items: [] }];
	const push = (node: Node) => stack[stack.length - 1]!.items.push(node);
	let i = 0;
	while (i < source.length) {
		const c = source[i]!;
		if (c === '"' || c === "'") {
			let j = i + 1;
			while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
			push(source.slice(i, j + 1));
			i = j + 1;
		} else if (/\s/.test(c)) {
			while (i < source.length && /\s/.test(source[i]!)) i += 1;
			push(' ');
		} else if (c in PAIRS) {
			stack.push({ open: c, items: [] });
			i += 1;
		} else if (stack.length > 1 && c === PAIRS[stack[stack.length - 1]!.open]) {
			const group = stack.pop()!;
			push({ open: group.open, close: c, items: group.items });
			i += 1;
		} else if (source.startsWith('&&', i) || source.startsWith('||', i)) {
			push(source.slice(i, i + 2));
			i += 2;
		} else {
			let j = i;
			while (j < source.length && !/[\s"'()[\]{},?:&|]/.test(source[j]!)) j += 1;
			if (j === i) j = i + 1;
			push(source.slice(i, j));
			i = j;
		}
	}
	// an unclosed group is malformed input: keep its text, unbroken
	while (stack.length > 1) {
		const group = stack.pop()!;
		push(group.open + group.items.map(flat).join(''));
	}
	return stack[0]!.items;
}

const flat = (node: Node): string =>
	Predicate.isString(node) ? node : node.open + node.items.map(flat).join('').trim() + node.close;

function group(node: Exclude<Node, string>, indent: string): string {
	const inline = flat(node);
	if (indent.length + inline.length <= WIDTH) return inline;
	const inner = indent + STEP;
	return `${node.open}\n${inner}${layout(node.items, inner, node.open)}\n${indent}${node.close}`;
}

/** Items that do not fit break after a top-level comma and before a top-level `&&`, `||`, `?` or `:`. */
function layout(items: readonly Node[], indent: string, open: string): string {
	const inline = items.map(flat).join('').trim();
	if (indent.length + inline.length <= WIDTH) return inline;
	const lines: string[] = [];
	let line = '';
	for (const item of items) {
		if (item === ',') {
			lines.push(`${line.trim()},`);
			line = '';
		} else if (item === '&&' || item === '||' || item === '?' || (item === ':' && open !== '{')) {
			lines.push(line.trim());
			line = item;
		} else line += Predicate.isString(item) ? item : group(item, indent);
	}
	lines.push(line.trim());
	return lines.filter((text) => text !== '').join(`\n${indent}`);
}

/** A CEL expression broken over indented lines where it does not fit; idempotent, and only whitespace changes. */
export function formatCel(source: string): string {
	return layout(parse(source), '', '');
}

/**
 * A stored value as indented `key: value` lines, keys sorted, CEL formatted and prose one sentence a line, so a
 * diff lands on the line that moved.
 */
export function valueLines(value: unknown, key = ''): string[] {
	if (value === null || value === undefined) return ['—'];
	if (!Predicate.isObjectOrArray(value)) {
		if (!Predicate.isString(value)) return [String(value)];
		if (CEL_KEYS.has(key)) return formatCel(value).split('\n');
		return value.split(/\n|(?<=[.;。；])\s+/);
	}
	const list = Array.isArray(value);
	const entries: [string, unknown, string][] = list
		? value.map((item): [string, unknown, string] => ['-', item, key])
		: Object.entries(value)
				.toSorted(([left], [right]) => left.localeCompare(right))
				.map(([name, item]): [string, unknown, string] => [`${name}:`, item, name]);
	if (entries.length === 0) return [list ? '[]' : '{}'];
	return entries.flatMap(([label, item, name]) => {
		const inner = valueLines(item, name);
		const scalar = !Predicate.isObjectOrArray(item);
		return scalar && inner.length === 1
			? [`${label} ${inner[0]}`]
			: [label, ...inner.map((text) => STEP + text)];
	});
}

export type DiffLine = { readonly kind: 'same' | 'removed' | 'added'; readonly text: string };

/** A line diff by longest common subsequence. */
export function lineDiff(left: readonly string[], right: readonly string[]): DiffLine[] {
	// ponytail: O(n·m) table; past ~4M cells it reports a whole replacement instead of a minimal diff
	if (left.length * right.length > 4_000_000)
		return [
			...left.map((text) => ({ kind: 'removed' as const, text })),
			...right.map((text) => ({ kind: 'added' as const, text }))
		];
	const n = left.length;
	const m = right.length;
	const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i -= 1)
		for (let j = m - 1; j >= 0; j -= 1)
			table[i]![j] =
				left[i] === right[j]
					? table[i + 1]![j + 1]! + 1
					: Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (left[i] === right[j]) {
			out.push({ kind: 'same', text: left[i]! });
			i += 1;
			j += 1;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!)
			out.push({ kind: 'removed', text: left[i++]! });
		else out.push({ kind: 'added', text: right[j++]! });
	}
	while (i < n) out.push({ kind: 'removed', text: left[i++]! });
	while (j < m) out.push({ kind: 'added', text: right[j++]! });
	return out;
}

/** The diff with runs of unchanged lines beyond `context` of a change folded into a count. */
export function foldDiff(
	lines: readonly DiffLine[],
	context = 3
): (DiffLine | { readonly kind: 'fold'; readonly count: number })[] {
	const near = lines.map((_, at) =>
		lines.slice(Math.max(0, at - context), at + context + 1).some((line) => line.kind !== 'same')
	);
	const out: (DiffLine | { kind: 'fold'; count: number })[] = [];
	for (const [at, line] of lines.entries()) {
		if (line.kind !== 'same' || near[at]) out.push(line);
		else {
			const last = out[out.length - 1];
			if (last?.kind === 'fold') last.count += 1;
			else out.push({ kind: 'fold', count: 1 });
		}
	}
	return out;
}
