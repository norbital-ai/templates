import { Effect, Schema } from 'effect';
import { Environment, type ParseResult } from '@marcbachmann/cel-js';
import { Refusal } from './foundation.js';

/** One deliberate expression environment: values arrive as stored JSON, no implicit coercion. */
const environment = new Environment({ unlistedVariablesAreDyn: true, homogeneousAggregateLiterals: false });

export const ROUND_MODES = ['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'TRUNCATE'] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

const minorDigits = (currency: string): number =>
	['JPY', 'KRW', 'VND', 'IDR'].includes(currency) ? 0 : ['BHD', 'KWD', 'OMR'].includes(currency) ? 3 : 2;

export const currencyFractionDigits = (currency: string): number => minorDigits(currency.toUpperCase());

/** Round to `step` under one declared mode. */
export function roundStep(value: number, step: number, mode: RoundMode): number {
	if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0)
		throw new Refusal({ message: 'Rounding requires a finite value and a positive step.' });
	const units = value / step;
	const epsilon = 1e-9;
	const sign = Math.sign(units);
	switch (mode) {
		case 'HALF_UP':
			return sign * Math.floor(Math.abs(units) + 0.5 + epsilon) * step;
		case 'HALF_EVEN': {
			const floor = Math.floor(Math.abs(units));
			const fraction = Math.abs(units) - floor;
			const rounded = fraction > 0.5 + epsilon ? floor + 1 : fraction < 0.5 - epsilon ? floor : floor % 2 === 0 ? floor : floor + 1;
			return sign * rounded * step;
		}
		case 'UP':
			return sign * Math.ceil(Math.abs(units) - epsilon) * step;
		case 'DOWN':
			return sign * Math.floor(Math.abs(units) + epsilon) * step;
		case 'TRUNCATE':
			return Math.trunc(units) * step;
		default:
			throw new Refusal({ message: `Unknown rounding mode: ${String(mode)}` });
	}
}

export const roundMinute = (hours: number): number => roundStep(hours, 1 / 60, 'HALF_UP');

const numericOperand = (value: unknown, context: string): number => {
	const parsed = Schema.is(Schema.Union(Schema.Number, Schema.String))(value) ? Number(value) : Number.NaN;
	if (Number.isFinite(parsed) && String(value).trim() !== '') return parsed;
	throw new Refusal({ message: `${context} requires an actual finite number.` });
};

const isCalendarDate = (value: unknown): value is string =>
	Schema.is(Schema.String)(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const dayOffset = (day: string, count: number, unit: 'DAY' | 'MONTH' | 'YEAR'): string => {
	const stamp = new Date(`${day}T00:00:00Z`);
	if (unit === 'DAY') stamp.setUTCDate(stamp.getUTCDate() + count);
	else if (unit === 'MONTH') stamp.setUTCMonth(stamp.getUTCMonth() + count);
	else stamp.setUTCFullYear(stamp.getUTCFullYear() + count);
	return stamp.toISOString().slice(0, 10);
};

environment.registerFunction('add_days(string, int): string', (day: unknown, count: unknown) =>
	dayOffset(String(day), Math.trunc(numericOperand(count, 'Calendar offset')), 'DAY'));
environment.registerFunction('add_months(string, int): string', (day: unknown, count: unknown) =>
	dayOffset(String(day), Math.trunc(numericOperand(count, 'Calendar offset')), 'MONTH'));
environment.registerFunction('add_years(string, int): string', (day: unknown, count: unknown) =>
	dayOffset(String(day), Math.trunc(numericOperand(count, 'Calendar offset')), 'YEAR'));
environment.registerFunction('calendar_distance_days(string, string): int', (from: unknown, to: unknown) => {
	if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Refusal({ message: 'Calendar distance requires actual calendar dates.' });
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
});
environment.registerFunction('calendar_date_valid(string): bool', (day: unknown) => isCalendarDate(day));
environment.registerFunction('ceil(dyn): double', (_engine: unknown, value: unknown) => Math.ceil(numericOperand(value, 'Ceiling')));
environment.registerFunction('floor(dyn): double', (_engine: unknown, value: unknown) => Math.floor(numericOperand(value, 'Floor')));
environment.registerFunction('math_round(dyn): double', (_engine: unknown, value: unknown) => Math.round(numericOperand(value, 'Integer rounding')));
environment.registerFunction('abs(dyn): double', (_engine: unknown, value: unknown) => Math.abs(numericOperand(value, 'Absolute value')));
environment.registerFunction('minor_units(dyn, string): int', (value: unknown, currency: unknown) => {
	if (!Schema.is(Schema.String)(currency)) throw new Refusal({ message: 'Minor units require an actual currency.' });
	const units = Math.round(numericOperand(value, 'Minor units') * 10 ** currencyFractionDigits(currency));
	if (!Number.isSafeInteger(units)) throw new Refusal({ message: 'Minor units cannot lose original integer precision.' });
	return units;
});
environment.registerFunction('round_step(double, double, string): double', (value: unknown, step: unknown, mode: unknown) =>
	roundStep(numericOperand(value, 'Rounding'), numericOperand(step, 'Rounding'), String(mode) as RoundMode));

const programs = new Map<string, ParseResult>();

/** One parsed expression per source text; stored programmes keep their exact original text. */
export function configuredProgram(expression: string): (context: object) => unknown {
	if (!Schema.is(Schema.String)(expression) || expression.trim() === '')
		throw new Refusal({ message: 'A configured expression retains its actual nonblank source text.' });
	let program = programs.get(expression);
	if (program === undefined) {
		program = environment.parse(expression);
		programs.set(expression, program);
	}
	return (context: object) => program!(context as Record<string, unknown>);
}

let configuredNestedDepth = 0;

environment.registerFunction('configured_eval(string, map): dyn', (expression: unknown, context: unknown) => {
	if (!Schema.is(Schema.String)(expression) || !Schema.is(Schema.Record(Schema.String, Schema.Unknown))(context))
		throw new Refusal({ message: 'Configured evaluation requires an expression and its captured record.' });
	if (configuredNestedDepth >= 16) throw new Refusal({ message: 'Configured evaluation exceeds its nested expression limit.' });
	configuredNestedDepth++;
	try {
		return configuredProgram(expression)(context);
	} finally {
		configuredNestedDepth--;
	}
});

/** One expression against its actual captured context. */
export const evaluateConfigured = (expression: string, context: object): unknown => configuredProgram(expression)(context);

/** One expression as an Effect, failures contained per evaluation. */
export const evaluateConfiguredEffect = (expression: string, context: object): Effect.Effect<unknown, Refusal> =>
	Effect.try({
		try: () => evaluateConfigured(expression, context),
		catch: (cause) => (cause instanceof Refusal ? cause : new Refusal({ message: 'Configured evaluation failed.', detail: String(cause) }))
	});

export const evaluateConfiguredOutputs = (expressions: readonly string[], context: object): unknown[] =>
	expressions.map((expression) => evaluateConfigured(expression, context));
