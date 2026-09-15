/**
 * The work band engine of RFC 0001 §6.
 *
 * A work day is priced by the version's `bands`, in order. Each band whose `when` holds consumes
 * a slice of the day's worked hours (`take_hours`), priced by `price_amount` — a money expression
 * for that whole slice, which reads the hours actually consumed as `hours`. A band may funnel the
 * portion of its slice above a named limit (`funnel_above_hours`) into the INCENTIVE line at the
 * same award, which is how overtime past a statutory ceiling becomes the INCENTIVE line while
 * keeping the multiple of the band it came from.
 *
 * Nothing here classifies or discards hours: attendance is priced as it happened, and compliance
 * belongs to the schedule that should have prevented it.
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

/** The two lines a band can emit: every band settles as OVERTIME, its funnel as INCENTIVE. */
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
	readonly breakMinutes: number;
	readonly rosterCode: string;
	readonly holidayKind: string;
	readonly holidayName: string;
	readonly monthOvertimeHours: number;
	readonly consecutiveHours: number;
	readonly continuousAttendance: boolean;
};

export type WorkBandRates = {
	readonly ordinaryHour: number;
	readonly ordinaryDay: number;
	readonly dayWage: number;
};

function contextOf(options: {
	readonly person: PersonContext;
	readonly day: WorkBandDay;
	readonly rates: WorkBandRates;
	readonly limits: Record<string, number>;
}): Record<string, unknown> {
	const { day, rates, limits, person } = options;
	return {
		person,
		date: day.date,
		day_type: day.dayType,
		worked_hours: day.workedHours,
		normal_hours: day.normalHours,
		hours_beyond_normal:
			day.dayType === 'ORDINARY'
				? day.overtimeHours
				: Math.max(0, day.overtimeHours - day.normalHours),
		hours_from_start_fraction:
			day.dayType === 'ORDINARY'
				? 0
				: day.normalHours > 0
					? Math.min(1, day.overtimeHours / day.normalHours)
					: 0,
		total_work_hours: day.workedHours,
		overtime_hours: day.overtimeHours,
		month_overtime_hours: day.monthOvertimeHours,
		consecutive_hours: day.consecutiveHours,
		continuous_attendance: day.continuousAttendance,
		roster_code: day.rosterCode,
		break_minutes: day.breakMinutes,
		ordinary_hour: rates.ordinaryHour,
		ordinary_day: rates.ordinaryDay,
		day_wage: rates.dayWage,
		// The slice a band consumed, for `price_amount`; zero until a band has one.
		hours: 0,
		limits,
		holiday: { kind: day.holidayKind, name: day.holidayName }
	};
}

/**
 * Price one day's bands. Rows are ordered by band; a funnel row follows the row it came from.
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
	let cursor = 0;
	for (const band of work.bands) {
		if (cursor >= day.workedHours) break;
		if (!evaluateBoolean(engine, band.when, context)) continue;
		const take = Math.max(0, evaluateNumber(engine, band.take_hours, context));
		const hours = Math.min(take, day.workedHours - cursor);
		if (hours <= 0) continue;
		slices.push({ band, hours, cursor });
		cursor += hours;
	}
	const base = Math.max(0, day.workedHours - cursor);
	const rows: WorkBandRow[] = [];
	for (const slice of slices) {
		const priced = { ...context, hours: slice.hours };
		const amount = Math.max(0, evaluateNumber(engine, slice.band.price_amount, priced));
		const start = base + slice.cursor;
		const end = start + slice.hours;
		let funnelHours = 0;
		if (slice.band.funnel_above_hours != null) {
			const above = evaluateNumber(engine, slice.band.funnel_above_hours, priced);
			funnelHours = Math.max(0, end - Math.max(start, above));
			funnelHours = Math.min(funnelHours, slice.hours);
		}
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
