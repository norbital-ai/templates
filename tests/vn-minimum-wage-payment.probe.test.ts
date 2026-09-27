// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

// Decrees 74/2024 and 293/2025 art. 4 make the floor a condition of agreement and payment.
for (const [period, floor] of [
	['2025-12', 3_450_000],
	['2026-01', 3_700_000],
	['2026-06', 3_700_000],
	['2026-07', 3_700_000]
]) {
	test(`VN Region IV monthly pay below ${floor} refuses ${period}`, () => {
		assert.throws(
			() =>
				buildStatutory({
					code: 'VN',
					period,
					region: 'IV',
					people: [{ key: 'UNDER', wage: floor - 1 }]
				}),
			/MINIMUM_WAGE_BELOW: UNDER is contracted/
		);
		assert.equal(
			buildStatutory({
				code: 'VN',
				period,
				region: 'IV',
				people: [{ key: 'EXACT', wage: floor }]
			}).slips.has('EXACT'),
			true
		);
	});
}

test('VN January hourly and weekly under-floor contracts refuse, and exact floors settle', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01-2',
				payFrequency: 'WEEKLY',
				region: 'IV',
				people: [{ key: 'H-UNDER', wage: 17_799, pay_frequency: 'HOURLY' }]
			}),
		/MINIMUM_WAGE_BELOW: H-UNDER is contracted at 17799 an hour/
	);
	assert.equal(
		buildStatutory({
			code: 'VN',
			period: '2026-01-2',
			payFrequency: 'WEEKLY',
			region: 'IV',
			people: [{ key: 'H-EXACT', wage: 17_800, pay_frequency: 'HOURLY' }]
		}).slips.has('H-EXACT'),
		true
	);
	assert.throws(
		() =>
			buildStatutory({
				code: 'VN',
				period: '2026-01-2',
				payFrequency: 'WEEKLY',
				region: 'IV',
				people: [{ key: 'W-UNDER', wage: 700_000, pay_frequency: 'WEEKLY' }]
			}),
		/MINIMUM_WAGE_BELOW: W-UNDER is contracted/
	);
	assert.equal(
		buildStatutory({
			code: 'VN',
			period: '2026-01-2',
			payFrequency: 'WEEKLY',
			region: 'IV',
			people: [{ key: 'W-LAWFUL', wage: 900_000, pay_frequency: 'WEEKLY' }]
		}).slips.has('W-LAWFUL'),
		true
	);
});

test('VN checks the earlier contract in a month even after a lawful raise', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'VN',
					period: '2026-01',
					region: 'IV',
					people: [{ key: 'RAISED', wage: 3_600_000 }]
				},
				(world) => {
					const first = world.employment_terms[0];
					first.effective_range.end = '2026-01-05';
					world.employment_terms.push({
						...first,
						id: 'b0000000-0000-4000-8000-000000000999',
						base_salary: 3_800_000,
						effective_range: { start: '2026-01-06', end: null }
					});
				}
			),
		/MINIMUM_WAGE_BELOW: RAISED is contracted at 3600000 a month.*from 2026-01-01 to 2026-01-05/
	);
});

test('all four active VN snapshots declare the payment guard', () => {
	const versions = settingsVersions('VN');
	assert.equal(versions.length, 4);
	for (const version of versions)
		assert.equal(
			version.work_rules.wages.block_below_when,
			'employment.type != "PART_TIME" && terms.pay_frequency in ["MONTHLY", "HOURLY", "WEEKLY", "DAILY"]'
		);
});
