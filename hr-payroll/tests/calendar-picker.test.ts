// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDateISO } from '@norbital-ai/std/date';
import {
	calendarDayAsPickerInstant,
	calendarDayFromPickerInstant,
	calendarDateInTimeZone,
	instantRangeAsDayPickerValue,
	instantRangeFromDayPickerValue,
	monthWorkDateInstantBounds,
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

	it('round-trips closed and open day ranges without inventing an upper bound', () => {
		const payrollTimeZone = 'Asia/Kuala_Lumpur';
		const pickerTimeZone = 'America/Los_Angeles';
		const closed = {
			start: '2026-08-25T16:00:00.000Z',
			end: '2026-08-30T16:00:00.000Z'
		};
		const open = { start: closed.start, end: null };

		const closedPicker = instantRangeAsDayPickerValue(closed, payrollTimeZone, pickerTimeZone);
		const openPicker = instantRangeAsDayPickerValue(open, payrollTimeZone, pickerTimeZone);

		assert.deepEqual(
			instantRangeFromDayPickerValue(closedPicker, payrollTimeZone, pickerTimeZone),
			closed
		);
		assert.deepEqual(openPicker, { start: '2026-08-26T07:00:00.000Z' });
		assert.deepEqual(
			instantRangeFromDayPickerValue(openPicker, payrollTimeZone, pickerTimeZone),
			open
		);
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
