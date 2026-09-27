// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

// Decrees 74/2024 and 293/2025, art. 4(3): weekly pay × 52 ÷ 12 or
// weekly pay ÷ normal weekly hours may meet the corresponding minimum.
for (const scenario of [
	{ period: '2025-12-2', below: 650_000, above: 800_000 },
	{ period: '2026-01-2', below: 700_000, above: 900_000 },
	{ period: '2026-05-4', below: 700_000, above: 900_000 },
	{ period: '2026-07-2', below: 700_000, above: 900_000 }
]) {
	test(`VN weekly minimum-wage comparison in ${scenario.period}`, () => {
		assert.throws(
			() =>
				buildStatutory({
					code: 'VN',
					period: scenario.period,
					payFrequency: 'WEEKLY',
					region: 'IV',
					people: [{ key: 'BELOW', wage: scenario.below, pay_frequency: 'WEEKLY' }]
				}),
			/MINIMUM_WAGE_BELOW: BELOW is contracted/
		);
		const result = buildStatutory({
			code: 'VN',
			period: scenario.period,
			payFrequency: 'WEEKLY',
			region: 'IV',
			people: [{ key: 'ABOVE', wage: scenario.above, pay_frequency: 'WEEKLY' }]
		});
		assert.equal(result.slips.get('ABOVE')?.gross, scenario.above);
	});
}

test('all four operative VN versions state the decree’s weekly conversion', () => {
	const versions = settingsVersions('VN');
	assert.equal(versions.length, 4);
	for (const version of versions)
		assert.equal(version.work_rules.wages.weekly_monthly_factor, 52 / 12);
	for (const version of versions)
		assert.equal(version.work_rules.wages.weekly_daily_hourly_alternative, true);
});
