/**
 * Run-time evaluation for the expression sites
 *
 * `compile.ts` checks an expression at catalogue write time against a blank context; this module
 * builds the engine that evaluates it against the real one. The closures give a seed expression
 * the values a run knows — minimum wages, evaluated limits, the calendar's working days — beside
 * the plain context members.
 */

import { Environment, type ParseResult } from '@marcbachmann/cel-js';
import { roundMoney } from '../../collections/payroll_runs/lib/rounding.js';
import { childBornOn, childCitizensUnder, childClassed, childUnder } from './child-under.js';
import { ageMonthsOn, ageOn, leaveTaken } from './person-functions.js';

/**
 * What differs between two evaluations of the same expression: the region's minimum wage, and —
 * on the assessment site — the payslip's own money. It is bound per call, not per engine, so one
 * compiled environment serves every employee and every run. Evaluation is synchronous, so the
 * binding cannot interleave.
 *
 * `code` and `catalog` read the code → signed amount map ACCUMULATE produced for this payslip; a
 * scheme's `assessed_on` is the only expression that calls them.
 */
export type ExpressionEngine = {
	readonly minimumWage: (region: string) => number;
	/** The signed total of one catalogue code this payslip, or 0 where the payslip has none. */
	readonly code?: (code: string) => number;
	/** `catalog('ALLOWANCE' | 'CLAIM' | 'LOAN', { pick } | { exclude } | { fixed })`, signed by each row. */
	readonly catalog?: (
		catalogue: string,
		selection?: {
			readonly pick?: readonly string[];
			readonly exclude?: readonly string[];
			readonly fixed?: boolean;
		}
	) => number;
	/** `earned_average(code, months_back, months)`: a window of earlier payslips' earnings. */
	readonly earnedAverage?: (code: string, monthsBack: number, months: number) => number;
	/** `days_under(age)`: the pay window's days on which the person is under that age. */
	readonly daysUnder?: (age: number) => number;
	/** `year_catalog(...)`: the same selection as `catalog`, summed over the tax year's earlier PAID payslips. */
	readonly yearCatalog?: ExpressionEngine['catalog'];
};

let bound: ExpressionEngine = { minimumWage: () => 0 };

/** The second argument of `catalog`, as the AST hands it over: a `{ pick | exclude }` map. */
function catalogSelection(value: unknown): {
	pick?: string[];
	exclude?: string[];
	fixed?: boolean;
} {
	const selection = value as
		{ pick?: unknown; exclude?: unknown; fixed?: unknown } | null | undefined;
	const list = (candidate: unknown): string[] =>
		Array.isArray(candidate) ? candidate.map(String) : [];
	return {
		...(selection?.pick == null ? {} : { pick: list(selection.pick) }),
		...(selection?.exclude == null ? {} : { exclude: list(selection.exclude) }),
		...(selection?.fixed == null ? {} : { fixed: Boolean(selection.fixed) })
	};
}

