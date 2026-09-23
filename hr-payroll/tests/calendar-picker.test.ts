// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDateISO } from '@norbital-ai/std/date';
import {
	calendarDayFromPickerInstant,
	dayWindowInstantBounds,
	endOfDayInstant,
	monthWorkDateInstantBounds,
	periodInCompanyGrammar,
	periodWindow,
	startOfDayInstant
} from '../src/lib/ui/calendar.js';
import { dayInstant, calendarDateInTimeZone, dateKey } from '../src/lib/iso-day.js';

describe('calendar-day picker adapters', () => {
	it('round-trips the same day through viewer-local instants on both sides of UTC', () => {
		const day = '2026-08-26';
		for (const timeZone of ['America/Los_Angeles', 'Asia/Singapore', 'Pacific/Kiritimati']) {
			const pickerValue = startOfDayInstant(day, timeZone);
			assert.equal(calendarDayFromPickerInstant(pickerValue, timeZone), day);
		}
	});

	it('round-trips a day whose local midnight sits on a daylight-saving boundary', () => {
		const day = '2026-03-08';
		const timeZone = 'America/New_York';
		const pickerValue = startOfDayInstant(day, timeZone);

		assert.equal(pickerValue, '2026-03-08T05:00:00.000Z');
		assert.equal(calendarDayFromPickerInstant(pickerValue, timeZone), day);
	});

	it('keeps a payroll calendar day stable when the picker and payroll zones differ', () => {
		const stored = '2026-08-25T16:00:00.000Z';
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		const pickerTimeZone = 'America/Los_Angeles';
		const payrollDay = calendarDateInTimeZone(new Date(stored), payrollTimeZone);
		const pickerValue = startOfDayInstant(payrollDay, pickerTimeZone);
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
		assert.equal(dateKey(stored), '2026-02-01');
		assert.equal(dateKey('2026-02-01'), '2026-02-01');
	});

	it("A1: a February work-date query bound is the stored UTC day, not the zone's midnight", () => {
		const bounds = monthWorkDateInstantBounds('2026-02');
		assert.equal(bounds.start, '2026-02-01T00:00:00.000Z');
		assert.equal(bounds.end, '2026-02-28T00:00:00.000Z');
		// A `lte` on the zone's midnight of the 28th sat before the 28th's own stored row.
		assert.ok('2026-02-28T00:00:00.000Z' <= bounds.end);
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
	it('spans the stored UTC days, with the end exclusive', () => {
		const bounds = dayWindowInstantBounds({ start: '2026-01-16', end: '2026-01-31' });
		assert.deepEqual(bounds, {
			start: '2026-01-16T00:00:00.000Z',
			end: '2026-02-01T00:00:00.000Z'
		});
		const inside = (instant: string) => instant >= bounds.start && instant < bounds.end;
		assert.ok(inside('2026-01-16T00:00:00.000Z') && inside('2026-01-31T00:00:00.000Z'));
		assert.ok(!inside('2026-01-15T00:00:00.000Z') && !inside('2026-02-01T00:00:00.000Z'));
	});
});

describe('endOfDayInstant', () => {
	it('closes a range on the last millisecond of the day in the payroll zone, as the bank does', () => {
		assert.equal(endOfDayInstant('2026-06-30'), '2026-06-30T15:59:59.999Z');
		// `contains_date` compares bound texts: the day's stored form lies inside a range that
		// starts on it and ends on it, so a leaver is in force on their last day in every list.
		const range = { start: dayInstant('2026-06-01'), end: endOfDayInstant('2026-06-30') };
		const contains = (day: string) =>
			range.start <= dayInstant(day) && dayInstant(day) <= range.end;
		assert.ok(contains('2026-06-01') && contains('2026-06-30'));
		assert.ok(!contains('2026-05-31') && !contains('2026-07-01'));
	});
});
