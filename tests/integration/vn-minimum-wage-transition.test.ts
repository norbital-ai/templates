import { expect, it } from 'vitest';
import { committed, refused, workspace } from './kit.ts';
import { settingsIdOn } from '../fixtures/statutory-world.ts';

it('saves Vietnam minimum-wage facts and refuses a daily contract below both converted floors', async () => {
	const t = await workspace({ now: '2026-01-25T02:00:00.000Z' });
	const admin = t.as(t.admin);
	const company = committed(
		await admin.act('companies.create', {
			settings_code: 'VN',
			name: 'VN wage transition probe',
			pay_cutoff_day: 21,
			pay_frequency: 'MONTHLY',
			region: 'IV',
			facts: {},
			effective_range: { from: '2024-01-01', to: null }
		})
	)[0]!.id as string;
	const work = committed(
		await admin.act('shift_definitions.create', {
			company_id: company,
			code: 'WORK',
			name: 'Eight-hour day',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 },
			effective_range: { from: '2024-01-01', to: null }
		})
	)[0]!.id as string;
	const off = committed(
		await admin.act('shift_definitions.create', {
			company_id: company,
			code: 'OFF',
			name: 'Off day',
			variant: { kind: 'OFF' },
			effective_range: { from: '2024-01-01', to: null }
		})
	)[0]!.id as string;
	const rest = committed(
		await admin.act('shift_definitions.create', {
			company_id: company,
			code: 'REST',
			name: 'Weekly rest day',
			variant: { kind: 'REST' },
			effective_range: { from: '2024-01-01', to: null }
		})
	)[0]!.id as string;
	const pattern = committed(
		await admin.act('shift_patterns.create', {
			company_id: company,
			code: 'FIVE_DAYS',
			name: 'Five days',
			pattern: {
				days: [work, work, work, work, work, off, rest].map((roster_code_id) => ({
					roster_code_id
				}))
			},
			effective_range: { from: '2024-01-01', to: null }
		})
	)[0]!.id as string;
	const person = committed(
		await admin.act('employees.create', {
			name: 'VN Incumbent Probe',
			email: 'vn-incumbent-probe@example.com'
		})
	)[0]!.id as string;
	const created = committed(
		await admin.act('employments.create', {
			employee_id: person,
			company_id: company,
			employee_number: 'VN-INCUMBENT',
			effective_range: { from: '2025-12-31', to: null },
			employment_terms: {
				create: [
					{
						residency_status: 'CITIZEN',
						tax_residency: 'RESIDENT',
						currency: 'VND',
						base_salary: 3_800_000,
						pay_frequency: 'MONTHLY',
						work_classification: 'EA_COVERED',
						employment_type: 'PERMANENT',
						ordinary_hours_per_week: 40,
						minimum_wage_2025_region: 'III',
						minimum_wage_2026_area_reclassified: true,
						shift_pattern_id: pattern,
						effective_range: { from: '2025-12-31', to: null }
					}
				]
			}
		})
	);
	const termsId = created.find((row) => row.collection === 'employment_terms')!.id as string;
	const terms = await admin.get('employment_terms', termsId);
	expect(terms?.minimum_wage_2025_region).toBe('III');
	expect(terms?.minimum_wage_2026_area_reclassified).toBe(true);
	for (const [code, elections] of [
		['UI', { pension_qualified: false }],
		['UNION_DUES', { union_member: false }]
	] as const) {
		const scheme = (
			await admin.read('statutory_contributions', {
				where: { settings_id: { eq: settingsIdOn('VN', '2026-01-25') }, code: { eq: code } },
				limit: 1
			})
		).rows[0]!;
		committed(
			await admin.act('employment_statutory_facts.create', {
				employee_id: person,
				employment_id: created.find((row) => row.collection === 'employments')!.id,
				statutory_contribution_id: scheme.id,
				effective_range: { from: '2025-12-31', to: null },
				status: { kind: 'REGISTERED', reference_number: `VN-${code}-PROBE`, elections }
			})
		);
	}
	const failure = refused(
		await admin.act('payroll_runs.create', { company_id: company, period: '2026-01' })
	);
	expect(failure).toContain('MINIMUM_WAGE_BELOW: VN-INCUMBENT');
	expect(failure).toContain('3860000 (protected 2025 Region III)');
	committed(
		await admin.act('employment_terms.update', { target: termsId, set: { base_salary: 3_860_000 } })
	);
	const run = committed(
		await admin.act('payroll_runs.create', { company_id: company, period: '2026-01' })
	).find((row) => row.collection === 'payroll_runs')!;
	const savedRun = await admin.get('payroll_runs', run.id as string);
	expect(savedRun?.warnings).not.toContain('MINIMUM_WAGE_BELOW');

	const dailyPerson = committed(
		await admin.act('employees.create', {
			name: 'VN Daily Wage Probe',
			email: 'vn-daily-wage-probe@example.com'
		})
	)[0]!.id as string;
	const dailyCreated = committed(
		await admin.act('employments.create', {
			employee_id: dailyPerson,
			company_id: company,
			employee_number: 'VN-DAILY',
			effective_range: { from: '2026-01-25', to: null },
			employment_terms: {
				create: [
					{
						residency_status: 'CITIZEN',
						tax_residency: 'RESIDENT',
						currency: 'VND',
						base_salary: 140_000,
						pay_frequency: 'DAILY',
						work_classification: 'EA_COVERED',
						employment_type: 'PERMANENT',
						ordinary_hours_per_week: 40,
						shift_pattern_id: pattern,
						effective_range: { from: '2026-01-25', to: null }
					}
				]
			}
		})
	);
	const dailyEmploymentId = dailyCreated.find((row) => row.collection === 'employments')!.id;
	const dailyTermsId = dailyCreated.find((row) => row.collection === 'employment_terms')!
		.id as string;
	for (const [code, elections] of [
		['UI', { pension_qualified: false }],
		['UNION_DUES', { union_member: false }]
	] as const) {
		const scheme = (
			await admin.read('statutory_contributions', {
				where: { settings_id: { eq: settingsIdOn('VN', '2026-02-20') }, code: { eq: code } },
				limit: 1
			})
		).rows[0]!;
		committed(
			await admin.act('employment_statutory_facts.create', {
				employee_id: dailyPerson,
				employment_id: dailyEmploymentId,
				statutory_contribution_id: scheme.id,
				effective_range: { from: '2026-01-25', to: null },
				status: { kind: 'REGISTERED', reference_number: `VN-${code}-DAILY`, elections }
			})
		);
	}
	const dailyFailure = refused(
		await admin.act('payroll_runs.create', { company_id: company, period: '2026-02' })
	);
	expect(dailyFailure).toContain('MINIMUM_WAGE_BELOW: VN-DAILY');
	expect(dailyFailure).toContain('17500 an hour');
	committed(
		await admin.act('employment_terms.update', {
			target: dailyTermsId,
			set: { base_salary: 150_000 }
		})
	);
	const february = committed(
		await admin.act('payroll_runs.create', { company_id: company, period: '2026-02' })
	).find((row) => row.collection === 'payroll_runs')!;
	const savedFebruary = await admin.get('payroll_runs', february.id as string);
	expect(savedFebruary?.warnings).not.toContain('MINIMUM_WAGE_BELOW');
});
