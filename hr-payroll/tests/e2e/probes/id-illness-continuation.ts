import { officeWeek, register, type ProbeCase, type ProbeInput } from '../payroll-probe.ts';

// The oracle is the saved gross wage plus the saved episode facts, rather than unrelated tax
// and contribution amounts. Each write uses the production collection transform and payroll run.
for (const [date, month, deduction] of [
	['2026-03-02', 4, 0],
	['2026-04-01', 5, 250_000],
	['2026-07-01', 8, 250_000],
	['2026-08-03', 9, 500_000],
	['2026-11-02', 12, 500_000],
	['2026-12-01', 13, 750_000]
] as const) {
	const period = date.slice(0, 7);
	const days = new Date(
		Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)
	).getUTCDate();
	const wage = days * 1_000_000;
	const medical = (day: string, ref: string): ProbeInput => ({
		collection: 'leave_entries',
		ref,
		values: {
			employment_id: '@job',
			catalogue_id: `@law:leave_catalogue:MEDICAL_LEAVE@${day}`,
			reference: ref,
			from_date: day,
			to_date: day,
			facts: { event_date: '2025-12-01' },
			reason: 'Continuation of the same certified illness'
		},
		files: { certificate_file: 'continuous-illness-doctor-certificate.pdf' }
	});
	register({
		id: `ID-37-episode-m${month}`,
		profile: 'ID',
		period,
		description: `Same illness starts 1 December 2025; its split month-${month} entry deducts Rp${deduction}, retaining the original pay stage.`,
		citation: [
			'UU 13/2003 art.93(3), 100%/75%/50%/25% in successive four-month stages: https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf',
			'Configured calendar-day proration (ID-106 owner default): wage equals calendar days × Rp1m, so the charged day is Rp1m.'
		],
		company: {
			region: 'Provinsi DKI Jakarta',
			risk_class: 'I',
			facts: { enterprise_size_class: 'OTHER' }
		},
		inputs: [
			...officeWeek('2000-01-03'),
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: 'Synthetic illness worker',
					date_of_birth: '1995-05-10',
					gender: 'MALE',
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					dependents_count: 0,
					nationality: 'Indonesian'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'ID-ILL',
					effective_range: { from: '2025-12-01', to: null }
				}
			},
			{
				collection: 'employment_terms',
				ref: 'terms',
				values: {
					employment_id: '@job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'IDR',
					base_salary: wage,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					worksite: 'Provinsi DKI Jakarta',
					worksite_sector: '62019',
					shift_pattern_id: '@week',
					effective_range: { from: '2025-12-01', to: null },
					facts: {
						worksite_sector_edition: '2020',
						wage_scale_grade: 'G1',
						wage_scale_basic_minimum: wage,
						wage_scale_effective_on: '2025-12-01',
						wage_scale_notice_on: '2025-12-01',
						wage_scale_reference: 'SYNTHETIC-SCALE-G1'
					}
				}
			},
			{
				collection: 'fact_evidence',
				values: {
					subject: { collection: 'employment_terms', id: '@terms' },
					fact_key: 'wage_scale_reference',
					reference: 'SYNTHETIC-SCALE-G1'
				},
				files: { file: 'synthetic-wage-scale-and-notice.pdf' }
			},
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@person',
					statutory_contribution_id: '@law:statutory_contributions:PPH21',
					effective_range: { from: '2025-12-01', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC-NPWP',
						elections: {
							recipient_class: 'REGULAR_EMPLOYEE',
							ptkp_marital_status: 'SINGLE',
							ptkp_dependants: 0,
							no_tax_id: false
						}
					}
				}
			},
			medical('2025-12-01', 'opening'),
			medical(date, 'continuation')
		],
		expected: [],
		saved: [
			{
				collection: 'payslips',
				where: { employment_id: '@job', payroll_run_id: '@run' },
				rows: [{ gross: wage - deduction }]
			},
			{
				collection: 'leave_entries',
				where: { id: '@continuation' },
				select: { facts: true, from_date: true, days: true },
				rows: [{ 'facts.event_date': '2025-12-01', from_date: date, days: 1 }]
			},
			{
				collection: 'employment_terms',
				where: { id: '@terms' },
				select: { facts: true },
				rows: [{ 'facts.worksite_sector_edition': '2020', 'facts.wage_scale_basic_minimum': wage }]
			}
		]
	} satisfies ProbeCase);
}
