import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import registrations from '../src/data/collection/employment_statutory_facts/+collection.ts';
import payslips from '../src/data/collection/payslips/+collection.ts';
import paymentEvents from '../src/data/collection/payment_events/+collection.ts';
import noncontractSettlements from '../src/data/collection/vn_noncontract_settlements/+collection.ts';
import { statutoryFactStatusFault } from '../src/lib/datatypes/statutory_fact_status.ts';
import {
	assessVnPaymentWithholding,
	type VnPaymentWithholdingInput
} from '../src/lib/vn/payment-withholding.ts';
import { transform } from './helpers/bodies.ts';
import { assessStatutory, expectStatutory } from './fixtures/statutory-world.ts';

const vnPitRows = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/VN/statutory_contributions.json', import.meta.url),
		'utf8'
	)
) as (VnPaymentWithholdingInput['pit'] & { settings_id: string })[];
const eventPit = (settingsId: string) => {
	const pit = vnPitRows.find((row) => row.code === 'PIT' && row.settings_id === settingsId);
	assert.ok(pit);
	return pit;
};
const junePit = eventPit('2b556ee6-e9e1-5b07-bfba-e91625653f0a');
const julyPit = eventPit('9b1cb22a-d399-52cc-adef-8e72ec084b78');

const noncontractEvent = (
	paidOn: string,
	gross: number,
	options: {
		pit?: VnPaymentWithholdingInput['pit'];
		settingsRange?: unknown;
		cash?: number;
		facts?: Partial<VnPaymentWithholdingInput['facts']>;
		taxTreatment?: 'TAXABLE' | 'EXEMPT';
	} = {}
): VnPaymentWithholdingInput => ({
	event: {
		company_id: 'VN-COMPANY',
		employee_id: 'PERSON',
		paid_on: paidOn,
		reference: 'BANK-PAYMENT-1',
		currency: 'VND',
		gross_amount: gross,
		non_event_deduction_amount: 0,
		cash_amount: options.cash ?? gross
	},
	allocations: [
		{
			gross_amount: gross,
			non_event_deduction_amount: 0,
			tranche: {
				id: 'TRANCHE-1',
				settlement: { collection: 'vn_noncontract_settlements', id: 'SETTLEMENT-1' },
				source_category: 'NONCONTRACT_REMUNERATION',
				source_kind: 'VN_NONCONTRACT_SETTLEMENT',
				source_id: 'SETTLEMENT-1',
				reference: 'AGREEMENT-FEE-1',
				tax_treatment: options.taxTreatment ?? 'TAXABLE',
				currency: 'VND',
				gross_amount: 10_000_000,
				due_on: '2026-07-31'
			}
		}
	],
	facts: { withhold_below_threshold_requested: false, ...options.facts },
	settlement: {
		id: 'SETTLEMENT-1',
		company_id: 'VN-COMPANY',
		employee_id: 'PERSON',
		currency: 'VND',
		relationship_reviewed_on: '2026-01-01',
		relationship_reference: 'ENGAGEMENT-1',
		income_nature_reference: 'REMUNERATION-1',
		tax_residency: 'RESIDENT',
		tax_residency_range: { from: '2026-01-01', to: '2026-12-31' },
		tax_residency_reference: 'TAX-RESIDENCE-1'
	},
	pit: options.pit ?? julyPit,
	settingsRange: options.settingsRange ?? { from: '2026-07-01', to: '9999-12-31' }
});

const occasions = (
	period: string,
	amounts: readonly number[],
	options: {
		requested?: number;
		paidOn?: string | readonly string[];
		commitment?: boolean;
		units?: number;
		wage?: number;
	} = {}
) => {
	const year = Number(period.slice(0, 4));
	const month = Number(period.slice(5, 7));
	const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
	const payDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
	return assessStatutory({
		code: 'VN',
		period,
		region: 'I',
		people: [
			{
				key: 'SHORT',
				wage: options.wage ?? amounts.reduce((sum, amount) => sum + amount, 0),
				citizenship: 'CITIZEN',
				hire_date: `${previous}-01`,
				exit_date: payDay,
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						elections: { commitment_form: options.commitment === true },
						unit_assessments: amounts.map((gross, index) => ({
							period,
							gross,
							units: options.units ?? 1,
							reference: `PAY-${index + 1}`,
							paid_on:
								typeof options.paidOn === 'string'
									? options.paidOn
									: (options.paidOn?.[index] ?? payDay),
							withhold_below_threshold_requested: options.requested === index
						}))
					}
				}
			}
		]
	});
};

