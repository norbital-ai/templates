import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	expectStatutory,
	type Person,
	settingsVersions,
	contributionSchemes
} from './fixtures/statutory-world.ts';
import { evaluateNumber, expressionEngine } from '../src/lib/expressions/evaluate.ts';

test('PCB reproduces the LHDN 2026 specification’s worked April additional-remuneration example', () => {
	// Official specification, printed pp.48–51: normal MTD 106.20, annual projected
	// MTD 328.20 + 106.20×9 = 1,284; additional 2,011.50 - 1,284 = 727.50.
	const rule = contributionSchemes('MY')
		.find((row) => row.code === 'PCB')!
		.rules.at(-1)!;
	const context = {
		base: 13750,
		ordinary: 5500,
		person: { employee: { spouse_status: 'WITH_INCOME' } },
		scheme: {
			deduction: 600,
			deductions: { VOLUNTARY_EPF: 0 },
			deductions_current: { ZAKAT_EXTERNAL: 0, DEPARTURE_LEVY: 0 },
			rate_override: 0,
			year_to_date: { base: 16500, employee: 328.2, rebate: 0 },
			projection: { future_equivalents: 8, payslips_remaining: 9 },
			elections: { pcb_disabled: false, pcb_spouse_disabled: false, zakat: 0 },
			child_claims: { UNDER_18: 3, STUDYING: 0, TERTIARY: 0, DISABLED: 0, DISABLED_TERTIARY: 0 }
		},
		produced: {
			EPF: { employee: 4000, employee_normal: 4000 },
			EPF_PR: { employee: 0, employee_normal: 0 },
			EPF_NON_CITIZEN: { employee: 0, employee_normal: 0 },
			SOCSO: { employee: 0 },
			EIS: { employee: 0 }
		}
	};
	assert.equal(evaluateNumber(expressionEngine, rule.employee, context), 833.7);
	assert.equal(
		evaluateNumber(expressionEngine, rule.employee, {
			...context,
			scheme: { ...context.scheme, year_to_date: { base: 16500, employee: 3000, rebate: 0 } }
		}),
		0,
		'prior withholding already exceeds annual tax including the bonus'
	);
});

const claim = (
	category: string,
	amount: number,
	period = '2026-01',
	source: 'EMPLOYEE' | 'PRIOR_EMPLOYER' = 'EMPLOYEE'
) => ({ period, category, amount, source, reference: `${source} ${category} ${period} ${amount}` });
const OUT = { kind: 'NOT_REGISTERED' };
const person = (
	key: string,
	claims: ReturnType<typeof claim>[],
	elections: Record<string, number | string | boolean> = {}
): Person => ({
	key,
	wage: 5001,
	citizenship: 'CITIZEN',
	registrations: {
		EPF_NON_CITIZEN: OUT,
		PCB: { kind: 'REGISTERED', deduction_claims: claims, elections }
	}
});

