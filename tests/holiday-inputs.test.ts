import assert from 'node:assert/strict';
import test from 'node:test';
import { changedHolidayDates, resolveHolidayInputs } from '../src/lib/holiday-inputs.ts';

const holiday = {
	date: '2026-02-03',
	name: 'Festival',
	original_date: null,
	source: 'Synthetic fixture'
};
const first = {
	id: 'calendar-one',
	jurisdiction_code: 'TEST',
	year: 2026,
	revision: 1,
	published_at: '2025-12-01T00:00:00Z',
	observations: [holiday]
};
const later = {
	...first,
	id: 'calendar-two',
	revision: 2,
	observations: [holiday, { ...holiday, date: '2026-06-01', name: 'Other festival' }]
};

test('new consumers use published coverage and retain a capture for every classified date', () => {
	const before = resolveHolidayInputs([first], 'TEST', ['2026-02-03']);
	const after = resolveHolidayInputs([first, later], 'TEST', [
		'2026-02-03',
		'2026-06-01',
		'2026-06-02'
	]);
	assert.equal(before.inputs[0]?.calendar_id, first.id);
	assert.equal(after.inputs[0]?.calendar_id, later.id);
	assert.deepEqual(before.holidays.get(holiday.date), after.holidays.get(holiday.date));
	assert.equal(after.inputs.length, 3);
	assert.ok(!after.holidays.has('2026-06-02'));
	assert.equal(after.inputs[2]?.date, '2026-06-02', 'absence of a holiday is also captured');
	assert.equal(before.calendars[0]?.observations.length, 1, 'previous evidence remains unchanged');
});

test('publication identifies edits, removal and both sides of a date shift', () => {
	assert.deepEqual(changedHolidayDates([holiday], [{ ...holiday, date: '2026-02-04' }]), [
		'2026-02-03',
		'2026-02-04'
	]);
	assert.deepEqual(changedHolidayDates([holiday], []), [holiday.date]);
	assert.deepEqual(changedHolidayDates([holiday], [{ ...holiday, name: 'Renamed' }]), [
		holiday.date
	]);
	assert.deepEqual(changedHolidayDates([holiday], [holiday]), []);
});

test('adding a holiday changes a previously non-holiday classification', () => {
	assert.deepEqual(changedHolidayDates(first.observations, later.observations), ['2026-06-01']);
});