test('VN short-contract withholding prices each documented payment at the dated threshold', () => {
	// Circular 111/2013 art.25(1)(i): VND2m before July; Decree 253/2026 art.50(2): VND5m.
	expectStatutory(occasions('2025-12', [1_000_000, 7_000_000]), 'SHORT', 'PIT', 700_000, 0);
	expectStatutory(occasions('2026-06', [1_000_000, 7_000_000]), 'SHORT', 'PIT', 700_000, 0);
	expectStatutory(occasions('2026-07', [4_000_000, 4_000_000]), 'SHORT', 'PIT', 0, 0);
	expectStatutory(occasions('2026-07', [5_000_000, 3_000_000]), 'SHORT', 'PIT', 500_000, 0);
	expectStatutory(
		occasions('2026-07', [4_000_000, 4_000_000], { requested: 0 }),
		'SHORT',
		'PIT',
		400_000,
		0
	);
	expectStatutory(
		occasions('2026-06', [5_000_000, 3_000_000], { commitment: true }),
		'SHORT',
		'PIT',
		0,
		0
	);
	assert.throws(
		() => occasions('2026-07', [5_000_000, 3_000_000], { commitment: true }),
		/pre-July short-payment commitment waiver is not established/
	);
});

test('VN payment-occasion withholding refuses missing, cross-version and unsupported settlement dates', () => {
	const standard = { period: '2026-07', gross: 8_000_000, units: 1, reference: 'PAY-1' };
	const status = {
		kind: 'REGISTERED' as const,
		reference_number: 'TAX',
		unit_assessments: [standard]
	};
	assert.equal(statutoryFactStatusFault(status), undefined);
	assert.ok(
		statutoryFactStatusFault({
			...status,
			unit_assessments: [{ ...standard, paid_on: '2026-02-30' }]
		})
	);
	assert.throws(
		() => occasions('2026-07', [8_000_000], { paidOn: '' }),
		/requires one unit, a dated payment/
	);
	assert.throws(
		() => occasions('2026-07', [8_000_000], { units: 2 }),
		/requires one unit, a dated payment/
	);
	assert.throws(
		() => occasions('2026-07', [8_000_000], { paidOn: '2026-06-30' }),
		/crosses the sealed settings version/
	);
	assert.throws(
		() => occasions('2026-07', [8_000_000], { paidOn: '2026-07-30' }),
		/differs from this run's settlement date/
	);
	assert.throws(
		() => occasions('2026-06', [8_000_000], { paidOn: '2026-07-01' }),
		/crosses the sealed settings version/
	);
	assert.throws(
		() =>
			occasions('2026-07', [5_000_000, 3_000_000], {
				paidOn: ['2026-07-30', '2026-07-31']
			}),
		/differs from this run's settlement date/
	);
	assert.throws(
		() => occasions('2026-07', [5_000_000, 3_000_000], { wage: 7_000_000 }),
		/gross equals this pay period's assessed gross/
	);
});

test('VN consultant payroll refuses an unproved no-contract PIT classification', () => {
	for (const period of ['2026-06', '2026-07'])
		assert.throws(
			() =>
				assessStatutory({
					code: 'VN',
					period,
					region: 'I',
					people: [
						{
							key: 'CONSULTANT',
							wage: 8_000_000,
							citizenship: 'CITIZEN',
							employment_type: 'CONSULTANT'
						}
					]
				}),
			/consultant label does not establish whether this payment is under a labour contract/
		);
});

