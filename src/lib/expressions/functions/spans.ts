/**
 * Date spans: an inclusive run of calendar days, and what the person's calendar says of each.
 *
 * `span(from, to)` is a map `{from, to}`; its methods count its days. The day kinds come from the
 * run's calendar (`ExpressionEngine.calendar`, the roster, pattern and holiday rows the run already
 * resolved); a site that binds none reads every kind as empty, so its working, rest and holiday
 * counts are 0 while the calendar counts stay exact. A per-day condition or a per-day total is
 * CEL over `days()`: `span(a, b).days().filter(d, d.kind == 'REST_DAY').size()`,
 * `sum(span(a, b).days().map(d, d.facts.output))`.
 */

import {
	addDays,
	daysBetween,
	exactMonths,
	inclusiveDays,
	monthDays
} from '../../payroll/run/dates.js';
import { isCalendarDate } from '../../iso-day.js';
import type { ExpressionFunctionEntry } from './index.js';

/** One day as the run's calendar states it: its day type and the day's declared inputs. */
export type SpanDay = {
	/** ORDINARY | REST_DAY | OFF_DAY | PUBLIC_HOLIDAY | SPECIAL_HOLIDAY, or '' where unknown. */
	readonly kind: string;
	readonly facts?: Readonly<Record<string, unknown>> | undefined;
};

type Span = { readonly from: string; readonly to: string };

const EMPTY: Span = { from: '', to: '' };

/** A span of two calendar dates in order; anything else is the empty span. */
function spanOf(from: unknown, to: unknown): Span {
	const start = String(from);
	const end = String(to);
	return isCalendarDate(start) && isCalendarDate(end) && start <= end
		? { from: start, to: end }
		: EMPTY;
}

const asSpan = (value: unknown): Span => {
	const map = (value ?? {}) as Partial<Record<keyof Span, unknown>>;
	return spanOf(map.from, map.to);
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const kindCount =
	(kinds: readonly string[]): ExpressionFunctionEntry['handler'] =>
	(engine, value) => {
		const span = asSpan(value);
		if (span.from === '' || engine.calendar == null) return 0;
		return daysBetween(span.from, span.to).filter((day) =>
			kinds.includes(engine.calendar?.(day)?.kind ?? '')
		).length;
	};

export const SPAN_FUNCTIONS: readonly ExpressionFunctionEntry[] = [
	{
		signature: 'span(string, string): map',
		handler: (_engine, from, to) => spanOf(from, to),
		doc: {
			path: 'span(from, to)',
			description:
				'The inclusive span of `YYYY-MM-DD` days from `from` through `to`; empty when either is empty or `to` is before `from`. Methods: calendar_days(), working_days(), rest_days(), holidays(), months(), days(), intersect(other), contains(date)'
		}
	},
	{
		signature: 'map.calendar_days(): double',
		handler: (_engine, value) => {
			const span = asSpan(value);
			return span.from === '' ? 0 : inclusiveDays(span.from, span.to);
		},
		doc: {
			path: 'span.calendar_days()',
			description: 'Calendar days in the span, both ends counted'
		}
	},
	{
		signature: 'map.working_days(): double',
		handler: kindCount(['ORDINARY']),
		doc: {
			path: 'span.working_days()',
			description:
				'Days of the span the person’s calendar marks ORDINARY; 0 where the site binds no calendar'
		}
	},
	{
		signature: 'map.rest_days(): double',
		handler: kindCount(['REST_DAY', 'OFF_DAY']),
		doc: {
			path: 'span.rest_days()',
			description: 'Days of the span the calendar marks REST_DAY or OFF_DAY'
		}
	},
	{
		signature: 'map.holidays(): double',
		handler: kindCount(['PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY']),
		doc: {
			path: 'span.holidays()',
			description: 'Days of the span the calendar marks PUBLIC_HOLIDAY or SPECIAL_HOLIDAY'
		}
	},
	{
		signature: 'map.months(): double',
		handler: (_engine, value) => {
			const span = asSpan(value);
			return span.from === '' ? 0 : exactMonths(span.from, addDays(span.to, 1));
		},
		doc: {
			path: 'span.months()',
			description: 'Months the span covers: completed months plus the part month by its days'
		}
	},
	{
		signature: 'map.days(): list',
		handler: (engine, value) => {
			const span = asSpan(value);
			if (span.from === '') return [];
			return daysBetween(span.from, span.to).map((date) => {
				const day = engine.calendar?.(date);
				return {
					date,
					weekday: WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!,
					kind: day?.kind ?? '',
					facts: day?.facts ?? {}
				};
			});
		},
		doc: {
			path: 'span.days()',
			description:
				'Every day of the span as `{date, weekday (MON…SUN), kind, facts}` — filter or total it: `span(a, b).days().filter(d, d.kind == "ORDINARY").size()`'
		}
	},
	{
		signature: 'map.intersect(map): map',
		handler: (_engine, value, other) => {
			const a = asSpan(value);
			const b = asSpan(other);
			if (a.from === '' || b.from === '') return EMPTY;
			return spanOf(a.from > b.from ? a.from : b.from, a.to < b.to ? a.to : b.to);
		},
		doc: { path: 'span.intersect(other)', description: 'The days two spans share; empty when none' }
	},
	{
		signature: 'map.contains(string): bool',
		handler: (_engine, value, date) => {
			const span = asSpan(value);
			const day = String(date);
			return span.from !== '' && isCalendarDate(day) && span.from <= day && day <= span.to;
		},
		doc: {
			path: 'span.contains(date)',
			description: 'Whether a `YYYY-MM-DD` day falls in the span'
		}
	},
	{
		signature: 'month_end(string): string',
		handler: (_engine, date) => {
			const day = String(date);
			return isCalendarDate(day)
				? `${day.slice(0, 8)}${String(monthDays(day)).padStart(2, '0')}`
				: '';
		},
		doc: {
			path: 'month_end(date)',
			description:
				'The last day of the month a `YYYY-MM-DD` day falls in — `month_end(add_months(period.start, 1))` is the last day of the next month; empty for an empty day'
		}
	},
	{
		signature: 'add_days(string, int): string',
		handler: (_engine, date, days) => {
			const day = String(date);
			return isCalendarDate(day) ? addDays(day, Number(days)) : '';
		},
		doc: {
			path: 'add_days(date, n)',
			description:
				'The `YYYY-MM-DD` day n days after date (before it for a negative n); empty for an empty day'
		}
	}
];