for (const code of ['MY', 'MY-nihon'] as const) {
	for (const voluntary of [0, 2000])
		test(`${code} — bonus EPF retains normal-pay relief with RM${voluntary} voluntary contributions`, () => {
			// LHDN D(b), E(13): prior EPF 500, normal K1=220, bonus Kt=440, n=5.
			// Normal EPF: 500 + 220×6 = 1,820; full EPF: 500 + 660 + 220×5 = 2,260.
			// Voluntary EPF 2,000 raises the full projected EPF relief to its 4,000 cap.
			// SOCSO, EIS and SKBBK are registered but relieve nothing without a TP1 claim (MTD spec
			// 2026 D.2(ii) item k). Normal P = 33,500 + 1,780 × 6 − 9,000 = 35,180 (− 2,000 voluntary
			// = 33,180); full P = 38,740 (− 1,740 voluntary, the rest of the 4,000 = 37,000).
			// Voluntary 0: 610.80 ÷ 6 = 101.80; 824.40 − 610.80 = 213.60; PCB 315.40.
			// Voluntary 2,000: −250 + 13,180 × 3% = 145.40 ÷ 6 = 24.23 → 24.25; 720 − 145.50 = 574.50;
			// PCB 598.75.
			const built = buildStatutory(
				{
					code,
					period: '2026-07',
					people: [
						{
							key: 'EPF-BONUS',
							wage: 2000,
							citizenship: 'CITIZEN',
							registrations: {
								EPF_NON_CITIZEN: OUT,
								SOCSO: { kind: 'REGISTERED' },
								EIS: { kind: 'REGISTERED' },
								EPF: {
									kind: 'REGISTERED',
									opening: [
										{
											year: '2026',
											base: 34000,
											employee: 500,
											employer: 0,
											reference: 'TP3 EPF'
										}
									]
								},
								PCB: {
									kind: 'REGISTERED',
									deduction_claims: [claim('VOLUNTARY_EPF', voluntary, '2026-07')],
									opening: [
										{
											year: '2026',
											base: 34000,
											employee: 0,
											employer: 0,
											months: 6,
											reference: 'TP3 remuneration'
										}
									]
								}
							}
						}
					]
				},
				(world) => {
					const settings = settingsVersions(code).find((row) =>
						String(row.effective_range.start).startsWith('2026-06')
					)!;
					const bonus = world.adhoc_catalogue!.find(
						(row) => row.code === 'ADJ' && row.settings_id === settings.id
					)!;
					world.adhoc_requests!.push({
						id: 'd0000000-0000-4000-8000-00000000ad20',
						employment_id: world.employments[0]!.id,
						catalogue_id: bonus.id,
						amount: 4000,
						event_date: '2026-07-01',
						pay_period: null,
						payslip_id: null,
						reason: 'Synthetic bonus',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			);
			const charges = built.slips.get('EPF-BONUS')!.statutory;
			const epf = charges.find((row) => row.scheme_code === 'EPF')!;
			const pcb = charges.find((row) => row.scheme_code === 'PCB')!;
			// EPF Act Third Schedule, note to Part A: a wage of RM5,000 or less lifted above RM5,000 by a
			// bonus keeps the employer's 13%: 13% × (2,000 + 4,000) = 780; employee 11% × 6,000 = 660.
			assert.deepEqual([epf.employee_amount, epf.employer_amount], [660, 780]);
			assert.deepEqual(
				[pcb.employee_amount, pcb.employer_amount],
				[voluntary === 0 ? 315.4 : 598.75, 0]
			);
			const trace = built.trace;
			const tracedTax = trace[0]!.schemes.find((row) => row.scheme_code === 'PCB')!;
			assert.equal(tracedTax.ordinary_amount, 2000);
			const relief = tracedTax.reads.find((row) => row.code === 'EPF')!;
			assert.deepEqual([relief.employee_amount, relief.ordinary_employee_amount], [2260, 1820]);
		});

	test(`${code} — TP1 2026 limits change normal remuneration withholding`, () => {
		// LHDN 2026: 60,012 annual remuneration - EPF 3,999.93 (K2 312.63) - personal 9,000 =
		// 47,012.07; SOCSO/EIS relieve only as claimed (D.2(ii) item k, TP1 C14), so SOCSO_EIS 500
		// is its RM350 cap. For these claims P stays in the 6% band:
		// (600 + (P - 35,000) * .06) / 12, truncated to cents then rounded up to 5 cents.
		const cases = [
			['PARENTS_CARE', 9000, 70.1],
			['PARENTS_CHECKUP', 1500, 105.1],
			['DISABILITY_EQUIPMENT', 7000, 80.1],
			['SELF_EDUCATION', 8000, 75.1],
			['UPSKILLING', 3000, 100.1],
			['SERIOUS_MEDICAL', 11000, 60.1],
			['VACCINATION', 1500, 105.1],
			['DENTAL', 1500, 105.1],
			['MEDICAL_SCREENING', 1500, 105.1],
			['LEARNING_DISABILITY', 11000, 60.1],
			['LIFESTYLE', 3000, 97.6],
			['SPORTS', 1500, 105.1],
			['BREASTFEEDING', 1500, 105.1],
			['CHILDCARE', 4000, 95.1],
			['SSPN', 9000, 70.1],
			['ALIMONY', 5000, 90.1],
			['VOLUNTARY_EPF', 5000, 110.1],
			['LIFE_INSURANCE_EPF', 4000, 95.1],
			['PRIVATE_RETIREMENT', 4000, 95.1],
			['EDUCATION_MEDICAL_INSURANCE', 5000, 90.1],
			['SOCSO_EIS', 500, 108.35],
			['EV_CHARGING', 3000, 97.6],
			['COMPOST', 3000, 97.6],
			['FOOD_GRINDER_CCTV', 3000, 97.6],
			['TOURISM', 1500, 105.1]
		] as const;
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: cases.map(([category, amount]) => person(category, [claim(category, amount)]))
		});
		for (const [category, , expected] of cases) expectStatutory(book, category, 'PCB', expected, 0);
	});

	test(`${code} — TP1 shared caps, dated claims and signed corrections`, () => {
		const cases = [
			person('PARENTS', [claim('PARENTS_CARE', 7500), claim('PARENTS_CHECKUP', 2000)]),
			person('EDUCATION', [claim('SELF_EDUCATION', 6000), claim('UPSKILLING', 3000)]),
			person('MEDICAL', [
				claim('SERIOUS_MEDICAL', 9500),
				claim('VACCINATION', 2000),
				claim('DENTAL', 2000)
			]),
			person('APPLIANCES', [
				claim('EV_CHARGING', 2000),
				claim('COMPOST', 2000),
				claim('FOOD_GRINDER_CCTV', 2000)
			]),
			person('NET_SAVINGS', [claim('SSPN', 2000), claim('SSPN', -1500)]),
			person('NEGATIVE_NET', [claim('SSPN', -500)]),
			person('FUTURE', [claim('LIFESTYLE', 2500, '2026-02')]),
			person('OLD_YEAR', [claim('LIFESTYLE', 2500, '2025-12')]),
			person('PRIOR_EMPLOYER', [
				claim('LIFESTYLE', 2000, '2026-01', 'PRIOR_EMPLOYER'),
				claim('LIFESTYLE', 1000)
			]),
			{ ...person('SPOUSE_ALIMONY', [claim('ALIMONY', 4000)]), spouse_status: 'WITHOUT_INCOME' }
		];
		const book = assessStatutory({ code, period: '2026-01', people: cases });
		const expected = [70.1, 75.1, 60.1, 97.6, 107.6, 110.1, 110.1, 110.1, 97.6, 90.1];
		cases.forEach((row, index) => expectStatutory(book, row.key, 'PCB', expected[index]!, 0));
	});

	test(`${code} — first-home interest uses the price band and joint owners' payment shares`, () => {
		const elections = {
			tp1_home_price: 500000,
			tp1_home_spa_date: '2025-01-01',
			tp1_home_first_interest_year: 2025,
			tp1_home_total_interest: 10000
		};
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: [
				person('LOWER_PRICE', [claim('HOME_INTEREST', 10000)], elections),
				person('UPPER_PRICE', [claim('HOME_INTEREST', 10000)], {
					...elections,
					tp1_home_price: 500001
				}),
				person('JOINT', [claim('HOME_INTEREST', 6000)], elections),
				person('ACTUAL_BELOW_CAP', [claim('HOME_INTEREST', 1000)], {
					...elections,
					tp1_home_total_interest: 1000
				})
			]
		});
		expectStatutory(book, 'LOWER_PRICE', 'PCB', 75.1, 0);
		expectStatutory(book, 'UPPER_PRICE', 'PCB', 85.1, 0);
		expectStatutory(book, 'JOINT', 'PCB', 89.1, 0); // 7,000 × 6,000 / 10,000 = 4,200.
		expectStatutory(book, 'ACTUAL_BELOW_CAP', 'PCB', 105.1, 0);
	});

	test(`${code} — conflicting recurring claims and incomplete housing facts stop payroll`, () => {
		for (const [category, earlier] of [
			['BREASTFEEDING', '2025-01'],
			['COMPOST', '2025-01'],
			['FOOD_GRINDER_CCTV', '2025-01']
		] as const)
			assert.throws(
				() =>
					buildStatutory({
						code,
						period: '2026-01',
						people: [person('REPEAT', [claim(category, 500), claim(category, 500, earlier)])]
					}),
				/claim interval/
			);
		assert.throws(
			() =>
				buildStatutory({
					code,
					period: '2026-01',
					people: [person('MISSING_HOME', [claim('HOME_INTEREST', 1000)])]
				}),
			/first-home/i // the declaration is required once interest is claimed (round 5, D15)
		);
	});
}

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — TP1 reduces normal and additional remuneration tax in a bonus month`, () => {
		// EPF 3,999.93 (K2 312.63) + personal 9,000 + TP1 2,500; no SOCSO/EIS relief without a
		// TP1 claim. Normal P=44,512.07: tax=1,170.7242; normal MTD=97.56 → 97.60.
		// With 12,000 additional pay (Kt 1,320, K2 192.63) P=56,512.07: tax=2,216.32.
		// Additional MTD=2,216.32 - 12×97.60=1,045.12 → 1,045.15; total=1,142.75.
		const book = assessStatutory(
			{ code, period: '2026-01', people: [person('BONUS', [claim('LIFESTYLE', 3000)])] },
			(world) => {
				const settings = settingsVersions(code).find((row) =>
					String(row.effective_range.start).startsWith('2025-12')
				)!;
				const bonus = world.adhoc_catalogue!.find(
					(row) => row.code === 'ADJ' && row.settings_id === settings.id
				)!;
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-00000000ad19',
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: 12000,
					event_date: '2026-01-01',
					pay_period: null,
					payslip_id: null,
					reason: 'Synthetic bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		expectStatutory(book, 'BONUS', 'PCB', 1142.75, 0);
	});

for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code} — direct TP1 rebates affect tax without adding a payslip deduction`, () => {
		const levy = { ...claim('DEPARTURE_LEVY', 40), event_reference: 'Journey A' };
		const people = [
			person('DIRECT', [claim('ZAKAT_EXTERNAL', 100)]),
			person('LEVY', [levy], { tp1_departure_levy_claims_before_year: 1 }),
			person('BOTH', [claim('ZAKAT_EXTERNAL', 100), levy], {
				tp1_departure_levy_claims_before_year: 0
			}),
			person('FUTURE', [claim('ZAKAT_EXTERNAL', 100, '2026-02')]),
			person('OLD', [claim('ZAKAT_EXTERNAL', 100, '2025-12')])
		];
		const built = buildStatutory({ code, period: '2026-01', people });
		for (const [key, expected, rebate] of [
			['DIRECT', 10.1, 100],
			['LEVY', 70.1, 40],
			['BOTH', 0, 140],
			['FUTURE', 110.1, 0],
			['OLD', 110.1, 0]
		] as const) {
			const slip = built.slips.get(key)!;
			const tax = slip.statutory.find((row) => row.scheme_code === 'PCB')!;
			assert.equal(tax.employee_amount, expected, key);
			assert.equal(tax.rebate_amount, rebate, key);
			assert.equal(slip.gross, 5001, 'external payments are not employer-paid remuneration');
			assert.equal(
				slip.total_deductions,
				Math.round(slip.statutory.reduce((sum, row) => sum + row.employee_amount, 0) * 100) / 100
			);
		}
	});

	test(`${code} — excess external rebates carry once through settled tax history`, () => {
		const people = [person('HISTORY', [claim('ZAKAT_EXTERNAL', 1000)])];
		const january = buildStatutory({ code, period: '2026-01', people });
		const prior = january.slips.get('HISTORY')!;
		assert.equal(prior.statutory.find((row) => row.scheme_code === 'PCB')!.rebate_amount, 1000);
		const february = assessStatutory({ code, period: '2026-02', people }, (world) => {
			world.payroll_runs.push({
				id: 'rebate-january',
				company_id: world.companies[0]!.id,
				period: '2026-01'
			});
			world.payslips.push({
				...prior,
				id: 'rebate-paid',
				payroll_run_id: 'rebate-january',
				status: 'PAID',
				paid_at: '2026-01-31'
			});
		});
		// February: (annual tax 1,320.72 - January rebate 1,000) / 11 = 29.156 => 29.15.
		expectStatutory(february, 'HISTORY', 'PCB', 29.15, 0);
	});

	test(`${code} — departure levy counts journeys with corrections and lifetime history`, () => {
		const levy = (reference: string, amount: number, event_reference: string) => ({
			...claim('DEPARTURE_LEVY', amount),
			reference,
			event_reference
		});
		const claims = [
			levy('A', 40, 'Trip A'),
			levy('B', 80, 'Trip B'),
			levy('B correction', -40, 'Trip B')
		];
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: [person('TWO', claims, { tp1_departure_levy_claims_before_year: 0 })]
		});
		expectStatutory(book, 'TWO', 'PCB', 30.1, 0);
		for (const [key, input, elections, message] of [
			['THIRD', claims, { tp1_departure_levy_claims_before_year: 1 }, /two lifetime/],
			['UNKNOWN_HISTORY', claims, {}, /Earlier departure levy claims is required/],
			[
				'NO_JOURNEY',
				[claim('DEPARTURE_LEVY', 40)],
				{ tp1_departure_levy_claims_before_year: 0 },
				/journey reference/
			],
			[
				'PRIOR_EMPLOYER',
				[claim('ZAKAT_EXTERNAL', 100, '2026-01', 'PRIOR_EMPLOYER')],
				{},
				/opening rebate/
			],
			[
				'OVER_CORRECTED_JOURNEY',
				[levy('A', 40, 'Trip A'), levy('A correction', -80, 'Trip A'), levy('B', 100, 'Trip B')],
				{ tp1_departure_levy_claims_before_year: 0 },
				/linked journey/
			]
		] as const)
			assert.throws(
				() =>
					buildStatutory({ code, period: '2026-01', people: [person(key, [...input], elections)] }),
				message
			);
	});
}

