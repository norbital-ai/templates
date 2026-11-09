import {
	elapsedMinutes,
	intervalMinutes,
	clockWindowMinutes,
	dateWeekday,
	addWorkingDays,
	addMinutes
} from './time_evidence.js';
import { parse, type AnyNode, type Pattern, type Program } from 'acorn';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import { sha256Hex } from '@norbital-ai/std/hash';
import { addDays, addMonths, datePeriod, days, isPlainDate, monthOf } from '@norbital-ai/std/date';
import { PHASE_ROOTS, type Phase } from './contracts.js';
import {
	completedMonths,
	getErrorMessage,
	isDynObject,
	Refusal,
	stableJson
} from './foundation.js';
import { decimal } from './money.js';

const callable = Symbol('payroll expression callable');
interface FunctionValue {
	readonly [callable]: true;
	readonly invoke: (args: readonly unknown[]) => unknown;
}
const fn = (invoke: FunctionValue['invoke']): FunctionValue => ({ [callable]: true, invoke });
const isFunction = (v: unknown): v is FunctionValue => isDynObject(v) && callable in v;
const bad = (message: string): never => {
	throw new Refusal({ message });
};
const numeric = (v: unknown): number =>
	v instanceof Decimal
		? v.toNumber()
		: typeof v === 'number' && Number.isFinite(v)
			? v
			: bad('Expected an actual finite number.');
const exact = (v: unknown): Decimal => (v instanceof Decimal ? v : decimal(numeric(v)));
const numericValue = (v: unknown): boolean =>
	v instanceof Decimal || (typeof v === 'number' && Number.isFinite(v));
const compare = (a: unknown, b: unknown): number =>
	numericValue(a) && numericValue(b)
		? exact(a).cmp(exact(b))
		: (numericValue(a) || a === Infinity || a === -Infinity) &&
			  (numericValue(b) || b === Infinity || b === -Infinity)
			? a === b
				? 0
				: a === Infinity || b === -Infinity
					? 1
					: -1
			: bad('Expected comparable numeric bounds.');
const truth = (v: unknown): boolean => (v instanceof Decimal ? !v.isZero() : Boolean(v));
const materialise = (v: unknown): unknown =>
	v instanceof Decimal
		? v.toNumber()
		: Array.isArray(v)
			? v.map(materialise)
			: isDynObject(v) && !isFunction(v)
				? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, materialise(x)]))
				: v;
const text = (v: unknown): string => (typeof v === 'string' ? v : bad('Expected actual text.'));
const list = (v: unknown): readonly unknown[] =>
	Array.isArray(v) ? v : bad('Expected an actual array.');
const object = (v: unknown): Record<string, unknown> =>
	isDynObject(v) ? v : bad('Expected an actual record.');
const periodEnd = (value: unknown): string | null => {
	if (typeof value === 'string') {
		const inner = value.startsWith('[') && value.endsWith(')') ? value.slice(1, -1) : value;
		const comma = inner.indexOf(',');
		const end = comma < 0 ? '' : inner.slice(comma + 1);
		return end === '' ? null : end;
	}
	if (isDynObject(value) && typeof value.to === 'string' && value.to !== '') return value.to;
	return null;
};

