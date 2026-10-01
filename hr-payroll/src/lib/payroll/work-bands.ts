/**
 * The work band engine
 *
 * A work day is priced by the version's `bands`, in order. Each band whose `when` holds consumes
 * a slice of the day's worked hours (`take_hours`), priced by `price_amount` — a money expression
 * for that whole slice, which reads the hours actually consumed as `hours`. The day's planned
 * incentive hours (`work_days.incentive_hours`) are the top of its payable hours: the part of any
 * slice that falls in them settles on that band's INCENTIVE line at the same award, so an
 * incentive hour keeps the multiple of the band it lands in. Nothing here decides how many hours
 * are incentive: they are keyed on the day (split only by the import, `splitPlannedOvertime`).
 */

import type { WorkLimit, WorkRateBand, WorkRules } from '../datatypes/work_rules.js';
import type { PersonContext } from '../../lib/payroll/run/eligibility.js';
import {
	expressionEngine,
	evaluateBoolean,
	evaluateNumber,
	type ExpressionEngine
} from '../expressions/evaluate.js';
import { evaluatedLimits } from '../scheduling/work-limits.js';
import * as Predicate from 'effect/Predicate';
import { weekStart } from './run/dates.js';

/** The two lines a band can emit: planned overtime settles as OVERTIME, incentive hours as INCENTIVE. */
export const OVERTIME_LINE = 'OVERTIME';
export const INCENTIVE_LINE = 'INCENTIVE';

/** One finished line the bands produced for one work day. */
export type WorkBandRow = {
	readonly workDayId: string;
	readonly line: string;
	readonly label: string;
	readonly hours: number;
	readonly amount: number;
	readonly rate: number;
	readonly ruleKey: string;
};

/** One priced person-day, as the bands read it. */
export type WorkBandDay = {
	readonly priorHours?: Readonly<Record<string, number>> | undefined;
	/** Actual attendance, distinct from the approved units a band may pay. */
	readonly actualWorkedHours?: number | undefined;
	readonly workDayId: string;
	readonly date: string;
	readonly dayType: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'SPECIAL_HOLIDAY' | 'OFF_DAY';
	/** The day's actual worked hours, net of the recorded break: the consumption space. */
	readonly workedHours: number;
	readonly normalHours: number;
	readonly comparableFullTimeDailyHours?: number | undefined;
	/**
	 * The payable units the ladder prices, already net of any break shortfall and floored: the
	 * overrun on an ordinary day, the whole day on a rest or holiday.
	 */
	readonly overtimeHours: number;
	/** The top of `overtimeHours` planned beyond the limits (`work_days.incentive_hours`); absent is none. */
	readonly incentiveHours?: number | undefined;
	readonly breakMinutes: number;
	readonly holidayKind: string;
	readonly holidayName: string;
	/** Present or on paid leave on the workday before the holiday (`presentBeforeHoliday`); true on other days. */
	readonly holidayPriorPresent?: boolean | undefined;
	/** Evidence-based entitlement to holiday salary, distinct from wages for actual work. */
	readonly holidayPayEligible?: boolean | undefined;
	readonly consecutiveHours: number;
	readonly continuousAttendance: boolean;
	/** The roster's weekly rest day, whatever holiday precedence called the day. */
	readonly restDay: boolean;
	/** The statutory rest day (TW 例假), whatever the holiday made it. */
	readonly statutoryRest?: boolean | undefined;
	/** The roster's unassigned day (OFF) before a holiday was overlaid on it. */
	readonly offDay: boolean;
	/** Hours inside the regime's night window, 0 where the version prices none. */
	readonly nightHours: number;
	/** `work_days.requested_by`: EMPLOYER unless the row says EMPLOYEE. */
	readonly requestedBy: string;
	/** `work_days.emergency_cause`: the extra hours were forced by an emergency. */
	readonly emergency?: boolean | undefined;
	/** `work_days.time_off_in_lieu`: the worker elected time off instead of overtime pay. */
	readonly timeOffInLieu?: boolean | undefined;
	/** `work_days.facts`, the version's `work_day_facts` with declared defaults filled; `day_facts`. */
	readonly facts?: Readonly<Record<string, string | number | boolean>> | undefined;
	/** The keys the day actually records, before defaults; `day_fact_keys`. */
	readonly factKeys?: readonly string[] | undefined;
};

