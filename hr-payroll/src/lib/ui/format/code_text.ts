/** CEL expression formatting for seed output and expression field names for settings editors. */
import * as Predicate from 'effect/Predicate';
import { Result } from 'effect';
import { parse, type ASTNode } from '@marcbachmann/cel-js';
import { STATUTORY_FIELDS } from '../../payroll_engine/statutory_fields.js';

/** Expression fields derive from the same declaration tree the manifest compiles. */
const expressionFields = (value: unknown, fields: Set<string>): void => {
	if (!Predicate.isObject(value)) return;
	for (const [name, spec] of Object.entries(value)) {
		if (!Predicate.isObject(spec)) continue;
		if (spec['format'] === 'cel') fields.add(name);
		expressionFields(spec, fields);
	}
};
export const CEL_KEYS: ReadonlySet<string> = (() => {
	const fields = new Set<string>();
	for (const declaration of Object.values(STATUTORY_FIELDS)) expressionFields(declaration, fields);
	return fields;
})();
const WIDTH = 72;
const STEP = '  ';

const childrenOf = (node: ASTNode): readonly ASTNode[] => {
	switch (node.op) {
		case 'value':
		case 'id':
			return [];
		case '!_':
		case '-_':
			return [node.args];
		case '.':
		case '.?':
			return [node.args[0]];
		case 'call':
			return node.args[1];
		case 'rcall':
			return [node.args[1], ...node.args[2]];
		case 'map':
			return node.args.flatMap((entry) => entry);
		default:
			return node.args;
	}
};
// Gaps contain only punctuation, whitespace and comments; literals stay in their AST ranges.
const hasComment = (gap: string): boolean => gap.includes('//') || gap.includes('/*');
const flatGap = (gap: string): string =>
	hasComment(gap)
		? gap
		: gap
				.replace(/\s+/g, ' ')
				.replace(/([(\[{]) /g, '$1')
				.replace(/ ([)\]}])/g, '$1')
				.replace(/\s*,\s*/g, ', ')
				.replace(/\s*:\s*/g, ': ');
const BINARY = new Set([
	'&&',
	'||',
	'==',
	'!=',
	'<',
	'<=',
	'>',
	'>=',
	'in',
	'+',
	'-',
	'*',
	'/',
	'%'
]);
const operatorOf = (node: ASTNode, index: number): string | undefined =>
	index === 0
		? undefined
		: node.op === '?:'
			? index === 1
				? '?'
				: ':'
			: BINARY.has(node.op)
				? node.op
				: undefined;
const inlineGap = (gap: string, operator: string | undefined): string => {
	const text = flatGap(gap);
	if (operator === undefined || hasComment(gap)) return text;
	const at = text.indexOf(operator);
	return `${text.slice(0, at).trimEnd()} ${operator} ${text.slice(at + operator.length).trimStart()}`;
};
const columnAfter = (text: string, column: number): number => {
	const newline = text.lastIndexOf('\n');
	return newline < 0 ? column + text.length : text.length - newline - 1;
};
const breakAt = (gap: string, token: string, indent: string, after = false): string => {
	if (hasComment(gap)) return gap;
	const at = after ? gap.lastIndexOf(token) : gap.indexOf(token);
	if (at < 0) return flatGap(gap);
	const left = gap.slice(0, at).trimEnd();
	const right = gap.slice(at + token.length).trimStart();
	return after
		? `${left}${token}\n${indent}${right}`
		: // a word operator (`in`) keeps its space before the operand that follows
			`${left}\n${indent}${token}${right === '' ? (/\w$/.test(token) ? ' ' : '') : ' ' + right}`;
};

