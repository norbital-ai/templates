/**
 * Run-time evaluation for the expression sites
 *
 * `compile.ts` checks an expression at catalogue write time against a blank context; this module
 * builds the engine that evaluates it against the real one. The closures give a seed expression
 * the values a run knows — minimum wages, evaluated limits, the calendar's working days — beside
 * the plain context members.
 */

import { Environment, type ParseResult } from '@marcbachmann/cel-js';
import type { RoundMode } from '../../lib/payroll/run/rounding.js';
import { addDays, exactMonths, monthDay } from '../../lib/payroll/run/dates.js';
import { isCalendarDate } from '../iso-day.js';
import {
	noticeDaysRemaining,
	noticeMonthlyWages,
	paydayNoticeDays,
	serviceYearsOn
} from './notice-period.js';
import {
	childBornOn,
	childMultipleBornOn,
	childCitizensUnder,
	childClassed,
	naturalSurvivingOn,
	naturalSurvivingBefore,
	naturalSurvivingConfinementsBefore,
	childUnclassedUnder,
	childUnder
} from './child-under.js';
import {
	ageMonthsOn,
	ageOn,
	averageDailyWage,
	averageMonthlyWage,
	birthday,
	earnedMonthlyAverage,
	pieceWagesLastWorkdays,
	leaveTaken,
	leaveDays,
	onLeave,
	presenceDaysIn,
	serviceDaysBefore,
	serviceMonthsNet
} from './person-functions.js';
import * as Predicate from 'effect/Predicate';
import { decodeNumber } from '../wire.js';
import { REGISTERED_FUNCTIONS } from './functions/index.js';
import type { SpanDay } from './functions/spans.js';
import { tablesIn, type TableLookup } from './functions/tables.js';
import type { CompanyAccess } from './functions/company.js';
import { historyIn } from './functions/history.js';
import { evaluationObserver } from '../trace/observer.js';
import type { HistoryAccess } from '../payroll/history.js';

/**
 * What differs between two evaluations of the same expression: the region's minimum wage, and —
 * on the assessment site — the payslip's own money. It is bound per call, not per engine, so one
 * compiled environment serves every employee and every run. Evaluation is synchronous, so the
 * binding cannot interleave.
 *
 * `code` reads the code → signed amount map ACCUMULATE produced for this payslip; a scheme's
 * `assessed_on` is the only expression that calls it.
 */
export type ExpressionEngine = {
	readonly minimumWage: (region: string) => number;
	/** The signed total of one catalogue code this payslip, or 0 where the payslip has none. */
	readonly code?: ((code: string) => number) | undefined;
	readonly annualQuantityExempt?: ((code: string, limit: number) => number) | undefined;
	readonly earnedQuantityExempt?: ((code: string, limit: number) => number) | undefined;
	readonly earnedMonthlyExcess?: ((code: string, limit: number) => number) | undefined;
	/** `earned_daily_excess(code, share)`: earlier months' payments over a per-day share of the floor then in force. */
	readonly earnedDailyExcess?: ((code: string, share: number) => number) | undefined;
	/** `earned_average(code, months_back, months)`: a window of earlier payslips' earnings. */
	readonly earnedAverage?:
		((code: string, monthsBack: number, months: number) => number) | undefined;
	/** `days_under(age)`: the pay window's days on which the person is under that age. */
	readonly daysUnder?: ((age: number) => number) | undefined;
	/** `run_hours_before_rest(minutes)`: a work day's hours before its first rest of at least `minutes`. */
	readonly runHoursBeforeRest?: ((minutes: number) => number) | undefined;
	/** Covered days on a `monthDays`-day insurance calendar; age 0 leaves coverage uncapped by age. */
	readonly coverageDays?: ((since: string, age: number, monthDays: number) => number) | undefined;
	/** Replaces every `round(value, step, mode)`: a caller that rounds a blend once. */
	readonly round?:
		| ((value: number, rounding: { readonly step: number; readonly mode: RoundMode }) => number)
		| undefined;
	/** The person's day on a `YYYY-MM-DD` date, for `span(...)` counts and `days()`; none reads every kind as empty. */
	readonly calendar?: ((date: string) => SpanDay | undefined) | undefined;
	/** The version's reference tables on this evaluation's resolution date (`table()`, `band()`, `bands()`). */
	readonly tables?: TableLookup | undefined;
	/** The person's saved past (`history.slips|days|leave|terms|external(…)`); none refuses. */
	readonly history?: HistoryAccess | undefined;
	/** The entity's employments (`company.headcount_on(…)`, `company.year.headcount_average(…)`); none refuses. */
	readonly company?: CompanyAccess | undefined;
};

