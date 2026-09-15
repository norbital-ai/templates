/**
 * Run-time evaluation for the expression sites of RFC 0001 §7.
 *
 * `compile.ts` checks an expression at catalogue write time against a blank context; this module
 * builds the engine that evaluates it against the real one. The closures give a seed expression
 * the values a run knows — minimum wages, evaluated limits, the calendar's working days — beside
 * the plain context members.
 */

import {
	createEnvironment,
	runComputation,
	type ComputationDefinition,
	type CustomOp,
	type ReckonEnvironment
} from '@norbital-ai/std/reckon';
import { roundMoney } from '../../collections/payroll_runs/lib/rounding.js';
import { childUnder } from './child-under.js';

/**
 * What differs between two evaluations of the same expression: the region's minimum wage. It is
 * bound per call, not per engine, so one compiled environment serves every employee and every run.
 * Evaluation is synchronous, so the binding cannot interleave.
 */
export type ExpressionEngine = {
	readonly minimumWage: (region: string) => number;
};

let bound: ExpressionEngine = { minimumWage: () => 0 };

const op = (signature: string, handler: (...args: unknown[]) => unknown): CustomOp => ({
	signature,
	handler
});

const OPS: readonly CustomOp[] = [
	op('minimum_wage(string): double', (region) => Number(bound.minimumWage(String(region)))),
	op('bracket(dyn, dyn, dyn): double', (base, upTo, step) => {
		const value = Number(base);
		const size = Number(step);
		return value <= Number(upTo) && size > 0 ? Math.ceil(value / size) * size : value;
	}),
	op('ladder(dyn, list<dyn>): double', (base, grades) => {
		const value = Number(base);
		const rungs = Array.isArray(grades) ? grades.map(Number) : [];
		return rungs.find((grade) => value <= grade) ?? rungs.at(-1) ?? value;
	}),
	op('round_cent(dyn): double', (value) => roundMoney(Number(value), 'NEAREST_CENT')),
	op('truncate_cent(dyn): double', (value) => roundMoney(Number(value), 'TRUNCATE_CENT')),
	op('up_5_cents(dyn): double', (value) => roundMoney(Number(value), 'UP_5_CENTS')),
	op('round_unit(dyn): double', (value) => roundMoney(Number(value), 'NEAREST_UNIT')),
	op('floor_unit(dyn): double', (value) => roundMoney(Number(value), 'FLOOR_UNIT')),
	op('up_to_unit(dyn): double', (value) => roundMoney(Number(value), 'UP_TO_UNIT')),
	op('progressive(dyn, list<dyn>): double', (value, table) => {
		const amount = Number(value);
		const rungs = Array.isArray(table) ? table.map(Number) : [];
		let charged = 0;
		for (let index = 0; index + 2 < rungs.length; index += 3) {
			const from = rungs[index]!;
			if (from >= amount) break;
			charged = rungs[index + 1]! + ((amount - from) * rungs[index + 2]!) / 100;
		}
		return charged;
	}),
	op('map.under(int): int', childUnder),
	op('map.days(string): double', () => 0),
	op('map.balance(string): double', () => 0)
];

export function runtimeExpressionEngine(
	options: {
		readonly minimumWage?: (region: string) => number;
	} = {}
): ExpressionEngine {
	return { minimumWage: options.minimumWage ?? (() => 0) };
}

/**
 * One compiled environment per expression text. A payroll run evaluates the same few hundred
 * catalogue expressions once per employee; rebuilding the CEL environment and hashing the
 * definition on every call cost a company of ninety more CPU than the guest's whole budget, while
 * the arithmetic itself was a rounding error. Catalogue text is finite; the cap only guards a
 * pathological caller.
 */
const environments = new Map<string, ReckonEnvironment>();
const ENVIRONMENT_CAP = 4_096;

export function environmentFor(expression: string): ReckonEnvironment {
	const cached = environments.get(expression);
	if (cached !== undefined) return cached;
	const definition: ComputationDefinition = {
		id: 'expression',
		tables: {},
		exprs: { value: expression },
		outputs: ['value']
	};
	const environment = createEnvironment(definition, [...OPS]);
	if (environments.size >= ENVIRONMENT_CAP) environments.clear();
	environments.set(expression, environment);
	return environment;
}

const DEFINITION: ComputationDefinition = {
	id: 'expression',
	tables: {},
	exprs: {},
	outputs: ['value']
};

function evaluateExpression(
	engine: ExpressionEngine,
	expression: string,
	context: Record<string, unknown>
): unknown {
	const environment = environmentFor(expression);
	const previous = bound;
	bound = engine;
	try {
		return runComputation<Record<string, unknown>, { value: unknown }>(
			DEFINITION,
			context,
			environment
		).outputs.value;
	} finally {
		bound = previous;
	}
}

export function evaluateNumber(
	engine: ExpressionEngine,
	expression: string,
	context: Record<string, unknown>
): number {
	const value = evaluateExpression(engine, expression, context);
	const number = Number(value);
	if (!Number.isFinite(number))
		throw new Error(`The expression "${expression}" produced ${String(value)}, not a number.`);
	return number;
}

/** The same, for the sites that require a boolean. */
export function evaluateBoolean(
	engine: ExpressionEngine,
	expression: string,
	context: Record<string, unknown>
): boolean {
	const value = evaluateExpression(engine, expression, context);
	if (typeof value !== 'boolean')
		throw new Error(`The expression "${expression}" produced ${String(value)}, not a boolean.`);
	return value;
}

/** The one engine every site without a version-bound helper shares; it holds no state. */
export const expressionEngine = runtimeExpressionEngine();
