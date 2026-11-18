import { expect, it } from '@effect/vitest';
import { calendarDate, calendarInstant } from '../src/lib/calendar.js';
it('keeps all-day dates separate from instants and refuses an unzoned event time', () => {
	expect(calendarDate({ date: '2026-10-13' })).toBe('2026-10-13');
	expect(calendarInstant({ date: '2026-10-13' })).toBeNull();
	expect(
		calendarInstant({ dateTime: '2026-10-13T09:00:00+08:00', timeZone: 'Asia/Singapore' })
	).toBe('2026-10-13T01:00:00.000Z');
	expect(() => calendarInstant({ dateTime: '2026-10-13T09:00:00' })).toThrow('with a zone');
});
