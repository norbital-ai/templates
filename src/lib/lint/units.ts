/**
 * Units of a stored expression, inferred from its tree: money, a percent, a fraction, a date, a
 * code of one table. The linter judges what the tree says, not what a run would compute, so a
 * member it cannot place is `unknown` and never refused: only a definite clash is reported —
 * money times a percent never divided by 100, money added to a fraction, a date in arithmetic or
 * compared with a number, a code compared with a value its table does not carry, a table keyed by
 * a code of another table.
 */

import { callArgs, callName, chainOf, children, isNode, literalOf, type Node } from './ast.js';
import * as Predicate from 'effect/Predicate';

export type Dim = 'money' | 'ratio' | 'date' | 'text' | 'bool' | 'count' | 'unknown';

/**
 * `pct` counts the factors of a hundred still to divide out: a percent is `ratio` with 1, a
 * fraction `ratio` with 0, and money times a percent is `money` with 1 until `/ 100` brings it
 * back to 0. `table` marks a code of that table; `literal` a literal's own value.
 */
export type Unit = {
	readonly dim: Dim;
	readonly pct: number;
	readonly table?: string | undefined;
	readonly literal?: unknown;
};

export type UnitEnv = {
	/** A member path's unit, or null where the version and the contexts do not say. */
	readonly member: (chain: readonly string[]) => Unit | null;
	/** A declared table column's unit (`code` is a code of the table itself). */
	readonly column: (table: string, column: string) => Unit | null;
	/** Per key a lookup passes, the table whose code it must be, or null where the key is not a code. */
	readonly keyTables: (table: string) => readonly (string | null)[] | null;
	/** The codes a table's rows carry in this version, or null where it carries none to judge by. */
	readonly codes: (table: string) => ReadonlySet<string> | null;
	readonly report: (rule: 'type' | 'code', message: string) => void;
};

const unit = (dim: Dim, pct = 0): Unit => ({ dim, pct });
const UNKNOWN: Unit = unit('unknown');
const COUNT: Unit = unit('count');
const BOOL: Unit = unit('bool');
export const MONEY: Unit = unit('money');
export const DATE: Unit = unit('date');
export const PERCENT: Unit = unit('ratio', 1);
export const FRACTION: Unit = unit('ratio');

/** Functions whose value is the unit of their first argument. */
const PASS_THROUGH = new Set(['round', 'abs', 'double', 'int']);
/** Functions that return a calendar day. */
const DATE_FUNCTIONS = new Set(['add_days', 'add_months', 'month_end', 'birthday']);
const TABLE_FUNCTIONS = new Set(['table', 'band', 'bands']);
const COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function describeUnit(value: Unit): string {
	if (value.dim === 'money')
		return value.pct === 0
			? 'money'
			: value.pct > 0
				? 'money times a percent'
				: 'money divided by a percent';
	if (value.dim === 'ratio') return value.pct === 0 ? 'a fraction' : 'a percent';
	if (value.dim === 'date') return 'a date';
	if (value.table != null) return `a ${value.table} code`;
	return value.dim === 'text' ? 'text' : value.dim === 'bool' ? 'a boolean' : 'a number';
}

const definite = (value: Unit) => value.dim !== 'unknown' && value.dim !== 'count';
const quantity = (value: Unit) => value.dim === 'money' || value.dim === 'ratio';

/** One unit for two values that must agree (min/max arguments, ternary branches, a sum). */
function join(env: UnitEnv, what: string, left: Unit, right: Unit): Unit {
	if (definite(left) && definite(right)) {
		if (quantity(left) && quantity(right) && (left.dim !== right.dim || left.pct !== right.pct))
			env.report('type', `${what} mixes ${describeUnit(left)} with ${describeUnit(right)}.`);
		return left;
	}
	if (definite(left)) return left;
	if (definite(right)) return right;
	return left.dim === 'count' && right.dim === 'count' ? COUNT : UNKNOWN;
}

