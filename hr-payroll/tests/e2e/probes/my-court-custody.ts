import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

const EA =
	'Employment Act 1955 (Act 265), AGC reprint as at 1 August 2023, ss.23,18A(c) and First Schedule para.2(5): https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf';
const grounds = [
	'IMPRISONMENT',
	'CUSTODY',
	'CUSTODY_TRAVEL',
	'COURT_ATTENDANCE_OR_TRAVEL',
	'EMPLOYER_WITNESS'
] as const;

const hire = (ref: string): ProbeInput[] => [
	{
		collection: 'employees',
		ref,
		values: {
			name: ref,
			date_of_birth: '1990-01-01',
			gender: 'MALE',
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
			base_salary: 3100,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
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
			status: { kind: 'REGISTERED', reference_number: `COURT-${code}`, elections: {} }
		}
	}))
];
const absence = (ref: string, ground: string | null, half = false): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: '@law:leave_catalogue:COURT_CUSTODY_ABSENCE',
		reference: `COURT-${ref}`,
		from_date: '2026-01-05',
		to_date: '2026-01-05',
		half_day_start: half,
		half_day_end: false,
		reason: 'Court or custody absence',
		...(ground == null ? {} : { facts: { absence_ground: ground } })
	}
});

register({
	id: 'MY-EA14-1',
	profile: 'MY',
	period: '2026-01',
	description:
		'Five classified court/custody grounds, a half-day court absence, and refusal of an unclassified entry through the saved payroll path.',
	citation: [
		`${EA}: imprisonment, custody, custody travel and court attendance/travel are unpaid; attendance as the employer’s witness preserves ordinary contractual pay. January monthly RM3100 / 31 = RM100 per day; full court/custody absence gross RM3000, half-day gross RM3050, witness gross RM3100.`,
		'EPF Act 452 Third Schedule Part A, effective 1 October 2025, printed page 8: RM2980.01–3000.00 employee RM330/employer RM390; RM3040.01–3060.00 employee RM337/employer RM398; RM3080.01–3100.00 employee RM341/employer RM403. https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025',
		'PERKESO Act 4 First Category: wages above RM2900 through RM3000 employee RM14.75/employer RM51.65; above RM3000 through RM3100 employee RM15.25/employer RM53.35. https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf',
		'Act 800 EIS Second Schedule: the same wage bands RM5.90 and RM6.10 each. https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf',
		'Net RM3000−330−14.75−5.90=RM2649.35; RM3050−337−15.25−6.10=RM2691.65; RM3100−341−15.25−6.10=RM2737.65. No June 2026 SKBBK in January.'
	],
	company: {
		facts: {
			hrd_scope: 'PART_I',
			hrd_registration_class: 'NOT_REGISTERED',
			hrd_form2_count: 0,
			hrd_education_schedule_code: 'NONE'
		}
	},
	inputs: [
		...officeWeek('2023-12-25'),
		...grounds.flatMap((ground) => [...hire(ground), absence(ground, ground)]),
		...hire('HALF_COURT'),
		absence('HALF_COURT', 'COURT_ATTENDANCE_OR_TRAVEL', true),
		{
			...absence('EMPLOYER_WITNESS', null),
			values: { ...absence('EMPLOYER_WITNESS', null).values, reference: 'COURT-MISSING-GROUND' },
			refused: 'Court or custody ground.*required'
		}
	],
	expected: [
		...grounds.map((ground) => ({
			employment: `${ground}_job`,
			lines:
				ground === 'EMPLOYER_WITNESS'
					? {
							gross: 3100,
							net: 2737.65,
							'EPF.employee': 341,
							'EPF.employer': 403,
							'SOCSO.employee': 15.25,
							'SOCSO.employer': 53.35,
							'EIS.employee': 6.1,
							'EIS.employer': 6.1
						}
					: {
							gross: 3000,
							net: 2649.35,
							'EPF.employee': 330,
							'EPF.employer': 390,
							'SOCSO.employee': 14.75,
							'SOCSO.employer': 51.65,
							'EIS.employee': 5.9,
							'EIS.employer': 5.9
						}
		})),
		{
			employment: 'HALF_COURT_job',
			lines: {
				gross: 3050,
				net: 2691.65,
				'EPF.employee': 337,
				'EPF.employer': 398,
				'SOCSO.employee': 15.25,
				'SOCSO.employer': 53.35,
				'EIS.employee': 6.1,
				'EIS.employer': 6.1
			}
		}
	]
});