export type WorkBandRates = {
	readonly ordinaryHour: number;
	readonly dayWage: number;
};

/**
 * An OFF day is a working-week day the roster left unassigned, not a rest day: every hour worked
 * on it is beyond the normal week, so the bands read it as ORDINARY overtime (the same reading
 * `ruleDayType` and the monthly counter make). Left as its own type it matched no band and every
 * OFF-day hour was priced at nothing.
 */
const isOrdinary = (day: WorkBandDay) => day.dayType === 'ORDINARY' || day.dayType === 'OFF_DAY';

function contextOf(options: {
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
	readonly limits: Record<string, number>;
}): Record<string, unknown> {
	const { day, rates, limits, person } = options;
	const ordinary = isOrdinary(day);
	return {
		person,
		date: day.date,
		day_type: ordinary ? 'ORDINARY' : day.dayType,
		worked_hours: day.workedHours,
		actual_worked_hours: day.actualWorkedHours ?? day.workedHours,
		normal_hours: day.normalHours,
		comparable_full_time_daily_hours:
			day.comparableFullTimeDailyHours ?? person.terms.comparable_full_time_daily_hours,
		hours_beyond_normal: ordinary
			? day.overtimeHours
			: Math.max(0, day.overtimeHours - day.normalHours),
		hours_from_start_fraction: ordinary
			? 0
			: day.normalHours > 0
				? Math.min(1, day.overtimeHours / day.normalHours)
				: 0,
		overtime_hours: day.overtimeHours,
		consecutive_hours: day.consecutiveHours,
		continuous_attendance: day.continuousAttendance,
		rest_day: day.restDay ?? false,
		statutory_rest: day.statutoryRest ?? false,
		off_day: day.offDay ?? false,
		night_hours: day.nightHours ?? 0,
		requested_by: day.requestedBy ?? 'EMPLOYER',
		emergency_cause: day.emergency ?? false,
		time_off_in_lieu: day.timeOffInLieu ?? false,
		ordinary_hour: rates.ordinaryHour,
		day_wage: rates.dayWage,
		// The slice a band consumed, for `price_amount`; zero until a band has one.
		hours: 0,
		limits,
		prior_hours: day.priorHours ?? {},
		holiday: {
			kind: day.holidayKind,
			name: day.holidayName,
			prior_day_present: day.holidayPriorPresent ?? true,
			pay_eligible: day.holidayPayEligible ?? true
		},
		day_facts: day.facts ?? {},
		day_fact_keys: day.factKeys ?? Object.keys(day.facts ?? {})
	};
}

