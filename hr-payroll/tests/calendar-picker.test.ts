// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDateISO } from '../src/lib/iso-day.ts';
import { periodInCompanyGrammar, periodWindow, startOfDayInstant } from '../src/lib/ui/calendar.js';
import { dayInstant, calendarDateInTimeZone, dateKey } from '../src/lib/iso-day.js';

describe('calendar-day picker adapters', () => {
	it('round-trips the same day through viewer-local instants on both sides of UTC', () => {
		const day = '2026-08-26';
		for (const timeZone of ['America/Los_Angeles', 'Asia/Singapore', 'Pacific/Kiritimati']) {
			const pickerValue = startOfDayInstant(day, timeZone);
			assert.equal(calendarDateInTimeZone(new Date(pickerValue), timeZone), day);
		}
	});

	it('round-trips a day whose local midnight sits on a daylight-saving boundary', () => {
		const day = '2026-03-08';
		const timeZone = 'America/New_York';
		const pickerValue = startOfDayInstant(day, timeZone);

		assert.equal(pickerValue, '2026-03-08T05:00:00.000Z');
		assert.equal(calendarDateInTimeZone(new Date(pickerValue), timeZone), day);
	});

	it('keeps a payroll calendar day stable when the picker and payroll zones differ', () => {
		const stored = '2026-08-25T16:00:00.000Z';
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		const pickerTimeZone = 'America/Los_Angeles';
		const payrollDay = calendarDateInTimeZone(new Date(stored), payrollTimeZone);
		const pickerValue = startOfDayInstant(payrollDay, pickerTimeZone);
		const selectedDay = calendarDateInTimeZone(new Date(pickerValue), pickerTimeZone);

		assert.equal(selectedDay, '2026-08-26');
		assert.equal(startOfDayInstant(selectedDay, payrollTimeZone), stored);
	});

	it('A1: a local-midnight work_date is the payroll calendar day, not the UTC day', () => {
		const stored = '2026-01-31T16:00:00.000Z';
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		assert.equal(startOfDayInstant('2026-02-01', payrollTimeZone), stored);
		assert.equal(formatDateISO(stored), '2026-01-31');
		assert.equal(formatDateISO(new Date(stored)), '2026-01-31');
		assert.equal(dateKey(stored), '2026-02-01');
		assert.equal(dateKey('2026-02-01'), '2026-02-01');
	});

	it('roster month options are YYYY-MM across years, not a 2026 list', () => {
		const periods = periodWindow(37, 12);
		assert.equal(periods.length, 37);
		assert.ok(periods.every((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period)));
		assert.ok(
			periods.some((period) => period.startsWith('2025-')) &&
				periods.some((period) => period.startsWith('2027-')),
			`MonthPeriodPicker window must span years, got ${JSON.stringify(periods)}`
		);
	});

	it('refuses invalid day and instant spellings instead of rolling them forward', () => {
		assert.throws(
			() => startOfDayInstant('2026-02-30', 'Asia/Singapore'),
			/not a YYYY-MM-DD calendar date/
		);
	});
});

describe('periodInCompanyGrammar', () => {
	it('reads a bare month as the half today falls in at a semi-monthly company', () => {
		assert.equal(periodInCompanyGrammar('2026-03', 'SEMI_MONTHLY', '2026-03-09'), '2026-03-1');
		assert.equal(periodInCompanyGrammar('2026-03', 'SEMI_MONTHLY', '2026-03-16'), '2026-03-2');
		assert.equal(periodInCompanyGrammar('2026-03-2', 'SEMI_MONTHLY', '2026-03-09'), '2026-03-2');
	});
	it('drops a half suffix at a monthly company', () => {
		assert.equal(periodInCompanyGrammar('2026-03-2', 'MONTHLY', '2026-03-09'), '2026-03');
		assert.equal(periodInCompanyGrammar('2026-03', undefined, '2026-03-09'), '2026-03');
	});
});
