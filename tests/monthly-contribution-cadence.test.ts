import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { COMPANY_ID, createStatutoryWorld } from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';
import { weeklyInstalments } from '../src/collections/payroll_runs/lib/period.ts';

function settlePeriod(world: PayrollWorld, period: string) {
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);
	const built = buildPayrollRun(prepared);
	world.payroll_runs.push({
		id: period,
		company_id: COMPANY_ID,
		period,
		company_charges: built.company_charges
	});
	for (const slip of built.payslip_payroll_run)
		world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
	for (const capture of built.captures)
		for (const request of world.adhoc_requests ?? [])
			if (capture.adhoc.includes(String(request.id))) request.payslip_id = capture.payslipId;
	for (const capture of built.captures)
		for (const entry of world.leave_entries)
			if (capture.leave.includes(String(entry.id))) entry.payslip_id = capture.payslipId;
	return built.payslip_payroll_run.flatMap((slip) => slip.statutory);
}

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
	test(`TW ${cutoff} closes a leaver's monthly deductions and retains employer history after departure`, () => {
		const world = createStatutoryWorld({
			code: 'TW',
			period: '2026-01-1',
			payFrequency: 'SEMI_MONTHLY',
			riskClass: '1',
			people: [
				{
					key: 'LEAVER',
					wage: 60000,
					citizenship: 'CITIZEN',
					pay_frequency: 'SEMI_MONTHLY',
					exit_date: '2026-01-15',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		});
		world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
		const first = settlePeriod(world, '2026-01-1');
		const last = settlePeriod(world, '2026-01-2');
		assert.equal(first.find((row) => row.scheme_code === 'LI')?.employee_amount, 527);
		assert.equal(first.find((row) => row.scheme_code === 'INCOME_TAX')?.employee_amount ?? 0, 0);
		assert.equal(first.find((row) => row.scheme_code === 'NHI')?.employee_amount ?? 0, 0);
		assert.deepEqual(last, []);
		const company = world.payroll_runs[1]!.company_charges as {
			scheme_code: string;
			employer_amount: number;
		}[];
		// 60,000 × 15/31 = 29,032.26 paid; no month-end NHI enrolment. 2.11% rounds to 613.
		assert.equal(
			company.find((row) => row.scheme_code === 'NHI_SUPPLEMENT_EMPLOYER')?.employer_amount,
			613
		);
	});

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
	for (const bonusAmount of [60000, 140000])
		test(`TW ${cutoff} keeps ${bonusAmount} bonuses per payment and the employer levy monthly`, () => {
			const world = createStatutoryWorld({
				code: 'TW',
				period: '2026-01-1',
				payFrequency: 'SEMI_MONTHLY',
				riskClass: '1',
				people: [
					{
						key: 'BONUS',
						wage: 60000,
						citizenship: 'CITIZEN',
						pay_frequency: 'SEMI_MONTHLY',
						registrations: {
							INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
						}
					}
				]
			});
			world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === '1fcfa66f-40da-5792-b925-7c2fcaa8f92c'
			)!;
			for (const [index, date] of ['2026-01-10', '2026-01-20'].entries())
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000000b${index}`,
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: bonusAmount,
					event_date: date,
					pay_period: null,
					payslip_id: null,
					reason: 'Bonus payment',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			const first = settlePeriod(world, '2026-01-1');
			const last = settlePeriod(world, '2026-01-2');
			for (const rows of [first, last])
				assert.equal(
					rows.find((row) => row.scheme_code === 'INCOME_TAX_BONUS')?.employee_amount ?? 0,
					bonusAmount === 140000 ? 7000 : 0
				);
			assert.equal(
				[...first, ...last]
					.filter((row) => row.scheme_code === 'INCOME_TAX')
					.reduce((sum, row) => sum + row.employee_amount, 0),
				3000
			);
			assert.equal(
				first.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')?.employee_amount ?? 0,
				0
			);
			// 280,000 cumulative bonus − 4 × 60,800 insured salary = 36,800; 2.11% rounds to 776.
			assert.equal(
				last.find((row) => row.scheme_code === 'NHI_SUPPLEMENT')?.employee_amount ?? 0,
				bonusAmount === 140000 ? 776 : 0
			);
			assert.deepEqual(world.payroll_runs[0]!.company_charges, []);
			const company = world.payroll_runs[1]!.company_charges as {
				scheme_code: string;
				employer_amount: number;
			}[];
			assert.equal(
				company.find((row) => row.scheme_code === 'NHI_SUPPLEMENT_EMPLOYER')?.employer_amount,
				bonusAmount === 140000 ? 5891 : 2515
			);
			assert.equal(
				company.find((row) => row.scheme_code === 'WAGE_ARREARS_FUND')?.employer_amount,
				11
			);
		});

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
	for (const unpaid of [13, 14])
		for (const continuation of [false, true])
			for (const month of ['2025-12', '2026-01', '2026-07'])
				test(`VN ${month} ${cutoff} assesses ${unpaid} unpaid days with continuation=${continuation}`, () => {
					const world = createStatutoryWorld({
						code: 'VN',
						period: `${month}-1`,
						payFrequency: 'SEMI_MONTHLY',
						region: 'I',
						people: [
							{
								key: 'UNPAID',
								wage: 22000000,
								citizenship: 'CITIZEN',
								pay_frequency: 'SEMI_MONTHLY',
								registrations: {
									SI: {
										kind: 'REGISTERED',
										elections: {
											continue_si_unpaid: continuation,
											...(continuation
												? {
														continued_si_base: 17000000,
														continued_si_reference: 'UNPAID-AGREEMENT'
													}
												: {})
										}
									}
								}
							}
						]
					});
					world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
					addUnpaidWorkingDays(world, month, unpaid);
					const rows = [...settlePeriod(world, `${month}-1`), ...settlePeriod(world, `${month}-2`)];
					const si = rows.filter((row) => row.scheme_code === 'SI');
					assert.deepEqual(
						[
							si.reduce((sum, row) => sum + row.employee_amount, 0),
							si.reduce((sum, row) => sum + row.employer_amount, 0)
						],
						unpaid === 13 ? [1760000, 3850000] : continuation ? [1360000, 2975000] : [0, 0]
					);
					for (const [code, expected] of [
						['HI', unpaid === 13 ? [330000, 660000] : continuation ? [255000, 510000] : [0, 0]],
						['UI', unpaid === 13 ? [220000, 220000] : [0, 0]]
					] as const) {
						const charges = rows.filter((row) => row.scheme_code === code);
						assert.deepEqual(
							[
								charges.reduce((sum, row) => sum + row.employee_amount, 0),
								charges.reduce((sum, row) => sum + row.employer_amount, 0)
							],
							expected,
							code
						);
					}
				});

for (const code of ['MY', 'MY-nihon'] as const)
	for (const period of ['2026-02', '2026-05'])
		test(`${code} weekly wages use one monthly statutory assessment in ${period}`, () => {
			const weeks = weeklyInstalments(period);
			const weekly = createStatutoryWorld({
				code,
				period: `${period}-1`,
				payFrequency: 'WEEKLY',
				people: [
					{
						key: 'WEEKLY',
						wage: 1500,
						age: 30,
						citizenship: 'CITIZEN',
						tax_residency: 'RESIDENT',
						pay_frequency: 'WEEKLY'
					}
				]
			});
			const monthly = createStatutoryWorld({
				code,
				period,
				people: [
					{
						key: 'MONTHLY',
						wage: 1500 * weeks.length,
						age: 30,
						citizenship: 'CITIZEN',
						tax_residency: 'RESIDENT'
					}
				]
			});
			const expected = settlePeriod(monthly, period);
			const actual = weeks.flatMap((week) => settlePeriod(weekly, `${period}-${week.sequence}`));
			for (const row of expected)
				for (const field of [
					'base_amount',
					'ordinary_amount',
					'employee_amount',
					'employer_amount'
				] as const)
					assert.equal(
						Math.round(
							actual
								.filter((value) => value.scheme_code === row.scheme_code)
								.reduce((sum, value) => sum + (value[field] ?? 0), 0) * 100
						) / 100,
						row[field] ?? 0,
						`${row.scheme_code} ${field}`
					);
		});

for (const code of ['SG', 'VN', 'MY', 'MY-nihon', 'ID', 'TW'] as const)
	for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
		test(`${code} ${cutoff} cut-offs reconcile to monthly assessments throughout the year`, () => {
			const wage =
				code === 'SG'
					? 10000
					: code === 'VN'
						? 20_000_000
						: code === 'ID'
							? 15_000_000
							: code === 'TW'
								? 60000
								: 6000;
			const monthly = createStatutoryWorld({
				code,
				period: '2026-01',
				region: code === 'ID' ? 'DKI Jakarta' : 'I',
				riskClass: code === 'TW' ? '1' : 'II',
				people: [
					{
						key: 'CADENCE',
						wage,
						age: 30,
						citizenship: 'CITIZEN',
						tax_residency: 'RESIDENT',
						...(code !== 'TW'
							? {}
							: {
									registrations: {
										LABOR_PENSION: { kind: 'REGISTERED', elections: { voluntary_rate: 6 } },
										INCOME_TAX: {
											kind: 'REGISTERED',
											elections: { five_percent_withholding: true }
										}
									}
								})
					}
				]
			});
			const split = createStatutoryWorld({
				code,
				period: '2026-01-1',
				payFrequency: 'SEMI_MONTHLY',
				region: code === 'ID' ? 'DKI Jakarta' : 'I',
				riskClass: code === 'TW' ? '1' : 'II',
				people: [
					{
						key: 'CADENCE',
						...(code !== 'TW'
							? {}
							: {
									registrations: {
										LABOR_PENSION: { kind: 'REGISTERED', elections: { voluntary_rate: 6 } },
										INCOME_TAX: {
											kind: 'REGISTERED',
											elections: { five_percent_withholding: true }
										}
									}
								}),
						wage,
						age: 30,
						citizenship: 'CITIZEN',
						tax_residency: 'RESIDENT',
						pay_frequency: 'SEMI_MONTHLY'
					}
				]
			});
			split.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			if (code === 'SG')
				for (const world of [monthly, split]) {
					const bonus = world.adhoc_catalogue!.find(
						(row) =>
							row.code === 'bonus' && row.settings_id === 'e363af9a-a034-59f7-84bf-5052f57ecae5'
					)!;
					world.adhoc_requests!.push({
						id: 'd0000000-0000-4000-8000-0000000000b1',
						employment_id: world.employments[0]!.id,
						catalogue_id: bonus.id,
						amount: 10000,
						event_date: '2026-01-01',
						pay_period: null,
						payslip_id: null,
						reason: 'Annual bonus',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			for (let month = 1; month <= 12; month++) {
				const period = `2026-${String(month).padStart(2, '0')}`;
				const expected = settlePeriod(monthly, period);
				const actual = [
					...settlePeriod(split, `${period}-1`),
					...settlePeriod(split, `${period}-2`)
				];
				for (const row of expected) {
					const rows = actual.filter((value) => value.scheme_code === row.scheme_code);
					for (const field of [
						'base_amount',
						'ordinary_amount',
						'employee_amount',
						'employer_amount'
					] as const)
						assert.equal(
							Math.round(rows.reduce((sum, value) => sum + (value[field] ?? 0), 0) * 100) / 100,
							row[field] ?? 0,
							`${period} ${row.scheme_code} ${field}`
						);
				}
				if (code === 'SG') {
					const cpf = expected.find((row) => row.scheme_code === 'CPF')!;
					// CPF Board: 8,000 monthly OW ceiling; 102,000 − 12 × 8,000 = 6,000 AW ceiling.
					assert.deepEqual(
						[cpf.base_amount, cpf.employee_amount, cpf.employer_amount],
						month === 1 ? [14000, 2800, 2380] : [8000, 1600, 1360]
					);
				}
				if (code === 'ID' && month === 1) {
					// BPJS monthly wage caps and PMK 168/2023 monthly TER A: 7% × 15,606,000.
					for (const [scheme, employee, employer] of [
						['JP', 105474, 210948],
						['KESEHATAN', 120000, 480000],
						['PPH21', 1092420, 0]
					] as const) {
						const row = expected.find((value) => value.scheme_code === scheme)!;
						assert.deepEqual([row.employee_amount, row.employer_amount], [employee, employer]);
					}
				}
				if (code === 'TW') {
					// 60,800 insured wage × 6% = 3,648 deductible voluntary pension each month.
					// (60,000 − 3,648) × 5% = 2,817.60; earlier months' contributions are not relieved again.
					assert.equal(
						expected.find((row) => row.scheme_code === 'INCOME_TAX')?.employee_amount,
						2817
					);
				}
			}
		});

// SSS Circular 2024-006, PhilHealth Circular 2020-0005 and HDMF Circular 460:
// monthly minima, salary credits and ceilings apply to the month's remuneration.
for (const [wage, expected] of [
	[4000, { SSS: [250, 500], SSS_MPF: [0, 0], SSS_EC: [0, 10], PHIC: [250, 250], HDMF: [80, 80] }],
	[
		30000,
		{ SSS: [1000, 2000], SSS_MPF: [500, 1000], SSS_EC: [0, 30], PHIC: [750, 750], HDMF: [200, 200] }
	]
] as const)
	test(`PH split cut-offs retain monthly contribution floors and ceilings on ${wage}`, () => {
		const world = createStatutoryWorld({
			code: 'PH',
			period: '2026-02-1',
			payFrequency: 'SEMI_MONTHLY',
			people: [{ key: 'SPLIT', wage, pay_frequency: 'SEMI_MONTHLY' }]
		});
		world.companies[0]!.semi_monthly_statutory_cutoff = 'SPLIT';
		const totals = new Map<string, [number, number]>();
		for (const period of ['2026-02-1', '2026-02-2']) {
			const prepared = Effect.runSync(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
			);
			const built = buildPayrollRun(prepared);
			world.payroll_runs.push({ id: period, company_id: COMPANY_ID, period });
			for (const slip of built.payslip_payroll_run) {
				world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
				for (const charge of slip.statutory) {
					const prior = totals.get(charge.scheme_code) ?? [0, 0];
					totals.set(charge.scheme_code, [
						prior[0] + charge.employee_amount,
						prior[1] + charge.employer_amount
					]);
				}
			}
		}
		for (const [scheme, amounts] of Object.entries(expected))
			assert.deepEqual(
				(totals.get(scheme) ?? [0, 0]).map((amount) => Math.round(amount * 100) / 100),
				amounts,
				scheme
			);
	});

for (const [period, hire, exit, li, ei, pension] of [
	['2026-01', '2026-01-16', null, 461, 40, 1203],
	['2026-01', '2026-01-31', null, 31, 3, 80],
	['2026-02', '2026-02-28', null, 92, 8, 241],
	['2026-02', '2015-01-01', '2026-02-28', 861, 75, 2406],
	['2026-02', '2026-02-28', '2026-02-28', 31, 3, 241]
] as const)
	test(`TW insured days use the thirty-day calendar: ${hire} to ${exit ?? period}`, () => {
		// BLI premium calculator: continuing entry on Feb 28 = 3 days; Jan 30/31 = 1.
		// BLI insurance training: a Feb 28 withdrawal charges 28 days, not 30.
		// Pension contributions use the thirty-day employment month, including its final day (BLI FAQ 9).
		const world = createStatutoryWorld({
			code: 'TW',
			period,
			riskClass: '1',
			people: [
				{
					key: 'DAYS',
					wage: 40000,
					citizenship: 'CITIZEN',
					hire_date: hire,
					...(exit == null ? {} : { exit_date: exit })
				}
			]
		});
		world.companies[0]!.pay_cutoff_day = 1;
		const rows = settlePeriod(world, period);
		assert.equal(rows.find((row) => row.scheme_code === 'LI')?.employee_amount, li);
		assert.equal(rows.find((row) => row.scheme_code === 'EI')?.employee_amount, ei);
		assert.equal(rows.find((row) => row.scheme_code === 'LABOR_PENSION')?.employer_amount, pension);
	});

test('TW continued labour insurance survives 65 while employment insurance ends on the birthday', () => {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{
				key: 'BIRTHDAY',
				wage: 40000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-16',
				birth_date: '1961-01-20'
			}
		]
	});
	const rows = settlePeriod(world, '2026-01');
	assert.equal(rows.find((row) => row.scheme_code === 'LI')?.employee_amount, 461);
	assert.equal(rows.find((row) => row.scheme_code === 'EI')?.employee_amount, 11); // Jan 16–19: 4 days.
});

test('TW wage arrears fund matches BLI’s five-worker example, including LI-exempt workers and a joiner', () => {
	// https://www.bli.gov.tw/0110180.html: 40,100 + 13,500 + 13,500 + 45,800 + 28,070 = 140,970.
	// The company rounds 140,970 × 0.025% once, giving 35.
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [
			{ key: 'A', wage: 40000, citizenship: 'CITIZEN' },
			{ key: 'B', wage: 13000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{
				key: 'C',
				wage: 13000,
				citizenship: 'CITIZEN',
				employment_type: 'PART_TIME',
				registrations: { LI: { kind: 'NOT_REGISTERED' } }
			},
			{
				key: 'D',
				wage: 70000,
				citizenship: 'CITIZEN',
				registrations: { LI: { kind: 'NOT_REGISTERED' } }
			},
			{ key: 'E', wage: 40000, citizenship: 'CITIZEN', hire_date: '2026-01-10' }
		]
	});
	settlePeriod(world, '2026-01');
	const fund = (
		world.payroll_runs[0]!.company_charges as {
			scheme_code: string;
			base_amount: number;
			employer_amount: number;
		}[]
	).find((row) => row.scheme_code === 'WAGE_ARREARS_FUND')!;
	assert.deepEqual([fund.base_amount, fund.employer_amount], [140970, 35]);
});

test('TW age 65+ requires an explicit labour-insurance standing; non-registration contributes no base', () => {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-01',
		riskClass: '1',
		people: [{ key: 'UNKNOWN', wage: 40000, age: 70, citizenship: 'CITIZEN' }]
	});
	const liIds = new Set(
		world.statutory_contributions.filter((row) => row.code === 'LI').map((row) => row.id)
	);
	const facts = world.employment_statutory_facts.filter((row) =>
		liIds.has(row.statutory_contribution_id)
	);
	world.employment_statutory_facts = world.employment_statutory_facts.filter(
		(row) => !liIds.has(row.statutory_contribution_id)
	);
	assert.throws(() => settlePeriod(world, '2026-01'), /record the insurance registration status/);
	for (const fact of facts)
		fact.status = { kind: 'NOT_REGISTERED', reason: 'Confirmed no LI coverage' };
	world.employment_statutory_facts.push(...facts);
	const li = settlePeriod(world, '2026-01').find((row) => row.scheme_code === 'LI');
	assert.equal(li, undefined);
});
