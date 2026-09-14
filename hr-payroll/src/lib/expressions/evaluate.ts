/**
 * Run-time evaluation for the expression sites of RFC 0001 §7.
 *
 * `compile.ts` checks an expression at catalogue write time against a blank context; this module
 * builds the engine that evaluates it against the real one. The closures give a seed expression
 * the values a run knows — minimum wages, evaluated limits, the calendar's working days — beside
 * the plain context members.
 */

import { createReckonEngine, type ComputationDefinition } from '@norbital-ai/std/reckon';
import { roundMoney } from '../../collections/payroll_runs/lib/rounding.js';
import { childUnder } from './child-under.js';

function monthDays(month: string): number {
	const [year, index] = month.split('-').map(Number);
	if (year == null || index == null) return 0;
	return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** The engine a run evaluates expressions with; see `compile.ts` for the compile-time twin. */
export function runtimeExpressionEngine(
	options: {
		/** The version's minimum wage by region, for `minimum_wage(region)`. */
		readonly minimumWage?: (region: string) => number;
		/** Evaluated limit values, for `limit(key)`; `limits.<key>` reads the context directly. */
		readonly limits?: Readonly<Record<string, number>>;
		/** Working days in a `YYYY-MM` month, for `working_days(month)`. */
		readonly workingDays?: (month: string) => number;
		/** Calendar days in a `YYYY-MM` month, for `calendar_days(month)`. */
		readonly calendarDays?: (month: string) => number;
	} = {}
) {
	return (
		createReckonEngine()
			.registerFunction(
				'calendar_days',
				'calendar_days(string): double',
				(month) => options.calendarDays?.(String(month)) ?? monthDays(String(month))
			)
			.registerFunction('working_days', 'working_days(string): double', (month) =>
				options.workingDays == null ? 22 : options.workingDays(String(month))
			)
			.registerFunction('minimum_wage', 'minimum_wage(string): double', (region) =>
				options.minimumWage == null ? 0 : Number(options.minimumWage(String(region)))
			)
			.registerFunction('limit', 'limit(string): double', (key) =>
				Number(options.limits?.[String(key)] ?? 0)
			)
			// One rung of a wage-bracket ladder: while the wage is within `upTo`, round it up to the
			// next `step`. A chain nests the calls; see `bracketBase` for why the step vanishes above
			// the last rung rather than freezing the contribution.
			.registerFunction('bracket', 'bracket(dyn, dyn, dyn): double', (base, upTo, step) => {
				const value = Number(base);
				const size = Number(step);
				return value <= Number(upTo) && size > 0 ? Math.ceil(value / size) * size : value;
			})
			// A published grade table: the lowest grade that covers the wage, the highest when none
			// does. `ladder(base, [500.0, 1000.0])`.
			.registerFunction('ladder', 'ladder(dyn, list<dyn>): double', (base, grades) => {
				const value = Number(base);
				const rungs = Array.isArray(grades) ? grades.map(Number) : [];
				return rungs.find((grade) => value <= grade) ?? rungs.at(-1) ?? value;
			})
			// Money rounding, the `rules.rounding` chain as callable functions. Every one delegates
			// to `roundMoney`, so the epsilon that protects the engine's floats is shared.
			.registerFunction('round_cent', 'round_cent(dyn): double', (value) =>
				roundMoney(Number(value), 'NEAREST_CENT')
			)
			.registerFunction('round_5_cents', 'round_5_cents(dyn): double', (value) =>
				roundMoney(Number(value), 'NEAREST_5_CENTS')
			)
			.registerFunction('truncate_cent', 'truncate_cent(dyn): double', (value) =>
				roundMoney(Number(value), 'TRUNCATE_CENT')
			)
			.registerFunction('up_5_cents', 'up_5_cents(dyn): double', (value) =>
				roundMoney(Number(value), 'UP_5_CENTS')
			)
			.registerFunction('round_unit', 'round_unit(dyn): double', (value) =>
				roundMoney(Number(value), 'NEAREST_UNIT')
			)
			.registerFunction('floor_unit', 'floor_unit(dyn): double', (value) =>
				roundMoney(Number(value), 'FLOOR_UNIT')
			)
			.registerFunction('up_to_unit', 'up_to_unit(dyn): double', (value) =>
				roundMoney(Number(value), 'UP_TO_UNIT')
			)
			// A published progressive ladder inlined as data: `[from, amount, rate, …]` triples, in
			// order. The last rung whose `from` is strictly below the value governs, exactly as its
			// `base > from && base <= to` rule did; below the first rung the charge is zero.
			.registerFunction('progressive', 'progressive(dyn, list<dyn>): double', (value, table) => {
				const amount = Number(value);
				const rungs = Array.isArray(table) ? table.map(Number) : [];
				let charged = 0;
				for (let index = 0; index + 2 < rungs.length; index += 3) {
					const from = rungs[index]!;
					if (from >= amount) break;
					charged = rungs[index + 1]! + ((amount - from) * rungs[index + 2]!) / 100;
				}
				return charged;
			})
			// `children.under(n)`: the count of ages below `n`, the shape `PersonContext` carries.
			.registerFunction('map.under', 'map.under(int): int', childUnder)
			.registerFunction('map.days', 'map.days(string): double', () => 0)
			.registerFunction('map.balance', 'map.balance(string): double', () => 0)
	);
}

export type ExpressionEngine = ReturnType<typeof runtimeExpressionEngine>;

/** Evaluate one expression against a context; the caller validated it at write time. */
function evaluateExpression(
	engine: ExpressionEngine,
	expression: string,
	context: Record<string, unknown>
): unknown {
	const definition: ComputationDefinition = {
		id: 'expression',
		tables: {},
		exprs: { value: expression },
		outputs: ['value']
	};
	return engine.runComputation<Record<string, unknown>, { value: unknown }>(definition, context)
		.outputs.value;
}

/** The same, for the sites that require a number; refuses a non-finite result. */
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
