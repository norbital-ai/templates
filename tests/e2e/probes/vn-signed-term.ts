import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

for (const [signedEnd, insured] of [
	['2026-08-31', false],
	['2027-09-30', true]
] as const) {
	const facts: ProbeInput[] = ['UNION_DUES', 'PIT'].map((code) => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: '@person',
			employment_id: '@job',
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from: '2025-10-01', to: null },
			status: {
				kind: 'REGISTERED',
				reference_number: `SYNTHETIC-SIGNED-${code}`,
				elections: code === 'PIT' ? { eligible_dependents: 0 } : { union_member: false }
			}
		}
	}));
	register({
		id: `VN-signed-term-${insured ? '24' : '11'}-month-redundancy`,
		profile: 'VN',
		period: '2026-08',
		description:
			'Synthetic foreign worker: signed duration determines insurance after redundancy; actual service remains eleven months.',
		citation: [
			'Labour Code arts.20(1)(b),21(1)(d),168(3); SI Law41/2024 art.2(2),31(1)(đ),33–34: https://datafiles.chinhphu.vn/cpp/files/vbpq/2024/9/41-2024-qh15.pdf',
			'HI Law art.12(1)(c),14(5), Decree188 art.6(1)(a): https://congbao.cdnchinhphu.vn/CongBaoCP/VanBan/2025/2/44464/55506-1-2025539-54022-vbhn-vpqh.pdf',
			'August reference2,530,000, ceiling50,600,000: SI8%/17.5%, HI1.5%/3%; excluded eleven-month term receives employer equivalent8,855,000+1,518,000=10,373,000. No UI for foreigners.',
			'PIT Law109/2025 art.9, Resolution110/2025 personal deduction15,500,000: equivalent is taxable wage. Eleven-month taxable60,000,000+10,373,000−15,500,000=54,873,000; PIT10m×5%+20m×10%+24,873,000×20%=7,474,600. Covered twenty-four-month taxable60,000,000−4,048,000−759,000−15,500,000=39,693,000; PIT10m×5%+20m×10%+9,693,000×20%=4,438,600.'
		],
		company: { region: 'I', facts: {}, effective_range: { from: '2025-10-01', to: null } },
		inputs: [
			...officeWeek('2025-09-29'),
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: 'Synthetic signed-term foreign worker',
					date_of_birth: '1985-02-10',
					gender: 'MALE',
					nationality: 'Japanese',
					marital_status: 'SINGLE',
					spouse_status: 'NONE'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'SIGNED',
					effective_range: { from: '2025-10-01', to: '2026-08-31' },
					signed_contract_end: signedEnd,
					exit_ground: 'REDUNDANCY',
					exit_facts: { pension_eligible: false }
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: 'FOREIGNER',
					pass_type: 'WORK_PERMIT',
					tax_residency: 'RESIDENT',
					currency: 'VND',
					base_salary: 60_000_000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'CONTRACT',
					shift_pattern_id: '@week',
					facts: { prior_floor_region: 'I', prior_floor_reclassified: false },
					effective_range: { from: '2025-10-01', to: '2026-08-31' }
				}
			},
			...facts
		],
		expected: [
			{
				employment: 'job',
				lines: {
					...(insured
						? {
								'SI.employee': 4_048_000,
								'SI.employer': 8_855_000,
								'HI.employee': 759_000,
								'HI.employer': 1_518_000
							}
						: { INSURANCE_EQUIVALENT: 10_373_000 }),
					'PIT.employee': insured ? 4_438_600 : 7_474_600,
					'PIT.employer': 0
				}
			}
		],
		saved: [
			{
				collection: 'employments',
				where: { id: '@job' },
				select: { signed_contract_end: true, effective_range: true, exit_ground: true },
				rows: [
					{
						signed_contract_end: signedEnd,
						'effective_range.to': '2026-08-31',
						exit_ground: 'REDUNDANCY'
					}
				]
			}
		]
	});
}