test('VN no-contract recipient is a separate evidenced person and payer record', async () => {
	const row = {
		company_id: 'VN-COMPANY',
		employee_id: 'PERSON',
		reference: 'FEE-2026-07',
		agreed_gross_vnd: 8_000_000,
		agreed_due_on: '2026-07-31',
		agreement_amount_reference: 'AGREEMENT-FEE-1',
		relationship_reference: 'ENGAGEMENT-1',
		relationship_reviewed_on: '2026-07-01',
		income_nature_reference: 'REMUNERATION-1',
		tax_residency: 'RESIDENT',
		tax_residency_range: { from: '2026-07-01', to: '2026-07-31' },
		tax_residency_reference: 'TAX-RESIDENCE-1',
		currency: 'VND'
	};
	const tables = { companies: [{ id: 'VN-COMPANY', settings_code: 'VN' }] };
	const [saved] = await transform(noncontractSettlements, [row], { tables });
	assert.equal(saved.employee_id, 'PERSON');
	assert.equal(saved.reference, 'FEE-2026-07');
	assert.deepEqual(saved.payable_tranches.create, [
		{
			source_category: 'NONCONTRACT_REMUNERATION',
			source_kind: 'VN_NONCONTRACT_SETTLEMENT',
			source_id: saved.id,
			reference: 'AGREEMENT-FEE-1',
			due_on: '2026-07-31',
			currency: 'VND',
			gross_amount: 8_000_000,
			non_event_deduction_amount: 0,
			tax_treatment: 'TAXABLE'
		}
	]);
	await assert.rejects(
		transform(noncontractSettlements, [{ ...row, currency: 'USD' }], { tables }),
		/needs VND payment amounts/
	);
	await assert.rejects(
		transform(noncontractSettlements, [{ ...row, relationship_reference: '' }], { tables }),
		/relationship_reference needs an evidence reference/
	);
	await assert.rejects(
		transform(noncontractSettlements, [{ ...row, agreed_gross_vnd: 0 }], { tables }),
		/positive whole VND amount/
	);
});

test('VN no-contract actual events apply the dated threshold to each partial payment', () => {
	const june = { pit: junePit, settingsRange: { from: '2026-05-16', to: '2026-06-30' } };
	assert.equal(
		assessVnPaymentWithholding(noncontractEvent('2026-06-30', 1_900_000, june))[0]?.employee_amount,
		0
	);
	assert.equal(
		assessVnPaymentWithholding(
			noncontractEvent('2026-06-30', 2_000_000, { ...june, cash: 1_800_000 })
		)[0]?.employee_amount,
		200_000
	);
	assert.equal(
		assessVnPaymentWithholding(noncontractEvent('2026-07-01', 4_900_000))[0]?.employee_amount,
		0
	);
	assert.equal(
		assessVnPaymentWithholding(noncontractEvent('2026-07-01', 5_000_000, { cash: 4_500_000 }))[0]
			?.employee_amount,
		500_000
	);
	const requested = noncontractEvent('2026-07-02', 4_000_000, {
		cash: 3_600_000,
		facts: {
			withhold_below_threshold_requested: true,
			request_received_on: '2026-07-01',
			request_reference: 'REQUEST-1'
		}
	});
	assert.equal(assessVnPaymentWithholding(requested)[0]?.employee_amount, 400_000);
	const preJulyCommitment = noncontractEvent('2026-06-30', 4_000_000, {
		...june,
		facts: {
			commitment_form_reference: 'FORM-08',
			commitment_received_on: '2026-06-29',
			commitment_tax_year: 2026,
			commitment_tax_id: 'TAX-ID',
			commitment_sole_income_declared: true,
			commitment_below_taxable_threshold_declared: true
		}
	});
	assert.equal(assessVnPaymentWithholding(preJulyCommitment)[0]?.employee_amount, 0);
	const nonresident = noncontractEvent('2026-07-02', 4_000_000, { cash: 3_200_000 });
	assert.equal(
		assessVnPaymentWithholding({
			...nonresident,
			settlement: { ...nonresident.settlement, tax_residency: 'NON_RESIDENT' }
		})[0]?.employee_amount,
		800_000
	);
	assert.throws(
		() =>
			assessVnPaymentWithholding({
				...requested,
				event: { ...requested.event, cash_amount: 4_000_000 }
			}),
		/cash must reconcile/
	);
});