const date = (v: unknown): string => {
	const value = text(v);
	return isPlainDate(value) ? value : bad('Expected an actual ISO calendar date.');
};
const blocked = new Set(['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments']);
const property = (v: unknown, key: string): unknown => {
	if (blocked.has(key)) return bad(`Property ${key} is unavailable.`);
	if (Array.isArray(v) || typeof v === 'string') {
		if (key === 'length') return v.length;
		if (/^\d+$/.test(key)) return v[Number(key)];
	}
	if (isDynObject(v) && Object.hasOwn(v, key)) return v[key];
	return bad(`Missing or unavailable field ${key}.`);
};
const path = (v: unknown, key: string, fallback: unknown): unknown => {
	let value = v;
	for (const part of key.split('.')) {
		if (blocked.has(part)) return bad('Unsafe property path.');
		if (!isDynObject(value) || !Object.hasOwn(value, part)) return fallback;
		value = value[part];
	}
	return value;
};
const binary = (op: string, a: unknown, b: unknown): unknown => {
	switch (op) {
		case '+':
			return typeof a === 'string' || typeof b === 'string'
				? String(a) + String(b)
				: exact(a).plus(exact(b));
		case '-':
			return exact(a).minus(exact(b));
		case '*':
			return exact(a).times(exact(b));
		case '/':
			if (numeric(b) === 0) return bad('Division by zero.');
			return exact(a).div(exact(b), 24);
		case '%':
			return numeric(a) % numeric(b);
		case '**':
			return numeric(a) ** numeric(b);
		case '===':
			return numericValue(a) && numericValue(b) ? exact(a).eq(exact(b)) : a === b;
		case '!==':
			return numericValue(a) && numericValue(b) ? !exact(a).eq(exact(b)) : a !== b;
		case '==':
			return binary('===', a, b) || (a == null && b == null);
		case '!=':
			return !(binary('===', a, b) || (a == null && b == null));
		case '<':
			return typeof a === 'string' && typeof b === 'string' ? a < b : compare(a, b) < 0;
		case '<=':
			return typeof a === 'string' && typeof b === 'string' ? a <= b : compare(a, b) <= 0;
		case '>':
			return typeof a === 'string' && typeof b === 'string' ? a > b : compare(a, b) > 0;
		case '>=':
			return typeof a === 'string' && typeof b === 'string' ? a >= b : compare(a, b) >= 0;
		default:
			return bad(`Operator ${op} is unavailable.`);
	}
};
class Environment {
	readonly values = new Map<string, { value: unknown; constant: boolean }>();
	constructor(readonly parent?: Environment) {}
	get(name: string): unknown {
		const item = this.values.get(name);
		return item !== undefined
			? item.value
			: this.parent !== undefined
				? this.parent.get(name)
				: bad(`Unbound reference ${name}.`);
	}
	set(name: string, value: unknown): unknown {
		const item = this.values.get(name);
		if (item === undefined)
			return this.parent === undefined
				? bad(`Unbound local ${name}.`)
				: this.parent.set(name, value);
		if (item.constant) return bad(`Cannot assign constant ${name}.`);
		item.value = value;
		return value;
	}
	declare(name: string, value: unknown, constant: boolean): void {
		if (this.values.has(name)) bad(`Duplicate binding ${name}.`);
		this.values.set(name, { value, constant });
	}
}
class Returned {
	constructor(readonly value: unknown) {}
}
const BREAK = Symbol('break'),
	CONTINUE = Symbol('continue');
