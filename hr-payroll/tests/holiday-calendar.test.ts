import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidays, type HolidayRow } from '../src/lib/holiday-calendar.ts';

const holiday = (changes: Partial<HolidayRow> = {}): HolidayRow => ({
	id: 'festival',
	company_id: '11111111-1111-4111-8111-111111111111',
	date: '2026-01-01',
	name: 'Festival',
	kind: 'PUBLIC',
	original_date: null,
	published_at: '2025-12-01T00:00:00Z',
	...changes
});

test('a published holiday is used; an unpublished one is not there; a range with none is empty', () => {
	assert.equal(
		resolveHolidays([], '11111111-1111-4111-8111-111111111111', '2026-01-01', '2026-01-31').size,
		0
	);
	assert.equal(
		resolveHolidays(
			[holiday({ published_at: null })],
			'11111111-1111-4111-8111-111111111111',
			'2026-01-01',
			'2026-01-31'
		).size,
		0
	);
	const resolved = resolveHolidays(
		[holiday()],
		'11111111-1111-4111-8111-111111111111',
		'2026-01-01',
		'2026-01-31'
	);
	assert.deepEqual([...resolved.keys()], ['2026-01-01']);
	assert.equal(resolved.get('2026-01-01')!.name, 'Festival');
	// The kind rides the snapshot: a run prices a SPECIAL day on its own ladder from this copy.
	assert.equal(resolved.get('2026-01-01')!.kind, 'PUBLIC');
	assert.equal(
		resolveHolidays(
			[holiday({ kind: 'SPECIAL' })],
			'11111111-1111-4111-8111-111111111111',
			'2026-01-01',
			'2026-01-31'
		).get('2026-01-01')!.kind,
		'SPECIAL'
	);
});

test('only the jurisdiction and range asked for, and never two published rows on one day', () => {
	const rows = [
		holiday(),
		holiday({ id: 'other-jurisdiction', company_id: 'other-entity' }),
		holiday({ id: 'outside', date: '2026-02-01' })
	];
	assert.deepEqual(
		[
			...resolveHolidays(
				rows,
				'11111111-1111-4111-8111-111111111111',
				'2026-01-01',
				'2026-01-31'
			).keys()
		],
		['2026-01-01']
	);
	assert.throws(
		() =>
			resolveHolidays(
				[holiday(), holiday({ id: 'twin' })],
				'11111111-1111-4111-8111-111111111111',
				'2026-01-01',
				'2026-01-31'
			),
		/two published holidays on 2026-01-01/
	);
	assert.throws(
		() => resolveHolidays([], '11111111-1111-4111-8111-111111111111', '2026-02-01', '2026-01-01'),
		/ordered date range/
	);
});