let bound: ExpressionEngine = { minimumWage: () => 0 };

const OPS: readonly (readonly [string, (...args: unknown[]) => unknown])[] = [
	['minimum_wage(string): double', (region) => bound.minimumWage(String(region))],
	[
		'add_months(string, int): string',
		(day, months) => {
			const date = String(day);
			if (!isCalendarDate(date)) return '';
			const [year, month, dayOfMonth] = date.split('-').map(Number) as [number, number, number];
			return monthDay(year, month - 1 + Number(months), dayOfMonth);
		}
	],
	[
		'months_through(string, string): double',
		(from, through) => {
			const start = String(from);
			const end = String(through);
			return !isCalendarDate(start) || !isCalendarDate(end) || end < start
				? 0
				: exactMonths(start, addDays(end, 1));
		}
	],
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
	['map.unclassed_under(int): int', childUnclassedUnder],
	['map.born_on(string): int', childBornOn],
	['map.multiple_born_on(string): int', childMultipleBornOn],
	['map.natural_surviving_on(string): int', naturalSurvivingOn],
	['map.natural_surviving_before(string): int', naturalSurvivingBefore],
	['map.natural_surviving_confinements_before(string): int', naturalSurvivingConfinementsBefore],
	['map.age_on(string): int', ageOn],
	['map.birthday(int): string', birthday],
	['map.age_months_on(string): int', ageMonthsOn],
	['map.presence_days_in(int): int', presenceDaysIn],
	['map.taken(string): double', leaveTaken],
	['map.earned_monthly_average(int): double', earnedMonthlyAverage],
	['map.piece_wages_last_workdays(int): double', pieceWagesLastWorkdays],
	['map.earned_monthly_average(int, list): double', earnedMonthlyAverage],
	['map.earned_monthly_average(int, list, dyn): double', earnedMonthlyAverage],
	['map.average_daily_wage(int, list): double', averageDailyWage],
	['map.average_monthly_wage(int, list): double', averageMonthlyWage],
	['map.average_daily_wage(int, list, list): double', averageDailyWage],
	['map.average_monthly_wage(int, list, list): double', averageMonthlyWage],
	['map.service_months_net(list, dyn): int', serviceMonthsNet],
	['map.on_leave(string, list): bool', onLeave],
	['map.service_days_before(dyn, int): int', serviceDaysBefore],
	['map.service_years_on(dyn): int', serviceYearsOn],
	['map.notice_days_remaining(dyn, dyn, dyn): double', noticeDaysRemaining],
	['map.notice_monthly_wages(dyn, dyn, dyn, dyn): double', noticeMonthlyWages],
	['map.payday_notice_days(dyn, dyn, dyn): double', paydayNoticeDays],
	['days_under(int): double', (age) => bound.daysUnder?.(Number(age)) ?? 0],
	[
		'run_hours_before_rest(double): double',
		(minutes) => bound.runHoursBeforeRest?.(decodeNumber(minutes)) ?? 0
	],
	[
		'coverage_days(string, int, int): double',
		(since, age, monthDays) =>
			bound.coverageDays?.(String(since), Number(age), Number(monthDays)) ?? 0
	],
	['map.days(string): double', leaveDays],
	[
		'annual_quantity_exempt(string, dyn): double',
		(code, limit) => bound.annualQuantityExempt?.(String(code), Number(limit)) ?? 0
	],
	[
		'earned_quantity_exempt(string, dyn): double',
		(code, limit) => bound.earnedQuantityExempt?.(String(code), Number(limit)) ?? 0
	],
	[
		'earned_monthly_excess(string, dyn): double',
		(code, limit) => bound.earnedMonthlyExcess?.(String(code), Number(limit)) ?? 0
	],
	[
		'earned_daily_excess(string, dyn): double',
		(code, limit) => bound.earnedDailyExcess?.(String(code), Number(limit)) ?? 0
	],
	['code(string): double', (catalogueCode) => bound.code?.(String(catalogueCode)) ?? 0],
	[
		'earned_average(string, int, int): double',
		(code, monthsBack, months) =>
			bound.earnedAverage?.(String(code), Number(monthsBack), Number(months)) ?? 0
	],
	[
		'earned_average(list, int, int): double',
		(codes, monthsBack, months) =>
			(Array.isArray(codes) ? codes : []).reduce(
				(sum: number, code) =>
					sum + (bound.earnedAverage?.(String(code), Number(monthsBack), Number(months)) ?? 0),
				0
			)
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
		annualQuantityExempt: options.annualQuantityExempt,
		earnedQuantityExempt: options.earnedQuantityExempt,
		earnedMonthlyExcess: options.earnedMonthlyExcess,
		earnedDailyExcess: options.earnedDailyExcess,
		earnedAverage: options.earnedAverage,
		daysUnder: options.daysUnder,
		runHoursBeforeRest: options.runHoursBeforeRest,
		coverageDays: options.coverageDays,
		calendar: options.calendar,
		tables: options.tables,
		history: options.history,
		company: options.company
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
for (const entry of REGISTERED_FUNCTIONS)
	environment.registerFunction(entry.signature, (...args: unknown[]) =>
		entry.handler(bound, ...args)
	);

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

/** One evaluation, or, inside a line trace scope (`lib/trace/record.ts`), the observer's recording of it. */
function run(engine: ExpressionEngine, expression: string, context: object): unknown {
	const observe = evaluationObserver();
	return observe == null
		? evaluateBound(engine, expression, context)
		: observe(engine, expression, context, (traced) => evaluateBound(traced, expression, context));
}

let evaluations = 0;
/** How many expressions this isolate has evaluated: the operation count a payroll run's cost guard bounds. */
export const evaluationCount = (): number => evaluations;

/** A program with `engine` bound; an engine that binds no tables or history borrows the context's (`TABLES`, `HISTORY`). */
function evaluateBound(engine: ExpressionEngine, expression: string, context: object): unknown {
	evaluations += 1;
	const program = programFor(expression);
	const tables = engine.tables ?? tablesIn(context);
	const history = engine.history ?? historyIn(context);
	const previous = bound;
	bound =
		tables === engine.tables && history === engine.history
			? engine
			: { ...engine, tables, history };
	try {
		return program(context);
	} finally {
		bound = previous;
	}
}

/** One evaluation with `engine` bound: what every typed evaluator and the write-time compiler run. */
export function evaluateExpression(
	engine: ExpressionEngine,
	expression: string,
	context: object
): unknown {
	return run(engine, expression, context);
}

/** One evaluation under the engine already bound: a person read inside another evaluation keeps it. */
export function evaluateUnderBound(expression: string, context: object): unknown {
	return run(bound, expression, context);
}

export function evaluateNumber(
	engine: ExpressionEngine,
	expression: string,
	context: object
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
	context: object
): boolean {
	const value = evaluateExpression(engine, expression, context);
	if (!Predicate.isBoolean(value))
		throw new Error(`The expression "${expression}" produced ${String(value)}, not a boolean.`);
	return value;
}

/** The same, for the sites that require a `YYYY-MM-DD` date (a duty's `due`). */
export function evaluateDate(
	engine: ExpressionEngine,
	expression: string,
	context: object
): string {
	const value = evaluateExpression(engine, expression, context);
	if (!Predicate.isString(value) || !isCalendarDate(value))
		throw new Error(
			`The expression "${expression}" produced ${String(value)}, not a YYYY-MM-DD day.`
		);
	return value;
}

/** The one engine every site without a version-bound helper shares; it holds no state. */
export const expressionEngine = runtimeExpressionEngine();
