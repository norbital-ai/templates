// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatutory } from './fixtures/statutory-world.ts';

// Decree 293/2025 art. 5(5): a pre-2026 hire at a locality moved from
// 2025 Region III to 2026 Region IV retains the higher former minimum.
for (const period of ['2026-01', '2026-06', '2026-07']) {
	test(`VN incumbent keeps the 2025 regional monthly floor in ${period}`, () => {
		const options = {
			code: 'VN',
			period,
			region: 'IV',
			people: [
				{
					key: 'INCUMBENT',
					hire_date: '2025-12-31',
					wage: 3_800_000,
					prior_floor_region: 'III',
					prior_floor_reclassified: true
				}
			]
		};
		assert.throws(
			() => buildStatutory(options),
			/MINIMUM_WAGE_BELOW: INCUMBENT.*3860000 \(protected Region III of 2025-12-31\)/
		);
		const result = buildStatutory({
			code: 'VN',
			period,
			region: 'IV',
			people: [
				{ key: 'NEW', hire_date: '2026-01-01', wage: 3_800_000, prior_floor_region: 'III' },
				{
					key: 'UNCHANGED',
					hire_date: '2025-01-01',
					wage: 3_800_000,
					prior_floor_region: 'IV'
				},
				{
					key: 'MOVED',
					hire_date: '2025-01-01',
					wage: 3_800_000,
					prior_floor_region: 'III',
					prior_floor_reclassified: false
				}
			]
		});
		assert.equal(result.slips.size, 3);
	});
}

test('VN qualifying incumbent needs a declared 2025 region before pricing', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01',
				region: 'IV',
				people: [
					{
						key: 'UNKNOWN',
						hire_date: '2025-01-01',
						wage: 3_800_000,
						prior_floor_region: null,
						prior_floor_reclassified: true
					}
				]
			}),
		/minimum-wage region on 2025-12-31/
	);
});

test('VN incumbent retains a higher 2025 hourly floor, while a January hire uses the new floor', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01-2',
				payFrequency: 'WEEKLY',
				region: 'IV',
				people: [
					{
						key: 'INCUMBENT',
						hire_date: '2025-01-01',
						wage: 18_000,
						pay_frequency: 'HOURLY',
						prior_floor_region: 'III',
						prior_floor_reclassified: true
					}
				]
			}),
		/MINIMUM_WAGE_BELOW: INCUMBENT.*18600 \(protected Region III of 2025-12-31\)/
	);
	const result = buildStatutory({
		code: 'VN',
		period: '2026-01-2',
		payFrequency: 'WEEKLY',
		region: 'IV',
		people: [
			{
				key: 'NEW',
				hire_date: '2026-01-01',
				wage: 18_000,
				pay_frequency: 'HOURLY',
				prior_floor_region: 'III'
			}
		]
	});
	assert.equal(result.slips.has('NEW'), true);
});

test('VN rejects a 2025 region absent from the governing decree', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01',
				region: 'IV',
				people: [
					{
						key: 'INVALID',
						hire_date: '2025-01-01',
						wage: 3_800_000,
						prior_floor_region: 'V',
						prior_floor_reclassified: true
					}
				]
			}),
		/minimum-wage region on 2025-12-31 is unknown/
	);
});

test('VN refuses an unknown 2026 area-change cause where the old floor could be higher', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01',
				region: 'IV',
				people: [
					{
						key: 'UNKNOWN',
						hire_date: '2025-01-01',
						wage: 3_800_000,
						prior_floor_region: 'III',
						prior_floor_reclassified: null
					}
				]
			}),
		/declare whether this worksite's minimum-wage area was reclassified after 2025-12-31/
	);
});
