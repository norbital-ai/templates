import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';
const inputs: ProbeInput[] = [...officeWeek('2026-02-23')];
for (const ref of ['a', 'b'])
	inputs.push(
		{
			collection: 'employees',
			ref,
			values: {
				name: `Synthetic rerun ${ref}`,
				date_of_birth: '1990-07-01',
				gender: 'MALE',
				nationality: 'Chinese',
				race: 'CHINESE',
				religion: 'OTHER'
			}
		},
		{
			collection: 'employments',
			ref: `${ref}_job`,
			values: {
				employee_id: `@${ref}`,
				company_id: '@company',
				employee_number: `RERUN-${ref}`,
				effective_range: { from: '2026-03-01', to: null }
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: `@${ref}_job`,
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
				employee_id: `@${ref}`,
				employment_id: `@${ref}_job`,
				statutory_contribution_id: '@law:statutory_contributions:SDL',
				effective_range: { from: '2026-03-01', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: `SYNTHETIC-SDL-${ref}`,
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
	);
const paid = { collection: 'payslips', where: { id: { eq: '@slip:2026-03:a_job' } } };
const slipProjection = {
	id: true,
	payroll_run_id: true,
	employment_id: true,
	status: true,
	paid_at: true,
	gross: true,
	net: true,
	total_deductions: true,
	employer_cost: true,
	base: true,
	proration: true,
	adjustments: true,
	statutory: true,
	leave_settlements: true
};
register({
	id: 'payroll-rerun-mixed-paid-unpaid',
	profile: 'SG',
	company: { facts: { sdl_individual_employer: false } },
	period: '2026-03',
	description:
		'The actual run is recalculated twice after new unpaid attendance, NPL and bonus; paid saved row stays byte-for-byte unchanged, both IDs remain stable.',
	citation: [
		'Employment Act1968 s.20A: incomplete-month monthly gross×days worked÷required workdays. March2026 Monday–Friday22workdays, one employee-requested NPLday:6,000×21/22=5,727.27; independent250bonus=>5,977.27. https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr20A-',
		'CPF Act1953 s.7: foreign employee outsideCPF. SDL Act1979 s.3: each employee wages above4,500 employerSDL11.25. https://sso.agc.gov.sg/Act/CPFA1953; https://sso.agc.gov.sg/Act/SDLA1979#pr3-'
	],
	inputs,
	history: [
		{
			period: '2026-03',
			paid: false,
			expected: ['a_job', 'b_job'].map((employment) => ({
				employment,
				lines: { gross: 6000, net: 6000, 'SDL.employee': 0, 'SDL.employer': 11.25 }
			}))
		}
	],
	event: [
		{
			collection: 'payslips',
			target: '@slip:2026-03:a_job',
			values: { status: 'PAID', paid_at: '2026-03-31T00:00:00.000Z' }
		},
		{
			collection: 'leave_entries',
			ref: 'npl',
			values: {
				employment_id: '@b_job',
				catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
				reference: 'SYNTHETIC-RERUN-NPL',
				from_date: '2026-03-16',
				to_date: '2026-03-16',
				half_day_start: false,
				half_day_end: false,
				no_pay_origin: 'EMPLOYEE_REQUESTED',
				reason: 'Approved synthetic unpaid leave recorded before rerun'
			}
		},
		{
			collection: 'work_days',
			ref: 'attendance',
			values: {
				employment_id: '@b_job',
				work_date: '2026-03-20',
				worked_intervals: [
					{ start: '2026-03-20T01:00:00.000Z', end: '2026-03-20T05:00:00.000Z' },
					{ start: '2026-03-20T06:00:00.000Z', end: '2026-03-20T10:00:00.000Z' }
				]
			}
		},
		{
			collection: 'adhoc_requests',
			ref: 'bonus',
			values: {
				employment_id: '@b_job',
				catalogue_id: '@law:adhoc_catalogue:bonus',
				amount: 250,
				event_date: '2026-03-20',
				pay_period: '2026-03',
				reason: 'Synthetic approved bonus'
			}
		},
		{ collection: 'payroll_runs', target: '@run:2026-03', values: {}, preserve: [paid] },
		{
			collection: 'payroll_runs',
			target: '@run:2026-03',
			values: {},
			preserve: [
				paid,
				{
					collection: 'payslips',
					where: { payroll_run_id: { eq: '@run:2026-03' } },
					select: slipProjection
				},
				{
					collection: 'payroll_runs',
					where: { id: { eq: '@run:2026-03' } },
					select: {
						id: true,
						period: true,
						kind: true,
						sequence: true,
						company_charges: true,
						company_remittances: true,
						calculation_trace: true
					}
				}
			]
		}
	],
	refused: 'already exists',
	expected: [],
	saved: [
		{
			collection: 'payslips',
			where: { id: '@slip:2026-03:a_job', payroll_run_id: '@run:2026-03', employment_id: '@a_job' },
			rows: [{ gross: 6000, net: 6000, status: 'PAID' }]
		},
		{
			collection: 'payslips',
			where: { id: '@slip:2026-03:b_job', payroll_run_id: '@run:2026-03', employment_id: '@b_job' },
			rows: [{ gross: 5977.27, net: 5977.27, status: 'DRAFT' }]
		},
		{
			collection: 'payslips',
			where: { payroll_run_id: '@run:2026-03' },
			select: { id: true, employment_id: true, gross: true, net: true, status: true },
			rows: [
				{
					gross: 6000,
					net: 6000,
					status: 'PAID'
				},
				{
					gross: 5977.27,
					net: 5977.27,
					status: 'DRAFT'
				}
			]
		},
		{
			collection: 'adhoc_requests',
			where: { id: '@bonus', payslip_id: '@slip:2026-03:b_job' },
			rows: [{ amount: 250 }]
		},
		{
			collection: 'work_days',
			where: { id: '@attendance', payslip_id: '@slip:2026-03:b_job' },
			rows: [{ work_date: '2026-03-20' }]
		},
		{
			collection: 'leave_entries',
			where: { id: '@npl', payslip_id: '@slip:2026-03:b_job' },
			rows: [{ from_date: '2026-03-16' }]
		}
	]
});

register({
	id: 'payroll-rerun-zero-funding-evidence-refusal',
	profile: 'SG',
	period: '2026-03',
	company: { facts: { sdl_individual_employer: false } },
	description:
		'Zero funded amount with a receipt date or reference freezes the individual unpaid calculation; actual rerun refuses and keeps both saved payslips unchanged.',
	citation: [
		'Synthetic corporate employer, two foreign employees on6,000. CPF Act1953 s.7 excludes foreign employees; SDL Act1979 s.3 charges employer11.25 each above4,500. https://sso.agc.gov.sg/Act/CPFA1953; https://sso.agc.gov.sg/Act/SDLA1979#pr3-',
		'Operational invariant: funding receipt evidence is retained even when recorded funded amount is zero; recalculation must refuse before changing any saved calculation. employer_cost records employer contributions and employer-only amounts, separately from gross wages: foreign worker CPF0 plus SDL11.25 =>11.25.'
	],
	inputs,
	history: [
		{
			period: '2026-03',
			paid: false,
			expected: ['a_job', 'b_job'].map((employment) => ({
				employment,
				lines: { gross: 6000, net: 6000, 'SDL.employee': 0, 'SDL.employer': 11.25 }
			}))
		}
	],
	event: [
		{
			collection: 'payslips',
			target: '@slip:2026-03:a_job',
			values: { status: 'PAID', paid_at: '2026-03-31T00:00:00.000Z' }
		},
		{
			collection: 'payslips',
			target: '@slip:2026-03:b_job',
			values: { funding_received: 0, funding_received_on: '2026-03-20', funding_reference: '' },
			preserve: [paid]
		},
		{
			collection: 'payroll_runs',
			target: '@run:2026-03',
			values: {},
			refused: 'funded payslip',
			preserve: [
				{ collection: 'payslips', where: { payroll_run_id: { eq: '@run:2026-03' } } },
				{ collection: 'payroll_runs', where: { id: { eq: '@run:2026-03' } } }
			]
		},
		{
			collection: 'payslips',
			target: '@slip:2026-03:b_job',
			values: {
				funding_received: 0,
				funding_received_on: null,
				funding_reference: 'SYNTHETIC-ZERO-RECEIPT'
			},
			preserve: [
				paid,
				{
					collection: 'payslips',
					where: { id: { eq: '@slip:2026-03:b_job' } },
					select: slipProjection
				}
			]
		},
		{
			collection: 'payroll_runs',
			target: '@run:2026-03',
			values: {},
			refused: 'funded payslip',
			preserve: [
				{ collection: 'payslips', where: { payroll_run_id: { eq: '@run:2026-03' } } },
				{ collection: 'payroll_runs', where: { id: { eq: '@run:2026-03' } } }
			]
		}
	],
	refused: 'already exists',
	expected: [],
	saved: [
		{
			collection: 'payslips',
			where: { payroll_run_id: '@run:2026-03' },
			select: { gross: true, net: true, total_deductions: true, employer_cost: true, status: true },
			rows: [
				{ gross: 6000, net: 6000, total_deductions: 0, employer_cost: 11.25, status: 'PAID' },
				{ gross: 6000, net: 6000, total_deductions: 0, employer_cost: 11.25, status: 'DRAFT' }
			]
		},
		{
			collection: 'payslips',
			where: { id: '@slip:2026-03:a_job', employment_id: '@a_job', payroll_run_id: '@run:2026-03' },
			rows: [{ gross: 6000, net: 6000, status: 'PAID', paid_at: '2026-03-31T00:00:00.000Z' }]
		},
		{
			collection: 'payslips',
			where: { id: '@slip:2026-03:b_job', employment_id: '@b_job', payroll_run_id: '@run:2026-03' },
			rows: [
				{
					gross: 6000,
					net: 6000,
					status: 'DRAFT',
					funding_received: 0,
					funding_received_on: null,
					funding_reference: 'SYNTHETIC-ZERO-RECEIPT'
				}
			]
		}
	]
});
