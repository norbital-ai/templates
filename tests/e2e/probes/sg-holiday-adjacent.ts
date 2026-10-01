import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

const authority =
	'Employment Act s.88(3); https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay; https://www.mom.gov.sg/faq/public-holidays/are-public-holidays-paid-even-when-an-employee-is-not-required-to-work';
const cases = [
	{
		id: 'SG-HOL-ADJACENT-UNAUTHORIZED',
		period: '2026-03',
		holiday: '2026-03-21',
		absent: '2026-03-20',
		permission: 'NO',
		gross: 2863.64,
		employee: 572,
		employer: 488,
		sdl: 7.16
	},
	{
		id: 'SG-HOL-ADJACENT-CONSENT',
		period: '2026-03',
		holiday: '2026-03-21',
		absent: '2026-03-20',
		permission: 'YES',
		gross: 3002.1,
		employee: 600,
		employer: 511,
		sdl: 7.51
	},
	{
		id: 'SG-HOL-ADJACENT-CROSS-MONTH',
		period: '2026-05',
		holiday: '2026-05-01',
		absent: '2026-04-30',
		permission: 'NO',
		gross: 2857.14,
		employee: 571,
		employer: 486,
		sdl: 7.14
	},
	{
		id: 'SG-HOL-ADJACENT-UNKNOWN',
		period: '2026-03',
		holiday: '2026-03-21',
		absent: '2026-03-20',
		permission: null,
		gross: 3002.1,
		employee: 600,
		employer: 511,
		sdl: 7.51
	}
] as const;

for (const example of cases) {
	const reference = `Synthetic absence review ${example.id}`;
	const facts: Row =
		example.permission == null
			? {}
			: {
					absence_permission: example.permission,
					absence_reasonable_excuse: 'NO',
					absence_decision: reference
				};
	const decision: ProbeInput[] =
		example.permission == null
			? []
			: [
					{
						collection: 'fact_evidence',
						ref: 'decision',
						values: {
							subject: { collection: 'work_days', id: '@absent' },
							fact_key: 'absence_decision',
							reference,
							received_on: example.absent
						}
					}
				];
	register({
		id: example.id,
		profile: 'SG',
		description: `${example.holiday} holiday with adjacent absence ${example.absent}; ${example.permission == null ? 'missing decision protects holiday pay and records unresolved evidence' : example.permission === 'YES' ? 'employer consent protects holiday pay' : 'evidenced unauthorized absence forfeits holiday pay'}.`,
		citation: [
			authority,
			'March: salary $3,000 / 22 weekdays = $136.36 absence deduction; Saturday holiday gross day $3,000 × 12 / (52 × 5) = $138.46. May: $3,000 / 21 weekdays = $142.86 holiday forfeiture; the April absence is not deducted from May salary.',
			'CPF total calendar-month contributions 37% nearest dollar (50 cents up), employee 20% drop cents, employer remainder: https://www.cpf.gov.sg/service/article/are-cpf-contributions-rounded-to-the-nearest-dollar; https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf. SDL 0.25%, employee levy rounded to cents: https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy'
		],
		company: {
			pay_cutoff_day: 1,
			facts: { public_holiday_compensation: 'PAY', sdl_individual_employer: false },
			effective_range: { from: '2025-06-02', to: null }
		},
		inputs: [
			...officeWeek('2025-06-02'),
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Synthetic ${example.id}`,
					date_of_birth: '1990-01-01',
					gender: 'MALE',
					nationality: 'Singaporean',
					race: 'OTHER',
					religion: 'OTHER'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: example.id,
					effective_range: { from: '2025-06-02', to: null }
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'SGD',
					base_salary: 3000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					shift_pattern_id: '@week',
					effective_range: { from: '2025-06-02', to: null }
				}
			},
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@person',
					employment_id: '@job',
					statutory_contribution_id: '@law:statutory_contributions:SDL',
					effective_range: { from: '2025-06-02', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'Synthetic SDL registration',
						elections: {
							sdl_service_scope: 'SINGAPORE_SERVICE',
							sdl_household_role: 'NONE',
							sdl_wholly_exclusive: false,
							sdl_nonbusiness: false,
							sdl_student_class: 'NONE'
						}
					}
				}
			},
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: example.holiday,
					name: example.holiday === '2026-03-21' ? 'Hari Raya Puasa' : 'Labour Day',
					kind: 'PUBLIC_HOLIDAY',
					given_to: 'EVERYONE',
					published_at: '2025-12-01T00:00:00.000Z'
				}
			},
			{
				collection: 'work_days',
				ref: 'holiday',
				values: { employment_id: '@job', work_date: example.holiday, worked_intervals: [] }
			},
			{
				collection: 'work_days',
				ref: 'absent',
				values: { employment_id: '@job', work_date: example.absent, worked_intervals: [], facts }
			},
			...decision
		],
		period: example.period,
		expected: [
			{
				employment: 'job',
				lines: {
					gross: example.gross,
					net: Math.round((example.gross - example.employee) * 100) / 100,
					'CPF.employee': example.employee,
					'CPF.employer': example.employer,
					'SDL.employer': example.sdl
				}
			}
		],
		warnings:
			example.permission == null
				? ['adjacent absence.*needs permission, reasonable-excuse and decision evidence']
				: [],
		saved: [
			{
				collection: 'work_days',
				where: { id: '@absent' },
				select: { facts: true, work_date: true },
				rows: [{ work_date: example.absent, facts }]
			},
			...(example.permission == null
				? []
				: [
						{
							collection: 'fact_evidence',
							where: { id: '@decision' },
							rows: [{ fact_key: 'absence_decision', reference, received_on: example.absent }]
						}
					])
		]
	});
}
