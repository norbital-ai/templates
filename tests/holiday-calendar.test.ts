import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidays, type HolidayRow } from '../src/lib/holiday-calendar.ts';

const holiday = (changes: Partial<HolidayRow> = {}): HolidayRow => ({
	id: 'festival',
	jurisdiction_code: 'JUR-A',
	date: '2026-01-01',
	name: 'Festival',
	original_date: null,
	published_at: '2025-12-01T00:00:00Z',
	...changes
});

test('a published holiday is used; an unpublished one is not there; a range with none is empty', () => {
	assert.equal(resolveHolidays([], 'JUR-A', '2026-01-01', '2026-01-31').size, 0);
	assert.equal(
		resolveHolidays([holiday({ published_at: null })], 'JUR-A', '2026-01-01', '2026-01-31').size,
		0
	);
	const resolved = resolveHolidays([holiday()], 'JUR-A', '2026-01-01', '2026-01-31');
	assert.deepEqual([...resolved.keys()], ['2026-01-01']);
	assert.equal(resolved.get('2026-01-01')!.name, 'Festival');
});

test('only the jurisdiction and range asked for, and never two published rows on one day', () => {
	const rows = [
		holiday(),
		holiday({ id: 'other-jurisdiction', jurisdiction_code: 'JUR-B' }),
		holiday({ id: 'outside', date: '2026-02-01' })
	];
	assert.deepEqual(
		[...resolveHolidays(rows, 'JUR-A', '2026-01-01', '2026-01-31').keys()],
		['2026-01-01']
	);
	assert.throws(
		() =>
			resolveHolidays([holiday(), holiday({ id: 'twin' })], 'JUR-A', '2026-01-01', '2026-01-31'),
		/two published holidays on 2026-01-01/
	);
	assert.throws(
		() => resolveHolidays([], 'JUR-A', '2026-02-01', '2026-01-01'),
		/ordered date range/
	);
});
