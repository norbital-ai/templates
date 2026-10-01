import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

const sources = [
	'Act265 ss37(2)(a)–(c),60I(1)/(1C): eligible maternity allowance covers calendar days at ordinary daily pay; monthly continued wages satisfy the allowance. https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf',
	'Employment (Minimum Rate of Maternity Allowance) Regulations1976 reg2: RM6 minimum per eligible day. https://jtksm.mohr.gov.my/sites/default/files/2023-03/5.%20EMPLOYMENT%20%28MINIMUM%20RATE%20OF%20MATERNITY%20ALLOWANCE%29%20REGULATIONS%201976_0.pdf',
	'EPF Act452 Third Schedule PartA: wages186 employee22/employer26;2500 275/325;2600 286/338;2800 308/364;3100 341/403. https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025',
	'PERKESO Act4 First Category table, January/February before SKBBK:186 employee0.85/employer2.95;2500 12.25/42.85;2600 12.75/44.65;2800 13.75/48.15;3100 15.25/53.35. https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf',
	'EIS Act800 Second Schedule:186 each0.35;2500 each4.90;2600 each5.10;2800 each5.50;3100 each6.10. https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf'
];
const company = {
	pay_cutoff_day: 21,
	facts: {
		hrd_scope: 'PART_I',
		hrd_registration_class: 'NOT_REGISTERED',
		hrd_form2_count: 0,
		hrd_education_schedule_code: 'NONE'
	}
};
function hire(ref: string, frequency: string, wage: number, short = false): ProbeInput[] {
	return [
		{
			collection: 'employees',
			ref,
			values: {
				name: ref,
				date_of_birth: '1990-01-01',
				gender: 'FEMALE',
				nationality: 'Malaysian',
				marital_status: 'SINGLE',
				spouse_status: 'NONE'
			}
		},
		{
			collection: 'employments',
			ref: `${ref}_job`,
			values: {
				employee_id: `@${ref}`,
				company_id: '@company',
				employee_number: ref,
				effective_range: { from: '2024-01-01', to: null }
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: `@${ref}_job`,
				residency_status: 'CITIZEN',
				tax_residency: 'RESIDENT',
				currency: 'MYR',
				base_salary: wage,
				pay_frequency: frequency,
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: short ? 'PART_TIME' : 'PERMANENT',
				...(short ? { ordinary_hours_per_week: 2.5 } : {}),
				facts: { worksite_state: 'SELANGOR' },
				shift_pattern_id: '@week',
				effective_range: { from: '2024-01-01', to: null }
			}
		},
		...['EPF', 'SOCSO', 'EIS'].map((code): ProbeInput => ({
			collection: 'employment_statutory_facts',
			values: {
				employee_id: `@${ref}`,
				employment_id: `@${ref}_job`,
				statutory_contribution_id: `@law:statutory_contributions:${code}`,
				effective_range: { from: '2024-01-01', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: `SYNTHETIC-MATERNITY-${code}`,
					elections: {}
				}
			}
		}))
	];
}
const history = (
	ref: string,
	month: string,
	end: string,
	wages: number,
	days: number
): ProbeInput => ({
	collection: 'employment_wage_periods',
	values: {
		employment_id: `@${ref}_job`,
		period: { from: `${month}-01`, to: end },
		currency: 'MYR',
		ordinary_wages: wages,
		ordinary_days: days,
		due_on: end,
		paid_on: end,
		reference: `Synthetic ${month}: actual ordinary worked days; incentives/rest/holiday/maternity allowance excluded`
	}
});
const maternity = (ref: string, from: string, to: string): ProbeInput => ({
	collection: 'leave_entries',
	ref: `${ref}_maternity`,
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: '@law:leave_catalogue:MATERNITY_LEAVE',
		reference: `SYNTHETIC-MATERNITY-${ref}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		facts: { event_kind: 'BIRTH', event_date: from },
		reason: 'Synthetic qualified maternity calendar absence'
	},
	files: { certificate_file: 'maternity-certificate.pdf' }
});
const lines = (
	gross: number,
	basic: number,
	target: number,
	epf: number,
	employerEpf: number,
	socso: number,
	employerSocso: number,
	eis: number
) => ({
	gross,
	net: gross - epf - socso - eis,
	BASIC: basic,
	...(target === 0 ? {} : { MATERNITY_LEAVE: target }),
	'EPF.employee': epf,
	'EPF.employer': employerEpf,
	'SOCSO.employee': socso,
	'SOCSO.employer': employerSocso,
	'EIS.employee': eis,
	'EIS.employer': eis,
	'PCB.employee': 0
});
for (const [ref, frequency, wage, expected] of [
	['MONTHLY', 'MONTHLY', 2600, lines(2600, 2600, 0, 286, 338, 12.75, 44.65, 5.1)],
	['DAILY', 'DAILY', 100, lines(3100, 2200, 900, 341, 403, 15.25, 53.35, 6.1)],
	['HOURLY', 'HOURLY', 12.5, lines(3100, 2200, 900, 341, 403, 15.25, 53.35, 6.1)],
	['FLOOR', 'HOURLY', 8.72, lines(186, 95.92, 90.08, 22, 26, 0.85, 2.95, 0.35)]
] as const) {
	const short = ref === 'FLOOR';
	register({
		id: `MY-SR06-${ref}`,
		profile: 'MY',
		period: '2026-01',
		company,
		description: `Saved qualified maternity ${ref} cash target with cutoff21; monthly deemed wages, historical calendar-day ORP, or RM6 floor.`,
		citation: [
			...sources,
			short
				? 'Lawful hourly8.72, five30-minute roster days: prior87.20/20=4.36;31×6=186. Retained22×4.36=95.92, target difference90.08.'
				: '31January calendar days,22Monday–Friday roster days. Prior2000/20=100; calendar target3100 less retained2200 gives900; monthly2600 remains2600.'
		],
		inputs: [
			...officeWeek('2023-12-25').map((input) =>
				short && input.ref === 'office'
					? {
							...input,
							values: {
								...input.values,
								variant: { kind: 'WORK', start_time: '09:00', end_time: '09:30', break_minutes: 0 }
							}
						}
					: input
			),
			...hire(ref, frequency, wage, short),
			...(frequency === 'MONTHLY'
				? []
				: [history(ref, '2025-12', '2025-12-31', short ? 87.2 : 2000, 20)]),
			maternity(ref, '2026-01-01', '2026-01-31')
		],
		expected: [{ employment: `${ref}_job`, lines: expected }]
	});
}
register({
	id: 'MY-SR06-CONTINUATION',
	profile: 'MY',
	period: '2026-02',
	company,
	description:
		'One saved maternity entry spans cutoff21 periods; January late-month and February calendar targets settle once each.',
	citation: [
		...sources,
		'Confinement21January: first11calendar days include8roster days; January base2200 plus3nonrostered×100=2500. PriorJanuary actual14normal-work days earned1400 before confinement, ORP100. February28calendar days,20roster days: base2000+800=2800.'
	],
	inputs: [
		...officeWeek('2023-12-25'),
		...hire('CONTINUED', 'DAILY', 100),
		history('CONTINUED', '2025-12', '2025-12-31', 2000, 20),
		maternity('CONTINUED', '2026-01-21', '2026-02-28')
	],
	history: [
		{
			period: '2026-01',
			expected: [
				{ employment: 'CONTINUED_job', lines: lines(2500, 2200, 300, 275, 325, 12.25, 42.85, 4.9) }
			]
		}
	],
	event: [history('CONTINUED', '2026-01', '2026-01-31', 1400, 14)],
	expected: [
		{ employment: 'CONTINUED_job', lines: lines(2800, 2000, 800, 308, 364, 13.75, 48.15, 5.5) }
	]
});