class Interpreter {
	steps = 0;
	tick(): void {
		if (++this.steps > 50000) bad('Expression exceeded its 50,000 operation limit.');
	}
	bind(pattern: Pattern, value: unknown, env: Environment, constant: boolean): void {
		this.tick();
		switch (pattern.type) {
			case 'Identifier':
				env.declare(pattern.name, value, constant);
				return;
			case 'AssignmentPattern':
				this.bind(
					pattern.left,
					value === undefined ? this.eval(pattern.right, env) : value,
					env,
					constant
				);
				return;
			case 'ObjectPattern':
				for (const p of pattern.properties) {
					if (p.type === 'RestElement') bad('Object rest binding is unavailable.');
					else {
						const key =
							p.key.type === 'Identifier' && !p.computed
								? p.key.name
								: String(this.eval(p.key, env));
						this.bind(p.value, property(value, key), env, constant);
					}
				}
				return;
			case 'ArrayPattern': {
				const values = list(value);
				pattern.elements.forEach((p, i) => {
					if (p !== null)
						this.bind(p, p.type === 'RestElement' ? values.slice(i) : values[i], env, constant);
				});
				return;
			}
			case 'RestElement':
				this.bind(pattern.argument, value, env, constant);
				return;
			default:
				bad('Unsupported local binding.');
		}
	}
	call(value: unknown, args: readonly unknown[]): unknown {
		this.tick();
		return isFunction(value)
			? value.invoke(args)
			: bad('Only declared pure functions can be called.');
	}
	method(value: unknown, key: string, args: readonly unknown[]): unknown {
		this.tick();
		if (blocked.has(key)) return bad(`Method ${key} is unavailable.`);
		if (Array.isArray(value)) {
			const callback = (v: unknown, i: number) => this.call(args[0], [v, i, value]);
			switch (key) {
				case 'map':
					return value.map(callback);
				case 'filter':
					return value.filter((v, i) => truth(callback(v, i)));
				case 'flatMap':
					return value.flatMap(callback);
				case 'find':
					return value.find((v, i) => truth(callback(v, i)));
				case 'findIndex':
					return value.findIndex((v, i) => truth(callback(v, i)));
				case 'some':
					return value.some((v, i) => truth(callback(v, i)));
				case 'every':
					return value.every((v, i) => truth(callback(v, i)));
				case 'reduce':
					if (args.length < 2) bad('Reduce requires an explicit initial value.');
					return value.reduce((a, v, i) => this.call(args[0], [a, v, i, value]), args[1]);
				case 'includes':
					return value.some((v) => binary('===', v, args[0]) === true);
				case 'indexOf':
					return value.findIndex((v) => binary('===', v, args[0]) === true);
				case 'join':
					return value.join(args[0] === undefined ? ',' : text(args[0]));
				case 'slice':
					return value.slice(
						args[0] === undefined ? 0 : numeric(args[0]),
						args[1] === undefined ? undefined : numeric(args[1])
					);
				case 'at':
					return value.at(numeric(args[0]));
				case 'concat':
					return value.concat(...args);
				case 'flat':
					return value.flat(args[0] === undefined ? 1 : Math.min(8, numeric(args[0])));
				case 'toSorted':
					return value.toSorted((a, b) =>
						args[0] === undefined
							? String(a).localeCompare(String(b))
							: numeric(this.call(args[0], [a, b]))
					);
			}
		}
		if (numericValue(value)) {
			if (key === 'toString' && (args.length === 0 || args[0] === 10))
				return exact(value).toString();
			if (key === 'toFixed') {
				const scale = args[0] === undefined ? 0 : numeric(args[0]);
				if (!Number.isInteger(scale) || scale < 0 || scale > 12)
					bad('Fixed decimal formatting supports 0–12 places.');
				const [whole, fraction = ''] = exact(value).round(scale, 'halfUp').toString().split('.');
				return scale === 0 ? whole : `${whole}.${fraction.padEnd(scale, '0')}`;
			}
		}
		if (typeof value === 'string') {
			switch (key) {
				case 'substring':
					return value.substring(
						numeric(args[0]),
						args[1] === undefined ? undefined : numeric(args[1])
					);
				case 'slice':
					return value.slice(
						numeric(args[0]),
						args[1] === undefined ? undefined : numeric(args[1])
					);
				case 'split':
					return value.split(text(args[0]));
				case 'trim':
					return value.trim();
				case 'toUpperCase':
					return value.toUpperCase();
				case 'toLowerCase':
					return value.toLowerCase();
				case 'includes':
					return value.includes(text(args[0]));
				case 'startsWith':
					return value.startsWith(text(args[0]));
				case 'endsWith':
					return value.endsWith(text(args[0]));
				case 'padStart':
					return value.padStart(
						Math.min(10000, numeric(args[0])),
						args[1] === undefined ? ' ' : text(args[1])
					);
				case 'replaceAll':
					return value.replaceAll(text(args[0]), text(args[1]));
			}
		}
		return this.call(property(value, key), args);
	}
	eval(node: AnyNode, env: Environment): unknown {
		this.tick();
		switch (node.type) {
			case 'Literal':
				if (node.regex !== undefined || node.bigint !== undefined)
					bad('Regular expression and bigint literals are unavailable.');
				return node.value;
			case 'Identifier':
				return env.get(node.name);
			case 'Program':
			case 'BlockStatement': {
				const local = node.type === 'Program' ? env : new Environment(env);
				for (const n of node.body) {
					const result = this.eval(n, local);
					if (result instanceof Returned || result === BREAK || result === CONTINUE) return result;
				}
				return undefined;
			}
			case 'EmptyStatement':
				return undefined;
			case 'ExpressionStatement':
				return this.eval(node.expression, env);
			case 'ReturnStatement':
				return new Returned(node.argument == null ? undefined : this.eval(node.argument, env));
			case 'VariableDeclaration':
				for (const item of node.declarations)
					this.bind(
						item.id,
						item.init == null ? undefined : this.eval(item.init, env),
						env,
						node.kind === 'const'
					);
				return undefined;
			case 'IfStatement':
				return truth(this.eval(node.test, env))
					? this.eval(node.consequent, env)
					: node.alternate == null
						? undefined
						: this.eval(node.alternate, env);
			case 'ConditionalExpression':
				return truth(this.eval(node.test, env))
					? this.eval(node.consequent, env)
					: this.eval(node.alternate, env);
			case 'LogicalExpression': {
				const a = this.eval(node.left, env);
				return node.operator === '&&'
					? truth(a)
						? this.eval(node.right, env)
						: a
					: node.operator === '||'
						? truth(a)
							? a
							: this.eval(node.right, env)
						: a == null
							? this.eval(node.right, env)
							: a;
			}
			case 'BinaryExpression':
				return binary(node.operator, this.eval(node.left, env), this.eval(node.right, env));
			case 'UnaryExpression': {
				if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
					try {
						const v = env.get(node.argument.name);
						return v instanceof Decimal ? 'number' : typeof v;
					} catch {
						return 'undefined';
					}
				}
				const v = this.eval(node.argument, env);
				switch (node.operator) {
					case '!':
						return !truth(v);
					case '-':
						return exact(v).neg();
					case '+':
						return numeric(v);
					case 'typeof':
						return v instanceof Decimal ? 'number' : typeof v;
					default:
						return bad(`Unary ${node.operator} is unavailable.`);
				}
			}
			case 'MemberExpression': {
				const value = this.eval(node.object, env);
				if (node.optional && value == null) return undefined;
				const key =
					!node.computed && node.property.type === 'Identifier'
						? node.property.name
						: String(this.eval(node.property, env));
				return property(value, key);
			}
			case 'ChainExpression':
				return this.eval(node.expression, env);
			case 'CallExpression': {
				const args: unknown[] = [];
				for (const a of node.arguments)
					a.type === 'SpreadElement'
						? args.push(...list(this.eval(a.argument, env)))
						: args.push(this.eval(a, env));
				if (node.callee.type === 'MemberExpression') {
					const value = this.eval(node.callee.object, env);
					if ((node.optional || node.callee.optional) && value == null) return undefined;
					const key =
						!node.callee.computed && node.callee.property.type === 'Identifier'
							? node.callee.property.name
							: String(this.eval(node.callee.property, env));
					return this.method(value, key, args);
				}
				return this.call(this.eval(node.callee, env), args);
			}
			case 'ArrayExpression': {
				const result: unknown[] = [];
				for (const n of node.elements)
					n === null
						? result.push(undefined)
						: n.type === 'SpreadElement'
							? result.push(...list(this.eval(n.argument, env)))
							: result.push(this.eval(n, env));
				return result;
			}
			case 'ObjectExpression': {
				const result: Record<string, unknown> = {};
				for (const p of node.properties) {
					if (p.type === 'SpreadElement') Object.assign(result, object(this.eval(p.argument, env)));
					else {
						if (p.kind !== 'init' || p.method) bad('Getters and object methods are unavailable.');
						const key =
							!p.computed && p.key.type === 'Identifier'
								? p.key.name
								: String(this.eval(p.key, env));
						if (blocked.has(key)) bad('Unsafe object key.');
						result[key] = this.eval(p.value, env);
					}
				}
				return result;
			}
			case 'ArrowFunctionExpression':
			case 'FunctionExpression': {
				if (node.async || node.generator) bad('Async and generator expressions are unavailable.');
				return fn((args) => {
					const local = new Environment(env);
					node.params.forEach((p, i) =>
						this.bind(p, p.type === 'RestElement' ? args.slice(i) : args[i], local, true)
					);
					const result = this.eval(node.body, local);
					return result instanceof Returned
						? result.value
						: node.body.type === 'BlockStatement'
							? undefined
							: result;
				});
			}
			case 'TemplateLiteral':
				return node.quasis
					.map(
						(q, i) =>
							(q.value.cooked ?? q.value.raw) +
							(i < node.expressions.length ? String(this.eval(node.expressions[i]!, env)) : '')
					)
					.join('');
			case 'AssignmentExpression': {
				if (node.left.type !== 'Identifier') return bad('Only local variables can be assigned.');
				const name = node.left.name,
					value = this.eval(node.right, env);
				return env.set(
					name,
					node.operator === '=' ? value : binary(node.operator.slice(0, -1), env.get(name), value)
				);
			}
			case 'UpdateExpression': {
				if (node.argument.type !== 'Identifier') return bad('Only local variables can be updated.');
				const previous = numeric(env.get(node.argument.name));
				env.set(node.argument.name, previous + (node.operator === '++' ? 1 : -1));
				return node.prefix ? env.get(node.argument.name) : previous;
			}
			case 'ForOfStatement': {
				if (node.await) bad('Async loops are unavailable.');
				for (const value of list(this.eval(node.right, env))) {
					this.tick();
					const local = new Environment(env);
					if (node.left.type !== 'VariableDeclaration')
						return bad('For-of requires a declared local.');
					if (node.left.declarations.length !== 1)
						return bad('For-of requires one declared local.');
					const declaration = node.left.declarations[0];
					if (declaration === undefined) return bad('Missing loop local.');
					this.bind(declaration.id, value, local, node.left.kind === 'const');
					const result = this.eval(node.body, local);
					if (result instanceof Returned) return result;
					if (result === BREAK) break;
				}
				return undefined;
			}
			case 'ForStatement': {
				const local = new Environment(env);
				if (node.init != null) this.eval(node.init, local);
				while (node.test == null || truth(this.eval(node.test, local))) {
					this.tick();
					const result = this.eval(node.body, local);
					if (result instanceof Returned) return result;
					if (result === BREAK) break;
					if (node.update != null) this.eval(node.update, local);
				}
				return undefined;
			}
			case 'BreakStatement':
				return BREAK;
			case 'ContinueStatement':
				return CONTINUE;
			case 'SequenceExpression': {
				let value: unknown;
				for (const e of node.expressions) value = this.eval(e, env);
				return value;
			}
			case 'ThrowStatement':
				return bad(String(this.eval(node.argument, env)));
			default:
				return bad(`Syntax ${node.type} is unavailable in a deterministic payroll expression.`);
		}
	}
}
// a catalogue's expressions repeat for every person of a run; parsing is what the guest's CPU budget goes on
const parsed = new Map<string, Program>();
const parseProgram = (source: string): Program => {
	const held = parsed.get(source);
	if (held !== undefined) return held;
	const program = parseSource(source);
	parsed.set(source, program);
	return program;
};
const parseSource = (source: string): Program => {
	if (source.length > 65536) bad('An expression exceeds the 64 KiB source limit.');
	return parse(source, {
		ecmaVersion: 2022,
		sourceType: 'script',
		allowReturnOutsideFunction: true
	});
};
/** Parse-time phase validation complements the actual restricted context supplied at execution. */
export function checkExpression(
	source: string,
	phase: Phase,
	availableSubtotals?: ReadonlySet<string>,
	allowedRoots?: readonly string[]
): void {
	const roots = allowedRoots ?? PHASE_ROOTS[phase];
	const tree = parseProgram(source);
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			node.forEach(visit);
			return;
		}
		if (!isDynObject(node)) return;
		if (
			node.type === 'CallExpression' &&
			isDynObject(node.callee) &&
			node.callee.type === 'MemberExpression' &&
			node.callee.computed === false &&
			isDynObject(node.callee.property) &&
			[
				'push',
				'pop',
				'splice',
				'sort',
				'reverse',
				'shift',
				'unshift',
				'copyWithin',
				'fill'
			].includes(String(node.callee.property.name))
		)
			bad(
				`Mutating method ${String(node.callee.property.name)} is unavailable; return immutable arrays.`
			);
		if (
			node.type === 'MemberExpression' &&
			isDynObject(node.object) &&
			node.object.type === 'Identifier' &&
			node.object.name === 'ctx'
		) {
			if (
				node.computed !== false ||
				!isDynObject(node.property) ||
				typeof node.property.name !== 'string' ||
				!roots.includes(node.property.name)
			)
				bad(
					`ctx.${isDynObject(node.property) ? String(node.property.name) : '?'} is unavailable at ${phase}.`
				);
		}
		if (
			node.type === 'MemberExpression' &&
			isDynObject(node.object) &&
			node.object.type === 'MemberExpression' &&
			isDynObject(node.object.object) &&
			node.object.object.type === 'Identifier' &&
			node.object.object.name === 'ctx' &&
			isDynObject(node.object.property) &&
			node.object.property.name === 'subtotals'
		) {
			const key = isDynObject(node.property)
				? node.computed === false
					? node.property.name
					: node.property.type === 'Literal'
						? node.property.value
						: undefined
				: undefined;
			if (
				typeof key !== 'string' ||
				(availableSubtotals !== undefined && !availableSubtotals.has(key))
			)
				bad(`Forward or unknown subtotal at ${phase}.`);
		}
		if (
			[
				'NewExpression',
				'ThisExpression',
				'AwaitExpression',
				'YieldExpression',
				'ImportExpression',
				'FunctionDeclaration',
				'ClassDeclaration',
				'WhileStatement',
				'DoWhileStatement',
				'TryStatement',
				'WithStatement'
			].includes(String(node.type))
		)
			bad(`Syntax ${String(node.type)} is unavailable.`);
		for (const [key, value] of Object.entries(node))
			if (!['loc', 'start', 'end'].includes(key)) visit(value);
	};
	visit(tree);
}
/** The `ctx` roots a source reads. */
export function contextRoots(source: string): ReadonlySet<string> {
	const roots = new Set<string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) return node.forEach(visit);
		if (!isDynObject(node)) return;
		if (
			node.type === 'MemberExpression' &&
			isDynObject(node.object) &&
			node.object.type === 'Identifier' &&
			node.object.name === 'ctx' &&
			isDynObject(node.property) &&
			typeof node.property.name === 'string'
		)
			roots.add(node.property.name);
		for (const value of Object.values(node)) visit(value);
	};
	visit(parseProgram(source));
	return roots;
}
const pure: Readonly<Record<string, FunctionValue>> = {
	add_minutes: fn((a) => addMinutes(text(a[0]), numeric(a[1]))),
	elapsed_minutes: fn((a) => elapsedMinutes(a[0], a[1])),
	interval_minutes: fn((a) => intervalMinutes(a[0], a[1])),
	clock_window_minutes: fn((a) =>
		clockWindowMinutes(a[0], text(a[1]), text(a[2]), text(a[3]), a[4])
	),
	weekday: fn((a) => dateWeekday(date(a[0]))),
	add_working_days: fn((a) =>
		addWorkingDays(
			date(a[0]),
			numeric(a[1]),
			list(a[2]),
			list(a[3]).map(numeric),
			list(a[4] ?? []).map(date)
		)
	),
	occurrence_key: fn((a) =>
		sha256Hex(stableJson(Schema.decodeUnknownSync(Schema.Array(Schema.Json))(a[0])))
	),
	divide_round: fn((a) => {
		const scale = numeric(a[2]);
		if (!Number.isInteger(scale) || scale < 0 || scale > 12)
			bad('Division rounding requires an explicit scale from 0 to 12.');
		const mode = roundMode(a[3]),
			modes = {
				HALF_UP: 'halfUp',
				HALF_EVEN: 'halfEven',
				UP: 'up',
				DOWN: 'down',
				TRUNCATE: 'down'
			} as const;
		return exact(a[0]).div(exact(a[1]), scale, modes[mode]);
	}),
	sum: fn((a) => list(a[0]).reduce<Decimal>((total, v) => total.plus(exact(v)), decimal(0))),
	round: fn((a) => {
		const step = a[1] === undefined ? decimal(1) : exact(a[1]);
		if (step.cmp(0) <= 0) bad('Rounding step must be positive.');
		const mode = a[2] === undefined ? 'HALF_UP' : roundMode(a[2]),
			modes = {
				HALF_UP: 'halfUp',
				HALF_EVEN: 'halfEven',
				UP: 'up',
				DOWN: 'down',
				TRUNCATE: 'down'
			} as const;
		return exact(a[0]).div(step, 0, modes[mode]).times(step);
	}),
	get: fn((a) => path(a[0], text(a[1]), null) ?? a[2] ?? null),
	period_end: fn((a) => periodEnd(a[0])),
	clamp: fn((a) => (compare(a[0], a[1]) < 0 ? a[1] : compare(a[0], a[2]) > 0 ? a[2] : a[0])),
	sum_field: fn((a) =>
		list(a[0]).reduce<Decimal>(
			(total, v) => total.plus(exact(path(v, text(a[1]), undefined))),
			decimal(0)
		)
	),
	group_sum: fn((a) => {
		const result: Record<string, Decimal> = {};
		for (const v of list(a[0])) {
			const key = String(path(v, text(a[1]), undefined));
			if (blocked.has(key)) bad('Unsafe group key.');
			result[key] = (result[key] ?? decimal(0)).plus(exact(path(v, text(a[2]), undefined)));
		}
		return result;
	}),
	group_by: fn((a) => {
		const result: Record<string, unknown[]> = {};
		for (const v of list(a[0])) {
			const key = String(path(v, text(a[1]), undefined));
			if (blocked.has(key)) bad('Unsafe group key.');
			(result[key] ??= []).push(v);
		}
		return result;
	}),
	flatten: fn((a) => list(a[0]).flat()),
	overlay: fn((a) => ({ ...object(a[0]), ...object(a[1]) })),
	first: fn((a) => list(a[0])[0] ?? null),
	add_days: fn((a) => String(addDays(date(a[0]), numeric(a[1])))),
	add_months: fn((a) => String(addMonths(date(a[0]), numeric(a[1])))),
	add_years: fn((a) => String(addMonths(date(a[0]), 12 * numeric(a[1])))),
	month_start: fn((a) => String(monthOf(date(a[0])).from)),
	month_end: fn((a) => String(monthOf(date(a[0])).to)),
	age_on: fn((a) => Math.floor(completedMonths(date(a[0]), date(a[1])) / 12)),
	calendar_completed_months: fn((a) => completedMonths(date(a[0]), date(a[1]))),
	calendar_distance_days: fn((a) => {
		const from = date(a[0]),
			to = date(a[1]);
		return from <= to ? days(datePeriod(from, to)) - 1 : 1 - days(datePeriod(to, from));
	}),
	bracket: fn((a) => {
		const value = exact(a[0]),
			bands = list(a[1]);
		for (const b of bands) {
			const row = object(b);
			if (row.up_to == null || value.lte(exact(row.up_to)))
				return property(row, Object.hasOwn(row, 'rate') ? 'rate' : 'amount');
		}
		return bad('Bracket table does not cover its input.');
	}),
	ladder: fn((a) => {
		let previous = decimal(0),
			total = decimal(0);
		const value = exact(a[0]);
		if (value.cmp(0) < 0) bad('Progressive base must be nonnegative.');
		for (const b of list(a[1])) {
			const row = object(b),
				end = row.up_to == null ? value : exact(row.up_to);
			if (end.lt(previous)) bad('Progressive thresholds must increase.');
			const upper = value.lt(end) ? value : end,
				slice = upper.minus(previous);
			if (slice.cmp(0) > 0) total = total.plus(slice.times(exact(row.rate)));
			if (value.lte(end)) return total;
			previous = end;
		}
		return bad('Progressive table does not cover its input.');
	}),
	Number: fn((a) => numeric(typeof a[0] === 'string' ? Number(a[0]) : a[0])),
	String: fn((a) => String(a[0])),
	Boolean: fn((a) => truth(a[0]))
};
const roundMode = (v: unknown): 'HALF_UP' | 'HALF_EVEN' | 'UP' | 'DOWN' | 'TRUNCATE' =>
	v === 'HALF_UP' || v === 'HALF_EVEN' || v === 'UP' || v === 'DOWN' || v === 'TRUNCATE'
		? v
		: bad('Unknown rounding mode.');