function times(env: UnitEnv, left: Unit, right: Unit): Unit {
	if (left.dim === 'date' || right.dim === 'date') {
		env.report('type', 'A date is multiplied or divided; a date is not a number.');
		return UNKNOWN;
	}
	if (left.dim === 'money' && right.dim === 'money') {
		env.report('type', 'Money is multiplied by money.');
		return MONEY;
	}
	const money = left.dim === 'money' ? left : right.dim === 'money' ? right : null;
	const other = money === left ? right : left;
	if (money != null) return unit('money', money.pct + (other.dim === 'ratio' ? other.pct : 0));
	if (left.dim === 'ratio' || right.dim === 'ratio')
		return unit(
			'ratio',
			(left.dim === 'ratio' ? left.pct : 0) + (right.dim === 'ratio' ? right.pct : 0)
		);
	return left.dim === 'count' && right.dim === 'count' ? COUNT : UNKNOWN;
}

function divided(env: UnitEnv, left: Unit, right: Unit): Unit {
	if (left.dim === 'date' || right.dim === 'date') {
		env.report('type', 'A date is multiplied or divided; a date is not a number.');
		return UNKNOWN;
	}
	if (right.literal === 100 && (left.dim === 'money' || left.dim === 'ratio') && left.pct > 0)
		return { dim: left.dim, pct: left.pct - 1 };
	if (left.dim === 'money' && right.dim === 'money') return COUNT;
	if (left.dim === 'money')
		return unit('money', left.pct - (right.dim === 'ratio' ? right.pct : 0));
	if (left.dim === 'ratio') return unit('ratio', left.pct);
	return left.dim === 'count' && right.dim === 'count' ? COUNT : UNKNOWN;
}

function added(env: UnitEnv, op: string, left: Unit, right: Unit): Unit {
	if (left.dim === 'text' || right.dim === 'text') return unit('text');
	if (left.dim === 'date' || right.dim === 'date') {
		if (left.dim !== 'unknown' && right.dim !== 'unknown')
			env.report('type', `A date is used in \`${op}\`; step a day with add_days(date, n).`);
		return UNKNOWN;
	}
	return join(env, `\`${op}\``, left, right);
}

/** A code value compared with a literal: the literal must be one of its table's codes. */
function codeLiteral(env: UnitEnv, code: Unit, other: Unit): void {
	if (code.table == null || !Predicate.isString(other.literal) || other.literal === '') return;
	const codes = env.codes(code.table);
	if (codes != null && !codes.has(other.literal))
		env.report('code', `${other.literal} is not a code of table ${code.table}.`);
}

function compared(env: UnitEnv, op: string, left: Unit, right: Unit): void {
	codeLiteral(env, left, right);
	codeLiteral(env, right, left);
	for (const [date, other] of [
		[left, right],
		[right, left]
	] as const) {
		if (date.dim !== 'date') continue;
		if (other.dim === 'money' || other.dim === 'ratio' || Predicate.isNumber(other.literal))
			env.report('type', `A date is compared (\`${op}\`) with ${describeUnit(other)}.`);
		if (Predicate.isString(other.literal) && other.literal !== '' && !ISO_DAY.test(other.literal))
			env.report(
				'type',
				`A date is compared with "${other.literal}", which is not a YYYY-MM-DD day.`
			);
	}
	if (quantity(left) && quantity(right) && (left.dim !== right.dim || left.pct !== right.pct))
		env.report('type', `\`${op}\` compares ${describeUnit(left)} with ${describeUnit(right)}.`);
}

/** A lookup's keys: each must be a code of the table its declaration keys it by. */
function lookup(env: UnitEnv, name: string, node: Node, args: readonly Unit[]): void {
	const expected = env.keyTables(name);
	if (expected == null) return;
	const keys = callName(node) === 'band' ? args.slice(2) : args.slice(1);
	keys.forEach((key, index) => {
		const table = expected[index];
		if (table == null) return;
		if (key.table != null && key.table !== table)
			env.report(
				'code',
				`${callName(node)}('${name}') is keyed by a ${table} code; this passes a ${key.table} code.`
			);
		codeLiteral(env, { ...UNKNOWN, table }, key);
	});
}