const OPS: readonly (readonly [string, (...args: unknown[]) => unknown])[] = [
	['minimum_wage(string): double', (region) => Number(bound.minimumWage(String(region)))],
	[
		'bracket(dyn, dyn, dyn): double',
		(base, upTo, step) => {
			const value = Number(base);
			const size = Number(step);
			return value <= Number(upTo) && size > 0 ? Math.ceil(value / size) * size : value;
		}
	],
	[
		'ladder(dyn, list<dyn>): double',
		(base, grades) => {
			const value = Number(base);
			const rungs = Array.isArray(grades) ? grades.map(Number) : [];
			return rungs.find((grade) => value <= grade) ?? rungs.at(-1) ?? value;
		}
	],
	['round_cent(dyn): double', (value) => roundMoney(Number(value), 'NEAREST_CENT')],
	['truncate_cent(dyn): double', (value) => roundMoney(Number(value), 'TRUNCATE_CENT')],
	['up_5_cents(dyn): double', (value) => roundMoney(Number(value), 'UP_5_CENTS')],
	['round_unit(dyn): double', (value) => roundMoney(Number(value), 'NEAREST_UNIT')],
	['floor_unit(dyn): double', (value) => roundMoney(Number(value), 'FLOOR_UNIT')],
	['up_to_unit(dyn): double', (value) => roundMoney(Number(value), 'UP_TO_UNIT')],
	[
		'progressive(dyn, list<dyn>): double',
		(value, table) => {
			const amount = Number(value);
			const rungs = Array.isArray(table) ? table.map(Number) : [];
			let charged = 0;
			for (let index = 0; index + 2 < rungs.length; index += 3) {
				const from = rungs[index]!;
				if (from >= amount) break;
				charged = rungs[index + 1]! + ((amount - from) * rungs[index + 2]!) / 100;
			}
			return charged;
		}
	],
	['map.under(int): int', childUnder],
	['map.citizens_under(int): int', childCitizensUnder],
	['map.classed(string): int', childClassed],
	['map.born_on(string): int', childBornOn],
	['map.age_on(string): int', ageOn],
	['map.age_months_on(string): int', ageMonthsOn],
	['map.taken(string): double', leaveTaken],
	['days_under(int): double', (age) => Number(bound.daysUnder?.(Number(age)) ?? 0)],
	['map.days(string): double', () => 0],
	['code(string): double', (catalogueCode) => Number(bound.code?.(String(catalogueCode)) ?? 0)],
	[
		'catalog(string): double',
		(catalogue) => Number(bound.catalog?.(String(catalogue), undefined) ?? 0)
	],
	[
		'earned_average(string, int, int): double',
		(code, monthsBack, months) =>
			Number(bound.earnedAverage?.(String(code), Number(monthsBack), Number(months)) ?? 0)
	],
	[
		'earned_average(list, int, int): double',
		(codes, monthsBack, months) =>
			(Array.isArray(codes) ? codes : []).reduce(
				(sum: number, code) =>
					sum +
					Number(bound.earnedAverage?.(String(code), Number(monthsBack), Number(months)) ?? 0),
				0
			)
	],
	[
		'catalog(string, dyn): double',
		(catalogue, selection) =>
			Number(bound.catalog?.(String(catalogue), catalogSelection(selection)) ?? 0)
	],
	[
		'year_catalog(string): double',
		(catalogue) => Number(bound.yearCatalog?.(String(catalogue), undefined) ?? 0)
	],
	[
		'year_catalog(string, dyn): double',
		(catalogue, selection) =>
			Number(bound.yearCatalog?.(String(catalogue), catalogSelection(selection)) ?? 0)
	],
	[
		'annual_exempt(dyn, dyn, dyn): double',
		(amount, earnedBefore, cap) =>
			Math.min(Number(amount), Math.max(0, Number(cap) - Number(earnedBefore)))
	]
];

export function runtimeExpressionEngine(options: Partial<ExpressionEngine> = {}): ExpressionEngine {
	return {
		minimumWage: options.minimumWage ?? (() => 0),
		code: options.code,
		catalog: options.catalog,
		earnedAverage: options.earnedAverage,
		daysUnder: options.daysUnder,
		yearCatalog: options.yearCatalog
	};
}

/**
 * One CEL environment per isolate, every function registered once; one parsed program per
 * expression text.
 *
 * The statutory catalogue is a Third Schedule transcribed as rules — tens of thousands of band
 * expressions, most of them distinct — and a run compiles each one it touches. Building a fresh
 * environment per expression re-registered every function and re-parsed every signature each time,
 * which cost a company of ninety more guest CPU than its whole budget; the parse itself is cheap.
 * The options match the reckon engine the write-time compiler validates against
 * (`compile.ts`), so what compiles there evaluates here. Catalogue text is finite; the cap only
 * guards a pathological caller.
 */
const environment = new Environment({
	unlistedVariablesAreDyn: true,
	homogeneousAggregateLiterals: false
});
for (const [signature, handler] of OPS) environment.registerFunction(signature, handler);

const programs = new Map<string, ParseResult>();
const PROGRAM_CAP = 65_536;

export function programFor(expression: string): ParseResult {
	const cached = programs.get(expression);
	if (cached !== undefined) return cached;
	const program = environment.parse(expression);
	if (programs.size >= PROGRAM_CAP) programs.clear();
	programs.set(expression, program);
	return program;
}

function evaluateExpression(
	engine: ExpressionEngine,
	expression: string,
	context: Record<string, unknown>
): unknown {
	const program = programFor(expression);
	const previous = bound;
	bound = engine;
	try {
		return program(context);
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
