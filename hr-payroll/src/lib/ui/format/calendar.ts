import { PlainDate } from '@norbital-ai/std/date';
import { calendarDateInTimeZone } from '../../payroll_engine/foundation.js';

export function todayKey(now: Date = new Date()): PlainDate {
	// the viewer's own day: no entity governs a bare "today"
	return PlainDate(calendarDateInTimeZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone));
}
