/**
 * The work band engine
 *
 * A work day is priced by the version's `bands`, in order. Each band whose `when` holds consumes
 * a slice of the day's worked hours (`take_hours`), priced by `price_amount` — a money expression
 * for that whole slice, which reads the hours actually consumed as `hours`. The day's planned
 * incentive hours (`work_days.incentive_hours`) are the top of its payable hours: the part of any
 * slice that falls in them settles on that band's INCENTIVE line at the same award, so an
 * incentive hour keeps the multiple of the band it lands in. Nothing here decides how many hours
 * are incentive: the split was made when the day was written (`splitPlannedOvertime`).
 */

import type { WorkRateBand, WorkRules } from '../../datatypes/work_rules/+definition.js';
import type { PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';
import {
	expressionEngine,
	evaluateBoolean,
	evaluateNumber,
	type ExpressionEngine
} from '../expressions/evaluate.js';
import { evaluatedLimits } from '../scheduling/work-limits.js';

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
	readonly workDayId: string;
	readonly date: string;
	readonly dayType: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'SPECIAL_HOLIDAY' | 'OFF_DAY';
	/** The day's actual worked hours, net of the recorded break: the consumption space. */
	readonly workedHours: number;
	readonly normalHours: number;
	/**
	 * The payable units the ladder prices, already net of any break shortfall and floored: the
	 * overrun on an ordinary day, the whole day on a rest or holiday.
	 */
	readonly overtimeHours: number;
	/** The top of `overtimeHours` planned beyond the limits (`work_days.incentive_hours`); absent is none. */
	readonly incentiveHours?: number;
	readonly breakMinutes: number;
	readonly holidayKind: string;
	readonly holidayName: string;
	/** Present or on paid leave on the workday before the holiday (`presentBeforeHoliday`); true on other days. */
	readonly holidayPriorPresent?: boolean;
	readonly consecutiveHours: number;
	readonly continuousAttendance: boolean;
	/** The roster's weekly rest day, whatever holiday precedence called the day. */
	readonly restDay: boolean;
	/** The statutory rest day (TW 例假), whatever the holiday made it. */
	readonly statutoryRest?: boolean;
	/** The roster's unassigned day (OFF) before a holiday was overlaid on it. */
	readonly offDay: boolean;
	/** Hours inside the regime's night window, 0 where the version prices none. */
	readonly nightHours: number;
	/** `work_days.requested_by`: EMPLOYER unless the row says EMPLOYEE. */
	readonly requestedBy: string;
	/** `work_days.emergency_cause`: the extra hours were forced by an emergency. */
	readonly emergency?: boolean;
	/** `work_days.time_off_in_lieu`: the worker elected time off instead of overtime pay. */
	readonly timeOffInLieu?: boolean;
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
		normal_hours: day.normalHours,
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
		holiday: {
			kind: day.holidayKind,
			name: day.holidayName,
			prior_day_present: day.holidayPriorPresent ?? true
		}
	};
}

/** Whether a day-level predicate holds over the same context the bands read (a limit's `counts_day_when`). */
export function workDayHolds(options: {
	readonly work: WorkRules;
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
	readonly engine?: ExpressionEngine;
}): { readonly ordinary: number; readonly overtime: number } {
	const { premium } = options;
	if (typeof premium.ordinary_add === 'number' && typeof premium.overtime_add === 'number')
		return { ordinary: premium.ordinary_add, overtime: premium.overtime_add };
	const engine = options.engine ?? expressionEngine;
	const context = contextOf({
		person: options.person,
		day: options.day,
		rates: options.rates,
		limits: evaluatedLimits(options.work.limits, options.day.breakMinutes)
	});
	const read = (add: number | string) =>
		typeof add === 'number' ? add : Math.max(0, evaluateNumber(engine, add, context));
	return { ordinary: read(premium.ordinary_add), overtime: read(premium.overtime_add) };
}

/**
 * Price one day's bands. Rows are ordered by band; an incentive row follows the row it came from.
 */
export function priceWorkDay(options: {
	readonly work: WorkRules;
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
	readonly engine?: ExpressionEngine;
}): WorkBandRow[] {
	const { work, day } = options;
	const limits = evaluatedLimits(work.limits, day.breakMinutes);
	const engine = options.engine ?? expressionEngine;
	const context = contextOf({ person: options.person, day, rates: options.rates, limits });
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
		const band = work.bands.find(
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
						line: OVERTIME_LINE,
						label: band.label,
						hours: 0,
						amount,
						rate: 0,
						ruleKey: `${OVERTIME_LINE}:${band.label}`
					}
				]
			: [];
	}
	let cursor = 0;
	for (const band of work.bands) {
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
				line: OVERTIME_LINE,
				label: slice.band.label,
				hours: slice.hours - funnelHours,
				amount: mainAmount,
				rate: slice.hours > 0 ? amount / slice.hours : 0,
				ruleKey: `${OVERTIME_LINE}:${slice.band.label}`
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
