import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';

// PP 35/2021 art.31(2)(a), (3) and art.32(2), signed text pp.19–20:
// https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf
// A six-day 7+7+7+7+7+5 roster averages 6⅔ hours, but the statutory rest-day ladder
// has seven hours at 2×. Using normal_hours instead of that edge overpays these cases.
const shortId = 'a1070000-0000-4000-8000-000000000001';
for (const [period, date] of [
	['2025-12', '2025-12-14'],
	['2026-02', '2026-02-08'],
	['2026-04', '2026-04-12']
] as const) {
	for (const [days, hours, amount, slices] of [
		[6, 7, 700_000, [['OT-2.0X', 7, 700_000]]],
		[
			6,
			8,
			850_000,
			[
				['OT-2.0X', 7, 700_000],
				['OT-3.0X', 1, 150_000]
			]
		],
		[
			6,
			11,
			1_450_000,
			[
				['OT-2.0X', 7, 700_000],
				['OT-3.0X', 1, 150_000],
				['OT-4.0X', 3, 600_000]
			]
		],
		[5, 8, 800_000, [['OT-2.0X', 8, 800_000]]],
		[
			5,
			9,
			950_000,
			[
				['OT-2.0X', 8, 800_000],
				['OT-3.0X', 1, 150_000]
			]
		],
		[
			5,
			12,
			1_550_000,
			[
				['OT-2.0X', 8, 800_000],
				['OT-3.0X', 1, 150_000],
				['OT-4.0X', 3, 600_000]
			]
		]
	] as const) {
		test(`ID art.31: ${days}-day rest overtime ${hours}h is Rp${amount} (${period})`, () => {
			const { slips } = buildStatutory(
				{
					code: 'ID',
					period,
					region: 'Provinsi DKI Jakarta',
					riskClass: 'I',
					people: [{ key: 'REST', wage: 8_650_000, hire_date: '2025-12-01' }]
				},
				(world) => {
					if (days === 6) {
						const day = world.shift_definitions.find((row) => row.code === 'DAY')!;
						const rest = world.shift_definitions.find((row) => row.code === 'REST')!;
						day.variant = {
							kind: 'WORK',
							start_time: '08:00',
							end_time: '16:00',
							break_minutes: 60
						};
						world.shift_definitions.push({
							...day,
							id: shortId,
							code: 'SHORT',
							name: 'Short day',
							variant: { kind: 'WORK', start_time: '08:00', end_time: '13:00', break_minutes: 0 }
						});
						world.shift_patterns[0]!.pattern = {
							days: [day.id, day.id, day.id, day.id, day.id, shortId, rest.id].map(
								(roster_code_id) => ({ roster_code_id })
							)
						};
					}
					world.work_days.push({
						id: `rest-${date}`,
						employment_id: world.employments[0]!.id,
						work_date: date,
						shift_definition_id: null,
						approved_overtime_hours: hours,
						// Include the provided half-hour break; net attendance equals the approved hours.
						worked_intervals: [
							{
								start: `${date}T08:00:00+07:00`,
								end: `${date}T${String(8 + hours).padStart(2, '0')}:30:00+07:00`
							}
						],
						approval_id: null
					});
				}
			);
			const slip = slips.get('REST')!;
			const lines = slip.adjustments.filter((row) => row.family === 'WORK_DAY');
			assert.deepEqual(
				lines.map((row) => [row.label, row.quantity, row.amount]),
				slices
			);
			assert.equal(
				lines.reduce((sum, row) => sum + row.amount, 0),
				amount
			);
			assert.equal(slip.gross, 8_650_000 + amount);
		});
	}
}
