import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

const bonus = (ref: string, amount: number, period: string, adjustment = false): ProbeInput => ({
	collection: 'adhoc_requests',
	ref,
	values: {
		employment_id: '@job',
		catalogue_id: '@law:adhoc_catalogue:bonus',
		amount,
		event_date: '2026-03-10',
		pay_period: period,
		as_adjustment_entry: adjustment,
		reason: 'Synthetic explicit correction; not a linked frozen reversal'
	}
});
for (const split of [false, true])
	register({
		id: `adhoc-manual-correction-${split ? 'split' : 'combined'}`,
		profile: 'SG',
		company: { facts: { sdl_individual_employer: false } },
		period: split ? '2026-04' : '2026-05',
		description:
			'Paid original remains unchanged; explicit next-period bonus clawback and replacement settle once.',
		citation: [
			'Synthetic employer instruction: March bonus2,000; April clawback500 and replacement750. April gross6,000−500+750=6,250. Combined case reruns unpaid April twice and May returns to6,000 without replay. This proves manual correction, not linked frozen reversal.',
			'CPF Act1953 s.7, First Schedule: foreign employees outside CPF: https://sso.agc.gov.sg/Act/CPFA1953',
			'SDL Act1979 s.3: 0.25% monthly wages, maximum11.25 above4,500: https://sso.agc.gov.sg/Act/SDLA1979#pr3-'
		],
		inputs: [
			...officeWeek('2026-02-23'),
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: 'Synthetic correction employee',
					date_of_birth: '1990-07-01',
					gender: 'MALE',
					nationality: 'Chinese',
					race: 'CHINESE',
					religion: 'OTHER'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'CORRECTION',
					effective_range: { from: '2026-03-01', to: null }
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@job',
					residency_status: 'FOREIGNER',
					pass_type: 'EMPLOYMENT_PASS',
					tax_residency: 'NON_RESIDENT',
					currency: 'SGD',
					base_salary: 6000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					shift_pattern_id: '@week',
					effective_range: { from: '2026-03-01', to: null }
				}
			},
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@person',
					employment_id: '@job',
					statutory_contribution_id: '@law:statutory_contributions:SDL',
					effective_range: { from: '2026-03-01', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'SYNTHETIC-SDL',
						elections: {
							sdl_service_scope: 'SINGAPORE_SERVICE',
							sdl_household_role: 'NONE',
							sdl_wholly_exclusive: false,
							sdl_nonbusiness: false,
							sdl_student_class: 'NONE'
						}
					}
				}
			}
		],
		history: [
			{
				period: '2026-03',
				inputs: [bonus('original', 2000, '2026-03')],
				expected: [
					{
						employment: 'job',
						lines: { gross: 8000, net: 8000, bonus: 2000, 'SDL.employee': 0, 'SDL.employer': 11.25 }
					}
				]
			},
			...(split
				? [
						{
							period: '2026-04',
							kind: 'OFF_CYCLE',
							sources: ['@correction', '@replacement'],
							inputs: [
								bonus('correction', 500, '2026-04', true),
								bonus('replacement', 750, '2026-04')
							],
							expected: [{ employment: 'job', lines: { gross: 250, net: 250 } }],
							early: [
								{
									employment: 'job',
									lines: { gross: 6000, net: 6000, 'SDL.employee': 0, 'SDL.employer': 11.25 }
								}
							]
						}
					]
				: [
						{
							period: '2026-04',
							paid: false,
							inputs: [
								bonus('correction', 500, '2026-04', true),
								bonus('replacement', 750, '2026-04')
							],
							expected: [
								{
									employment: 'job',
									lines: { gross: 6250, net: 6250, 'SDL.employee': 0, 'SDL.employer': 11.25 }
								}
							]
						}
					])
		],
		event: [
			{
				collection: 'adhoc_requests',
				target: '@original',
				values: { amount: 1500 },
				refused: 'already taken this record into account|captured|settled',
				preserve: [{ collection: 'payslips', where: { id: '@slip:2026-03:job' } }]
			},
			...(split
				? []
				: [
						{
							collection: 'payroll_runs',
							target: '@run:2026-04',
							values: {},
							preserve: [{ collection: 'payslips', where: { id: '@slip:2026-03:job' } }]
						},
						{
							collection: 'payroll_runs',
							target: '@run:2026-04',
							values: {},
							preserve: [
								{ collection: 'payslips', where: { id: '@slip:2026-03:job' } },
								{ collection: 'payslips', where: { id: '@slip:2026-04:job' } },
								{
									collection: 'adhoc_requests',
									where: { id: { in: ['@original', '@correction', '@replacement'] } }
								}
							]
						}
					])
		],
		expected: split
			? []
			: [
					{
						employment: 'job',
						lines: { gross: 6000, net: 6000, 'SDL.employee': 0, 'SDL.employer': 11.25 }
					}
				],
		...(split ? { absent: ['job'] } : {}),
		saved: [
			{
				collection: 'payslips',
				where: { id: '@slip:2026-03:job' },
				rows: [
					{ status: 'PAID', gross: 8000, net: 8000, total_deductions: 0, employer_cost: 11.25 }
				]
			},
			...(!split
				? [
						{
							collection: 'payslips',
							where: {
								id: '@slip:2026-04:job',
								payroll_run_id: '@run:2026-04',
								employment_id: '@job'
							},
							rows: [
								{
									status: 'DRAFT',
									gross: 6250,
									net: 6250,
									total_deductions: 0,
									employer_cost: 11.25
								}
							]
						}
					]
				: []),
			{
				collection: 'adhoc_requests',
				where: { id: '@replacement', payslip_id: '@slip:2026-04:job' },
				rows: [{ amount: 750, as_adjustment_entry: false }]
			},
			{
				collection: 'adhoc_requests',
				where: { id: '@original', payslip_id: '@slip:2026-03:job' },
				rows: [
					{
						amount: 2000,
						event_date: '2026-03-10',
						pay_period: '2026-03'
					}
				]
			},
			{
				collection: 'adhoc_requests',
				where: { id: '@correction', payslip_id: '@slip:2026-04:job' },
				rows: [
					{
						amount: 500,
						as_adjustment_entry: true,
						event_date: '2026-03-10',
						pay_period: '2026-04'
					}
				]
			}
		]
	});
