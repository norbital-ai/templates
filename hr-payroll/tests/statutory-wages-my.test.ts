import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const registration = { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } };
const work = (world: PayrollWorld, key: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `my-r44-${key}`,
		employment_id: employment.id,
		work_date: '2026-01-05',
		shift_definition_id: null,
		worked_intervals: [
			{
				start: '2026-01-05T09:00:00+08:00',
				end: '2026-01-05T20:00:00+08:00'
			}
		],
		approval_id: null
	});
};

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — First Schedule wage classes govern the RM4,000 overtime coverage threshold`, () => {
		const version = settingsVersions(code).find(
			(row) =>
				row.effective_range.start <= '2026-01-05T00:00:00.000Z' &&
				row.effective_range.end > '2026-01-05T00:00:00.000Z'
		)!;
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [
					...['BARE', 'ALLOWANCE', 'COMMISSION', 'SUBSISTENCE'].map((key) => ({
						key,
						wage: 3800,
						citizenship: 'CITIZEN' as const,
						registrations: registration
					})),
					{ key: 'OVER_LIMIT', wage: 4000.01, citizenship: 'CITIZEN', registrations: registration },
					{
						key: 'MANUAL',
						wage: 5000,
						citizenship: 'CITIZEN',
						statutory_work_category: 'MANUAL_LABOUR',
						registrations: registration
					}
				]
			},
			(world) => {
				const sua = world.allowance_catalogue.find(
					(row) => row.code === 'SUA' && row.settings_id === version.id
				)!;
				assert.ok(sua.counts_toward.includes('FIRST_SCHEDULE_WAGES'));
				for (const [key, mark] of [
					['COMMISSION', ['WAGES']],
					['SUBSISTENCE', []]
				] as const) {
					world.allowance_catalogue.push({
						...sua,
						id: `my-r44-class-${code}-${key}`,
						code: key,
						name: key,
						counts_toward: [...mark]
					});
				}
				for (const key of ['ALLOWANCE', 'COMMISSION', 'SUBSISTENCE']) {
					const employment = world.employments.find((row) => row.employee_number === key)!;
					world.employment_terms.find((row) => row.employment_id === employment.id)!.allowances = [
						{
							catalogue_id: world.allowance_catalogue.find(
								(row) =>
									row.code === (key === 'ALLOWANCE' ? 'SUA' : key) && row.settings_id === version.id
							)!.id,
							amount: 500
						}
					];
				}
				for (const key of [
					'BARE',
					'ALLOWANCE',
					'COMMISSION',
					'SUBSISTENCE',
					'OVER_LIMIT',
					'MANUAL'
				])
					work(world, key);
			}
		);
		const overtime = (key: string) =>
			slips
				.get(key)!
				.adjustments.filter((row) => row.family === 'WORK_DAY' && row.label.includes('OT'));
		for (const key of ['BARE', 'COMMISSION', 'SUBSISTENCE', 'MANUAL'])
			assert.ok(overtime(key).length > 0, `${key}: statutorily covered`);
		for (const key of ['ALLOWANCE', 'OVER_LIMIT'])
			assert.equal(overtime(key).length, 0, `${key}: outside the threshold`);
	});
