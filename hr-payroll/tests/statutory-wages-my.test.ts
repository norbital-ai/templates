import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsVersions, type Person } from './fixtures/statutory-world.ts';
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

// PSMB Act 2001 s.2 and First Schedule: the HRD levy is on Malaysian citizens, and an employer of 5
// or more of them can be levied (5-9 on election, 10+ compulsorily). The results-pay refusal is
// gated by that seeded expression, and the engine judges it against the run's citizen count.
const HRD_TEST = 'employee.citizenship == "CITIZEN" && company.headcount_citizens >= 5';

test('MY/MY-nihon — every version seeds the HRD results-pay refusal test', () => {
	for (const code of ['MY', 'MY-nihon'] as const)
		for (const version of settingsVersions(code))
			assert.equal(
				version.work_rules.wages?.results_pay?.applies_when,
				HRD_TEST,
				`${code} ${version.code}`
			);
});

test('MY — the results-pay levy refusal follows wages.results_pay.applies_when', () => {
	// One zero-basic piece worker (1 unit × RM1,800) among ten citizens: HRD liable (10 ≥ 5).
	const people: Person[] = [
		{
			key: 'PIECE-HRD',
			wage: 0,
			statutory_work_category: 'PIECE_RATE',
			citizenship: 'CITIZEN',
			registrations: registration
		},
		...Array.from({ length: 9 }, (_, index): Person => ({
			key: `HRD-${index}`,
			wage: 1_700,
			citizenship: 'CITIZEN',
			registrations: registration
		}))
	];
	const run = (appliesWhen: string | null) =>
		buildStatutory({ code: 'MY', period: '2026-01', region: 'Malaysia', people }, (world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			if (appliesWhen != null)
				for (const [index, version] of world.jurisdiction_settings.entries()) {
					const copy = structuredClone(version) as {
						work_rules: { wages: { results_pay: Record<string, unknown> } };
					};
					copy.work_rules.wages.results_pay.applies_when = appliesWhen;
					world.jurisdiction_settings[index] = copy;
				}
			world.work_days.push({
				id: 'wd-piece-hrd-gate',
				employment_id: world.employments[0]!.id,
				work_date: '2026-01-30',
				shift_definition_id: null,
				worked_intervals: null,
				piece_units: 1,
				piece_unit_rate: 1_800,
				approval_id: null
			});
		});
	const refusal = /need an HRD Corp levy classification/;
	assert.throws(() => run(null), refusal, 'seeded: 10 citizens ≥ 5');
	// The same run with the test narrowed past this employer's ten citizens: the gate reads the count.
	let message = '';
	try {
		run('company.headcount_citizens >= 11');
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	assert.doesNotMatch(message, refusal);
});
