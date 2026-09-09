import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidayInputs } from '../src/lib/holiday-inputs.ts';

const festival = {
	id: 'festival',
	jurisdiction_code: 'TEST',
	date: '2026-02-03',
	name: 'Festival',
	kind: 'PUBLIC',
	original_date: null,
	published_at: '2025-12-01T00:00:00Z'
};
const later = { ...festival, id: 'later', date: '2026-06-01', name: 'Other festival' };

test('every classified date gets an input: the published holiday on it, or none', () => {
	const result = resolveHolidayInputs([festival, later], 'TEST', [
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

test('a work day pin keeps its holiday after it was unpublished; an unpinned day takes what is published now', () => {
	const unpublished = { ...festival, published_at: null };
	const pinned = resolveHolidayInputs(
		[unpublished, later],
		'TEST',
		['2026-02-03', '2026-06-01'],
		[{ jurisdiction_code: 'TEST', date: '2026-02-03', holiday_id: 'festival' }]
	);
	assert.equal(pinned.holidays.get('2026-02-03')?.id, 'festival');
	assert.equal(pinned.holidays.get('2026-06-01')?.id, 'later');
	const unpinned = resolveHolidayInputs([unpublished, later], 'TEST', ['2026-02-03']);
	assert.equal(unpinned.holidays.has('2026-02-03'), false);
});

test('two pins disagreeing on one day, or a pin to a missing holiday, refuse', () => {
	const pin = (holiday_id: string) => ({
		jurisdiction_code: 'TEST',
		date: '2026-02-03',
		holiday_id
	});
	assert.throws(
		() => resolveHolidayInputs([festival], 'TEST', ['2026-02-03'], [pin('festival'), pin('other')]),
		/disagree/
	);
	assert.throws(
		() => resolveHolidayInputs([], 'TEST', ['2026-02-03'], [pin('gone')]),
		/missing holiday/
	);
});