/** Calendar totals before each day, measured before the payable-window filter. */
export function withPriorWorkHours(options: {
	readonly days: readonly WorkBandDay[];
	readonly workOn: (date: string) => WorkRules;
	readonly personOn: (date: string) => PersonContext;
	readonly ratesOn: (date: string) => WorkBandRates;
}): WorkBandDay[] {
	const totals = new Map<string, number>();
	return options.days
		.toSorted((a, b) => a.date.localeCompare(b.date))
		.map((day) => {
			const work = options.workOn(day.date);
			const priorHours: Record<string, number> = {};
			const counters = (work.counters ?? []).map((counter) => {
				const period =
					counter.period === 'DAY'
						? day.date
						: counter.period === 'WEEK'
							? weekStart(day.date)
							: counter.period === 'MONTH'
								? day.date.slice(0, 7)
								: counter.period === 'QUARTER'
									? `${day.date.slice(0, 4)}-${Math.ceil(Number.parseInt(day.date.slice(5, 7), 10) / 3)}`
									: day.date.slice(0, 4);
				const key = `${counter.key}:${counter.period}:${period}`;
				priorHours[counter.key] = totals.get(key) ?? 0;
				return { counter, key };
			});
			const counted = { ...day, priorHours };
			const context = contextOf({
				person: options.personOn(day.date),
				day: counted,
				rates: options.ratesOn(day.date),
				limits: evaluatedLimits(work.limits, day.breakMinutes)
			});
			for (const { counter, key } of counters) {
				const hours = evaluateNumber(expressionEngine, counter.count_hours, context);
				if (!Number.isFinite(hours) || hours < 0)
					throw new Error(`Work counter ${counter.key} requires non-negative finite hours.`);
				totals.set(key, priorHours[counter.key]! + hours);
			}
			return counted;
		});
}

/** Whether a day-level predicate holds over the same context the bands read (a limit's `counts_day_when`). */
export function workDayHolds(options: {
	readonly work: { readonly limits: readonly WorkLimit[] };
	readonly expression: string;
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
}): boolean {
	const { work, day } = options;
	return evaluateBoolean(
		expressionEngine,
		options.expression,
		contextOf({
			person: options.person,
			day,
			rates: options.rates,
			limits: evaluatedLimits(work.limits, day.breakMinutes)
		})
	);
}

/**
 * The night premium's two adds for one day, as percentages: a figure stands as it is, an
 * expression is read over the same day context the bands see (PH art.86: the add follows the
 * day's own rate — 13 on a rest day, 20 on a regular holiday, 26 where they coincide).
 */
export function nightAddsFor(options: {
	readonly work: WorkRules;
	readonly premium: {
		readonly ordinary_add: number | string;
		readonly overtime_add: number | string;
	};
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
	readonly engine?: ExpressionEngine | undefined;
}): { readonly ordinary: number; readonly overtime: number } {
	const { premium } = options;
	if (Predicate.isNumber(premium.ordinary_add) && Predicate.isNumber(premium.overtime_add))
		return { ordinary: premium.ordinary_add, overtime: premium.overtime_add };
	const engine = options.engine ?? expressionEngine;
	const context = contextOf({
		person: options.person,
		day: options.day,
		rates: options.rates,
		limits: evaluatedLimits(options.work.limits, options.day.breakMinutes)
	});
	const read = (add: number | string) =>
		Predicate.isNumber(add) ? add : Math.max(0, evaluateNumber(engine, add, context));
	return { ordinary: read(premium.ordinary_add), overtime: read(premium.overtime_add) };
}

/** The line a band's rows post to: a normal-day band's component, else its own line, else OVERTIME. */
export const lineOf = (band: Pick<WorkRateBand, 'component' | 'line'>): string =>
	band.component ?? band.line ?? OVERTIME_LINE;

/**
 * Price one day's bands. Rows are ordered by band; an incentive row follows the row it came from.
 * The overtime bands price by default; `normalDay` prices the normal-day bands instead (those
 * naming a `component`), whose rows carry that component as their line. An overtime band naming a
 * `line` posts there instead of OVERTIME.
 */
