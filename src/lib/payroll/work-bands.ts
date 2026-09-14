/**
 * The work band engine of RFC 0001 §6.
 *
 * A work day is priced by the version's `rates.bands`, in order. Each band whose `when` holds
 * consumes a slice of the day's worked hours (`take`), priced by `price` — a CEL money expression
 * for that whole slice. A band may funnel the portion of its slice above a named limit into
 * another line at the same award, which is how overtime past a statutory ceiling becomes the
 * INCENTIVE line while keeping the multiple of the band it came from.
 *
 * Nothing here classifies or discards hours: attendance is priced as it happened, and compliance
 * belongs to the schedule that should have prevented it.
 */

import type { WorkRateBand, WorkRules } from '../../datatypes/work_rules/+definition.js';
import type { PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';
import {
	evaluateBoolean,
	evaluateNumber,
	runtimeExpressionEngine,
	type ExpressionEngine
} from '../expressions/evaluate.js';
import { evaluatedLimits } from '../scheduling/work-limits.js';

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

/** The band key a priced row maps back to; the component's identity inside Work. */
function workBandKey(line: string, label: string): string {
	return `${line}:${label}`;
}

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
		paid_minutes: 0,
		break_minutes: day.breakMinutes,
		start_time: '',
		end_time: '',
		ordinary_hour: rates.ordinaryHour,
		ordinary_day: rates.ordinaryDay,
		day_wage: rates.dayWage,
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
	const engine =
		options.engine ??
		runtimeExpressionEngine({
			limits,
			minimumWage: () => 0,
			calendarDays: () => 0,
			workingDays: () => 0
		});
	const context = contextOf({ person: options.person, day, rates: options.rates, limits });
	const slices: {
		readonly band: WorkRateBand;
		readonly hours: number;
		readonly cursor: number;
	}[] = [];
	let cursor = 0;
	for (const band of work.rates.bands) {
		if (cursor >= day.workedHours) break;
		if (!evaluateBoolean(engine, band.when, context)) continue;
		const take = Math.max(0, evaluateNumber(engine, band.take, context));
		const hours = Math.min(take, day.workedHours - cursor);
		if (hours <= 0) continue;
		slices.push({ band, hours, cursor });
		cursor += hours;
	}
	const base = Math.max(0, day.workedHours - cursor);
	const rows: WorkBandRow[] = [];
	for (const slice of slices) {
		const amount = Math.max(0, evaluateNumber(engine, slice.band.price, context));
		const start = base + slice.cursor;
		const end = start + slice.hours;
		let funnelHours = 0;
		if (slice.band.funnel != null) {
			const above = evaluateNumber(engine, slice.band.funnel.above, context);
			funnelHours = Math.max(0, end - Math.max(start, above));
			funnelHours = Math.min(funnelHours, slice.hours);
		}
		const funnelAmount = slice.hours > 0 ? (amount * funnelHours) / slice.hours : 0;
		const mainAmount = amount - funnelAmount;
		if (mainAmount > 0)
			rows.push({
				workDayId: day.workDayId,
				line: slice.band.line,
				label: slice.band.label,
				hours: slice.hours - funnelHours,
				amount: mainAmount,
				rate: slice.hours > 0 ? amount / slice.hours : 0,
				ruleKey: workBandKey(slice.band.line, slice.band.label)
			});
		if (funnelHours > 0 && slice.band.funnel != null)
			rows.push({
				workDayId: day.workDayId,
				line: slice.band.funnel.line,
				label: slice.band.label,
				hours: funnelHours,
				amount: funnelAmount,
				rate: slice.hours > 0 ? amount / slice.hours : 0,
				ruleKey: workBandKey(slice.band.funnel.line, slice.band.label)
			});
	}
	return rows;
}