test('VN no-contract event refuses a stale version, unsupported exemption and July commitment', () => {
	assert.throws(
		() => assessVnPaymentWithholding(noncontractEvent('2026-06-30', 5_000_000)),
		/sealed PIT version/
	);
	assert.throws(
		() =>
			assessVnPaymentWithholding(
				noncontractEvent('2026-07-01', 5_000_000, {
					taxTreatment: 'EXEMPT',
					cash: 4_500_000
				})
			),
		/evidenced exemption category/
	);
	assert.throws(
		() =>
			assessVnPaymentWithholding(
				noncontractEvent('2026-07-01', 5_000_000, {
					facts: {
						commitment_form_reference: 'FORM-08',
						commitment_received_on: '2026-06-30',
						commitment_tax_year: 2026,
						commitment_tax_id: 'TAX-ID',
						commitment_sole_income_declared: true,
						commitment_below_taxable_threshold_declared: true
					}
				})
			),
		/commitment waiver lacks current primary authority/
	);
});

test('VN saved employment payment refuses a frozen upfront PIT amount on partial disbursement', async () => {
	const tranche = {
		id: 'TRANCHE-EMP-1',
		settlement: { collection: 'payslips', id: 'SLIP-1' },
		source_category: 'REGULAR_WAGE',
		source_kind: 'PAYROLL_RUN',
		source_id: 'RUN-1',
		reference: 'WAGE-1',
		due_on: '2026-07-31',
		currency: 'VND',
		gross_amount: 8_000_000,
		non_event_deduction_amount: 0,
		tax_treatment: 'TAXABLE'
	};
	const tables = {
		payable_tranches: [tranche],
		payslips: [
			{
				id: 'SLIP-1',
				payroll_run_id: 'RUN-1',
				employment_id: 'EMPLOYMENT-1',
				payment_mode: 'EVENT_LEDGER',
				status: 'DRAFT',
				currency: 'VND',
				statutory: [{ scheme_code: 'PIT', employee_amount: 800_000, payment_occasion: true }]
			}
		],
		vn_noncontract_settlements: [],
		payment_allocations: [],
		employments: [{ id: 'EMPLOYMENT-1', company_id: 'VN-COMPANY', employee_id: 'PERSON' }],
		payroll_runs: [{ id: 'RUN-1', company_id: 'VN-COMPANY', period: '2026-07' }],
		companies: [{ id: 'VN-COMPANY', settings_code: 'VN' }],
		ph_maternity_movements: [],
		ph_maternity_cases: []
	};
	await assert.rejects(
		paymentEvents.bodies.transform(
			[
				{
					company_id: 'VN-COMPANY',
					employee_id: 'PERSON',
					paid_on: '2026-07-15',
					reference: 'BANK-1',
					currency: 'VND',
					cash_amount: 3_600_000,
					payment_allocations: {
						create: [
							{
								payable_tranche_id: tranche.id,
								gross_amount: 4_000_000,
								non_event_deduction_amount: 0
							}
						]
					}
				}
			],
			{
				today: '2026-07-31',
				db: { read: async (name: keyof typeof tables) => ({ rows: tables[name], next: null }) },
				refuse: (message: string) => {
					throw new Error(message);
				}
			} as never
		),
		/payment-date statutory charges; recalculate them for the actual payment/
	);
});

