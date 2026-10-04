import { PlainDate } from '@norbital-ai/std/date';
import { PAYROLL_TIME_ZONE, calendarDateInTimeZone } from '../../payroll_engine/foundation.js';

export function todayKey(now: Date = new Date()): PlainDate {
	return PlainDate(calendarDateInTimeZone(now, PAYROLL_TIME_ZONE));
}
