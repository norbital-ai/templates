import { PlainDate } from '@norbital-ai/std/date';
import {
	PAYROLL_TIME_ZONE,
	calendarDateInTimeZone,
	weeklyInstalments
} from '../../payroll_engine/foundation.js';

export function todayKey(now: Date = new Date()): PlainDate {
	return PlainDate(calendarDateInTimeZone(now, PAYROLL_TIME_ZONE));
}

const period_month = (period: string): string => period.slice(0, 7);

const period_half = (period: string): number | null => {
	const suffix = period.slice(8);
	return suffix === '' ? null : Number.parseInt(suffix, 10);
};

/** The Monday a Sunday-ending week begins. */
const week_start = (end: string): string => {
	const stamp = new Date(`${end}T00:00:00Z`);
	stamp.setUTCDate(stamp.getUTCDate() - 6);
	return stamp.toISOString().slice(0, 10);
};

/**
 * A selected period restated in the company's grammar: a semi-monthly company reads a bare month
 * as the half `today` falls in, a monthly company drops a half suffix. The board and its picker
 * follow the entity's pay cycle, not the calendar month.
 */
export function periodInCompanyGrammar(
	period: string,
	payFrequency: string | undefined,
	today: string
): string {
	const month = period_month(period);
	if (payFrequency === 'WEEKLY') {
		const weeks = weeklyInstalments(month);
		const named = period_half(period);
		if (named != null && named <= weeks.length) return period;
		const current = weeks.findIndex((sunday) => week_start(sunday) <= today && today <= sunday);
		return `${month}-${current >= 0 ? current + 1 : 1}`;
	}
	if (payFrequency !== 'SEMI_MONTHLY') return month;
	const half = period_half(period);
	if (half != null && half <= 2) return period;
	return `${month}-${Number.parseInt(today.slice(8, 10), 10) <= 15 ? 1 : 2}`;
}
