import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidayInputs } from '../src/lib/holiday-inputs.ts';

const festival = {
	id: 'festival',
	company_id: '11111111-1111-4111-8111-111111111111',
	date: '2026-02-03',
	name: 'Festival',
	kind: 'PUBLIC',
	replaces: null,
	published_at: '2025-12-01T00:00:00Z'
};
const later = { ...festival, id: 'later', date: '2026-06-01', name: 'Other festival' };

test('every classified date gets an input: the published holiday on it, or none', () => {
	const result = resolveHolidayInputs([festival, later], '11111111-1111-4111-8111-111111111111', [
		'2026-02-03',
		'2026-02-04',
		'2026-06-01'
	]);
	assert.deepEqual(
		result.inputs.map((row) => [row.date, row.holiday_id]),
		[
			['2026-02-03', 'festival'],
			['2026-02-04', null],
			['2026-06-01', 'later']
		]
	);
	assert.deepEqual(
		result.snapshots.map((row) => row.id),
		['festival', 'later']
	);
});

test('an unpublished holiday is not on the calendar, whatever a day once was classified as', () => {
	// There is no pin: the overlay is what is published now, for every date asked about.
	const unpublished = { ...festival, published_at: null };
	const result = resolveHolidayInputs(
		[unpublished, later],
		'11111111-1111-4111-8111-111111111111',
		['2026-02-03', '2026-06-01']
	);
	assert.equal(result.holidays.has('2026-02-03'), false);
	assert.equal(result.holidays.get('2026-06-01')?.id, 'later');
	assert.deepEqual(
		result.inputs.map((row) => [row.date, row.holiday_id]),
		[
			['2026-02-03', null],
			['2026-06-01', 'later']
		]
	);
	assert.deepEqual(
		result.snapshots.map((row) => row.id),
		['later']
	);
});