// the same check repeats for every person of a run, at the same place in the chain
const checked = new Map<string, Set<string>>();
const checkOnce = (
	source: string,
	phase: Phase,
	subtotals: readonly string[],
	roots?: readonly string[]
): void => {
	const scope = `${phase}:${subtotals.join()}:${roots?.join() ?? ''}`;
	const seen = checked.get(source) ?? new Set<string>();
	if (seen.has(scope)) return;
	checkExpression(source, phase, new Set(subtotals), roots);
	checked.set(source, seen.add(scope));
};
export function evaluateExact(
	source: string,
	phase: Phase,
	context: object,
	field: string,
	roots?: readonly string[]
): unknown {
	try {
		checkOnce(
			source,
			phase,
			isDynObject(Reflect.get(context, 'subtotals'))
				? Object.keys(Reflect.get(context, 'subtotals'))
				: [],
			roots
		);
		const env = new Environment();
		for (const [name, value] of Object.entries(pure)) env.declare(name, value, true);
		env.declare('Infinity', Infinity, true);
		env.declare('undefined', undefined, true);
		env.declare('NaN', NaN, true);
		env.declare(
			'Math',
			Object.fromEntries(
				['min', 'max', 'abs', 'floor', 'ceil', 'trunc', 'round', 'pow', 'sqrt'].map((name) => [
					name,
					fn((a) => {
						if (a.length > 0 && ['min', 'max'].includes(name))
							return a.reduce((best, value) =>
								name === 'min'
									? compare(best, value) <= 0
										? best
										: value
									: compare(best, value) >= 0
										? best
										: value
							);
						const values = a.map(numeric);
						if (name === 'abs') return exact(a[0]).abs();
						if (name === 'floor' || name === 'ceil' || name === 'trunc')
							return exact(a[0]).round(0, name === 'trunc' ? 'down' : name);
						switch (name) {
							case 'min':
								return Math.min(...values);
							case 'max':
								return Math.max(...values);
							case 'abs':
								return Math.abs(numeric(values[0]));
							case 'floor':
								return Math.floor(numeric(values[0]));
							case 'ceil':
								return Math.ceil(numeric(values[0]));
							case 'trunc':
								return Math.trunc(numeric(values[0]));
							case 'round':
								return Math.round(numeric(values[0]));
							case 'pow':
								return Math.pow(numeric(values[0]), numeric(values[1]));
							default:
								return Math.sqrt(numeric(values[0]));
						}
					})
				])
			),
			true
		);
		env.declare(
			'Object',
			{
				entries: fn((a) => Object.entries(object(a[0]))),
				values: fn((a) => Object.values(object(a[0]))),
				keys: fn((a) => Object.keys(object(a[0]))),
				fromEntries: fn((a) =>
					Object.fromEntries(
						list(a[0]).map((v) => {
							const pair = list(v);
							const key = text(pair[0]);
							if (blocked.has(key)) bad('Unsafe object key.');
							return [key, pair[1]];
						})
					)
				),
				hasOwn: fn((a) => Object.hasOwn(object(a[0]), text(a[1])))
			},
			true
		);
		env.declare('Array', { isArray: fn((a) => Array.isArray(a[0])) }, true);
		env.declare(
			'ctx',
			Object.fromEntries(
				Object.entries(context).filter(([k]) => (roots ?? PHASE_ROOTS[phase]).includes(k))
			),
			true
		);
		const result = new Interpreter().eval(parseProgram(source), env);
		if (!(result instanceof Returned)) return bad('Expression must explicitly return its result.');
		return result.value;
	} catch (error) {
		throw new Refusal({ message: `${field}: ${getErrorMessage(error)}`, detail: source });
	}
}
export const evaluate = (
	source: string,
	phase: Phase,
	context: object,
	field: string,
	roots?: readonly string[]
): unknown => materialise(evaluateExact(source, phase, context, field, roots));