/** AST ranges retain literal bytes and parentheses; only inter-token whitespace is laid out. */
function layout(root: ASTNode, source: string): string {
	const flat = new WeakMap<ASTNode, string>();
	const inline = (node: ASTNode): string => {
		const cached = flat.get(node);
		if (cached !== undefined) return cached;
		if (node.op === 'value' || node.op === 'id') return source.slice(node.start, node.end);
		let text = '',
			end = node.start;
		for (const [index, child] of childrenOf(node).entries()) {
			text += inlineGap(source.slice(end, child.start), operatorOf(node, index)) + inline(child);
			end = child.end;
		}
		text += flatGap(source.slice(end, node.end));
		flat.set(node, text);
		return text;
	};
	const render = (node: ASTNode, indent: string, column: number): string => {
		const text = inline(node);
		if (!text.includes('\n') && text.length + column <= WIDTH) return text;
		if (node.op === 'value' || node.op === 'id') return text;
		const nested = indent + STEP;
		const grouped =
			node.op === 'call' || node.op === 'rcall' || node.op === 'list' || node.op === 'map';
		const open = node.op === 'list' ? '[' : node.op === 'map' ? '{' : '(';
		const close = node.op === 'list' ? ']' : node.op === 'map' ? '}' : ')';
		const children = childrenOf(node);
		let out = '',
			end = node.start,
			current = column;
		for (const [index, child] of children.entries()) {
			let gap = source.slice(end, child.start);
			const operator = operatorOf(node, index);
			const firstArgument = index === (node.op === 'rcall' ? 1 : 0);
			if (grouped && firstArgument) gap = breakAt(gap, open, nested, true);
			else if (grouped && index > 0) gap = breakAt(gap, ',', nested, true);
			else if (operator !== undefined)
				gap = breakAt(gap, operator, node.op === '?:' ? nested : indent);
			else gap = flatGap(gap);
			out += gap;
			current = columnAfter(gap, current);
			const childIndent = grouped && !(node.op === 'rcall' && index === 0) ? nested : indent;
			const value = render(child, node.op === '?:' && index > 0 ? nested : childIndent, current);
			out += value;
			current = columnAfter(value, current);
			end = child.end;
		}
		const suffix = source.slice(end, node.end);
		return (
			out + (grouped && children.length > 0 ? breakAt(suffix, close, indent) : flatGap(suffix))
		);
	};
	// The parser omits enclosing parentheses and comments from the root's range.
	const prefix = source.slice(0, root.start);
	return prefix + render(root, '', columnAfter(prefix, 0)) + source.slice(root.end);
}
/** An expression's meaning without its source offsets: two texts with the same key are the same CEL. */
function celKey(node: ASTNode): string {
	switch (node.op) {
		case 'value': {
			const value = node.args;
			return `value:${
				value instanceof Uint8Array
					? `bytes:${[...value].join(',')}`
					: Predicate.isBigInt(value)
						? `${value}n`
						: Predicate.isObject(value)
							? `uint:${String(value.value)}`
							: JSON.stringify(value)
			}`;
		}
		case 'id':
			return `id:${node.args}`;
		case '!_':
		case '-_':
			return `${node.op}(${celKey(node.args)})`;
		case '.':
		case '.?':
			return `${node.op}(${celKey(node.args[0])},${node.args[1]})`;
		case 'call':
			return `call:${node.args[0]}(${node.args[1].map(celKey).join(',')})`;
		case 'rcall':
			return `rcall:${node.args[0]}(${celKey(node.args[1])};${node.args[2].map(celKey).join(',')})`;
		case 'map':
			return `map(${node.args.map(([key, value]) => `${celKey(key)}=${celKey(value)}`).join(',')})`;
		default:
			return `${node.op}(${node.args.map(celKey).join(',')})`;
	}
}

/** CEL laid out over lines; the source unchanged when it does not parse or a layout would change its meaning. */
export function formatCel(source: string): string {
	return Result.getOrElse(
		Result.try(() => {
			const tree = parse(source).ast;
			const laid = layout(tree, source);
			return celKey(parse(laid).ast) === celKey(tree) ? laid : source;
		}),
		() => source
	);
}