test('VN dated occasion survives a registration write and a later PAID date cannot retain its tax', async () => {
	const entry = {
		period: '2026-07',
		gross: 8_000_000,
		units: 1,
		reference: 'PAY-1',
		paid_on: '2026-07-31',
		withhold_below_threshold_requested: false
	};
	const status = {
		kind: 'REGISTERED' as const,
		reference_number: 'TAX',
		unit_assessments: [entry]
	};
	const [saved] = await transform(
		registrations,
		[
			{
				employee_id: 'PERSON',
				employment_id: 'EMPLOYMENT',
				statutory_contribution_id: 'PIT',
				status
			}
		],
		{
			tables: {
				statutory_contributions: [
					{
						id: 'PIT',
						code: 'PIT',
						elections: [],
						rules: [{ when: 'true', per_unit: true, payment_occasion: true }]
					}
				],
				employments: [{ id: 'EMPLOYMENT', employee_id: 'PERSON' }]
			}
		}
	);
	assert.deepEqual(saved.status.unit_assessments, [entry]);
	const splitEntries = [
		{ ...entry, gross: 5_000_000, paid_on: '2026-07-30' },
		{ ...entry, gross: 3_000_000, reference: 'PAY-2' }
	];
	const [savedSplit] = await transform(
		registrations,
		[
			{
				employee_id: 'PERSON',
				employment_id: 'EMPLOYMENT',
				statutory_contribution_id: 'PIT',
				status: { ...status, unit_assessments: splitEntries }
			}
		],
		{
			tables: {
				statutory_contributions: [
					{
						id: 'PIT',
						code: 'PIT',
						elections: [],
						rules: [{ when: 'true', per_unit: true, payment_occasion: true }]
					}
				],
				employments: [{ id: 'EMPLOYMENT', employee_id: 'PERSON' }]
			}
		}
	);
	assert.deepEqual(savedSplit.status.unit_assessments, splitEntries);
	const slip = {
		id: 'SLIP',
		payroll_run_id: 'RUN',
		employment_id: 'EMPLOYMENT',
		status: 'DRAFT',
		paid_at: null,
		currency: 'VND',
		unfunded_contributions: 0,
		funding_received: 0,
		funding_received_on: null,
		funding_reference: null,
		statutory: [{ scheme_code: 'PIT', payment_occasion: true }]
	};
	const tables = {
		payslips: [slip],
		payroll_runs: [
			{
				id: 'RUN',
				company_id: 'COMPANY',
				period: '2026-07',
				pay_date: '2026-07-31',
				payslips: [{ employment_id: 'EMPLOYMENT' }]
			}
		]
	};
	await assert.rejects(
		transform(payslips, [{ status: 'PAID', paid_at: '2026-08-01' }], { existing: [slip], tables }),
		/Payment-occasion withholding was calculated for the run settlement date/
	);
	const [paid] = await transform(payslips, [{ status: 'PAID', paid_at: '2026-07-31' }], {
		existing: [slip],
		tables
	});
	assert.equal(paid.status, 'PAID');
});

test('VN July PIT withholds 10% on a wage paid after a long contract ends', () => {
	// Decree 253/2026 art.50(2), confirmed by Hanoi Tax Authority on 14 September 2026.
	// The monthly salary window ends on the 20th; the employment ends on the 21st; pay is on the 31st.
	const paid = (period: string) =>
		assessStatutory(
			{
				code: 'VN',
				period,
				region: 'I',
				people: [
					{
						key: 'FORMER',
						wage: 20_000_000,
						citizenship: 'CITIZEN',
						hire_date: '2025-01-01',
						exit_date: `${period}-21`,
						exit_reason: 'RESIGNATION',
						registrations: {
							PIT: {
								kind: 'REGISTERED',
								unit_assessments: [
									{
										period,
										gross: period.endsWith('-06') ? 13_636_364 : 13_043_478,
										units: 1,
										reference: 'FINAL-WAGE',
										paid_on: `${period}-${period.endsWith('-06') ? '30' : '31'}`
									}
								]
							}
						}
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 21;
			}
		);
	expectStatutory(paid('2026-07'), 'FORMER', 'PIT', 1_304_348, 0);
	expectStatutory(paid('2026-06'), 'FORMER', 'PIT', 1_363_636, 0);
});

test('VN monthly cutoff changes the attendance window, while the May run still settles on 31 May', () => {
	// The cutoff of 16 closes attendance on 15 May. It does not schedule payment on 16 May;
	// the monthly run's settlement remains 31 May, so no cross-version refusal applies.
	const book = assessStatutory(
		{
			code: 'VN',
			period: '2026-05',
			region: 'I',
			people: [{ key: 'CUTOFF', wage: 20_000_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 16;
		}
	);
	expectStatutory(book, 'CUTOFF', 'PIT', 120_000, 0);
});
