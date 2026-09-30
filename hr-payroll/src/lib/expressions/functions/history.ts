/**
 * The history accessor (E4): windows over a person's past and the saved rows inside them.
 *
 * A window is a span map `{from, to}` (as `span(a, b)` builds it). The window functions build the
 * usual ones — `months_before(d, n[, skip])`, `days_before(d, n)`, `year_of(d[, start_month])`,
 * `service_year_of(d, start)` — and `history.slips|days|leave|terms|external(…)` list what was saved
 * in one. `rolling(list, n)` turns a list into its runs of n. Every average, floor and threshold is
 * the stored expression's own: `sum(history.slips(months_before(period.start, 3)).map(s, s.classes.WAGES)) / 3`.
 *
 * The rows come from `ExpressionEngine.history` (`payroll/history.ts`); a site that binds none
 * refuses, because an empty past read as zero is a wrong answer, not a default.
 */

import { addDays, monthBounds, monthDay, monthKey, shiftPeriod } from '../../payroll/run/dates.js';
import { isCalendarDate } from '../../iso-day.js';
import type { HistoryAccess, HistoryWindow } from '../../payroll/history.js';
import type { ExpressionFunctionEntry } from './index.js';

const EMPTY: HistoryWindow = { from: '', to: '' };

/**
 * A person context's own history: the run binds each person's accessor on the context it builds,
 * under this key, invisible to CEL; an evaluation whose engine binds none reads it (as `TABLES`).
 */
export const HISTORY: unique symbol = Symbol('person history');

/** The accessor `context` (or the person it carries) was built with, if any. */
export const historyIn = (context: unknown): HistoryAccess | undefined => {
	const own = (value: unknown) =>
		(value as { readonly [HISTORY]?: HistoryAccess } | null | undefined)?.[HISTORY];
	return own(context) ?? own((context as { readonly person?: unknown } | null)?.person);
};

const windowOf = (value: unknown): HistoryWindow => {
	const map = (value ?? {}) as Partial<Record<keyof HistoryWindow, unknown>>;
	const from = String(map.from ?? '');
	const to = String(map.to ?? '');
	return isCalendarDate(from) && isCalendarDate(to) && from <= to ? { from, to } : EMPTY;
};

const between = (from: string, to: string): HistoryWindow => (from <= to ? { from, to } : EMPTY);

/** The `n` whole calendar months before the month of `date`, after skipping the `skip` latest. */
export function monthsBefore(date: string, n: number, skip = 0): HistoryWindow {
	if (!isCalendarDate(date) || n < 1 || skip < 0) return EMPTY;
	const month = monthKey(date);
	return between(
		monthBounds(shiftPeriod(month, -(n + skip))).start,
		monthBounds(shiftPeriod(month, -(1 + skip))).end
	);
}

/** The `n` days before `date`, `date` itself not counted. */
export function daysBefore(date: string, n: number): HistoryWindow {
	return !isCalendarDate(date) || n < 1 ? EMPTY : between(addDays(date, -n), addDays(date, -1));
}

/** The twelve-month year starting in `startMonth` (1–12) that holds `date`. */
export function yearOf(date: string, startMonth = 1): HistoryWindow {
	if (!isCalendarDate(date) || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12)
		return EMPTY;
	const year = Number(date.slice(0, 4));
	const opens = (y: number) => monthDay(y, startMonth - 1, 1);
	const start = opens(year) <= date ? opens(year) : opens(year - 1);
	return between(start, addDays(opens(Number(start.slice(0, 4)) + 1), -1));
}

/** The service year holding `date`: from the latest anniversary of `start` on or before it. */
export function serviceYearOf(date: string, start: string): HistoryWindow {
	if (!isCalendarDate(date) || !isCalendarDate(start) || date < start) return EMPTY;
	const month = Number(start.slice(5, 7)) - 1;
	const day = Number(start.slice(8, 10));
	const anniversary = (y: number) => monthDay(y, month, day);
	const year = Number(date.slice(0, 4));
	const opens = anniversary(year) <= date ? year : year - 1;
	return between(anniversary(opens), addDays(anniversary(opens + 1), -1));
}

/** Every run of `n` consecutive items of `list`, in order; none where the list is shorter. */
export function rolling(list: readonly unknown[], n: number): unknown[][] {
	if (!Number.isInteger(n) || n < 1) return [];
	return Array.from({ length: Math.max(0, list.length - n + 1) }, (_, index) =>
		list.slice(index, index + n)
	);
}

const accessOf = (engine: { readonly history?: HistoryAccess | undefined }, fn: string) => {
	if (engine.history == null) throw new Error(`history.${fn}(): this site has no history bound.`);
	return engine.history;
};

/** The window functions whose every argument after the first is a count that must be a literal. */
const LITERAL_BOUNDS = ['months_before', 'days_before', 'rolling'] as const;

/** The arguments of each call of `name` in `expression`, split at top-level commas. */
function callsOf(expression: string, name: string): string[][] {
	const calls: string[][] = [];
	const pattern = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g');
	for (const match of expression.matchAll(pattern)) {
		const args: string[] = [];
		let depth = 0;
		let current = '';
		for (const char of expression.slice(match.index + match[0].length)) {
			if (depth === 0 && (char === ',' || char === ')')) {
				args.push(current.trim());
				current = '';
				if (char === ')') break;
				continue;
			}
			if (char === '(' || char === '[' || char === '{') depth++;
			if (char === ')' || char === ']' || char === '}') depth--;
			current += char;
		}
		calls.push(args);
	}
	return calls;
}

