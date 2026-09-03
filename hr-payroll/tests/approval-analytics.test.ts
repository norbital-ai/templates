// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bucketSeasonalHeatmap,
	seasonalityDateWindow,
	seasonalityYears
} from '../src/lib/seasonality.ts';

test('leave seasonality includes the live year in its rolling five-year window', () => {
	assert.deepEqual(seasonalityYears(2026), [2022, 2023, 2024, 2025, 2026]);
});

test('seasonality date window is Jan 1 of the first year through exclusive Jan 1 after the last', () => {
	assert.deepEqual(seasonalityDateWindow(2026), {
		start: '2022-01-01',
		endExclusive: '2027-01-01'
	});
});

test('heatmap bucketing fills five years by twelve months and zeros missing buckets', () => {
	const years = seasonalityYears(2026);
	const heatmap = bucketSeasonalHeatmap(years, [
		'2022-01-15',
		'2022-01-20',
		'2024-06-01',
		new Date('2026-12-01T00:00:00.000Z'),
		'2021-08-01',
		null
	]);
	assert.equal(heatmap.length, 5);
	assert.deepEqual(
		heatmap.map((row) => row.year),
		['2022', '2023', '2024', '2025', '2026']
	);
	for (const row of heatmap) {
		assert.equal(row.months.length, 12);
	}
	assert.deepEqual(heatmap[0]?.months, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(heatmap[1]?.months, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.equal(heatmap[2]?.months[5], 1);
	assert.deepEqual(heatmap[3]?.months, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.equal(heatmap[4]?.months[11], 1);
	assert.equal(
		heatmap.reduce((sum, row) => sum + row.months.reduce((inner, count) => inner + count, 0), 0),
		4
	);
});
