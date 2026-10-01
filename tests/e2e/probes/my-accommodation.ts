import { officeWeek, register, type ProbeInput } from '../payroll-probe.ts';

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
			base_salary: 3000,
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
const SOURCE =
	'JTKSM Act446 FAQ, P.U.(A)249/2020 and P.U.(A)49/2026: https://jtksm.mohr.gov.my/ms/soalan-lazim/perumahan-penginapan-dan-kemudahan-pekerja . RM100/month through February2026; RM150 from March2026; current certificate, contractual lower charge and prior written variation required; estate housing rent prohibited.';
const company = {
	facts: {
		hrd_scope: 'PART_I',
		hrd_registration_class: 'NOT_REGISTERED',
		hrd_form2_count: 0,
		hrd_education_schedule_code: 'NONE'
	}
};
const rent = (
	ref: string,
	date: string,
	amount: number,
	extra: Record<string, unknown> = {},
	reversal = false,
	payPeriod = date.slice(0, 7)
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:ACCOMMODATION_RENT@${date}`,
		amount,
		event_date: date,
		pay_period: payPeriod,
		as_adjustment_entry: reversal,
		reason: 'Accommodation rent',
		facts: {
			rent_month: date.slice(0, 7),
			accommodation_kind: 'ACCOMMODATION',
			certificate_reference: 'JTKSM-CERT-001',
			certificate_active: true,
			certificate_valid_from: '2025-01-01',
			certificate_valid_to: '2026-12-31',
			contract_reference: 'SIGNED-CONTRACT-001',
			contract_monthly_charge: 200,
			written_variation: false,
			...extra
		}
	}
});
const expected = (ref: string, deducted: number) => ({
	employment: `${ref}_job`,
	lines: {
		gross: 3000,
		net: 2649.35 - deducted,
		'EPF.employee': 330,
		'EPF.employer': 390,
		'SOCSO.employee': 14.75,
		'SOCSO.employer': 51.65,
		'EIS.employee': 5.9,
		'EIS.employer': 5.9
	}
});
const contributions =
	'Net rent does not change RM3000 wages: EPF PartA330/390 (https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025); SOCSO FirstCategory14.75/51.65 (https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf); EIS5.90each (https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf). Net3000−330−14.75−5.90=2649.35 before rent.';
const changed = {
	contract_monthly_charge: 0,
	written_variation: true,
	varied_monthly_charge: 150,
	variation_reference: 'SIGNED-CHANGE',
	variation_agreed_on: '2026-02-28'
};
register(
	{
		id: 'MY-ACCOM-01-1',
		profile: 'MY',
		period: '2026-03',
		company,
		description:
			'March aggregate RM150; contract RM100 remains binding; free/estate/invalid certificate refused; written variation permits changed rent.',
		citation: [
			SOURCE,
			contributions,
			'100+50=150; another1 refused. Contract100 caps100. Free contract0 refuses1; written change agreed28Feb allows150. Net2499.35 at150,2549.35 at100.'
		],
		inputs: [
			...officeWeek('2023-12-25'),
			...hire('AGGREGATE'),
			...hire('CONTRACT'),
			...hire('VARIED'),
			rent('AGGREGATE', '2026-03-01', 100),
			rent('AGGREGATE', '2026-03-02', 50),
			{ ...rent('AGGREGATE', '2026-03-03', 1), refused: '151.00 requested against 150.00' },
			rent('CONTRACT', '2026-03-01', 100, { contract_monthly_charge: 100 }),
			{
				...rent('CONTRACT', '2026-03-02', 1, { contract_monthly_charge: 100 }),
				refused: '101.00 requested against 100.00'
			},
			{
				...rent('VARIED', '2026-03-01', 1, { contract_monthly_charge: 0 }),
				refused: '1.00 requested against 0.00'
			},
			{
				...rent('VARIED', '2026-03-01', 150, { certificate_active: false }),
				refused: 'certificate currently in force'
			},
			{
				...rent('VARIED', '2026-03-01', 150, { certificate_valid_to: '2026-02-28' }),
				refused: 'certificate must be valid'
			},
			{
				...rent('VARIED', '2026-03-01', 150, { accommodation_kind: 'ESTATE_HOUSING' }),
				refused: 'Estate housing rent'
			},
			{
				...rent('VARIED', '2026-03-01', 150, { rent_month: '2026-02' }),
				refused: 'rent month must'
			},
			{
				...rent('VARIED', '2026-03-01', 150, { ...changed, variation_agreed_on: '2026-03-02' }),
				refused: 'variation must precede'
			},
			rent('VARIED', '2026-03-01', 150, changed)
		],
		expected: [expected('AGGREGATE', 150), expected('CONTRACT', 100), expected('VARIED', 150)]
	},
	{
		id: 'MY-ACCOM-01-2',
		profile: 'MY',
		period: '2026-03',
		company,
		description:
			'Captured February100 consumes February cap; reversal releases100 before replacement; March150 uses separate month.',
		citation: [
			SOURCE,
			contributions,
			'February100 leaves net2549.35. Additional February1 fails101>100 even with March settlement. February reversal100 plus replacement100 net to0 in March; March150 leaves net2499.35.'
		],
		inputs: [...officeWeek('2023-12-25'), ...hire('HISTORY')],
		history: [
			{
				period: '2026-02',
				inputs: [rent('HISTORY', '2026-02-01', 100)],
				expected: [expected('HISTORY', 100)]
			}
		],
		event: [
			{
				...rent('HISTORY', '2026-02-02', 1, {}, false, '2026-03'),
				refused: '101.00 requested against 100.00'
			},
			rent('HISTORY', '2026-02-02', 100, {}, true, '2026-03'),
			rent('HISTORY', '2026-02-03', 100, {}, false, '2026-03'),
			rent('HISTORY', '2026-03-01', 150)
		],
		expected: [expected('HISTORY', 150)]
	}
);
