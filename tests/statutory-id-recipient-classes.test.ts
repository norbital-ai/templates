import assert from 'node:assert/strict';
import test from 'node:test';
import registrations from '../src/data/collection/employment_statutory_facts/+collection.ts';
import { statutoryFactStatusFault } from '../src/lib/datatypes/statutory_fact_status.ts';
import { transform } from './helpers/bodies.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import {
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	COMPANY_ID,
	expectStatutory,
	type Person
} from './fixtures/statutory-world.ts';

test('ID services — each cut-off withholds on actual monthly receipts and reconciles prior withholding', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-03-1',
		payFrequency: 'SEMI_MONTHLY',
		people: [{ ...person('SERVICE', 310_000_000, 'NON_EMPLOYEE'), pay_frequency: 'SEMI_MONTHLY' }]
	});
	const build = (period: string) => {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		return { prepared, built: buildPayrollRun(prepared) };
	};
	const first = build('2026-03-1');
	const amount = (result: ReturnType<typeof build>) =>
		result.built.payslip_payroll_run[0]!.statutory.find((row) => row.scheme_code === 'PPH21')!
			.employee_amount;
	// Actual first cut-off gross 310m × 15/31 = 150m; half = 75m → 3m + 15m × 15% = 5.25m.
	assert.equal(amount(first), 5_250_000);
	world.payroll_runs.push({
		id: 'FIRST',
		company_id: COMPANY_ID,
		period: '2026-03-1',
		pay_date: first.prepared.window.payDate,
		attendance_from: first.prepared.window.attendance.start,
		attendance_to: first.prepared.window.attendance.end,
		approval_id: null
	});
	world.payslips.push(
		...first.built.payslip_payroll_run.map((slip) => ({
			...slip,
			payroll_run_id: 'FIRST',
			paid_at: first.prepared.window.payDate,
			approval_id: null
		}))
	);
	// Month 310m / 2 = 155m → 17.25m, minus 5.25m already withheld = 12m.
	assert.equal(amount(build('2026-03-2')), 12_000_000);
});

test('payment assessments validate through the authored status schema and registration write', async () => {
	const entry = { period: '2026-03', gross: 600_000, units: 1, reference: 'PAYMENT-1' };
	const status = {
		kind: 'REGISTERED' as const,
		reference_number: 'TAX',
		rate_override: null,
		unit_assessments: [entry]
	};
	assert.equal(statutoryFactStatusFault(status), undefined);
	for (const invalid of [
		{ ...entry, units: 0 },
		{ ...entry, units: 1.5 },
		{ ...entry, gross: -1 },
		{ ...entry, reference: ' ' },
		{ ...entry, period: '2026-13' }
	])
		assert.ok(statutoryFactStatusFault({ ...status, unit_assessments: [invalid] }));
	const tables = {
		statutory_contributions: [
			{
				id: 'SCHEME',
				code: 'DAILY',
				elections: [],
				rules: [{ when: 'true', per_unit: true, employee: '0.0', employer: '0.0' }]
			}
		],
		employments: [{ id: 'EMPLOYMENT', employee_id: 'PERSON' }]
	};
	const fact = {
		employee_id: 'PERSON',
		employment_id: 'EMPLOYMENT',
		statutory_contribution_id: 'SCHEME',
		status
	};
	const [out] = await transform(registrations, [fact], { tables });
	assert.deepEqual(out.status.unit_assessments, [entry]);
	await assert.rejects(
		transform(registrations, [{ ...fact, employment_id: null }], { tables }),
		/named employment/
	);
	await assert.rejects(
		transform(
			registrations,
			[{ ...fact, status: { ...status, unit_assessments: [entry, entry] } }],
			{ tables }
		),
		/distinct reference/
	);
});

// PMK 168/2023 arts.12, 16 and Lampiran A.III–VII; UU PPh art.17(1)(a).
// Recipient class is a declaration, independent of the employment contract label.
const excluded = Object.fromEntries(
	['JHT', 'JP', 'JKK', 'JKM', 'JKP', 'KESEHATAN'].map((code) => [code, { kind: 'NOT_REGISTERED' }])
);
function person(key: string, wage: number, recipient_class: string): Person {
	return {
		key,
		wage,
		registrations: {
			...excluded,
			PPH21: { kind: 'REGISTERED', elections: { recipient_class, service_kind: 'OTHER' } }
		}
	};
}

