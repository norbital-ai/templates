import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { parse, type ASTNode } from '@marcbachmann/cel-js';
import { Predicate } from 'effect';
import {
	celKey,
	foldDiff,
	formatCel,
	lineDiff,
	valueLines
} from '../src/lib/ui/format/code_text.ts';

/** Parser nodes own op/args and source locations; the legacy converter leaves nodes inside macro arrays. */
function semanticAst(node: ASTNode): unknown {
	const op = node.op;
	switch (node.op) {
		case 'value': {
			const value = node.args;
			return {
				op,
				args:
					value instanceof Uint8Array
						? value
						: Predicate.isObject(value)
							? { uint: value.value }
							: value
			};
		}
		case 'id':
			return { op, args: node.args };
		case '!_':
		case '-_':
			return { op, args: semanticAst(node.args) };
		case '.':
		case '.?':
			return { op, args: [semanticAst(node.args[0]), node.args[1]] };
		case 'call':
			return { op, args: [node.args[0], node.args[1].map(semanticAst)] };
		case 'rcall':
			return { op, args: [node.args[0], semanticAst(node.args[1]), node.args[2].map(semanticAst)] };
		case 'map':
			return { op, args: node.args.map(([key, value]) => [semanticAst(key), semanticAst(value)]) };
		default:
			return { op, args: node.args.map(semanticAst) };
	}
}

describe('code text', () => {
	it('formats CEL without changing anything but whitespace, idempotently', () => {
		const source =
			'has(terms.facts) && has(terms.facts.weekly_scheduled_days) && double(terms.facts.weekly_scheduled_days) <= 4.0 ? [[0.0, 1.0], [2.0, 3.0]][0][1] : size(bands.filter(b, service_months >= b.service_months)) > 0 ? "a, b ? c" : 0.0';
		const formatted = formatCel(source);
		assert.ok(formatted.includes('\n'));
		assert.ok(formatted.includes('"a, b ? c"'));
		assert.equal(formatCel(formatted), formatted);
		const squash = (text: string) => text.replace(/\s+/g, '');
		assert.equal(squash(formatted), squash(source));
		assert.equal(formatCel('base.assessed <= 50.0'), 'base.assessed <= 50.0');
	});

	it('keeps a word operator apart from its operand when a long expression breaks before it', () => {
		const source =
			'(company.region in rules.regions.by_region) ? (("monthly" in rules.regions.by_region[company.region].high_temperature) ? double(rules.regions.by_region[company.region].high_temperature.monthly) : 0.0) : 0.0';
		const formatted = formatCel(source);
		assert.ok(formatted.includes('\n'));
		assert.ok(
			!/in[a-z]/.test(formatted.replace(/\bin[a-z_]*/g, (word) => (word === 'in' ? 'in' : '')))
		);
		assert.equal(celKey(parse(formatted).ast), celKey(parse(source).ast));
	});

	it('lays out nested calls, lists, maps, indexing and operators without rewriting tokens', () => {
		const source =
			'((sum(items.filter(item, item.amount >= 0.1234567890123456789 && item.name == "a  b ? c, d").map(item, {"label": "a  b ? c, d", "amount": item.amount * 0.1234567890123456789, "bands": [item.amount, item.amount + 10.0, item.amount + 20.0, item.amount + 30.0]}))[0] + sum([100.0, 200.0, 300.0])) / -(1.0 + totals.adjustment))';
		const formatted = formatCel(source);
		assert.ok(formatted.includes('sum(\n'));
		assert.ok(formatted.includes('.filter(\n'));
		assert.ok(formatted.includes('.map(\n'));
		assert.ok(formatted.includes('{\n'));
		assert.ok(formatted.includes('[\n'));
		assert.ok(formatted.includes('"a  b ? c, d"'));
		assert.ok(formatted.includes('0.1234567890123456789'));
		assert.equal(formatCel(formatted), formatted);
		assert.deepEqual(semanticAst(parse(formatted).ast), semanticAst(parse(source).ast));
		assert.equal(formatted.replace(/\s+/g, ''), source.replace(/\s+/g, ''));
	});

	it('retains comments, quoted whitespace and enclosing parentheses', () => {
		const source =
			'// leading  comment\n((items.filter(item, // keep  this ? : , comment\nitem.name == "a  b // c" && item.amount > 0.1234567890123456789).map(item, {"amount": item.amount, "name": item.name}))) // trailing  comment';
		const formatted = formatCel(source);
		assert.ok(formatted.startsWith('// leading  comment\n(('));
		assert.ok(formatted.includes('// keep  this ? : , comment\n'));
		assert.ok(formatted.includes('"a  b // c"'));
		assert.ok(formatted.endsWith('))) // trailing  comment'));
		assert.equal(formatCel(formatted), formatted);
		assert.deepEqual(semanticAst(parse(formatted).ast), semanticAst(parse(source).ast));
	});

	it('semantic comparison retains operators, macro arguments, map keys, order and literal types', () => {
		for (const [left, right] of [
			['items.filter(i, i.amount > 1)', 'items.filter(i, i.amount >= 1)'],
			['{"start": 1, "end": 2}', '{"start": 2, "end": 1}'],
			['[1, 2]', '[2, 1]'],
			['1u', '2u'],
			['1', '1u'],
			['b"a"', 'b"b"'],
			['"1"', '1']
		] as const)
			assert.notDeepEqual(semanticAst(parse(left).ast), semanticAst(parse(right).ast));
	});

	it('leaves unfinished expressions available for editing', () => {
		const source = 'items.filter(item, item.amount >';
		assert.equal(formatCel(source), source);
	});

	it('diffs lines and folds unchanged runs', () => {
		const left = valueLines({ code: 'AL', bands: [{ days: 14 }], name: 'Annual' });
		const right = valueLines({ code: 'AL', bands: [{ days: 16 }], name: 'Annual' });
		const diff = lineDiff(left, right);
		assert.deepEqual(
			diff.filter((line) => line.kind !== 'same').map((line) => `${line.kind} ${line.text}`),
			['removed     days: 14', 'added     days: 16']
		);
		const long = Array.from({ length: 20 }, (_, at) => `line ${at}`);
		const folded = foldDiff(lineDiff(long, [...long.slice(0, 19), 'changed']), 2);
		assert.deepEqual(folded[0], { kind: 'fold', count: 17 });
	});
});
