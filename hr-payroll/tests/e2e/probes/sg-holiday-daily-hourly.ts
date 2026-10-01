import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

const authority = [
	'Employment Act s88(3): evidenced absence without consent or reasonable excuse on either adjacent working day forfeits holiday entitlement. Actual holiday work remains separately paid. https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay',
	'MOM: Saturday is the non-working day on a five-day week; holiday then earns another day off or salary in lieu, subject to entitlement. https://www.mom.gov.sg/faq/public-holidays/are-public-holidays-paid-even-when-an-employee-is-not-required-to-work',
	'CPF2026 citizen below55: employee20%, total37%, nearest dollar total and employee cents dropped. All selected gross figures are whole hundreds. https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf',
	'SDL0.25% total wages, within minimum2 and maximum11.25. https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy'
];
const scenarios = [
	{
		code: 'BEFORE',
		absent: '2026-04-30',
		permission: 'NO',
		excuse: 'NO',
		gross: 2000,
		basic: 2000
	},
	{ code: 'AFTER', absent: '2026-05-04', permission: 'NO', excuse: 'NO', gross: 1900, basic: 1900 },
	{
		code: 'EXCUSE',
		absent: '2026-05-04',
		permission: 'NO',
		excuse: 'YES',
		gross: 2000,
		basic: 2000
	},
	{
		code: 'UNKNOWN',
		absent: '2026-05-04',
		permission: null,
		excuse: null,
		gross: 2000,
		basic: 2000
	},
	{
		code: 'WORKED',
		absent: '2026-05-04',
		permission: 'NO',
		excuse: 'NO',
		gross: 2000,
		basic: 1900
	},
	{
		code: 'OFF-DENIED',
		absent: '2026-03-20',
		permission: 'NO',
		excuse: 'NO',
		gross: 2100,
		basic: 2100
	},
	{
		code: 'OFF-CONSENT',
		absent: '2026-03-20',
		permission: 'YES',
		excuse: 'NO',
		gross: 2200,
		basic: 2100
	}
] as const;
for (const frequency of ['DAILY', 'HOURLY'] as const)
	for (const scenario of scenarios) {
		const id = `SG-HOL-EARNED-${frequency}-${scenario.code}`;
		const off = scenario.code.startsWith('OFF-');
		const worked = scenario.code === 'WORKED';
		const holiday = off ? '2026-03-21' : '2026-05-01';
		const reference = `Synthetic evidenced attendance review ${id}`;
		const facts: Row =
			scenario.permission == null
				? {}
				: {
						absence_permission: scenario.permission,
						absence_reasonable_excuse: scenario.excuse,
						absence_decision: reference
					};
		const evidence: ProbeInput[] =
			scenario.permission == null
				? []
				: [
						{
							collection: 'fact_evidence',
							ref: 'decision',
							values: {
								subject: { collection: 'work_days', id: '@absent' },
								fact_key: 'absence_decision',
								reference,
								received_on: scenario.absent
							}
						}
					];
		register({
			id,
			profile: 'SG',
			period: off ? '2026-03' : '2026-05',
			description: `${frequency} eight-hour100-dollar day: ${scenario.code} holiday entitlement through saved payroll.`,
			citation: [
				...authority,
				'May has21Monday–Friday days; March22. DAILY100 or HOURLY12.50×8 buys100. PriorApril absence removes no May earned units. FollowingMay absence removes100; forfeiture removes holiday100 separately. Worked holiday preserves extra100. March absent Friday leaves21earned weekdays2100; entitled Saturday holiday adds100.',
				`Expected gross${scenario.gross}, BASIC${scenario.basic}; employeeCPF${scenario.gross * 0.2}, employerCPF${scenario.gross * 0.17}, SDL${scenario.gross * 0.0025}. Synthetic race/religion OTHER triggers no self-help levy.`
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
						name: `Synthetic ${id}`,
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
						employee_number: id,
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
						base_salary: frequency === 'DAILY' ? 100 : 12.5,
						pay_frequency: frequency,
						ordinary_hours_per_week: 40,
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
						date: holiday,
						name: off ? 'Hari Raya Puasa' : 'Labour Day',
						kind: 'PUBLIC_HOLIDAY',
						given_to: 'EVERYONE',
						published_at: '2025-12-01T00:00:00.000Z'
					}
				},
				{
					collection: 'work_days',
					ref: 'holiday',
					values: {
						employment_id: '@job',
						work_date: holiday,
						worked_intervals: worked
							? [
									{ start: `${holiday}T09:00:00+08:00`, end: `${holiday}T13:00:00+08:00` },
									{ start: `${holiday}T14:00:00+08:00`, end: `${holiday}T18:00:00+08:00` }
								]
							: [],
						...(worked ? { approved_overtime_hours: 8 } : {})
					}
				},
				{
					collection: 'work_days',
					ref: 'absent',
					values: { employment_id: '@job', work_date: scenario.absent, worked_intervals: [], facts }
				},
				...evidence
			],
			expected: [
				{
					employment: 'job',
					lines: {
						gross: scenario.gross,
						net: scenario.gross * 0.8,
						BASIC: scenario.basic,
						...(worked || (off && scenario.permission === 'YES') ? { OVERTIME: 100 } : {}),
						'CPF.employee': scenario.gross * 0.2,
						'CPF.employer': scenario.gross * 0.17,
						'SDL.employer': scenario.gross * 0.0025
					}
				}
			],
			warnings:
				scenario.permission == null
					? ['adjacent absence.*needs permission, reasonable-excuse and decision evidence']
					: [],
			saved: [
				{
					collection: 'work_days',
					where: { id: '@absent' },
					select: { facts: true, work_date: true },
					rows: [{ work_date: scenario.absent, facts }]
				},
				...evidence.map(() => ({
					collection: 'fact_evidence' as const,
					where: { id: '@decision' },
					rows: [{ fact_key: 'absence_decision', reference, received_on: scenario.absent }]
				}))
			]
		});
	}
