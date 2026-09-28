import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHolidays, type HolidayRow } from '../src/lib/holiday-calendar.ts';

const holiday = (changes: Partial<HolidayRow> = {}): HolidayRow => ({
	id: 'festival',
	company_id: '11111111-1111-4111-8111-111111111111',
	date: '2026-01-01',
	name: 'Festival',
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
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
	assert.equal(resolved.get('2026-01-01')!.kind, 'PUBLIC_HOLIDAY');
	assert.equal(
		resolveHolidays(
			[holiday({ kind: 'SPECIAL_HOLIDAY' })],
			'11111111-1111-4111-8111-111111111111',
			'2026-01-01',
			'2026-01-31'
		).get('2026-01-01')!.kind,
		'SPECIAL_HOLIDAY'
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

test('a local day on a company-wide date keeps the dearer kind, the company-wide row on a tie; two local rows reach only their own sites', () => {
	// Owner rule 2026-09-28: the law is silent on a city's special day falling on a company-wide
	// holiday; the higher-paying kind stands, which meets both. RA 7669 (San Juan) and Proclamation
	// 1186 (Las Piñas) both name 27 March 2026: each city's row reaches its own staff only.
	const company = '11111111-1111-4111-8111-111111111111';
	const at = (site: string | null) => () => site;
	const rows = [
		holiday({ id: 'san-juan', date: '2026-03-27', kind: 'SPECIAL_HOLIDAY', worksite: 'San Juan' }),
		holiday({ id: 'las-pinas', date: '2026-03-27', kind: 'SPECIAL_HOLIDAY', worksite: 'Las Pinas' })
	];
	const on = (list: HolidayRow[], site: string | null) =>
		resolveHolidays(list, company, '2026-03-27', '2026-03-27', at(site)).get('2026-03-27')?.id;
	assert.equal(on(rows, 'San Juan'), 'san-juan');
	assert.equal(on(rows, 'Las Pinas'), 'las-pinas');
	assert.equal(on(rows, 'Manila'), undefined);
	const regular = holiday({ id: 'regular', date: '2026-03-27', kind: 'PUBLIC_HOLIDAY' });
	assert.equal(on([...rows, regular], 'San Juan'), 'regular');
	const special = holiday({ id: 'special', date: '2026-03-27', kind: 'SPECIAL_HOLIDAY' });
	assert.equal(on([...rows, special], 'San Juan'), 'special');
	const localRegular = holiday({ id: 'local', date: '2026-03-27', worksite: 'San Juan' });
	assert.equal(on([special, localRegular], 'San Juan'), 'local');
	assert.throws(
		() => on([rows[0]!, { ...rows[0]!, id: 'twin' }], 'San Juan'),
		/two published holidays on 2026-03-27/
	);
});
