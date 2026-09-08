import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveHolidayCalendars,
	validateHolidayCalendar,
	type HolidayCalendar
} from '../src/lib/holiday-calendar.ts';

const calendar = (changes: Partial<HolidayCalendar> = {}): HolidayCalendar => ({
	id: 'calendar-2026-r1',
	jurisdiction_code: 'JUR-A',
	year: 2026,
	revision: 1,
	published_at: '2025-12-01T00:00:00Z',
	observations: [{ date: '2026-01-01', name: 'Festival', original_date: null, source: null }],
	...changes
});

test('missing and draft coverage block calculation; a published empty year is complete', () => {
	assert.throws(
		() => resolveHolidayCalendars([], 'JUR-A', '2026-01-01', '2026-01-31'),
		/Publish.*2026/
	);
	assert.throws(
		() =>
			resolveHolidayCalendars(
				[calendar({ published_at: null })],
				'JUR-A',
				'2026-01-01',
				'2026-01-31'
			),
		/Publish.*2026/
	);
	const result = resolveHolidayCalendars(
		[calendar({ observations: [] })],
		'JUR-A',
		'2026-01-01',
		'2026-01-31'
	);
	assert.equal(result.calendars.length, 1);
	assert.equal(result.holidays.size, 0);
});

test('cross-year calculation requires both years from the same jurisdiction', () => {
	const next = calendar({
		id: 'next',
		year: 2027,
		observations: [
			{ date: '2027-01-04', name: 'Observed', original_date: '2026-12-31', source: null }
		]
	});
	assert.throws(
		() => resolveHolidayCalendars([calendar()], 'JUR-A', '2026-12-20', '2027-01-15'),
		/Publish.*2027/
	);
	assert.throws(
		() =>
			resolveHolidayCalendars(
				[calendar(), { ...next, jurisdiction_code: 'JUR-B' }],
				'JUR-A',
				'2026-12-20',
				'2027-01-15'
			),
		/Publish.*2027/
	);
	const result = resolveHolidayCalendars([calendar(), next], 'JUR-A', '2026-12-20', '2027-01-15');
	assert.deepEqual(
		result.calendars.map((row) => row.year),
		[2026, 2027]
	);
	assert.equal(result.holidays.get('2027-01-04')?.original_date, '2026-12-31');
	assert.equal(result.holidays.has('2026-12-31'), false);
});

test('latest published revision is fixed for the calculation, independent of newer drafts', () => {
	const first = calendar();
	const second = calendar({ id: 'r2', revision: 2, observations: [] });
	const draft = calendar({ id: 'r3', revision: 3, published_at: null });
	const result = resolveHolidayCalendars(
		[draft, first, second],
		'JUR-A',
		'2026-01-01',
		'2026-12-31'
	);
	assert.equal(result.calendars[0]?.id, 'r2');
	assert.equal(result.holidays.size, 0);
	second.observations.push(first.observations[0]!);
	assert.equal(result.calendars[0]?.observations.length, 0);
});

test('invalid dates, duplicate observations, out-of-year dates and revisions are refused', () => {
	const observation = calendar().observations[0]!;
	assert.throws(
		() => validateHolidayCalendar(calendar({ observations: [observation, observation] })),
		/more than once/
	);
	for (const date of ['2026-02-30', '2027-01-01'])
		assert.throws(
			() => validateHolidayCalendar(calendar({ observations: [{ ...observation, date }] })),
			/calendar year/
		);
	assert.throws(() => validateHolidayCalendar(calendar({ revision: 0 })), /positive integer/);
	assert.throws(
		() => validateHolidayCalendar(calendar({ jurisdiction_code: ' ' })),
		/jurisdiction/
	);
});
