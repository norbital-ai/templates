// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatutory } from './fixtures/statutory-world.ts';

// Decrees 74/2024 and 293/2025 art. 4(3): weekly/daily pay may meet either the
// monthly or hourly table after conversion on the employer's normal schedule.
function daily(period: string, wage: number, days = 5, hours = 8) {
	return buildStatutory(
		{
			code: 'VN',
			period,
			region: 'IV',
			people: [
				{
					key: 'DAILY',
					hire_date: period.startsWith('2025') ? '2025-12-01' : '2026-01-01',
					wage,
					pay_frequency: 'DAILY',
					ordinary_hours_per_week: days * hours
				}
			]
		},
		days === 5 && hours === 8
			? undefined
			: (world) => {
					const workId = world.shift_definitions[0].id;
					const restId = world.shift_definitions[1].id;
					world.shift_definitions[0].variant = {
						kind: 'WORK',
						start_time: '09:00',
						end_time: `${String(10 + hours).padStart(2, '0')}:00`,
						break_minutes: 60
					};
					world.shift_patterns[0].pattern.days = [
						...Array.from({ length: days }, () => ({ roster_code_id: workId })),
						...Array.from({ length: 7 - days }, () => ({ roster_code_id: restId }))
					];
				}
	);
}

test('VN daily wage can satisfy the hourly floor while below the monthly conversion', () => {
	const result = daily('2026-02', 150_000);
	assert.equal(result.slips.has('DAILY'), true);
	assert.equal(
		result.warnings.some((warning) => warning.includes('MINIMUM_WAGE_BELOW')),
		false
	);
});

test('VN December 2025 daily hourly boundary uses the earlier decree', () => {
	assert.equal(daily('2025-12', 132_800).warnings.length, 0);
	assert.throws(() => daily('2025-12', 125_000), /MINIMUM_WAGE_BELOW: DAILY/);
});

test('VN daily wage below both converted floors blocks payroll', () => {
	assert.throws(() => daily('2026-02', 140_000), /MINIMUM_WAGE_BELOW: DAILY.*17500.*17800/);
});

test('VN daily wage can satisfy the monthly floor while below the hourly conversion', () => {
	// July 2026 has 27 projected Monday–Saturday days: 140,000 × 27 = 3,780,000.
	const result = daily('2026-07', 140_000, 6, 8);
	assert.equal(result.slips.has('DAILY'), true);
	assert.equal(
		result.warnings.some((warning) => warning.includes('MINIMUM_WAGE_BELOW')),
		false
	);
});

test('VN daily wage uses a lawful ten-hour normal day on a four-day weekly schedule', () => {
	assert.throws(() => daily('2026-02', 175_000, 4, 10), /MINIMUM_WAGE_BELOW: DAILY.*17500.*17800/);
});

test('VN unequal daily shifts refuse an unsupported hourly conversion', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'VN',
					period: '2026-02',
					region: 'IV',
					people: [
						{
							key: 'MIXED',
							hire_date: '2026-01-01',
							wage: 150_000,
							pay_frequency: 'DAILY',
							ordinary_hours_per_week: 40
						}
					]
				},
				(world) => {
					const long = {
						...world.shift_definitions[0],
						id: 'c0000000-0000-4000-8000-000000000010',
						code: 'LONG',
						variant: { kind: 'WORK', start_time: '09:00', end_time: '20:00', break_minutes: 60 }
					};
					world.shift_definitions.push(long);
					world.shift_patterns[0].pattern.days[4] = { roster_code_id: long.id };
				}
			),
		/daily normal hours vary/
	);
});

test('VN weekly wage can satisfy the hourly alternative when its monthly conversion is low', () => {
	const result = buildStatutory({
		code: 'VN',
		period: '2026-02-2',
		payFrequency: 'WEEKLY',
		region: 'IV',
		people: [
			{
				key: 'WEEKLY',
				hire_date: '2026-01-01',
				wage: 800_000,
				pay_frequency: 'WEEKLY',
				ordinary_hours_per_week: 40
			}
		]
	});
	assert.equal(result.slips.has('WEEKLY'), true);
	assert.equal(
		result.warnings.some((warning) => warning.includes('MINIMUM_WAGE_BELOW')),
		false
	);
});