export function priceWorkDay(options: {
	readonly work: WorkRules;
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
	readonly engine?: ExpressionEngine | undefined;
	readonly normalDay?: boolean | undefined;
}): WorkBandRow[] {
	const { work, day } = options;
	const bands = work.bands.filter(
		(band) => (band.component != null) === (options.normalDay === true)
	);
	const limits = evaluatedLimits(work.limits, day.breakMinutes);
	const engine = options.engine ?? expressionEngine;
	const context = contextOf({ person: options.person, day, rates: options.rates, limits });
	if (
		(work.part_time_comparator_when ?? '').trim() !== '' &&
		evaluateBoolean(engine, work.part_time_comparator_when!, context)
	) {
		const presence = options.person.terms.comparable_full_time_presence;
		const usualHours = options.person.terms.comparable_full_time_daily_hours;
		const dayHours = day.comparableFullTimeDailyHours ?? 0;
		if (presence === 'ABSENT' && (usualHours > 0 || dayHours > 0))
			throw new Error(
				'A declared absence of a comparable full-time employee conflicts with stated comparable hours.'
			);
		if (presence !== 'ABSENT' && !(presence === 'PRESENT' && (dayHours > 0 || usualHours > 0)))
			throw new Error(
				'The comparable full-time employee’s normal daily hours are required for part-time work pay.'
			);
	}
	const slices: {
		readonly band: WorkRateBand;
		readonly hours: number;
		readonly cursor: number;
	}[] = [];
	// The consumption space is the payable hours, never the raw clock: on an ordinary day the
	// bands price the overrun and the worked hours are only the boundary they read; on a rest day
	// or a holiday the whole day is overtime, already floored and net of the unpaid statutory
	// break, and a slice past that priced the break shortfall the statute says is not work.
	const payable = isOrdinary(day) ? day.workedHours : day.overtimeHours;
	// A day with nothing worked is priced by amount, not by the hour: the first band that holds
	// over it and takes no hours (`take_hours` 0) pays what it states — an unworked regular
	// holiday's day wage (PH art.94), a holiday on a non-working day (SG s.88). A band that takes
	// hours prices attendance and is not read here.
	if (payable <= 0) {
		const band = bands.find(
			(candidate) =>
				evaluateBoolean(engine, candidate.when, context) &&
				evaluateNumber(engine, candidate.take_hours, context) <= 0
		);
		if (band == null) return [];
		const amount = Math.max(0, evaluateNumber(engine, band.price_amount, { ...context, hours: 0 }));
		return amount > 0
			? [
					{
						workDayId: day.workDayId,
						line: lineOf(band),
						label: band.label,
						hours: 0,
						amount,
						rate: 0,
						ruleKey: `${lineOf(band)}:${band.label}`
					}
				]
			: [];
	}
	let cursor = 0;
	for (const band of bands) {
		if (cursor >= payable) break;
		if (!evaluateBoolean(engine, band.when, context)) continue;
		const take = Math.max(0, evaluateNumber(engine, band.take_hours, context));
		const hours = Math.min(take, payable - cursor);
		if (hours <= 0) continue;
		slices.push({ band, hours, cursor });
		cursor += hours;
	}
	const base = Math.max(0, payable - cursor);
	const rows: WorkBandRow[] = [];
	for (const slice of slices) {
		const priced = { ...context, hours: slice.hours };
		const amount = Math.max(0, evaluateNumber(engine, slice.band.price_amount, priced));
		const start = base + slice.cursor;
		const end = start + slice.hours;
		const above = payable - (day.incentiveHours ?? 0);
		const funnelHours = Math.min(slice.hours, Math.max(0, end - Math.max(start, above)));
		const funnelAmount = slice.hours > 0 ? (amount * funnelHours) / slice.hours : 0;
		const mainAmount = amount - funnelAmount;
		if (mainAmount > 0)
			rows.push({
				workDayId: day.workDayId,
				line: lineOf(slice.band),
				label: slice.band.label,
				hours: slice.hours - funnelHours,
				amount: mainAmount,
				rate: slice.hours > 0 ? amount / slice.hours : 0,
				ruleKey: `${lineOf(slice.band)}:${slice.band.label}`
			});
		if (funnelHours > 0)
			rows.push({
				workDayId: day.workDayId,
				line: INCENTIVE_LINE,
				label: slice.band.label,
				hours: funnelHours,
				amount: funnelAmount,
				rate: slice.hours > 0 ? amount / slice.hours : 0,
				ruleKey: `${INCENTIVE_LINE}:${slice.band.label}`
			});
	}
	return rows;
}
