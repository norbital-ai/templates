// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDateISO } from '@norbital-ai/std/date';
import {
	calendarDayAsPickerInstant,
	calendarDayFromPickerInstant,
	calendarDateInTimeZone,
	dayWindowInstantBounds,
	monthWorkDateInstantBounds,
	periodInCompanyGrammar,
	periodWindow,
	startOfDayInstant,
	workDateCalendarKey
} from '../src/lib/ui/calendar.js';

describe('calendar-day picker adapters', () => {
	it('round-trips the same day through viewer-local instants on both sides of UTC', () => {
		const day = '2026-08-26';
		for (const timeZone of ['America/Los_Angeles', 'Asia/Singapore', 'Pacific/Kiritimati']) {
			const pickerValue = calendarDayAsPickerInstant(day, timeZone);
			assert.equal(calendarDayFromPickerInstant(pickerValue, timeZone), day);
		}
	});

	it('round-trips a day whose local midnight sits on a daylight-saving boundary', () => {
		const day = '2026-03-08';
		const timeZone = 'America/New_York';
		const pickerValue = calendarDayAsPickerInstant(day, timeZone);

		assert.equal(pickerValue, '2026-03-08T05:00:00.000Z');
		assert.equal(calendarDayFromPickerInstant(pickerValue, timeZone), day);
	});

	it('keeps a payroll calendar day stable when the picker and payroll zones differ', () => {
		const stored = '2026-08-25T16:00:00.000Z';
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		const pickerTimeZone = 'America/Los_Angeles';
		const payrollDay = calendarDateInTimeZone(new Date(stored), payrollTimeZone);
		const pickerValue = calendarDayAsPickerInstant(payrollDay, pickerTimeZone);
		const selectedDay = calendarDayFromPickerInstant(pickerValue, pickerTimeZone);

		assert.equal(selectedDay, '2026-08-26');
		assert.equal(startOfDayInstant(selectedDay, payrollTimeZone), stored);
	});

	it('A1: a local-midnight work_date is the payroll calendar day, not the UTC day', () => {
		const stored = '2026-01-31T16:00:00.000Z';
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		assert.equal(startOfDayInstant('2026-02-01', payrollTimeZone), stored);
		assert.equal(formatDateISO(stored), '2026-01-31');
		assert.equal(formatDateISO(new Date(stored)), '2026-01-31');
		assert.equal(workDateCalendarKey(stored), '2026-02-01');
		assert.equal(workDateCalendarKey(new Date(stored)), '2026-02-01');
		assert.equal(workDateCalendarKey('2026-02-01'), '2026-02-01');
	});

	it('A1: a February work-date query bound starts at local midnight, not UTC midnight', () => {
		const bounds = monthWorkDateInstantBounds('2026-02');
		assert.equal(bounds.start, '2026-01-31T16:00:00.000Z');
		assert.equal(bounds.end, '2026-02-27T16:00:00.000Z');
		assert.notEqual(bounds.start, '2026-02-01T00:00:00.000Z');
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
			() => calendarDayAsPickerInstant('2026-02-30', 'Asia/Singapore'),
			/not a YYYY-MM-DD calendar date/
		);
		assert.throws(
			() => calendarDayFromPickerInstant('not-an-instant', 'Asia/Singapore'),
			/not a valid instant/
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

describe('dayWindowInstantBounds', () => {
	it('spans the payroll-zone day starts, with the end exclusive, so both instant anchors match', () => {
		const bounds = dayWindowInstantBounds({ start: '2026-01-16', end: '2026-01-31' });
		assert.deepEqual(bounds, {
			start: '2026-01-15T16:00:00.000Z',
			end: '2026-01-31T16:00:00.000Z'
		});
		const inside = (instant: string) => instant >= bounds.start && instant < bounds.end;
		// A 31 January stored at UTC midnight, and one stored at the zone's day start.
		assert.ok(inside('2026-01-31T00:00:00.000Z'));
		assert.ok(inside('2026-01-30T16:00:00.000Z'));
		// The 16th on either anchor is in; the 15th and 1 February on either anchor are out.
		assert.ok(inside('2026-01-16T00:00:00.000Z') && inside('2026-01-15T16:00:00.000Z'));
		assert.ok(!inside('2026-01-15T00:00:00.000Z') && !inside('2026-01-14T16:00:00.000Z'));
		assert.ok(!inside('2026-02-01T00:00:00.000Z') && !inside('2026-01-31T16:00:00.000Z'));
	});
});