for (const period of ['2025-12', '2026-01', '2026-03', '2026-12']) {
	test(`ID recipient classes — ${period}: services use half gross, without annual reconciliation`, () => {
		const book = assessStatutory({
			code: 'ID',
			period,
			people: [
				person('SERVICE', 1_000_000, 'NON_EMPLOYEE'),
				person('EDGE', 120_000_000, 'NON_EMPLOYEE'),
				person('ABOVE', 120_020_000, 'NON_EMPLOYEE')
			]
		});
		expectStatutory(book, 'SERVICE', 'PPH21', 25_000, 0);
		expectStatutory(book, 'EDGE', 'PPH21', 3_000_000, 0);
		// 60m × 5% + 10k × 15%, assessed for this tax month, never cumulative YTD.
		expectStatutory(book, 'ABOVE', 'PPH21', 3_001_500, 0);
	});
	test(`ID recipient classes — ${period}: monthly temporary workers keep TER in the final month`, () => {
		const book = assessStatutory({
			code: 'ID',
			period,
			people: [person('TEMP', 8_000_000, 'NON_PERMANENT_MONTHLY')]
		});
		// Lampiran B.IV.2: December 8m, category A TER 1.5% = 120k.
		expectStatutory(book, 'TEMP', 'PPH21', 120_000, 0);
	});
}

test('ID Article 16 — full-gross classes and commissioners do not reconcile the year', () => {
	const classes = ['ACTIVITY_PARTICIPANT', 'FORMER_EMPLOYEE', 'ACTIVE_PENSION_WITHDRAWAL'];
	const book = assessStatutory({
		code: 'ID',
		period: '2026-12',
		people: [
			...classes.map((category) => person(category, 70_000_000, category)),
			person('COMMISSIONER', 8_000_000, 'IRREGULAR_COMMISSIONER')
		]
	});
	for (const category of classes) expectStatutory(book, category, 'PPH21', 4_500_000, 0);
	expectStatutory(book, 'COMMISSIONER', 'PPH21', 120_000, 0);
});

test('ID services — documented pass-throughs, no-tax-ID surcharge and prior tax remain distinct', () => {
	const sample = person('SERVICE', 10_000_000, 'NON_EMPLOYEE');
	const book = assessStatutory({ code: 'ID', period: '2026-12', people: [sample] }, (world) => {
		for (const fact of world.employment_statutory_facts) {
			if (
				world.statutory_contributions.find((row) => row.id === fact.statutory_contribution_id)
					?.code !== 'PPH21' ||
				fact.status.kind !== 'REGISTERED'
			)
				continue;
			fact.status.elections = {
				recipient_class: 'NON_EMPLOYEE',
				service_kind: 'OTHER',
				no_tax_id: true
			};
			fact.status.deduction_claims = [
				{
					period: '2026-12',
					category: 'SERVICE_COSTS',
					amount: 2_000_000,
					source: 'EMPLOYEE',
					reference: 'INVOICES'
				}
			];
			fact.status.opening = [
				{ year: '2026', base: 400_000_000, employee: 10_000_000, employer: 0, reference: 'EARLIER' }
			];
		}
	});
	// No PTKP input needed. (10m − 2m) × 50% × 5% × 120% = 240k; earlier tax is not refunded.
	expectStatutory(book, 'SERVICE', 'PPH21', 240_000, 0);
});

for (const service_kind of ['CATERING', 'MEDICAL']) {
	test(`ID ${service_kind} — costs cannot reduce statutory gross`, () => {
		assert.throws(
			() =>
				assessStatutory(
					{
						code: 'ID',
						period: '2026-03',
						people: [person('SERVICE', 10_000_000, 'NON_EMPLOYEE')]
					},
					(world) => {
						for (const fact of world.employment_statutory_facts) {
							if (
								world.statutory_contributions.find(
									(row) => row.id === fact.statutory_contribution_id
								)?.code !== 'PPH21' ||
								fact.status.kind !== 'REGISTERED'
							)
								continue;
							fact.status.elections.service_kind = service_kind;
							fact.status.deduction_claims = [
								{
									period: '2026-03',
									category: 'SERVICE_COSTS',
									amount: 1_000_000,
									source: 'EMPLOYEE',
									reference: 'COST'
								}
							];
						}
					}
				),
			/cannot reduce catering/
		);
	});
}

for (const invalid of ['missing', 'wrong-period', 'short', 'duplicate', 'zero-units']) {
	test(`ID daily assessment refuses ${invalid} payment inputs`, () => {
		assert.throws(
			() =>
				assessStatutory(
					{
						code: 'ID',
						period: '2026-03',
						people: [person('DAILY', 1_000_000, 'NON_PERMANENT_NON_MONTHLY')]
					},
					(world) => {
						for (const fact of world.employment_statutory_facts) {
							if (
								world.statutory_contributions.find(
									(row) => row.id === fact.statutory_contribution_id
								)?.code !== 'PPH21_DAILY' ||
								fact.status.kind !== 'REGISTERED'
							)
								continue;
							fact.status.unit_assessments =
								invalid === 'missing'
									? []
									: invalid === 'duplicate'
										? [
												{ period: '2026-03', gross: 500_000, units: 1, reference: 'DUP' },
												{ period: '2026-03', gross: 500_000, units: 1, reference: 'DUP' }
											]
										: [
												{
													period: invalid === 'wrong-period' ? '2026-02' : '2026-03',
													gross: invalid === 'short' ? 500_000 : 1_000_000,
													units: invalid === 'zero-units' ? 0 : 1,
													reference: 'PAYMENT'
												}
											];
						}
					}
				),
			/unit assessments/i
		);
	});
}

