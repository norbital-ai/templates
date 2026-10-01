import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

const source =
	'https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf';
for (const arrangement of ['DAILY', 'WEEKLY'] as const) {
	const weekly = arrangement === 'WEEKLY';
	const facts = { normal_hours_arrangement: arrangement, normal_hours_notified_on: '2026-02-01' };
	const schedule = officeWeek('2026-01-26').map((input): ProbeInput => {
		if (weekly && input.ref === 'office')
			return {
				...input,
				values: {
					...input.values,
					variant: { kind: 'WORK', start_time: '09:00', end_time: '20:00', break_minutes: 60 }
				}
			};
		if (weekly && input.ref === 'week')
			return {
				...input,
				values: {
					...input.values,
					pattern: {
						days: ['@office', '@office', '@office', '@office', '@off', '@off', '@rest'].map(
							(roster_code_id) => ({ roster_code_id })
						)
					}
				}
			};
		return input;
	});
	register({
		id: weekly ? 'VN-LC105-02-1' : 'VN-LC105-01-1',
		profile: 'VN',
		description: `${arrangement} arrangement saved through terms: February 2026 has ${weekly ? '16 ten-hour' : '20 eight-hour'} normal days. Only the extra hour on 2 February earns overtime; late notification and a 49-hour contractual week are refused.`,
		citation: [
			`Labour Code 45/2019/QH14 arts.98(1)(a), 105(1)–(2): ${source}; VND16,000,000 / ${weekly ? '16 / 10' : '20 / 8'} = VND100,000/hour; one extra hour × 150% = VND150,000. Notification must precede application.`,
			'Law 41/2024/QH15 arts.33–34, Decree 188/2025/ND-CP, Law 74/2025/QH15 arts.33–34: on VND16m SI 8%/17.5%, HI 1.5%/3%, UI 1%/1%; Law 109/2025 art.4(8) exempts overtime, Resolution 110/2025 personal deduction VND15.5m exceeds VND14.32m ordinary taxable income.'
		],
		company: { region: 'I', facts: {}, effective_range: { from: '2026-02-01', to: null } },
		inputs: [
			...schedule,
			{
				collection: 'employees',
				ref: 'worker',
				values: {
					name: `Working-time ${arrangement}`,
					date_of_birth: '1990-01-01',
					gender: 'MALE',
					marital_status: 'SINGLE',
					spouse_status: 'NONE'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@worker',
					company_id: '@company',
					employee_number: `P-VN-HOURS-${arrangement}`,
					effective_range: { from: '2026-02-01', to: null }
				}
			},
			{
				collection: 'employment_terms',
				ref: 'terms',
				values: {
					employment_id: '@job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'VND',
					base_salary: 16_000_000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					ordinary_hours_per_week: 40,
					facts,
					shift_pattern_id: '@week',
					effective_range: { from: '2026-02-01', to: null }
				}
			},
			{
				collection: 'employment_terms',
				target: '@terms',
				values: { facts: { ...facts, normal_hours_notified_on: '2026-02-02' } },
				refused: 'notify the worker of the working-time arrangement on or before its effective date'
			},
			{
				collection: 'employment_terms',
				target: '@terms',
				values: { ordinary_hours_per_week: 49 },
				refused: 'normal working time exceeds 48 hours a week'
			},
			...['UI', 'UNION_DUES', 'PIT'].map((code): ProbeInput => ({
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@worker',
					employment_id: '@job',
					statutory_contribution_id: `@law:statutory_contributions:${code}`,
					effective_range: { from: '2026-02-01', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: `VN-HOURS-${arrangement}-${code}`,
						elections:
							code === 'UI'
								? { pension_qualified: false }
								: code === 'UNION_DUES'
									? { union_member: false }
									: { eligible_dependents: 0 }
					}
				}
			})),
			{
				collection: 'work_days',
				values: {
					employment_id: '@job',
					work_date: '2026-02-02',
					worked_intervals: [
						{ start: '2026-02-02T02:00:00.000Z', end: '2026-02-02T06:00:00.000Z' },
						{
							start: '2026-02-02T07:00:00.000Z',
							end: weekly ? '2026-02-02T14:00:00.000Z' : '2026-02-02T12:00:00.000Z'
						}
					],
					approved_overtime_hours: 1
				}
			}
		],
		period: '2026-02',
		expected: [
			{
				employment: 'job',
				lines: {
					BASIC: 16_000_000,
					OVERTIME: 150_000,
					gross: 16_150_000,
					net: 14_470_000,
					'SI.employee': 1_280_000,
					'SI.employer': 2_800_000,
					'HI.employee': 240_000,
					'HI.employer': 480_000,
					'UI.employee': 160_000,
					'UI.employer': 160_000,
					'PIT.employee': 0
				}
			}
		],
		saved: [
			{
				collection: 'employment_terms',
				select: { facts: true, ordinary_hours_per_week: true },
				where: { employment_id: '@job' },
				rows: [
					{
						'facts.normal_hours_arrangement': arrangement,
						'facts.normal_hours_notified_on': '2026-02-01',
						ordinary_hours_per_week: 40
					}
				]
			}
		]
	});
}
