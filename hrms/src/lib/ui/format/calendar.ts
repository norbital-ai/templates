import { plain_date } from '../../date.js';
import type { PlainDate } from '@norbital-ai/bolt';
import { calendarDateInTimeZone } from '../../payroll_engine/foundation.js';

/** A paid run is locked, so its last write is the moment it was marked paid: that day in the company's zone. */
export const paidOn = (at: unknown, zone: string): string =>
	calendarDateInTimeZone(new Date(String(at)), zone);

export function todayKey(now: Date = new Date()): PlainDate {
	// the viewer's own day: no entity governs a bare "today"
	return plain_date(calendarDateInTimeZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone));
}