for (const payFrequency of ['SEMI_MONTHLY', 'WEEKLY'] as const) {
	test(`ID daily assessment — ${payFrequency} uses the current payment without monthly estimation`, () => {
		const period = '2026-03-1';
		// The first semi-monthly salary window is 15/31 of March; 3.1m × 15/31 = 1.5m.
		const sample = person(
			'DAILY',
			payFrequency === 'SEMI_MONTHLY' ? 3_100_000 : 1_000_000,
			'NON_PERMANENT_NON_MONTHLY'
		);
		const book = assessStatutory(
			{ code: 'ID', period, payFrequency, people: [{ ...sample, pay_frequency: payFrequency }] },
			(world) => {
				for (const fact of world.employment_statutory_facts) {
					if (
						world.statutory_contributions.find((row) => row.id === fact.statutory_contribution_id)
							?.code !== 'PPH21_DAILY' ||
						fact.status.kind !== 'REGISTERED'
					)
						continue;
					fact.status.unit_assessments = [
						{
							period,
							gross: payFrequency === 'SEMI_MONTHLY' ? 1_500_000 : 1_000_000,
							units: payFrequency === 'SEMI_MONTHLY' ? 3 : 2,
							reference: 'BATCH'
						}
					];
				}
			}
		);
		expectStatutory(
			book,
			'DAILY',
			'PPH21_DAILY',
			payFrequency === 'SEMI_MONTHLY' ? 7_500 : 5_000,
			0
		);
	});
}

test('ID recipient classes — missing class refuses; employment label cannot establish tax class', () => {
	assert.throws(
		() =>
			buildStatutory({ code: 'ID', period: '2026-03', people: [person('UNKNOWN', 1_000_000, '')] }),
		/recipient class/i
	);
});

for (const period of ['2025-12', '2026-01', '2026-03', '2026-12']) {
	test(`ID daily assessment — ${period}: each payment uses its own daily or average daily base`, () => {
		const cases = [
			{ key: 'BOUNDARY', payments: [{ gross: 4_500_000, units: 10 }], tax: 0 },
			{ key: 'LOW', payments: [{ gross: 500_000, units: 1 }], tax: 2_500 },
			{ key: 'CEILING', payments: [{ gross: 25_000_000, units: 10 }], tax: 125_000 },
			{ key: 'BATCH', payments: [{ gross: 15_000_000, units: 5 }], tax: 375_000 },
			{ key: 'PROGRESSIVE', payments: [{ gross: 280_000_000, units: 2 }], tax: 9_000_000 },
			{
				key: 'VARIABLE',
				payments: [
					{ gross: 400_000, units: 1 },
					{ gross: 600_000, units: 1 }
				],
				tax: 3_000
			}
		];
		const people = cases.map(({ key, payments }) =>
			person(
				key,
				payments.reduce((sum, payment) => sum + payment.gross, 0),
				'NON_PERMANENT_NON_MONTHLY'
			)
		);
		const book = assessStatutory({ code: 'ID', period, people }, (world) => {
			for (const fact of world.employment_statutory_facts) {
				const scheme = world.statutory_contributions.find(
					(row) => row.id === fact.statutory_contribution_id
				);
				if (scheme?.code !== 'PPH21_DAILY' || fact.status.kind !== 'REGISTERED') continue;
				const employee = world.employments.find((row) => row.employee_id === fact.employee_id)!;
				const sample = cases.find((row) => employee.employee_number === row.key)!;
				fact.status.unit_assessments = sample.payments.map((payment, index) => ({
					...payment,
					period,
					reference: `${sample.key}-${index}`
				}));
			}
		});
		for (const sample of cases) expectStatutory(book, sample.key, 'PPH21_DAILY', sample.tax, 0);
	});
}

test('ID DTP — reference-month eligibility survives a raise and cannot arise from a later pay cut', () => {
	const samples = [
		{ key: 'RAISE', wage: 12_000_000, reference: 9_000_000, expected: 0 },
		{ key: 'CUT', wage: 8_000_000, reference: 11_000_000, expected: 120_000 }
	];
	const people = samples.map((sample) => {
		const row = person(sample.key, sample.wage, 'REGULAR_EMPLOYEE');
		return {
			...row,
			registrations: {
				...row.registrations,
				PPH21: {
					kind: 'REGISTERED',
					elections: {
						recipient_class: 'REGULAR_EMPLOYEE',
						dtp_reference_gross: sample.reference,
						dtp_reference_year: '2026',
						other_pph21_incentive: false
					}
				}
			}
		};
	});
	const book = assessStatutory({
		code: 'ID',
		period: '2026-03',
		companyFacts: { pph21_dtp_sector: true },
		people
	});
	for (const sample of samples) expectStatutory(book, sample.key, 'PPH21', sample.expected, 0);
});