/** The unit of one node, reporting every definite clash beneath it once. */
export function unitOf(env: UnitEnv, node: Node): Unit {
	const { op } = node;
	if (op === 'value') {
		const value = literalOf(node);
		if (Predicate.isNumber(value)) return { ...COUNT, literal: value };
		if (Predicate.isString(value)) return { dim: 'text', pct: 0, literal: value };
		return Predicate.isBoolean(value) ? BOOL : UNKNOWN;
	}
	if (op === 'id' || op === '.' || op === '.?') {
		const chain = chainOf(node);
		if (chain != null) return env.member(chain) ?? UNKNOWN;
		const [object, column] = node.args as readonly [unknown, unknown];
		if (isNode(object)) {
			unitOf(env, object);
			const fn = callName(object);
			const name = literalOf(callArgs(object)[0] ?? object);
			if (
				fn != null &&
				TABLE_FUNCTIONS.has(fn) &&
				Predicate.isString(name) &&
				Predicate.isString(column)
			)
				return env.column(name, column) ?? UNKNOWN;
		}
		return UNKNOWN;
	}
	if (op === 'call' || op === 'rcall') {
		const name = callName(node) ?? '';
		const args = callArgs(node).map((arg) => unitOf(env, arg));
		if (op === 'rcall') {
			const receiver = (node.args as readonly unknown[])[1];
			if (isNode(receiver)) unitOf(env, receiver);
		}
		if (TABLE_FUNCTIONS.has(name)) {
			const table = literalOf(callArgs(node)[0] ?? node);
			if (Predicate.isString(table)) lookup(env, table, node, args);
			return UNKNOWN;
		}
		if (name === 'code') return MONEY;
		if (DATE_FUNCTIONS.has(name)) return DATE;
		if (PASS_THROUGH.has(name)) return args[0] ?? UNKNOWN;
		if (name === 'min' || name === 'max')
			return args.reduce((left, right) => join(env, `${name}()`, left, right), args[0] ?? UNKNOWN);
		return UNKNOWN;
	}
	const parts = children(node);
	// `x * part / whole` reads left to right: money times money is a share of money once divided by
	// money, so the product is judged with its divisor.
	if (op === '/' && parts[0]?.op === '*') {
		const [a = UNKNOWN, b = UNKNOWN] = children(parts[0]).map((part) => unitOf(env, part));
		const by = parts[1] == null ? UNKNOWN : unitOf(env, parts[1]);
		if (a.dim === 'money' && b.dim === 'money' && by.dim === 'money')
			return unit('money', a.pct + b.pct - by.pct);
		return divided(env, times(env, a, b), by);
	}
	if (op === '?:') {
		const [condition, yes, no] = parts;
		if (condition != null) unitOf(env, condition);
		return join(
			env,
			'A `? :`',
			yes == null ? UNKNOWN : unitOf(env, yes),
			no == null ? UNKNOWN : unitOf(env, no)
		);
	}
	const units = parts.map((part) => unitOf(env, part));
	const [left = UNKNOWN, right = UNKNOWN] = units;
	if (op === '*') return times(env, left, right);
	if (op === '/') return divided(env, left, right);
	if (op === '%') return left;
	if (op === '+' || op === '-') return added(env, op, left, right);
	if (op === '-_') return left;
	if (COMPARISONS.has(op)) {
		compared(env, op, left, right);
		return BOOL;
	}
	if (op === 'in') {
		const list = parts[1];
		if (list != null && list.op === 'list')
			for (const item of children(list))
				codeLiteral(env, left, { ...UNKNOWN, literal: literalOf(item) });
		return BOOL;
	}
	if (op === '&&' || op === '||' || op === '!_') return BOOL;
	return UNKNOWN;
}