const INTEGER = /^\d+$/;

/**
 * The first window whose size is not a literal: the run loads a bounded past, sized from the
 * literals (`historyReachDays`), so `months_before(d, scheme.facts.n)` is refused at write time.
 */
export function historyWindowFault(expression: string): string | null {
	for (const name of LITERAL_BOUNDS)
		for (const args of callsOf(expression, name))
			for (const count of args.slice(1))
				if (!INTEGER.test(count))
					return `${name}(…) takes its count as a whole-number literal; got ${count}.`;
	return null;
}

/**
 * How many days before a run's period the expressions' `history.days` windows can reach: the
 * largest literal window, a month counted as 31 days plus the current month. 0 where no expression
 * reads days. A window built otherwise (`span(…)`) refuses at run time beyond this horizon.
 */
export function historyReachDays(expressions: readonly string[]): number {
	let reach = 0;
	for (const expression of expressions) {
		if (!/\bhistory\s*\.\s*days\s*\(/.test(expression)) continue;
		for (const args of callsOf(expression, 'months_before'))
			reach = Math.max(reach, ((Number(args[1]) || 0) + (Number(args[2]) || 0) + 1) * 31);
		for (const args of callsOf(expression, 'days_before'))
			reach = Math.max(reach, Number(args[1]) || 0);
		if (/\b(service_)?year_of\s*\(/.test(expression)) reach = Math.max(reach, 12 * 31);
	}
	return reach;
}

export const HISTORY_FUNCTIONS: readonly ExpressionFunctionEntry[] = [
	{
		signature: 'months_before(string, int): map',
		handler: (_engine, date, n) => monthsBefore(String(date), Number(n)),
		doc: {
			path: 'months_before(date, n[, skip])',
			description:
				'The window of the n whole calendar months before the month of date, after skipping the skip latest; n and skip are literals'
		}
	},
	{
		signature: 'months_before(string, int, int): map',
		handler: (_engine, date, n, skip) => monthsBefore(String(date), Number(n), Number(skip))
	},
	{
		signature: 'days_before(string, int): map',
		handler: (_engine, date, n) => daysBefore(String(date), Number(n)),
		doc: {
			path: 'days_before(date, n)',
			description: 'The window of the n days before date, date not counted; n is a literal'
		}
	},
	{
		signature: 'year_of(string): map',
		handler: (_engine, date) => yearOf(String(date)),
		doc: {
			path: 'year_of(date[, start_month])',
			description:
				'The window of the twelve-month year holding date, opening on the 1st of start_month (1–12; January where omitted) — a tax year to date is `span(year_of(d, m).from, add_days(d, -1))`'
		}
	},
	{
		signature: 'year_of(string, int): map',
		handler: (_engine, date, month) => yearOf(String(date), Number(month))
	},
	{
		signature: 'service_year_of(string, string): map',
		handler: (_engine, date, start) => serviceYearOf(String(date), String(start)),
		doc: {
			path: 'service_year_of(date, start)',
			description:
				'The window of the service year holding date: from the latest anniversary of start'
		}
	},
	{
		signature: 'rolling(list, int): list',
		handler: (_engine, list, n) => rolling(Array.isArray(list) ? list : [], Number(n)),
		doc: {
			path: 'rolling(list, n)',
			description:
				'Every run of n consecutive items, in order — the busiest 7 days: `max_of(rolling(history.days(w).map(d, d.hours), 7).map(r, sum(r)))`'
		}
	},
	{
		signature: 'map.slips(map): list',
		handler: (engine, _history, window) => accessOf(engine, 'slips').slips(windowOf(window)),
		doc: {
			path: 'history.slips(window)',
			description:
				'Earlier payslips by wage month — a slip paying arrears is one per month it pays — whose first covered day is in the window, as `{payslip_id, wage_month, pay_month, start, end, status, paid_on, opening, lines.<code>, classes.<class>, bases.<scheme>, days.{covered, unpaid}, leave.<code>, recorded.{normal_wages, ordinary_wages, ordinary_days}}`; an opening month recorded before this workspace has `opening` true and its figures in `recorded`'
		}
	},
	{
		signature: 'map.days(map): list',
		handler: (engine, _history, window) => accessOf(engine, 'days').days(windowOf(window)),
		doc: {
			path: 'history.days(window)',
			description:
				'Every calendar day of the window as `{date, recorded, hours, overtime_hours, piece_units, facts}`; `recorded` is false where no work day was saved'
		}
	},
	{
		signature: 'map.leave(map): list',
		handler: (engine, _history, window) => accessOf(engine, 'leave').leave(windowOf(window)),
		doc: {
			path: 'history.leave(window)',
			description:
				'Approved time off touching the window, one per episode, as `{episode, code, from, to, days (inside the window), total_days}`'
		}
	},
	{
		signature: 'map.terms(map): list',
		handler: (engine, _history, window) => accessOf(engine, 'terms').terms(windowOf(window)),
		doc: {
			path: 'history.terms(window)',
			description:
				'The terms revisions touching the window, oldest first, with their fields and `{from, to}` (`to` empty while open) — a contract count is `history.terms(w).filter(t, …).size()`'
		}
	},
	{
		signature: 'map.external(string, map): list',
		handler: (engine, _history, kind, window) =>
			accessOf(engine, 'external').external(String(kind), windowOf(window)),
		doc: {
			path: 'history.external(kind, window)',
			description:
				'The person’s recorded history of one `history_kinds` code outside this payroll (a prior employer’s year to date, insured periods), clipped to the window, as `{from, to, days, facts.<key>}`'
		}
	}
];
