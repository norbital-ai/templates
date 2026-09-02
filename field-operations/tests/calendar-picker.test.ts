// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	calendarDayAsPickerInstant,
	calendarDayFromPickerInstant
} from '../src/lib/calendar-date.js';

describe('dispatch calendar-day picker adapter', () => {
	it('preserves the selected day across negative and positive UTC offsets', () => {
		const day = '2026-08-26';
		const expectations = new Map([
			['Pacific/Pago_Pago', '2026-08-26T11:00:00.000Z'],
			['UTC', '2026-08-26T00:00:00.000Z'],
			['Asia/Singapore', '2026-08-25T16:00:00.000Z'],
			['Pacific/Kiritimati', '2026-08-25T10:00:00.000Z']
		]);

		for (const [timeZone, expectedInstant] of expectations) {
			const pickerInstant = calendarDayAsPickerInstant(day, timeZone);
			assert.equal(pickerInstant, expectedInstant);
			assert.equal(calendarDayFromPickerInstant(pickerInstant, timeZone), day);
		}
	});

	it('uses the offset in force at local midnight across DST changes', () => {
		const timeZone = 'America/New_York';
		const expectations = new Map([
			['2026-03-08', '2026-03-08T05:00:00.000Z'],
			['2026-03-09', '2026-03-09T04:00:00.000Z'],
			['2026-11-01', '2026-11-01T04:00:00.000Z'],
			['2026-11-02', '2026-11-02T05:00:00.000Z']
		]);

		for (const [day, expectedInstant] of expectations) {
			const pickerInstant = calendarDayAsPickerInstant(day, timeZone);
			assert.equal(pickerInstant, expectedInstant);
			assert.equal(calendarDayFromPickerInstant(pickerInstant, timeZone), day);
		}
	});

	it('keeps the day when a DST jump erases local midnight itself', () => {
		const day = '2018-11-04';
		const timeZone = 'America/Sao_Paulo';
		const pickerInstant = calendarDayAsPickerInstant(day, timeZone);

		assert.equal(pickerInstant, '2018-11-04T03:00:00.000Z');
		assert.equal(calendarDayFromPickerInstant(pickerInstant, timeZone), day);
	});

	it('rejects invalid days and malformed picker values instead of rolling them forward', () => {
		assert.throws(
			() => calendarDayAsPickerInstant('2026-02-30', 'Asia/Singapore'),
			/not a valid calendar day/
		);
		assert.throws(
			() => calendarDayAsPickerInstant('99-07-04', 'UTC'),
			/not a YYYY-MM-DD calendar day/
		);
		assert.throws(() => calendarDayAsPickerInstant('2011-12-30', 'Pacific/Apia'), /does not occur/);
		assert.equal(calendarDayFromPickerInstant('not-an-instant', 'UTC'), null);
		assert.equal(calendarDayFromPickerInstant(undefined, 'UTC'), null);
	});
});