test('ID daily DTP — Rp500,000 inclusive, tax identity and conflicting incentive control eligibility', () => {
	const samples = [
		{ key: 'ELIGIBLE', wage: 500_000, no_tax_id: false, other: false, tax: 0 },
		{ key: 'ABOVE', wage: 500_001, no_tax_id: false, other: false, tax: 2_500 },
		{ key: 'NO_ID', wage: 500_000, no_tax_id: true, other: false, tax: 3_000 },
		{ key: 'OTHER', wage: 500_000, no_tax_id: false, other: true, tax: 2_500 }
	];
	const people = samples.map((sample) => {
		const row = person(sample.key, sample.wage, 'NON_PERMANENT_NON_MONTHLY');
		return {
			...row,
			registrations: {
				...row.registrations,
				PPH21: {
					kind: 'REGISTERED',
					elections: {
						recipient_class: 'NON_PERMANENT_NON_MONTHLY',
						no_tax_id: sample.no_tax_id,
						other_pph21_incentive: sample.other
					}
				}
			}
		};
	});
	const book = assessStatutory(
		{ code: 'ID', period: '2026-03', companyFacts: { pph21_dtp_sector: true }, people },
		(world) => {
			for (const fact of world.employment_statutory_facts) {
				if (
					world.statutory_contributions.find((row) => row.id === fact.statutory_contribution_id)
						?.code !== 'PPH21_DAILY' ||
					fact.status.kind !== 'REGISTERED'
				)
					continue;
				const employment = world.employments.find((row) => row.employee_id === fact.employee_id)!;
				const sample = samples.find((row) => row.key === employment.employee_number)!;
				fact.status.unit_assessments = [
					{ period: '2026-03', gross: sample.wage, units: 1, reference: sample.key }
				];
			}
		}
	);
	for (const sample of samples) expectStatutory(book, sample.key, 'PPH21_DAILY', sample.tax, 0);
});

test('ID month-to-date tax includes employer premiums actually charged at the cut-off', () => {
	const book = assessStatutory(
		{
			code: 'ID',
			period: '2026-03-1',
			payFrequency: 'SEMI_MONTHLY',
			region: 'DKI Jakarta',
			riskClass: 'II',
			people: [{ key: 'EMPLOYEE', wage: 31_000_000, pay_frequency: 'SEMI_MONTHLY' }]
		},
		(world) => {
			world.companies[0]!.semi_monthly_statutory_cutoff = 'SPLIT';
		}
	);
	// First 15/31 salary = 15m. SPLIT provisionally prices BPJS on two instalments (30m):
	// JKK 162000, JKM 90000, Kesehatan 480000; half charged now = 366000.
	// Actual taxable gross 15366000 × TER A 7% = 1075620; the second cut-off reconciles BPJS.
	expectStatutory(book, 'EMPLOYEE', 'PPH21', 1_075_620, 0);
});

test('ID former employee — a bonus paid after exit reaches Article 16 without another salary', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-04',
		region: 'DKI Jakarta',
		riskClass: 'II',
		people: [{ ...person('FORMER', 10_000_000, 'FORMER_EMPLOYEE'), exit_date: '2026-03-31' }]
	});
	const version = world.jurisdiction_settings.find((row) =>
		String(row.effective_range.start).startsWith('2026-03')
	)!;
	const bonus = world.adhoc_catalogue!.find(
		(row) => row.settings_id === version.id && row.code === 'BONUS_THR'
	)!;
	world.adhoc_requests!.push({
		id: 'FORMER-BONUS',
		employment_id: world.employments[0]!.id,
		catalogue_id: bonus.id,
		amount: 70_000_000,
		event_date: '2026-04-15',
		pay_period: '2026-04',
		payslip_id: null,
		reason: 'Bonus awarded after cessation',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	const built = buildPayrollRun(
		gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period: '2026-04'
		})
	);
	assert.equal(built.payslip_payroll_run.length, 1);
	const slip = built.payslip_payroll_run[0]!;
	assert.equal(slip.gross, 70_000_000);
	// Full gross Article 17: 60m × 5% + 10m × 15% = 4.5m, no recurring wage.
	assert.equal(
		slip.statutory.find((row) => row.scheme_code === 'PPH21')!.employee_amount,
		4_500_000
	);
});