for (const code of ['MY', 'MY-nihon'] as const) {
	const profile = (kind: string, first = 2026, last = 2030) => ({
		pcb_tax_profile: kind,
		pcb_approval_first_year: first,
		pcb_approval_last_year: last,
		pcb_approval_reference: `Synthetic ${kind} approval`,
		pcb_profile_conditions_confirmed: true
	});
	test(`${code} — approved 15-percent profiles use chargeable income and resident rebates`, () => {
		const cases = [
			{ ...person('REP', [], profile('REP')), wage: 5001 },
			{ ...person('KNOWLEDGE', [], profile('KNOWLEDGE_WORKER')), wage: 5001 },
			{
				...person('LOWER', [], profile('REP')),
				wage: 3500,
				registrations: {
					EPF: { kind: 'REGISTERED' },
					EPF_PR: OUT,
					EPF_NON_CITIZEN: OUT,
					SOCSO: { kind: 'REGISTERED' },
					EIS: { kind: 'REGISTERED' },
					PCB: { kind: 'REGISTERED', elections: profile('REP') }
				}
			},
			{
				...person('C_SUITE', [], profile('C_SUITE')),
				wage: 40000,
				citizenship: 'FOREIGN',
				registrations: {
					EPF: OUT,
					EPF_PR: OUT,
					EPF_NON_CITIZEN: { kind: 'REGISTERED' },
					SOCSO: { kind: 'REGISTERED' },
					EIS: { kind: 'REGISTERED' },
					PCB: { kind: 'REGISTERED', elections: profile('C_SUITE') }
				}
			},
			{
				...person('C_SUITE_MINIMUM', [], profile('C_SUITE')),
				wage: 25000,
				citizenship: 'FOREIGN',
				registrations: {
					EPF: OUT,
					EPF_PR: OUT,
					EPF_NON_CITIZEN: { kind: 'REGISTERED' },
					SOCSO: { kind: 'REGISTERED' },
					EIS: { kind: 'REGISTERED' },
					PCB: { kind: 'REGISTERED', elections: profile('C_SUITE') }
				}
			}
		];
		const book = assessStatutory({ code, period: '2026-01', people: cases });
		// 15% of P, the s.6A RM400 rebate at P ≤ 35,000; EPF relieved (K2 truncated, E(1)), SOCSO/EIS
		// not without a TP1 claim (MTD spec 2026 D.2(ii) item k):
		// REP/KNOWLEDGE 5,001: P = 60,012 − 3,999.93 − 9,000 = 47,012.07 → 7,051.81 ÷ 12 → 587.65.
		// LOWER 3,500: P = 42,000 − 3,999.93 − 9,000 = 29,000.07 → 4,350.01 − 400 ÷ 12 → 329.20.
		expectStatutory(book, 'REP', 'PCB', 587.65, 0);
		expectStatutory(book, 'KNOWLEDGE', 'PCB', 587.65, 0);
		expectStatutory(book, 'LOWER', 'PCB', 329.2, 0);
		// The approved non-citizen C-suite: Part F EPF 800, K2 290.90: P = 480,000 − 3,999.90 −
		// 9,000 = 467,000.10 → 70,050.015 ÷ 12 = 5,837.50.
		expectStatutory(book, 'C_SUITE', 'PCB', 5837.5, 0);
		// P.U. (A) 242/2023 r.5(d): RM25,000 basic is the inclusive minimum. EPF 500, K2 318.18:
		// P = 300,000 − 3,999.98 − 9,000 = 287,000.02 → 43,050.003 ÷ 12 = 3,587.50.
		expectStatutory(book, 'C_SUITE_MINIMUM', 'PCB', 3587.5, 0);
	});

	test(`${code} — approved profile additional pay is included once in the annual projection`, () => {
		const employee = {
			...person('BONUS_PROFILE', [], profile('REP')),
			wage: 3500,
			registrations: {
				EPF: { kind: 'REGISTERED' },
				EPF_PR: OUT,
				EPF_NON_CITIZEN: OUT,
				SOCSO: { kind: 'REGISTERED' },
				EIS: { kind: 'REGISTERED' },
				PCB: { kind: 'REGISTERED', elections: profile('REP') }
			}
		};
		const book = assessStatutory({ code, period: '2026-01', people: [employee] }, (world) => {
			const setting = settingsVersions(code).find((row) =>
				String(row.effective_range.start).startsWith('2025-12')
			)!;
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'ADJ' && row.settings_id === setting.id
			)!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-00000000ad25',
				employment_id: world.employments[0]!.id,
				catalogue_id: bonus.id,
				amount: 12000,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: 'Synthetic approved-profile bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		});
		// The bonus is projected once; EPF (1,705 on 15,500, K2 208.63 → 3,999.93) reduces chargeable
		// income, SOCSO/EIS do not without TP1: P = 54,000 − 3,999.93 − 9,000 = 41,000.07 → 15% =
		// 6,150.01 ÷ 12 = 512.50.
		expectStatutory(book, 'BONUS_PROFILE', 'PCB', 512.5, 0);
	});

	test(`${code} — profile approval bounds and unrestricted gross-rate overrides are validated`, () => {
		for (const [elections, citizenship, message] of [
			[{ pcb_tax_profile: 'REP' }, 'CITIZEN', /approved assessment year/i],
			[profile('REP', 2020, 2024), 'CITIZEN', /approval years/],
			[profile('REP', 2026, 2032), 'CITIZEN', /five consecutive/],
			[profile('REP', 2026, 2028), 'CITIZEN', /five consecutive/],
			[profile('C_SUITE', 2026, 2028), 'FOREIGN', /five consecutive/],
			[
				{ ...profile('KNOWLEDGE_WORKER'), pcb_profile_conditions_confirmed: false },
				'CITIZEN',
				/current employee, employer, location/i
			],
			[{ ...profile('REP'), pcb_approval_reference: '' }, 'CITIZEN', /approval reference/i],
			[profile('REP'), 'FOREIGN', /citizen/],
			[profile('C_SUITE'), 'CITIZEN', /non-citizen/]
		] as const)
			assert.throws(
				() =>
					buildStatutory({
						code,
						period: '2026-01',
						people: [{ ...person('INVALID', [], elections), citizenship }]
					}),
				message
			);
		assert.throws(
			() =>
				buildStatutory({
					code,
					period: '2026-01',
					people: [
						{ ...person('LOW_CS', [], profile('C_SUITE')), wage: 24999, citizenship: 'FOREIGN' }
					]
				}),
			/RM25,000/
		);
		assert.throws(
			() =>
				buildStatutory({
					code,
					period: '2026-01',
					people: [
						{
							...person('OVERRIDE', []),
							registrations: { PCB: { kind: 'REGISTERED', rate_override: 15 } }
						}
					]
				}),
			/approved PCB tax profile/
		);
	});
}
