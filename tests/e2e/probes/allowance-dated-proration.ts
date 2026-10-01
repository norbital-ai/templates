import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

// Synthetic contractual history; this is an application settlement regression, not a new legal rule.
for (const split of [false, true]) {
	const id = `MY-ALLOWANCE-DATED-${split ? 'TITLE-SPLIT' : 'UNSPLIT'}`;
	const terms = (from: string, to: string | null, title: string): ProbeInput => ({
		collection: 'employment_terms',
		values: {
			employment_id: '@job',
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'MYR',
			base_salary: 2340,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			job_title: title,
			facts: { worksite_state: 'SELANGOR' },
			shift_pattern_id: '@week',
			effective_range: { from, to },
			allowances: [{ catalogue_id: '@law:allowance_catalogue:SUA', amount: 260 }]
		}
	});
	const segment = (
		code: string,
		from: string,
		to: string,
		title: string,
		start: string,
		days: number,
		unpaid: number,
		contract: number,
		amount: number
	): Row => ({
		component_code: code,
		term_key: `${title} @ ${start} · 2340.00`,
		from,
		to,
		basis: { by: 'CALENDAR_DAYS' },
		days,
		denominator: 31,
		unpaid_days: unpaid,
		contract_amount: contract,
		prorated_amount: amount
	});
	const opening = 'Opening contract';
	const closing = 'Title changed only';
	const proration = [
		...(split
			? [
					segment('BASIC', '2026-01-01', '2026-01-15', opening, '2024-01-02', 15, 0, 2340, 1132.26),
					segment('BASIC', '2026-01-16', '2026-01-31', closing, '2026-01-16', 16, 0, 2340, 1207.74)
				]
			: [segment('BASIC', '2026-01-01', '2026-01-31', opening, '2024-01-02', 31, 0, 2340, 2340)]),
		...(split
			? [
					segment('SUA', '2026-01-01', '2026-01-15', opening, '2024-01-02', 15, 0, 260, 125.81),
					segment('SUA', '2026-01-16', '2026-01-31', closing, '2026-01-16', 16, 0, 260, 134.19)
				]
			: [segment('SUA', '2026-01-01', '2026-01-31', opening, '2024-01-02', 31, 0, 260, 260)]),
		segment('SUA', '2025-12-23', '2025-12-23', opening, '2024-01-02', 1, 1, -260, -8.39)
	];
	register({
		id,
		profile: 'MY',
		period: '2026-01',
		description:
			'January cutoff21 settles a December23 unpaid day on dated contract wages; title-only split preserves allowance cash.',
		citation: [
			'Employment Act1955 s18A(c), s2 wages: public MY calendar-month proration includes fixed cash wages. https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf',
			'Application contract: existing attendance cutoff21 prices December23 on December terms/divisor; December and January each31days. SUA260 −260/31 =251.61; BASIC2340 −2340/31 =2264.52; combined gross2516.13. Changing only title preserves all cash.',
			'EPF Third Schedule PartA wages2500.01–2520: employee278 employer328. https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025',
			'SOCSO/EIS wages2500–2600: employee12.75/5.10 employer44.65/5.10; net2220.28, employer charges377.75. https://www.perkeso.gov.my/en/rate-of-contribution.html'
		],
		company: {
			pay_cutoff_day: 21,
			facts: {
				hrd_scope: 'PART_I',
				hrd_registration_class: 'NOT_REGISTERED',
				hrd_form2_count: 0,
				hrd_education_schedule_code: 'NONE'
			}
		},
		inputs: [
			...officeWeek('2024-01-01'),
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Synthetic ${id}`,
					date_of_birth: '1990-01-01',
					gender: 'MALE',
					nationality: 'Malaysian'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: id,
					effective_range: { from: '2024-01-02', to: null }
				}
			},
			terms('2024-01-02', split ? '2026-01-15' : null, opening),
			...(split ? [terms('2026-01-16', null, closing)] : []),
			...['EPF', 'SOCSO', 'EIS'].map((code): ProbeInput => ({
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@person',
					employment_id: '@job',
					statutory_contribution_id: `@law:statutory_contributions:${code}`,
					effective_range: { from: '2024-01-02', to: null },
					status: { kind: 'REGISTERED', reference_number: `Synthetic ${code}`, elections: {} }
				}
			})),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: `Synthetic ${id} December23`,
					from_date: '2025-12-23',
					to_date: '2025-12-23',
					half_day_start: false,
					half_day_end: false,
					reason: 'Synthetic employee requested unpaid leave'
				}
			}
		],
		expected: [
			{
				employment: 'job',
				lines: {
					gross: 2516.13,
					net: 2220.28,
					employer_cost: 377.75,
					BASIC: 2340,
					SUA: 251.61,
					'EPF.employee': 278,
					'EPF.employer': 328,
					'SOCSO.employee': 12.75,
					'SOCSO.employer': 44.65,
					'EIS.employee': 5.1,
					'EIS.employer': 5.1
				}
			}
		],
		saved: [
			{
				collection: 'payslips',
				where: { employment_id: '@job' },
				select: { salary_from: true, salary_to: true, proration: true },
				rows: [{ salary_from: '2026-01-01', salary_to: '2026-01-31', proration }]
			}
		]
	});
}
