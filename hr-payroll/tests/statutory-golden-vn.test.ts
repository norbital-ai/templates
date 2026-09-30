/**
 * Vietnam: expected payslips against the law itself.
 *
 * Law on Social Insurance 41/2024/QH15 arts.31, 33 and 34; Law on Health Insurance as amended by
 * Law 51/2024/QH15; Law on Employment 74/2025/QH15 (38/2013/QH13 to 31 December 2025); Trade Union
 * Law 50/2024/QH15 art.29; PIT Law 04/2007/QH12 art.22 with Resolution 954/2020/UBTVQH14, PIT Law
 * 109/2025/QH15 art.9 and art.29(2) with Resolution 110/2025/UBTVQH15; Circular 111/2013/TT-BTC
 * art.7 and art.25(1)(b); Decree 74/2024/NĐ-CP and Decree 293/2025/NĐ-CP (regional minimum wages);
 * Decree 161/2026/NĐ-CP (the 2,530,000 reference level from 1 July 2026).
 *
 * Every figure here is the statute's own monthly figure. Personal income tax is withheld month by
 * month on the MONTHLY progressive table (Circular 111/2013 art.25(1)(b)) over the month's income
 * net of the month's own SI, HI and UI (art.7) and the monthly family deduction — so a January run,
 * a run with year-to-date on file and a standalone July run all land on the same table figure. The
 * year-end finalisation (Gap #38) is a separate reckoning the seed does not carry.
 *
 * Every contribution and withholding is a whole đồng: the currency has no minor unit, VSS bills and
 * the tax return (Circular 80/2021/TT-BTC) carry whole đồng, so each rule rounds with `round_unit`.
 * The engine's own money — the prorated base, an overtime line, gross and net — is still kept to
 * two decimals (`cents()` in `rounding.ts` is currency-blind); the goldens below pin that too.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COMPANY,
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	settingsVersions,
	settingsIdOn,
	contributionSchemes,
	leaveCatalogue,
	adhocCatalogue,
	rowIn,
	COMPANY_ID,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';
import { evaluateNumber, expressionEngine } from '../src/lib/expressions/evaluate.ts';
import { restBreakAssessment } from '../src/lib/scheduling/rest-break.ts';

const VN_PEOPLE = [
	{ key: 'VN-20M', wage: 20_000_000, age: 25, citizenship: 'CITIZEN' },
	{ key: 'VN-46.8M', wage: 46_800_000, citizenship: 'CITIZEN' },
	{ key: 'VN-60M', wage: 60_000_000, age: 55, citizenship: 'CITIZEN' },
	{ key: 'VN-FOREIGN', wage: 20_000_000, citizenship: 'FOREIGNER' }
];

for (const period of ['2025-12', '2026-01', '2026-06', '2026-07', '2026-12'])
	test(`Vietnam — declared non-residence selects 20% in ${period} without an override`, () => {
		// Circular 111/2013 art.18 and Law 109/2025 art.21: salary 20m × 20%.
		// No personal, dependant or insurance deduction; nationality does not determine residence.
		const book = assessStatutory({
			code: 'VN',
			period,
			region: 'I',
			people: [
				{
					key: 'NONRES-FOREIGN',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT',
					children: 2
				},
				{
					key: 'NONRES-CITIZEN',
					wage: 20_000_000,
					citizenship: 'CITIZEN',
					tax_residency: 'NON_RESIDENT',
					registrations: {
						PIT: { kind: 'REGISTERED', rate_override: 15, elections: { commitment_form: true } }
					}
				}
			]
		});
		expectStatutory(book, 'NONRES-FOREIGN', 'PIT', 4_000_000, 0);
		expectStatutory(book, 'NONRES-CITIZEN', 'PIT', 4_000_000, 0);
	});

test('Vietnam — short contracts do not replace non-resident withholding with the resident 10% rule', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{
				key: 'NONRES-SHORT',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				tax_residency: 'NON_RESIDENT',
				hire_date: '2026-06-01',
				exit_date: '2026-07-31',
				exit_reason: 'END_OF_CONTRACT'
			}
		]
	});
	// A foreigner on a two-month contract is outside SI and HI (Law 41/2024 art.2(2)) and owed the
	// employer's 17.5% + 3% of 20,000,000 = 4,100,000 as wages (LC art.168(3)); 20% of 24,100,000.
	expectStatutory(book, 'NONRES-SHORT', 'PIT', 4_820_000, 0);
});

test('Vietnam — SI, HI, UI and the union fee under the 1 January 2026 version', () => {
	// Region I: `companies.region` picks the minimum wage the UI cap is a multiple of.
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Social insurance: employee 8%, employer 17.5% (3% sickness-maternity + 0.5% occupational +
	// 14% retirement and survivorship), capped at 20 × the reference level 2,340,000 = 46,800,000.
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-46.8M', 'SI', 3_744_000, 8_190_000); // exactly on the ceiling
	expectStatutory(book, 'VN-60M', 'SI', 3_744_000, 8_190_000); // capped

	// Health insurance: 4.5% total, employee 1.5% / employer 3%, on the same ceiling.
	expectStatutory(book, 'VN-20M', 'HI', 300_000, 600_000);
	expectStatutory(book, 'VN-46.8M', 'HI', 702_000, 1_404_000);
	expectStatutory(book, 'VN-60M', 'HI', 702_000, 1_404_000);

	// Unemployment insurance: 1% each side, capped at 20 × the REGIONAL minimum wage — Region I
	// from 1 January 2026 is 5,310,000, so the cap is 106,200,000 and never binds here.
	expectStatutory(book, 'VN-20M', 'UI', 200_000, 200_000);
	expectStatutory(book, 'VN-46.8M', 'UI', 468_000, 468_000);
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);
	// Law 74/2025 covers Vietnamese citizens: a foreign employee is outside the scheme entirely.
	expectStatutorySkipped(book, 'VN-FOREIGN', 'UI');
	// Social and health insurance reach a foreign employee like anyone else (Law 41/2024 art.2(2)).
	expectStatutory(book, 'VN-FOREIGN', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-FOREIGN', 'HI', 300_000, 600_000);

	// Union budget contribution: 2% of the social-insurance salary fund, employer only, same cap.
	// Law on Trade Unions 2024 art.29(1)(b): the employer's 2% is on the establishment's SI salary
	// fund — one company line, not a charge on any payslip: 20,000,000 + 46,800,000 + 46,800,000
	// (capped) + 20,000,000 = 133,600,000 × 2% = 2,672,000.
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 2_672_000);
	assert.equal(book.get('VN-20M')!.get('UNION_FEE'), undefined);
});

test('Vietnam — the contribution floor is the reference level (calculation-only; Law 41/2024 art.31(1)(đ))', () => {
	// A wage under 2,340,000 contributes on 2,340,000 for SI, HI, the union fee and, since Law
	// 41/2024 art.31(1)(đ) makes the UI base the SI base, UI too. 2,340,000 × 8% = 187,200, × 17.5%
	// = 409,500, × 1.5% = 35,100, × 3% = 70,200, × 2% = 46,800, × 1% = 23,400.
	// The payable run refuses this under-minimum full-time contract; price the insurance formula alone.
	const january = assessStatutoryUnvalidated({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [{ key: 'VN-2M', wage: 2_000_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(january, 'VN-2M', 'SI', 187_200, 409_500);
	expectStatutory(january, 'VN-2M', 'HI', 35_100, 70_200);
	expectStatutory(january, COMPANY, 'UNION_FEE', 0, 46_800);
	expectStatutory(january, 'VN-2M', 'UI', 23_400, 23_400);
	expectStatutory(january, 'VN-2M', 'PIT', 0, 0);
	// From 1 July 2026 the floor is 2,530,000: × 8% = 202,400, × 17.5% = 442,750, × 1.5% = 37,950,
	// × 3% = 75,900, × 2% = 50,600.
	const july = assessStatutoryUnvalidated({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'VN-2M', wage: 2_000_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(july, 'VN-2M', 'SI', 202_400, 442_750);
	expectStatutory(july, 'VN-2M', 'HI', 37_950, 75_900);
	expectStatutory(july, COMPANY, 'UNION_FEE', 0, 50_600);
});

test('Vietnam — the unemployment ceiling follows the company region (Decree 293/2025)', () => {
	// Twenty times the regional minimum wage: Region II 4,730,000 → 94,600,000, Region III
	// 4,140,000 → 82,800,000, Region IV 3,700,000 → 74,000,000. A 120,000,000 wage is over all of them.
	const person = { key: 'VN-120M', wage: 120_000_000, citizenship: 'CITIZEN' };
	for (const [region, cap] of [
		['II', 946_000],
		['III', 828_000],
		['IV', 740_000]
	] as const) {
		const book = assessStatutory({ code: 'VN', period: '2026-01', region, people: [person] });
		expectStatutory(book, 'VN-120M', 'UI', cap, cap);
		// The SI ceiling does not read the region.
		expectStatutory(book, 'VN-120M', 'SI', 3_744_000, 8_190_000);
	}
	// The wages orders exclude a vocational trainee (Labour Code art.61); everyone else is covered.
	for (const version of settingsVersions('VN'))
		assert.equal(version.work_rules.wages.applies_when, 'employment.type != "INTERN"');
});

test('Vietnam — monthly PIT withholding on the 1 January 2026 scale', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Circular 111/2013 art.25(1)(b) withholds on the monthly table; the scale is the five-bracket
	// table of Law 109/2025 art.9 (≤10M at 5%, >10–30M at 10%, >30–60M at 20%, >60–100M at 30%,
	// >100M at 35%), applied from the 2026 tax period by art.29(2), over the month's income net of
	// the month's own SI, HI and UI and the 15,500,000 monthly personal deduction (Resolution
	// 110/2025).
	//
	// VN-20M: 20,000,000 − 2,100,000 (1,600,000 + 300,000 + 200,000) − 15,500,000 = 2,400,000 at
	// 5% = 120,000.
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
	// VN-46.8M: 46,800,000 − 4,914,000 − 15,500,000 = 26,386,000: 500,000 + 16,386,000 × 10% =
	// 2,138,600.
	expectStatutory(book, 'VN-46.8M', 'PIT', 2_138_600, 0);
	// VN-60M: 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000: 500,000 + 2,000,000 + 9,454,000 ×
	// 20% = 4,390,800.
	expectStatutory(book, 'VN-60M', 'PIT', 4_390_800, 0);
	// A resident foreign employee runs the same scale minus the UI they are outside:
	// 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 at 5% = 130,000.
	expectStatutory(book, 'VN-FOREIGN', 'PIT', 130_000, 0);
});

test('Vietnam — a dependant deducts 6,200,000 a month, and a non-resident is withheld at 20%', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'VN-46.8M-D1', wage: 46_800_000, citizenship: 'CITIZEN', children: 1 },
			{ key: 'VN-20M-D1', wage: 20_000_000, citizenship: 'CITIZEN', children: 1 },
			// Law 04/2007 art.26 (carried by Law 109/2025): a non-resident's salary is taxed at a
			// flat 20% with no deductions; the registration's rate override carries the election.
			{
				key: 'VN-NR-20M',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				registrations: { PIT: { kind: 'REGISTERED', rate_override: 20 } }
			}
		]
	});
	// Resolution 110/2025: 6,200,000 a month per dependant. 46,800,000 − 4,914,000 − 15,500,000 −
	// 6,200,000 = 20,186,000: 500,000 + 10,186,000 × 10% = 1,518,600.
	expectStatutory(book, 'VN-46.8M-D1', 'PIT', 1_518_600, 0);
	// 20,000,000 − 2,100,000 − 21,700,000 is negative: nothing is withheld.
	expectStatutory(book, 'VN-20M-D1', 'PIT', 0, 0);
	expectStatutory(book, 'VN-NR-20M', 'PIT', 4_000_000, 0);
});

test('Vietnam — July PIT uses registered eligible dependants, not the employee profile count (Decree 253/2026 arts.47–48)', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{
				key: 'PROFILE-ONLY',
				wage: 46_800_000,
				citizenship: 'CITIZEN',
				children: 1,
				registrations: { PIT: { kind: 'REGISTERED', elections: { eligible_dependents: 0 } } }
			},
			{
				key: 'REGISTERED-OTHER',
				wage: 46_800_000,
				citizenship: 'CITIZEN',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						elections: {
							eligible_dependents: 1,
							dependents_registration_reference: 'REGISTERED-PARENT'
						}
					}
				}
			}
		]
	});
	expectStatutory(book, 'PROFILE-ONLY', 'PIT', 2_138_600, 0);
	expectStatutory(book, 'REGISTERED-OTHER', 'PIT', 1_518_600, 0);
	assert.throws(
		() =>
			assessStatutory({
				code: 'VN',
				period: '2026-07',
				region: 'I',
				people: [
					{
						key: 'NO-REGISTRATION-EVIDENCE',
						wage: 46_800_000,
						citizenship: 'CITIZEN',
						registrations: {
							PIT: {
								kind: 'REGISTERED',
								elections: { eligible_dependents: 1 }
							}
						}
					}
				]
			}),
		/Dependant registration and eligibility evidence reference is required/
	);
});

test('Vietnam — February relieves February’s insurance, not the year’s (Circular 111/2013 art.7)', () => {
	// The monthly table is applied to the month's income net of the insurance deducted from that
	// month's pay. With January on file the relief must still be one month's 2,100,000, and the
	// withholding the same 120,000 as January's.
	const book = assessStatutory(
		{ code: 'VN', period: '2026-02', region: 'I', people: [VN_PEOPLE[0]!] },
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'VN-20M');
			assert.ok(employment);
			world.payroll_runs.push({ id: 'prior-2026-01', company_id: COMPANY_ID, period: '2026-01' });
			world.payslips.push({
				id: 'payslip-2026-01',
				payroll_run_id: 'prior-2026-01',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-01-28T00:00:00.000Z',
				currency: 'VND',
				base: [],
				adjustments: [],
				statutory: [
					['PIT', 120_000, 0],
					['SI', 1_600_000, 3_500_000],
					['HI', 300_000, 600_000],
					['UI', 200_000, 200_000],
					['UNION_FEE', 0, 400_000]
				].map(([scheme_code, employee_amount, employer_amount]) => ({
					scheme_code,
					employee_amount,
					employer_amount,
					base_amount: 20_000_000,
					rule_when: null,
					authority: null
				}))
			});
		}
	);
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
});

test('Vietnam — the 1 July 2026 version raises the ceiling and exempts the overtime wage', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-07', people: VN_PEOPLE, region: 'I' });

	// Decree 161/2026 raises the reference level to 2,530,000, so the SI/HI ceiling becomes 20 ×
	// 2,530,000 = 50,600,000: 8% = 4,048,000 and 17.5% = 8,855,000; 1.5% = 759,000 and 3% = 1,518,000.
	expectStatutory(book, 'VN-60M', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-60M', 'HI', 759_000, 1_518_000);
	// The fund: 20,000,000 + 46,800,000 + 50,600,000 (capped) + 20,000,000 = 137,400,000 × 2%.
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 2_748_000);
	// The regional minimum did not move on 1 July, so UI is unchanged.
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);

	// The same monthly table, over the month's own insurance. A standalone July run has no
	// year-to-date and needs none: VN-20M and VN-46.8M are unchanged at 120,000 and 2,138,600; VN-60M
	// relieves the higher capped insurance, 60,000,000 − 5,407,000 (4,048,000 + 759,000 + 600,000) −
	// 15,500,000 = 39,093,000: 2,500,000 + 9,093,000 × 20% = 4,318,600.
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
	expectStatutory(book, 'VN-46.8M', 'PIT', 2_138_600, 0);
	expectStatutory(book, 'VN-60M', 'PIT', 4_318_600, 0);
});

test('Vietnam — the December 2025 version, and the regional cap that moves off it', () => {
	// The first sealed version: Decree 74/2024 regional minimum wages, the 2,340,000 reference
	// level, and the Resolution 954/2020 family deductions of 11,000,000 / 4,400,000 a month.
	// A wage of 120,000,000 is the only way to see the unemployment ceiling, which is the one
	// figure the 1 January 2026 version actually moves.
	// Each authorised this employer to finalise the year (Decree 126/2020 art.8(6)(d)): without
	// it December stays on the monthly table — which for these steady years is the same figure.
	const finalise = {
		PIT: { kind: 'REGISTERED', elections: { finalisation_authorised: true } }
	} as const;
	const people = [
		{ key: 'VN-20M', wage: 20_000_000, citizenship: 'CITIZEN', registrations: finalise },
		{ key: 'VN-120M', wage: 120_000_000, citizenship: 'CITIZEN', registrations: finalise },
		{ key: 'VN-200M', wage: 200_000_000, citizenship: 'CITIZEN', registrations: finalise }
	];
	// December closes the tax year: the last payslip charges the annual scale on the year's income
	// less what the year withheld (Law 04/2007 art.22 with Circular 111/2013 art.25), so the
	// eleven earlier months stand on file at the monthly figures the table gives.
	const december = assessStatutory(
		{ code: 'VN', period: '2025-12', people, region: 'I' },
		(world) => {
			for (const [index, key] of ['VN-20M', 'VN-120M', 'VN-200M'].entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				const wage = people[index]!.wage;
				const monthly = {
					'VN-20M': [2_100_000, 440_000],
					'VN-120M': [5_438_000, 26_396_700],
					'VN-200M': [5_438_000, 54_396_700]
				}[key]!;
				for (let month = 1; month <= 11; month += 1) {
					const period = `2025-${String(month).padStart(2, '0')}`;
					if (index === 0)
						world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
					world.payslips.push({
						id: `payslip-${key}-${period}`,
						payroll_run_id: `prior-${period}`,
						employment_id: employment.id,
						status: 'PAID',
						paid_at: `${period}-28T00:00:00.000Z`,
						currency: 'VND',
						base: [],
						adjustments: [],
						statutory: [
							// The year's compulsory insurance is read from the slips, not multiplied from
							// December's, so the earlier months carry their own (all under SI here).
							{
								scheme_code: 'SI',
								employee_amount: monthly[0],
								employer_amount: 0,
								base_amount: wage,
								rule_when: null,
								authority: null
							},
							{
								scheme_code: 'PIT',
								employee_amount: monthly[1],
								employer_amount: 0,
								base_amount: wage,
								rule_when: null,
								authority: null
							}
						]
					});
				}
			}
		}
	);
	const january = assessStatutory({ code: 'VN', period: '2026-01', people, region: 'I' });

	// Social and health insurance did not move: 8% / 17.5% and 1.5% / 3% on the same twenty times
	// the 2,340,000 reference level = 46,800,000 ceiling.
	expectStatutory(december, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(december, 'VN-120M', 'SI', 3_744_000, 8_190_000);
	expectStatutory(december, 'VN-120M', 'HI', 702_000, 1_404_000);
	// The fund over the three people: 20,000,000 + 46,800,000 + 46,800,000 (both capped) = 113,600,000 × 2%.
	expectStatutory(december, COMPANY, 'UNION_FEE', 0, 2_272_000);

	// Unemployment insurance is 1% each side, capped at twenty times the REGIONAL minimum wage.
	// Region I is 4,960,000 to 31 December 2025 (Decree 74/2024) → cap 99,200,000 → 992,000, and
	// 5,310,000 from 1 January 2026 (Decree 293/2025, +7.2%) → cap 106,200,000 → 1,062,000.
	expectStatutory(december, 'VN-120M', 'UI', 992_000, 992_000);
	expectStatutory(january, 'VN-120M', 'UI', 1_062_000, 1_062_000);

	// PIT on the seven-rung table of Law 04/2007 art.22 (≤5M 5%, >5–10M 10%, >10–18M 15%,
	// >18–32M 20%, >32–52M 25%, >52–80M 30%, >80M 35%) with the 11,000,000 monthly deduction.
	// The year: VN-20M earned 240,000,000, less 25,200,000 insurance and 132,000,000 deductions =
	// 82,800,000 on the annual scale (≤60M 5%, then 10%): 3,000,000 + 2,280,000 = 5,280,000; the
	// eleven months withheld 4,840,000, so December charges 440,000 — the monthly figure, because
	// a steady year annualises to itself.
	expectStatutory(december, 'VN-20M', 'PIT', 440_000, 0);
	// VN-120M: 1,440,000,000 − 65,256,000 − 132,000,000 = 1,242,744,000: 217,800,000 + 282,744,000
	// × 35% = 316,760,400, less 11 × 26,396,700 = 26,396,700.
	expectStatutory(december, 'VN-120M', 'PIT', 26_396_700, 0);
	// VN-200M: 2,400,000,000 − 65,256,000 − 132,000,000 = 2,202,744,000: 217,800,000 +
	// 1,242,744,000 × 35% = 652,760,400, less 11 × 54,396,700 = 54,396,700.
	expectStatutory(december, 'VN-200M', 'PIT', 54_396_700, 0);
});

test('Vietnam — the đồng above the ceiling is charged on the ceiling', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'VN-50600000.01', wage: 50_600_000.01 }]
	});
	// 20 × 2,530,000 = 50,600,000: SI 8% / 17.5%, HI 1.5% / 3%, union 2% employer, all on the cap.
	expectStatutory(book, 'VN-50600000.01', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-50600000.01', 'HI', 759_000, 1_518_000);
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 1_012_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Labour Code 2019: the pay side. The world's shift is 09:00–18:00 with a sixty-minute break —
// eight normal hours, Monday to Friday, Saturday and Sunday rest days — and the version's ordinary
// divisor is `period.working_days` (Decree 145/2020 art.54(1)(a): the month's salary over the
// month's normal working days, then over eight hours). A public holiday on a scheduled working
// day is a working day — a paid one (art.112) — so it stays in the count. Wages are chosen so the
// hourly rate is a round 100,000: 22 working days × 8 h × 100,000 = 17,600,000 for January 2026.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const VN_2026_JAN = settingsIdOn('VN', '2026-01-15');
const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
/** `HH:MM` one hour later, for the break that separates two worked intervals. */
const anHourLater = (time: string) => {
	const minutes = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + 60) % 1440;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
/**
 * A punch from `start` to `end` on `date`, in Hồ Chí Minh City's +07:00 frame. `mealStart` names the
 * hour the shift's break is taken: only a gap between worked intervals proves it, so a break the
 * punches do not show is worked time (BLLĐ 2019 art.109(1), art.84(b)).
 */
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	mealStart?: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const at = (from: string, to: string) => ({
		start: `${date}T${from}:00+07:00`,
		end: `${date}T${to}:00+07:00`
	});
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals:
			mealStart == null
				? [at(start, end)]
				: [at(start, mealStart), at(anHourLater(mealStart), end)],
		approval_id: null
	});
};

test('Vietnam — non-resident overtime exemption changes on 1 July, independently of the resident tax year', () => {
	for (const [period, workDate, wage, base, tax] of [
		['2026-06', '2026-06-08', 17_600_000, 17_800_000, 3_560_000],
		['2026-07', '2026-07-06', 18_400_000, 18_400_000, 3_680_000]
	] as const) {
		// 22 June / 23 July weekdays × 8 hours give a VND100,000 ordinary hour.
		// Two OT hours pay 300,000. Before July only the 100,000 premium is exempt;
		// from July the full statutory 300,000 is exempt (Decree 253/2026 arts.26,69).
		const { slips } = buildStatutory(
			{
				code: 'VN',
				period,
				region: 'I',
				people: [
					{
						key: 'NONRES-OT',
						wage,
						citizenship: 'FOREIGNER',
						tax_residency: 'NON_RESIDENT'
					}
				]
			},
			(world) => punch(world, 'NONRES-OT', workDate, '09:00', '20:00', '13:00')
		);
		assert.deepEqual(charge(slips.get('NONRES-OT')!, 'PIT'), [base, tax, 0]);
	}
});

test('Vietnam — leave exemption respects residence commencement and a future departure is not cessation', () => {
	const versions = new Map(settingsVersions('VN').map((row) => [row.id, row]));
	for (const row of contributionSchemes('VN').filter((row) => row.code === 'PIT')) {
		const start = versions.get(row.settings_id).effective_range.start.slice(0, 10);
		for (const residency of ['RESIDENT', 'NON_RESIDENT']) {
			for (const exit of ['', '2026-12-31', '2025-11-30']) {
				const exempt =
					(start >= '2026-07-01' || (start >= '2026-01-01' && residency === 'RESIDENT')) &&
					exit !== '' &&
					exit <= start;
				const actual = evaluateNumber(expressionEngine, row.assessed_on, {
					BASE: 1000000,
					ALLOWANCES: 0,
					ADHOC: 0,
					OVERTIME: 0,
					OVERTIME_PREMIUM: 0,
					ENCASHMENT: 100000,
					INCENTIVE: 0,
					NIGHT_WAGE: 0,
					ABSENCE: 0,
					NO_PAY_LEAVE: 0,
					// The PIT parts (Decree 253/2026 art.8(2)(g)-(h)); no meal or rent here.
					MEAL: { ALLOWANCES: 0, ADHOC: 0 },
					HOUSING: { ALLOWANCES: 0, ADHOC: 0 },
					person: { terms: { tax_residency: residency }, employment: { exit_date: exit } },
					period: { end: start }
				});
				assert.equal(actual, exempt ? 1000000 : 1100000, `${start} ${residency} exit=${exit}`);
			}
		}
	}
});
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
/** The same five days, on a Monday, a Saturday, a holiday and a Monday into the night. */
const week = (
	world: PayrollWorld,
	key: string,
	month: string,
	days: readonly [string, string, string, string]
) => {
	const [monday, saturday, holidayDate, nightMonday] = days;
	world.jurisdiction_holidays.push(holiday(`${month}-${holidayDate}`, 'Holiday'));
	punch(world, key, `${month}-${monday}`, '09:00', '21:00', '13:00'); // 11 worked: 3 h beyond the normal day
	punch(world, key, `${month}-${saturday}`, '09:00', '18:00'); // rest day: 9 h clock, no break taken, 9 h worked
	punch(world, key, `${month}-${holidayDate}`, '09:00', '18:00', '13:00'); // holiday: the normal day
	punch(world, key, `${month}-${nightMonday}`, '09:00', '24:00', '13:00'); // 14 worked: 6 h beyond, 2 of them at night
};

test('Vietnam — art.98 prices 150% / 200% / 300%, the night premium and the art.109 break', () => {
	const { slips, warnings, companyCharges } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'VN-17.6M', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			week(world, 'VN-17.6M', '2026-01', ['05', '10', '01', '12']);
			punch(world, 'VN-17.6M', '2026-01-17', '09:00', '17:00'); // rest day: 8 h clock, no break
		}
	);
	const slip = slips.get('VN-17.6M')!;
	assert.deepEqual(workLines(slip), [
		// Art.98(1)(c): every hour worked on a holiday at 300% of the hourly wage, on top of the
		// holiday's own paid day inside the month; the shift's sixty-minute break leaves eight.
		['2026-01-01', 'OT-3.0X', 8, 2_400_000],
		// Art.98(1)(a): the three hours beyond the normal day at 150%.
		['2026-01-05', 'OT-1.5X', 3, 450_000],
		// Art.98(1)(b): a rest day at 200% from its first hour. A time entry is a span, so the
		// seeded rule (BLLĐ 2019 art.109(1): `consecutive_hours >= 6.0` → 30 minutes, not worked
		// time) is deducted from the span less any gap. The nine continuous clocked hours carry the
		// provided half hour → 8.5 worked, in the seed's two rows (the normal day, then the half hour
		// beyond it, both at 200%).
		['2026-01-10', 'OT-2.0X', 8, 1_600_000],
		['2026-01-10', 'OT-2.0X', 0.5, 100_000],
		// Six hours beyond the normal day at 150%, and art.98(2)–(3) for the two of them after 22:00:
		// 30% of the hourly wage for night work plus 20% of the day-time unit price — which, the
		// night overtime following four daytime overtime hours, is the 150% hour (Decree 145
		// art.57(1)(b)): 60,000 an hour.
		['2026-01-12', 'NIGHT_PREMIUM', 2, 120_000],
		// Art.107(2)(b): four hours of overtime a day; Decree 253/2026 art.26(3) taxes the part
		// beyond, so the fifth and sixth hours are their own line at the same 150%.
		['2026-01-12', 'OT-1.5X', 4, 600_000],
		['2026-01-12', 'OT-1.5X', 2, 300_000],
		// An eight-hour rest-day clock (09:00–17:00) carries the seeded art.109(1) thirty minutes
		// → 7.5 worked at 200%.
		['2026-01-17', 'OT-2.0X', 7.5, 1_500_000]
	]);
	// Art.107(2)(b): overtime may not exceed 50% of the normal day — four hours. The sixth is paid
	// at the same rate and reported.
	assert.deepEqual(
		warnings.map((warning) => warning.split('.')[0]),
		['DAILY_OVERTIME_LIMIT_EXCEEDED: VN-17']
	);
	assert.equal(slip.gross, 17_600_000 + 6_950_000 + 120_000);
	// Social, health and unemployment insurance and the union fee read the salary alone (Labour Code
	// art.168, Circular 06/2021 art.30: the contractual wage, never overtime).
	assert.deepEqual(charge(slip, 'SI'), [17_600_000, 1_408_000, 3_080_000]);
	assert.deepEqual(charge(slip, 'HI'), [17_600_000, 264_000, 528_000]);
	assert.deepEqual(charge(slip, 'UI'), [17_600_000, 176_000, 176_000]);
	assert.deepEqual(companyCharges.get('UNION_FEE'), [17_600_000, 352_000]);
	// Law 109/2025 art.4(8), in force for salary income "từ kỳ tính thuế năm 2026" (art.29(2)):
	// overtime and night pay are exempt whole — except, under Decree 253/2026 art.26(3), the part
	// beyond the art.107 limits: the two hours past the four-hour day, 300,000, on their own line
	// (`INCENTIVE`). Base 17,600,000 + 300,000 = 17,900,000; tax (17,900,000 − 1,848,000 −
	// 15,500,000) × 5% = 27,600. (Law 04/2007 art.4(9) exempted only the part above the ordinary
	// rate; that is the December 2025 version.)
	assert.deepEqual(charge(slip, 'PIT'), [17_900_000, 27_600, 0]);
	assert.equal(slip.total_deductions, 1_875_600); // 1,408,000 + 264,000 + 176,000 + 27,600
	assert.equal(slip.net, 22_794_400); // 24,670,000 − 1,875,600
	// The union fund is the establishment’s line, not the payslip’s employer cost.
	assert.equal(slip.employer_cost, 3_080_000 + 528_000 + 176_000);
});

test('Vietnam — on the July 2026 version too, the overtime and night wage are outside PIT (Law 109/2025 art.4(8))', () => {
	// July 2026 has 23 weekdays, the holiday on Wednesday the 1st among them: 23 × 8 × 100,000.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-07',
			region: 'I',
			people: [{ key: 'VN-18.4M', wage: 18_400_000, citizenship: 'CITIZEN' }]
		},
		(world) => week(world, 'VN-18.4M', '2026-07', ['06', '11', '01', '13'])
	);
	const slip = slips.get('VN-18.4M')!;
	assert.deepEqual(
		workLines(slip).map((row) => [row[1], row[2], row[3]]),
		[
			['OT-3.0X', 8, 2_400_000],
			['OT-1.5X', 3, 450_000],
			// The rest day's nine continuous clocked hours carry the seeded art.109(1) thirty
			// minutes, so 8.5 are worked — the normal-day row then the half hour beyond it.
			['OT-2.0X', 8, 1_600_000],
			['OT-2.0X', 0.5, 100_000],
			['NIGHT_PREMIUM', 2, 120_000],
			['OT-1.5X', 4, 600_000],
			['OT-1.5X', 2, 300_000]
		]
	);
	// The third version's PIT base is BASE + the overrun beyond art.107 − ABSENCE − NO_PAY_LEAVE:
	// 18,400,000 + 300,000 − 1,932,000 (1,472,000 + 276,000 + 184,000) − 15,500,000 = 1,268,000
	// × 5% = 63,400; the four lawful hours stay outside.
	assert.deepEqual(charge(slip, 'SI'), [18_400_000, 1_472_000, 3_220_000]);
	assert.deepEqual(charge(slip, 'PIT'), [18_700_000, 63_400, 0]);
	assert.equal(slip.gross, 18_400_000 + 5_450_000 + 120_000);
});

test('Vietnam — a part month prorates on working days, an allowance with it, and unpaid leave leaves the allowance whole', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	const LUNCH = 'c1c1c1c1-0000-4000-8000-00000000000b';
	// January 2026 with no holiday planted: 22 working days on the Monday-to-Friday pattern.
	const { slips, allowances } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{ key: 'VN-WHOLE', wage: 22_000_000, citizenship: 'CITIZEN' },
				{ key: 'VN-NPL', wage: 22_000_000, citizenship: 'CITIZEN' },
				{ key: 'VN-JOINER', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
				{
					key: 'VN-LEAVER',
					wage: 22_000_000,
					citizenship: 'CITIZEN',
					exit_date: '2026-01-15',
					registrations: {
						PIT: {
							kind: 'REGISTERED',
							unit_assessments: [
								{
									period: '2026-01',
									gross: 11_370_000,
									units: 1,
									reference: 'FINAL-WAGE',
									paid_on: '2026-01-31'
								}
							]
						}
					}
				},
				// A base that does not divide: 20,000,000 × 10 ÷ 22 = 9,090,909.09.
				{ key: 'VN-JOINER-20M', wage: 20_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' }
			]
		},
		(world) => {
			world.allowance_catalogue.push({
				id: LUNCH,
				settings_id: VN_2026_JAN,
				code: 'LUNCH',
				name: 'Tiền ăn giữa ca',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				// Decree 158/2025 art.7(1)(c) with Circular 10/2020/TT-BLĐTBXH art.3(5)(c): a mid-shift
				// meal is a benefit, not a wage supplement, so outside the insurance salary; it is
				// salary income for PIT (Circular 111/2013 art.2(2)(g.5)) and counts toward that alone.
				fixed: false,
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['PIT'],
				approval_id: null
			});
			// Circular 111/2013 art.2(2)(g.5): the meal is taxable above 730,000 a month. The bank's
			// PIT row taxes every allowance a version carries; a version that adds a meal row states
			// the cap beside it, as this world does.
			for (const scheme of world.statutory_contributions)
				if (scheme.code === 'PIT' && scheme.settings_id === VN_2026_JAN)
					scheme.assessed_on = `${scheme.assessed_on} - (code('LUNCH') > 730000.0 ? 730000.0 : code('LUNCH'))`;
			for (const [index, employment] of world.employments.entries())
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: LUNCH,
					amount: 2_200_000,
					effective_from: '2025-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			world.leave_catalogue.push({
				id: NPL,
				settings_id: VN_2026_JAN,
				code: 'BEREAVEMENT_LEAVE_UNPAID',
				name: 'Nghỉ không hưởng lương',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: true,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			const employment = world.employments.find((row) => row.employee_number === 'VN-NPL')!;
			const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: NPL,
				leave_code: 'BEREAVEMENT_LEAVE_UNPAID',
				reference: 'NPL-1',
				from_date: '2026-01-14',
				to_date: '2026-01-14',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-14',
				reason: 'art.115(2)',
				allocations: [],
				charges: [
					{
						date: '2026-01-14',
						days: 1,
						catalogue_id: NPL,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				],
				approval_id: null
			});
		}
	);
	const facts = (key: string) => {
		const [segment, ...rest] = allowances.get(key)!;
		assert.equal(rest.length, 0, `${key}: one segment`);
		const line = slips
			.get(key)!
			.base.find((row) => row.component_code === segment!.component_code)!;
		assert.equal(line.amount, segment!.prorated_amount, `${key}: the line is the segment`);
		return [segment!.days, segment!.denominator, segment!.unpaid_days, segment!.prorated_amount];
	};
	const prorated = (key: string) =>
		slips
			.get(key)!
			.proration.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]);
	// `work_rules.proration` is WORKING_DAYS: a joiner on Monday the 19th takes 10 of January's 22,
	// a leaver on the 15th the 11 before it, on the salary and the allowance alike — one entry each.
	assert.deepEqual(prorated('VN-JOINER'), [[10, 22, 10_000_000]]);
	assert.deepEqual(facts('VN-JOINER'), [10, 22, 0, 1_000_000]);
	assert.deepEqual(prorated('VN-LEAVER'), [[11, 22, 11_000_000]]);
	assert.deepEqual(facts('VN-LEAVER'), [11, 22, 0, 1_100_000]);
	assert.deepEqual(facts('VN-WHOLE'), [22, 22, 0, 2_200_000]);
	// Art.115(2): the day is unpaid — one working day, 22,000,000 ÷ 22 = 1,000,000, off the salary,
	// and the allowance loses its day with it (2,200,000 ÷ 22 = 100,000): the deduction follows the
	// wage including the allowances (Decree 145/2020 art.55).
	assert.deepEqual(facts('VN-NPL'), [21, 22, 1, 2_100_000]);
	const absence = slips.get('VN-NPL')!.adjustments.find((row) => row.bucket === 'ABSENCE')!;
	assert.deepEqual([absence.quantity, absence.amount], [1, 1_000_000]);
	// The mid-shift meal is `fixed: false`, so it is outside the insurance salary (Circular 06/2021
	// art.30(3)) — `terms.fixed_allowances` does not carry it. Law 41/2024 art.33(5): one unpaid
	// working day is under the fourteen the cliff names, so the month insures on the whole
	// contractual salary, 22,000,000 × 8% = 1,760,000 / 17.5% = 3,850,000.
	assert.deepEqual(charge(slips.get('VN-NPL')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	// PIT: the meal is salary income above 730,000 (art.2(2)(g.5)): 22,000,000 + 2,200,000 −
	// 730,000 = 23,470,000; − 2,310,000 − 15,500,000 = 5,660,000 × 5% = 283,000.
	assert.deepEqual(charge(slips.get('VN-WHOLE')!, 'PIT'), [23_470_000, 283_000, 0]);
	// The đồng has no minor unit: a prorated base is a whole đồng, 20,000,000 × 10 ÷ 22 =
	// 9,090,909.09 → 9,090,909, on the segment as on the line.
	assert.deepEqual(prorated('VN-JOINER-20M'), [[10, 22, 9_090_909]]);
	assert.equal(slips.get('VN-JOINER-20M')!.gross, 9_090_909 + 1_000_000);
	// The part month. Law 41/2024 art.33(5): a month with fourteen or more unpaid working days
	// contributes nothing; fewer contributes on the whole contractual salary. The joiner has twelve
	// (2–16 January) and the leaver twelve (16–30), so both insure the whole 22,000,000 × 8% =
	// 1,760,000 / 17.5% = 3,850,000 (the scheme reads `person.period.working_days` less
	// `period.days_employed`), and the 20,000,000 joiner 1,600,000 / 3,500,000, 300,000 / 600,000
	// health.
	assert.deepEqual(charge(slips.get('VN-JOINER')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	assert.deepEqual(charge(slips.get('VN-LEAVER')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	assert.deepEqual(charge(slips.get('VN-JOINER-20M')!, 'SI'), [20_000_000, 1_600_000, 3_500_000]);
	assert.deepEqual(charge(slips.get('VN-JOINER-20M')!, 'HI'), [20_000_000, 300_000, 600_000]);
});

test('Vietnam — a contract that states its own divisor prorates on it; the floor still reads the contract month (Decree 145/2020 art.55(1)(a); Decree 293/2025 art.4)', () => {
	// No statute fixes a monthly-salary proration divisor (VN-PRORATE-01): art.55(1)(a) prices
	// overtime on the hours actually worked, Decree 293/2025 art.4 holds the full month's wage to
	// the floor. So the contract's divisor governs a part month; the version's working days only
	// where the contract states none. January 2026: 22 working days, 31 calendar days; a joiner on
	// Monday the 19th works 10 of the 22 and is employed 13 calendar days.
	const bases = {
		'VN-CAL': { by: 'CALENDAR_DAYS' },
		'VN-26': { by: 'FIXED_DAYS', days: 26 },
		'VN-26-WHOLE': { by: 'FIXED_DAYS', days: 26 },
		// Region I 5,310,000 (Decree 293/2025 art.3): 5,000,000 is under it whatever the divisor.
		'VN-26-LOW': { by: 'FIXED_DAYS', days: 26 }
	} as const;
	const run = (contractual: boolean, low = false) =>
		buildStatutory(
			{
				code: 'VN',
				period: '2026-01',
				region: 'I',
				people: [
					{ key: 'VN-DEFAULT', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
					{ key: 'VN-CAL', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
					{ key: 'VN-26', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
					{ key: 'VN-26-WHOLE', wage: 22_000_000, citizenship: 'CITIZEN' },
					...(low ? [{ key: 'VN-26-LOW', wage: 5_000_000, citizenship: 'CITIZEN' }] : [])
				]
			},
			(world) => {
				for (const employment of world.employments) {
					const basis = bases[employment.employee_number as keyof typeof bases];
					if (basis == null) continue;
					for (const term of world.employment_terms)
						if (term.employment_id === employment.id) term.proration = basis;
				}
				if (!contractual)
					for (const version of world.jurisdiction_settings)
						delete (version.work_rules as { proration_contractual?: boolean })
							.proration_contractual;
			}
		);
	const basic = (slips: ReturnType<typeof run>['slips'], key: string) =>
		slips
			.get(key)!
			.proration.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]);
	const { slips } = run(true);
	// No contract divisor: the version's working days, 22,000,000 × 10 ÷ 22 = 10,000,000.
	assert.deepEqual(basic(slips, 'VN-DEFAULT'), [[10, 22, 10_000_000]]);
	// Calendar days: 22,000,000 × 13 ÷ 31 = 9,225,806.45 → 9,225,806 (whole đồng).
	assert.deepEqual(basic(slips, 'VN-CAL'), [[13, 31, 9_225_806]]);
	// Twenty-six: 22,000,000 × 10 ÷ 26 = 8,461,538.46 → 8,461,538.
	assert.deepEqual(basic(slips, 'VN-26'), [[10, 26, 8_461_538]]);
	// A whole month on 26 is the whole salary, not 22 ÷ 26 of it.
	assert.deepEqual(basic(slips, 'VN-26-WHOLE'), [[26, 26, 22_000_000]]);
	// The floor still compares the contract month, whatever the divisor, and blocks the run
	// (Decree 293/2025 art.4): 5,000,000 is under Region I's 5,310,000.
	assert.throws(() => run(true, true), /MINIMUM_WAGE_BELOW: VN-26-LOW is contracted at 5000000/);
	// A version that does not leave the divisor to the contract ignores the terms' basis.
	const statutory = run(false).slips;
	assert.deepEqual(basic(statutory, 'VN-CAL'), [[10, 22, 10_000_000]]);
	assert.deepEqual(basic(statutory, 'VN-26'), [[10, 22, 10_000_000]]);
});

test('Vietnam — fourteen unpaid working days in the month is a month outside insurance (Law 41/2024 art.33(5))', () => {
	// January 2026 holds 22 working days; a leaver on Friday the 9th worked seven of them and is
	// unpaid for the fifteen after, so the month contributes nothing to social, health or
	// unemployment insurance, and the union fee that rides the same fund is nothing too. The wage
	// itself is still paid on the working days: 22,000,000 × 7 ÷ 22.
	const { slips } = buildStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{
				key: 'VN-EARLY',
				wage: 22_000_000,
				citizenship: 'CITIZEN',
				exit_date: '2026-01-09',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						unit_assessments: [
							{
								period: '2026-01',
								gross: 7_000_000,
								units: 1,
								reference: 'FINAL-WAGE',
								paid_on: '2026-01-31'
							}
						]
					}
				}
			}
		]
	});
	const slip = slips.get('VN-EARLY')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[7, 22, 7_000_000]]
	);
	for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
		assert.equal(
			slip.statutory.find((entry) => entry.scheme_code === code),
			undefined,
			`${code} charges nothing and carries no row`
		);
});

test('Vietnam — fourteen days of no-pay leave inside an employed month is the same month outside insurance', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	// The whole of January is employed, so `period.days_employed` is the month's 22 working days;
	// the fourteen the person did not receive wages for are the no-pay leave charged, which the
	// scheme reads as `person.period.unpaid_days`. Thirteen such days still insure the whole
	// contractual salary; the fourteenth takes the month out (Law 41/2024 art.33(5)).
	const build = (days: number) =>
		buildStatutory(
			{
				code: 'VN',
				period: '2026-01',
				region: 'I',
				people: [{ key: 'VN-NPL', wage: 22_000_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.leave_catalogue.push({
					id: NPL,
					settings_id: VN_2026_JAN,
					code: 'UNPAID_LEAVE',
					name: 'Nghỉ không hưởng lương',
					eligibility: '',
					evidence: 'NONE',
					evidence_after_days: null,
					entitlement: {
						availability: 'UNLIMITED',
						year_start_month: 1,
						proration: 'NONE',
						bands: []
					},
					is_npl: true,
					can_encash: false,
					bands: [],
					approval_id: null
				});
				const employment = world.employments.find((row) => row.employee_number === 'VN-NPL')!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				// Weekdays from Thursday 1 January, one charge a day, inside the run's attendance
				// window (the 21st to the 20th): fourteen of them end on Tuesday the 20th.
				const dates: string[] = [];
				for (let day = 1; dates.length < days; day += 1) {
					const date = `2026-01-${String(day).padStart(2, '0')}`;
					const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
					if (weekday !== 0 && weekday !== 6) dates.push(date);
				}
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-000000000002',
					employment_id: employment.id,
					catalogue_id: NPL,
					leave_code: 'UNPAID_LEAVE',
					reference: 'NPL-14',
					from_date: dates[0]!,
					to_date: dates.at(-1)!,
					half_day_start: false,
					half_day_end: false,
					days,
					effective_on: dates[0]!,
					reason: 'art.115(3)',
					allocations: [],
					charges: dates.map((date) => ({
						date,
						days: 1,
						catalogue_id: NPL,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				});
			}
		).slips.get('VN-NPL')!;
	const thirteen = build(13);
	assert.deepEqual(charge(thirteen, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	const fourteen = build(14);
	assert.equal(
		fourteen.adjustments
			.filter((row) => row.bucket === 'ABSENCE')
			.reduce((total, row) => total + row.amount, 0),
		14_000_000,
		'the fourteen days come off the salary at 1,000,000 a working day'
	);
	for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
		assert.equal(
			fourteen.statutory.find((entry) => entry.scheme_code === code),
			undefined,
			`${code} charges nothing and carries no row`
		);
});

test('Vietnam — June 2026 (the 16 May version, Decree 105/2026) charges the union fee at the same 2%', () => {
	// Decree 105/2026/NĐ-CP (in force 16 May 2026) moves when the union fee is paid, not what it
	// is: Law 50/2024 art.29(1)(b) still sets 2% of the SI salary fund. The reference level is
	// 2,340,000 to 30 June 2026 (cap 46,800,000). 20,000,000: SI 8% = 1,600,000 / 17.5% =
	// 3,500,000; the union fee 2% × 20,000,000 = 400,000, one company line.
	const book = assessStatutory({
		code: 'VN',
		period: '2026-06',
		region: 'I',
		people: [{ key: 'VN-20M', wage: 20_000_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 400_000);
});

for (const period of ['2026-06', '2026-09'])
	test(`Vietnam — ${period}: a union fee suspension zeroes the 2% and a reduction cuts it by the decided share (Decree 105/2026 arts.12–13)`, () => {
		// Decree 105/2026 art.13(3)(a): a suspension by decision, by month, at most 12 months — no
		// fee for that month. Art.12(3): a reduction of at most 20% of the art.29(1)(b) 2% fee:
		// 2% × 20,000,000 = 400,000 × (100 − 20)% = 320,000. The member's own dues are untouched.
		const people = [{ key: 'VN-20M', wage: 20_000_000, citizenship: 'CITIZEN' }];
		const fee = (companyFacts: Record<string, number | boolean>) =>
			assessStatutory({ code: 'VN', period, region: 'I', people, companyFacts });
		expectStatutory(fee({}), COMPANY, 'UNION_FEE', 0, 400_000);
		expectStatutory(fee({ union_fee_suspended: true }), COMPANY, 'UNION_FEE', 0, 0);
		expectStatutory(fee({ union_fee_reduction_percent: 20 }), COMPANY, 'UNION_FEE', 0, 320_000);
	});

test('every sealed version of `VN` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('VN');
});

test('Vietnam — a night hour of rest-day work adds 20% of the rest-day wage (art.98(3)), a night shift owes 45 minutes (art.109(1)), and the statutory holiday on the rest day is 300% (art.98(1)(c))', () => {
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'VN-NIGHT', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			// Sunday the 4th is the rest day and Tết Dương lịch's substitute stands elsewhere; a
			// holiday row on the rest day itself makes the day the statutory day under SUBSTITUTE.
			world.jurisdiction_holidays.push(holiday('2026-01-11', 'A holiday on the rest day'));
			const employment = world.employments.find((row) => row.employee_number === 'VN-NIGHT')!;
			world.work_days.push({
				id: 'wd-VN-NIGHT-2026-01-10',
				employment_id: employment.id,
				work_date: '2026-01-10',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-01-10T18:00:00+07:00', end: '2026-01-11T02:00:00+07:00' }
				],
				approval_id: null
			}); // Saturday rest day into the night
			punch(world, 'VN-NIGHT', '2026-01-11', '09:00', '13:00'); // the holiday on the rest day
		}
	);
	const lines = workLines(slips.get('VN-NIGHT')!);
	// 17,600,000 ÷ 22 ÷ 8 = 100,000 an hour. Saturday: eight hours on a rest day at 200%; four of
	// them after 22:00 (the interval runs to 02:00 the next morning, inside the 22:00–06:00
	// window) add 20% of the rest-day wage on the band, beside the 30% night premium's own line.
	// A time entry is a span: art.109(1) provides forty-five minutes on a six-hour night shift
	// (the seeded `consecutive_hours >= 6.0 && night_hours > 0.0` rule, not worked time), and no
	// gap proves one taken, so 8 − 45m = 7.25 hours are worked: the band pays
	// 7.25 × 200,000 + 4 × 20,000 = 1,530,000. (The deduction path currently measures no night
	// window, so it provisionally takes only the seeded 30-minute rule; the 45-minute figure is
	// the statute's and is asserted below.)
	const saturday = lines.filter((line) => line[0] === '2026-01-10' && line[1].startsWith('OT'));
	assert.equal(
		saturday.reduce((sum, line) => sum + line[2], 0),
		7.25,
		'the provided 45-minute night break comes off the span'
	);
	assert.equal(
		saturday.reduce((sum, line) => sum + line[3], 0),
		7.25 * 200_000 + 4 * 20_000
	);
	const owed = restBreakAssessment({
		intervals: [{ start: '2026-01-10T18:00:00+07:00', end: '2026-01-11T02:00:00+07:00' }],
		breakMinutes: 0,
		breaks: settingsVersions('VN').find((row) => row.id === settingsIdOn('VN', '2026-01-10'))!
			.work_rules.breaks,
		nightHours: 4
	});
	assert.equal(owed.requiredMinutes, 45);
	assert.equal(owed.shortfallMinutes, 45);
	assert.equal(owed.rule?.counts_as_worked_time, false);
	// Sunday: the statutory holiday falls on the rest day, and work on it is 300%: 4 × 300,000.
	assert.deepEqual(
		lines.filter((line) => line[0] === '2026-01-11'),
		[['2026-01-11', 'OT-3.0X-STATUTORY-DAY', 4, 1_200_000]]
	);
});

test('Vietnam — the 300-hour sector limit, the reduced accident rate and union dues turn on entity facts and elections', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		companyFacts: { occupational_accident_reduced: true, overtime_300h_sector: true },
		people: [
			{
				key: 'VN-MEMBER',
				wage: 17_600_000,
				citizenship: 'CITIZEN',
				registrations: { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } }
			},
			{ key: 'VN-NONMEMBER', wage: 17_600_000, citizenship: 'CITIZEN' }
		]
	});
	// Decree 58/2020 art.5: the employer's SI share is 17.3% where the reduced 0.3% accident rate
	// is granted: 17,600,000 × 17.3% = 3,044,800.
	expectStatutory(book, 'VN-MEMBER', 'SI', 1_408_000, 3_044_800);
	// Decision 61/QĐ-TLĐ (from 1 July 2025): a union member pays dues of 0.5% of the SI salary,
	// 17,600,000 × 0.5% = 88,000, under the 10%-of-reference-level cap; a non-member pays none.
	expectStatutory(book, 'VN-MEMBER', 'UNION_DUES', 88_000, 0);
	assert.equal(book.get('VN-NONMEMBER')!.get('UNION_DUES'), undefined);
});

test('Vietnam — a holiday on the rest day is the holiday, its substitute Monday the rest day (Decree 145/2020 art.55(3))', () => {
	// Giỗ Tổ Hùng Vương 2026 is Sunday 26 April, with Monday the 27th its substitute — the
	// calendar's shape for a holiday on a rest day (the bank seeds both rows). Eight clocked hours
	// on the Sunday with no gap: art.109(1)'s seeded thirty minutes (the day is a rest day with no
	// shift grant) come off the span, so 7.5 hours are worked and, the holiday coinciding with the
	// weekly rest day, they are paid as holiday overtime at 300%. Eight hours on the substitute:
	// rest-day overtime — 200%. The company cuts off on the 21st, so both days are in the May run;
	// each is priced at the hour of the month it was worked (art.55(1)(a)): April's 22 working
	// days, 17,600,000 ÷ 22 ÷ 8 = 100,000, not May's 21.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-05',
			region: 'I',
			people: [{ key: 'VN-HUNG', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-04-26', 'Giỗ Tổ Hùng Vương'), {
				...holiday('2026-04-27', 'Giỗ Tổ Hùng Vương — observed'),
				kind: 'SUBSTITUTE',
				replaces: '2026-04-26'
			});
			punch(world, 'VN-HUNG', '2026-04-26', '09:00', '17:00'); // eight hours, no break taken
			punch(world, 'VN-HUNG', '2026-04-27', '09:00', '18:00', '13:00'); // eight on the substitute
		}
	);
	assert.deepEqual(workLines(slips.get('VN-HUNG')!), [
		['2026-04-26', 'OT-3.0X-STATUTORY-DAY', 7.5, 2_250_000],
		['2026-04-27', 'OT-2.0X-SUBSTITUTE', 8, 1_600_000]
	]);
});

test('Vietnam — a part-timer under the floor and a trainee are outside compulsory insurance (Law 41/2024 art.2(1)(a), (l))', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'VN-PT-2M', wage: 2_000_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{ key: 'VN-PT-FLOOR', wage: 2_340_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{ key: 'VN-INTERN', wage: 5_000_000, citizenship: 'CITIZEN', employment_type: 'INTERN' }
		]
	});
	// Art.2(1)(l): a part-timer is a member only from a month's wage at or above the lowest
	// contribution salary; exactly the reference level is in.
	for (const scheme of ['SI', 'HI', 'UI']) {
		expectStatutorySkipped(book, 'VN-PT-2M', scheme);
		expectStatutorySkipped(book, 'VN-INTERN', scheme);
	}
	expectStatutory(book, 'VN-PT-FLOOR', 'SI', 187_200, 409_500);
	expectStatutory(book, 'VN-PT-FLOOR', 'UI', 23_400, 23_400);
});

test('Vietnam — union dues below the floor are 0.5% of the floored SI salary (calculation-only; Decision 61/QĐ-TLĐ)', () => {
	const book = assessStatutoryUnvalidated({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{
				key: 'VN-DUES-2M',
				wage: 2_000_000,
				citizenship: 'CITIZEN',
				registrations: { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } }
			}
		]
	});
	// The SI salary is the floored 2,340,000, so the dues are 0.5% × 2,340,000 = 11,700 — not
	// 10,000 on the raw wage.
	expectStatutory(book, 'VN-DUES-2M', 'UNION_DUES', 11_700, 0);
});

test('Vietnam — union dues stop only for a month unpaid, and a member outside SI pays the set sum (Decision 61/QĐ-TLĐ art.1)', () => {
	const member = { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } } as const;
	const dues = (unpaid: number, person: Record<string, unknown> = {}) => {
		const slip = buildStatutory(
			{
				code: 'VN',
				period: '2026-07',
				region: 'I',
				people: [
					{
						key: 'VN-DUES',
						wage: 30_000_000,
						citizenship: 'CITIZEN',
						registrations: {
							...member,
							SI: { kind: 'REGISTERED', elections: { continue_si_unpaid: false } }
						},
						...person
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				if (unpaid > 0) addUnpaidWorkingDays(world, '2026-07', unpaid);
			}
		).slips.get('VN-DUES')!;
		const row = slip.statutory.find((entry) => entry.scheme_code === 'UNION_DUES');
		return row ? [row.base_amount, row.employee_amount] : [];
	};
	// 15 of July's 23 working days unpaid: past Law 41/2024 art.33(5)'s 14, so no SI, but under a
	// month, so the member still owes 0.5% of the 30,000,000 insurance salary = 150,000.
	assert.deepEqual(dues(15), [30_000_000, 150_000]);
	// Every working day of July unpaid: a month without pay, no dues.
	assert.deepEqual(dues(23), []);
	// An intern is outside compulsory SI (Law 41/2024 art.2(1)); the set sum is at least 0.5% of
	// the 2,530,000 base salary = 12,650.
	assert.deepEqual(dues(0, { wage: 5_000_000, employment_type: 'INTERN' }), [2_530_000, 12_650]);
});

test('Vietnam — union dues require a dated membership declaration even without scheme registration', () => {
	for (const period of ['2025-12', '2026-01', '2026-06', '2026-07']) {
		const options = {
			code: 'VN' as const,
			period,
			region: 'I',
			people: [
				{
					key: 'VN-NONMEMBER',
					wage: 20_000_000,
					citizenship: 'CITIZEN',
					registrations: {
						UNION_DUES: {
							kind: 'NOT_REGISTERED',
							declaration_reference: 'MEMBERSHIP-DECLARATION-2026',
							elections: { union_member: false }
						}
					}
				}
			]
		};
		const declared = buildStatutory(options);
		assert.equal(
			declared.slips.get('VN-NONMEMBER')!.statutory.some((row) => row.scheme_code === 'UNION_DUES'),
			false,
			period
		);
		assert.throws(
			() =>
				buildStatutory(options, (world) => {
					for (const fact of world.employment_statutory_facts)
						if (
							fact.status.kind === 'NOT_REGISTERED' &&
							fact.status.elections?.union_member === false
						)
							delete fact.status.elections.union_member;
				}),
			/UNION_DUES: Union member is required before calculation/,
			period
		);
	}
});

test('Vietnam — a month on sickness benefit carries no union dues; a paternity spell does not waive them (Decision 61/QĐ-TLĐ art.1)', () => {
	// Decision 61/QĐ-TLĐ art.1: no dues for a member on social-insurance benefit for a month or
	// more. Sickness days are paid by the fund, not the employer (Law 41/2024 art.42), so each is a
	// wholly unpaid day on the payslip. July 2026 holds 23 fixture working days: all 23 sick → no
	// dues; 13 sick and 10 unpaid → every working day wholly unpaid, no dues (owner rule 2026-09-28);
	// 22 sick → one day worked, the member pays 0.5% of the 30,000,000 insurance salary = 150,000
	// (SI is nil, Law 41/2024 art.33(5)). A father's 14 paternity days (twins by caesarean, Law
	// 41/2024 art.53(2)) end the month's SI too, but the benefit is under a month: he still pays
	// 150,000 (fixed in place 2026-09-28; the waiver had read 14 full maternity or paternity days).
	const july = settingsIdOn('VN', '2026-07-15');
	const run = (code: string, leaveDays: number, unpaid = 0) => {
		const sick = rowIn(leaveCatalogue('VN'), july, code);
		const slip = buildStatutory(
			{
				code: 'VN',
				period: '2026-07',
				region: 'I',
				people: [
					{
						key: 'VN-DUES',
						wage: 30_000_000,
						citizenship: 'CITIZEN',
						gender: 'MALE',
						registrations: {
							UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } },
							SI: {
								kind: 'REGISTERED',
								elections: {
									continue_si_unpaid: false,
									sickness_benefit_eligible: true,
									long_term_sickness: false,
									first_return_month: false,
									maternity_benefit_eligible: true,
									maternity_category: 'OTHER'
								}
							}
						}
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				world.leave_catalogue.push(
					...leaveCatalogue('VN')
						.filter((row) => row.id === sick)
						.map((row) => ({ ...row, approval_id: null }))
				);
				const dates: string[] = [];
				for (let day = 1; day <= 31; day++) {
					const date = `2026-07-${String(day).padStart(2, '0')}`;
					if (![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) dates.push(date);
				}
				const days = dates.slice(dates.length - leaveDays);
				world.leave_entries.push({
					id: 'e1a10000-0000-4000-8000-000000000001',
					employment_id: world.employments[0]!.id,
					catalogue_id: sick,
					leave_code: code,
					reference: 'BENEFIT-1',
					certificate_file: code === 'PATERNITY_LEAVE' ? 'BIRTH-CERTIFICATE' : null,
					event_kind: code === 'PATERNITY_LEAVE' ? 'MULTIPLE_BIRTH_SURGERY' : null,
					event_relationship: code === 'PATERNITY_LEAVE' ? 'WIFE' : null,
					event_date: code === 'PATERNITY_LEAVE' ? '2026-07-01' : null,
					from_date: days[0]!,
					to_date: days.at(-1)!,
					half_day_start: false,
					half_day_end: false,
					days: days.length,
					effective_on: days[0]!,
					reason: 'Social-insurance benefit',
					allocations: [],
					charges: days.map((date) => ({
						date,
						days: 1,
						catalogue_id: sick,
						employment_term_id: world.employment_terms[0]!.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				});
				if (unpaid > 0) addUnpaidWorkingDays(world, '2026-07', unpaid);
			}
		).slips.get('VN-DUES')!;
		const line = (scheme: string) => {
			const row = slip.statutory.find((entry) => entry.scheme_code === scheme);
			return row ? [row.base_amount, row.employee_amount] : [];
		};
		return { dues: line('UNION_DUES'), si: line('SI') };
	};
	assert.deepEqual(run('SICK_LEAVE', 23).dues, []);
	assert.deepEqual(run('SICK_LEAVE', 13, 10).dues, []);
	assert.deepEqual(run('SICK_LEAVE', 22).dues, [30_000_000, 150_000]);
	const paternity = run('PATERNITY_LEAVE', 14);
	assert.deepEqual(paternity.si, []);
	assert.deepEqual(paternity.dues, [30_000_000, 150_000]);
});

test('Vietnam — a preexisting July paternity entry without the wife’s child history cannot settle (Decree 168/2026 art.2)', () => {
	const priorPaternity = leaveCatalogue('VN').find(
		(row) => row.code === 'PATERNITY_LEAVE' && row.settings_id === settingsIdOn('VN', '2026-06-30')
	)!;
	const paternity = leaveCatalogue('VN').find(
		(row) => row.code === 'PATERNITY_LEAVE' && row.settings_id === settingsIdOn('VN', '2026-07-01')
	)!;
	const run = (wifePrior: number | null, relationship = 'WIFE', certificate = true) =>
		assessStatutory(
			{
				code: 'VN',
				period: '2026-07',
				region: 'I',
				people: [
					{
						key: 'VN-FATHER',
						wage: 30_000_000,
						citizenship: 'CITIZEN',
						gender: 'MALE',
						registrations: {
							SI: {
								kind: 'REGISTERED',
								elections: {
									continue_si_unpaid: false,
									maternity_benefit_eligible: true,
									maternity_category: 'OTHER'
								}
							}
						}
					}
				]
			},
			(world) => {
				world.leave_catalogue.push(
					{ ...priorPaternity, approval_id: null },
					{ ...paternity, approval_id: null }
				);
				world.leave_entries.push({
					id: 'e1a10000-0000-4000-8000-000000000002',
					employment_id: world.employments[0]!.id,
					catalogue_id: priorPaternity.id,
					leave_code: 'PATERNITY_LEAVE',
					reference: 'OLDER-APPROVED-BIRTH',
					certificate_file: certificate ? 'BIRTH-CERTIFICATE' : null,
					event_kind: 'BIRTH',
					event_relationship: relationship,
					event_date: '2026-07-01',
					event_wife_prior_living_biological_children: wifePrior,
					from_date: '2026-07-01',
					to_date: '2026-07-01',
					half_day_start: false,
					half_day_end: false,
					days: 1,
					effective_on: '2026-07-01',
					reason: 'Insured paternity leave',
					allocations: [],
					charges: [
						{
							date: '2026-07-01',
							days: 1,
							catalogue_id: priorPaternity.id,
							employment_term_id: world.employment_terms[0]!.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						}
					],
					approval_id: null
				});
			}
		);
	// The refusal names the dated catalogue row, never a hard-coded jurisdiction label.
	const named = (tail: string) => ({ message: `${paternity.name} requires ${tail}` });
	assert.equal(paternity.name, 'Paternity leave (Nghỉ khi vợ sinh con)');
	assert.throws(
		() => run(null),
		named('the wife’s prior living biological child count on the birth date.')
	);
	assert.throws(() => run(1, 'OTHER'), named('the birth event to identify the employee’s wife.'));
	assert.throws(() => run(1, 'WIFE', false), named('its birth evidence and supporting reference.'));
	run(0);
});

test('Vietnam — the year-end finalisation deducts the taxpayer’s twelve months whatever the months employed (Decree 253/2026 art.48(1)(b))', () => {
	// A joiner on 1 July 2026 at 60,000,000 with no other income of the year: the employer's
	// finalisation in December reads the year's income, 6 × 60,000,000 = 360,000,000, less the
	// year's insurance (6 × 4,807,000 on the 50,600,000 cap: SI 4,048,000 + HI 759,000; UI on the
	// regional cap 20 × 5,310,000 = 106,200,000 → 600,000 — 5,407,000 a month, 32,442,000) and the
	// twelve-month self-deduction, 186,000,000 (six months' worth, 93,000,000, would have left
	// 234,558,000): 141,558,000 → 5% × 120,000,000 + 10% × 21,558,000 = 8,155,800, less the five
	// months withheld on file — the year's tax is below what the monthly table took, and the
	// finalisation refunds the difference through the payslip.
	const people = [
		// Authorised this employer to finalise (Decree 253/2026 art.51(2)(a)): one source, a contract
		// of three months or more, still employed at settlement.
		{
			key: 'VN-JULY',
			wage: 60_000_000,
			citizenship: 'CITIZEN',
			hire_date: '2026-07-01',
			registrations: {
				PIT: { kind: 'REGISTERED', elections: { finalisation_authorised: true } }
			}
		}
	];
	// The monthly table on 60,000,000 − 5,407,000 − 15,500,000 = 39,093,000: 500,000 + 2,000,000 +
	// 20% × 9,093,000 = 4,318,600.
	const withheld = 4_318_600;
	const settle = (dependentFromJuly = false, missingJanuary = false) =>
		assessStatutory({ code: 'VN', period: '2026-12', people, region: 'I' }, (world) => {
			if (dependentFromJuly || missingJanuary) {
				const pitIds = new Set(
					contributionSchemes('VN')
						.filter((row) => row.code === 'PIT')
						.map((row) => row.id)
				);
				for (const fact of [...world.employment_statutory_facts]) {
					const status = fact.status as {
						kind: string;
						elections?: Record<string, unknown>;
					};
					if (!pitIds.has(fact.statutory_contribution_id) || status.kind !== 'REGISTERED') continue;
					if (missingJanuary) {
						fact.effective_range = { start: '2026-02-01', end: null };
						continue;
					}
					world.employment_statutory_facts.push({
						...fact,
						id: `${fact.id}-prior`,
						effective_range: { start: '2000-01-01', end: '2026-06-30' }
					});
					fact.effective_range = { start: '2026-07-01', end: null };
					fact.status = {
						...status,
						elections: {
							...status.elections,
							eligible_dependents: 1,
							dependents_registration_reference: 'REGISTERED-JULY'
						}
					};
				}
			}
			const employment = world.employments.find((row) => row.employee_number === 'VN-JULY')!;
			for (let month = 7; month <= 11; month += 1) {
				const period = `2026-${String(month).padStart(2, '0')}`;
				world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `payslip-VN-JULY-${period}`,
					payroll_run_id: `prior-${period}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${period}-28T00:00:00.000Z`,
					currency: 'VND',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'SI',
							employee_amount: 4_048_000,
							employer_amount: 0,
							base_amount: 50_600_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'HI',
							employee_amount: 759_000,
							employer_amount: 0,
							base_amount: 50_600_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'UI',
							employee_amount: 600_000,
							employer_amount: 0,
							base_amount: 60_000_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'PIT',
							employee_amount: dependentFromJuly ? 3_078_600 : withheld,
							employer_amount: 0,
							base_amount: 60_000_000,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		});
	const december = settle();
	expectStatutory(december, 'VN-JULY', 'PIT', 8_155_800 - 5 * withheld, 0);
	// Six qualifying months (July–December), not the current count multiplied by twelve:
	// 360m − 32.442m insurance − 186m self − 37.2m dependant = 104.358m taxable.
	expectStatutory(settle(true), 'VN-JULY', 'PIT', 5_217_900 - 5 * 3_078_600, 0);
	assert.throws(() => settle(false, true), /PIT:.*dated eligible dependant count for 2026-01/i);
});

test('Vietnam — a contract under three months is withheld 10% flat from 5,000,000 a payment, unless the commitment is on file (Decree 253/2026 art.50(2))', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			// Two months, 8,000,000: 10% = 800,000 — no deduction, no table.
			{
				key: 'VN-2M-CONTRACT',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28',
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						unit_assessments: [
							{
								period: '2026-01',
								gross: 8_000_000,
								units: 1,
								reference: 'JAN-WAGE',
								paid_on: '2026-01-31'
							}
						]
					}
				}
			},
			// The same on 4,000,000: January still uses Circular 111's 2,000,000 threshold.
			{
				key: 'VN-2M-SMALL',
				wage: 4_000_000,
				employment_type: 'PART_TIME',
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28',
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						unit_assessments: [
							{
								period: '2026-01',
								gross: 4_000_000,
								units: 1,
								reference: 'JAN-WAGE',
								paid_on: '2026-01-31'
							}
						]
					}
				}
			},
			// The commitment (mẫu 08/CK-TNCN) suspends the 10%: the table, which on 8,000,000 less
			// the 15,500,000 deduction is nothing.
			{
				key: 'VN-2M-COMMITTED',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28',
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						elections: { commitment_form: true },
						unit_assessments: [
							{
								period: '2026-01',
								gross: 8_000_000,
								units: 1,
								reference: 'JAN-WAGE',
								paid_on: '2026-01-31'
							}
						]
					}
				}
			},
			// Three months is the progressive table: 8,000,000 − insurance − 15,500,000 < 0 → 0.
			{
				key: 'VN-3M-CONTRACT',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-03-31',
				exit_reason: 'END_OF_CONTRACT'
			}
		]
	});
	expectStatutory(book, 'VN-2M-CONTRACT', 'PIT', 800_000, 0);
	expectStatutory(book, 'VN-2M-SMALL', 'PIT', 400_000, 0);
	expectStatutory(book, 'VN-2M-COMMITTED', 'PIT', 0, 0);
	expectStatutory(book, 'VN-3M-CONTRACT', 'PIT', 0, 0);
});

test('Vietnam — the 2,000,000 short-contract threshold holds through December 2025', () => {
	// Circular 111/2013 art.25(1)(i): a payment of 2,000,000 or more to a resident on a contract
	// under three months is withheld 10%. Decree 253/2026 art.50(2) raised the threshold to
	// 5,000,000 from the 2026 tax year (art.69(1)(a)), so a December 2025 payment of 4,000,000 is
	// withheld 400,000 where the same payment in January 2026 is not withheld at all.
	const december = assessStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'I',
		people: [
			{
				key: 'VN-DEC-4M',
				wage: 4_000_000,
				employment_type: 'PART_TIME',
				citizenship: 'CITIZEN',
				hire_date: '2025-11-01',
				exit_date: '2025-12-31',
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						unit_assessments: [
							{
								period: '2025-12',
								gross: 4_000_000,
								units: 1,
								reference: 'DEC-WAGE',
								paid_on: '2025-12-31'
							}
						]
					}
				}
			}
		]
	});
	expectStatutory(december, 'VN-DEC-4M', 'PIT', 400_000, 0);
});

test('Vietnam — a foreigner is insured on a contract of twelve months or more (Law 41/2024 art.2(2)); those outside are owed the employer’s rate as wages (Labour Code art.168(3))', () => {
	const version = settingsVersions('VN').find((v) =>
		String(v.effective_range.start).startsWith('2026-01')
	)!;
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{
					key: 'VN-F-6M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					hire_date: '2026-01-01',
					exit_date: '2026-06-30',
					exit_reason: 'END_OF_CONTRACT'
				},
				{
					key: 'VN-F-12M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					hire_date: '2026-01-01',
					exit_date: '2026-12-31',
					exit_reason: 'END_OF_CONTRACT'
				},
				// A working pensioner, recorded outside SI: nothing to the fund, 17.5% + 1% to them (HI
				// is the SI agency's, HI Law art.13(5)(d)).
				{
					key: 'VN-PENSIONER',
					wage: 20_000_000,
					citizenship: 'CITIZEN',
					receiving_pension: true,
					registrations: {
						SI: { kind: 'NOT_REGISTERED' },
						HI: { kind: 'NOT_REGISTERED' },
						UI: { kind: 'NOT_REGISTERED' }
					}
				}
			]
		},
		(world) => {
			const row = world.allowance_catalogue.find(
				(item) => item.code === 'INSURANCE_EQUIVALENT' && item.settings_id === version.id
			)!;
			for (const [index, key] of ['VN-F-6M', 'VN-PENSIONER'].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-0000000000e${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: 'art.168(3)',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	// The payslip lists a scheme the person is outside as a zero row; the charge is what counts.
	const charge = (key: string, code: string) => {
		const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	const equivalent = (key: string) =>
		slips.get(key)!.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount;
	// Six months: outside SI and HI; the employer's 17.5% + 3% of the 20,000,000 it would have
	// insured — 4,100,000 — is paid with the wage; a foreigner is outside UI, so no 1%.
	assert.deepEqual(charge('VN-F-6M', 'SI'), [0, 0]);
	assert.deepEqual(charge('VN-F-6M', 'HI'), [0, 0]);
	assert.equal(equivalent('VN-F-6M'), 4_100_000);
	// Twelve months: insured, 8% / 17.5% and 1.5% / 3%.
	assert.deepEqual(charge('VN-F-12M', 'SI'), [1_600_000, 3_500_000]);
	assert.deepEqual(charge('VN-F-12M', 'HI'), [300_000, 600_000]);
	// The pensioner: SI's 17.5% plus UI's 1% of 20,000,000 = 3,700,000. No HI 3%: HI Law
	// art.12(2)(a), 13(5)(d) insure a pensioner through the SI agency, so art.168(3) owes none.
	assert.deepEqual(charge('VN-PENSIONER', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-PENSIONER'), 3_700_000);
});

test('Vietnam — a pensioner, a transferee and a foreigner hired at retirement age are outside insurance and owed the employer’s rate (Law 41/2024 art.2(2), 2(7); Labour Code art.168(3))', () => {
	// 2026 retirement age (Decree 135/2020 art.4): 61 years 6 months for a man, 57 for a woman.
	const version = settingsVersions('VN').find((v) =>
		String(v.effective_range.start).startsWith('2026-01')
	)!;
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{ key: 'VN-PENSION', wage: 20_000_000, citizenship: 'CITIZEN', receiving_pension: true },
				{
					key: 'VN-TRANSFEREE',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					pass_type: 'INTRA_COMPANY_TRANSFER'
				},
				// A man born 1 May 1964 hired on 1 January 2026 is 61 years 8 months — past 61 years 6.
				{
					key: 'VN-F-RETIRED',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					gender: 'MALE',
					birth_date: '1964-05-01',
					hire_date: '2026-01-01'
				},
				// Born 1 September 1964: 61 years 4 months — under it, insured.
				{
					key: 'VN-F-NOT-YET',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					gender: 'MALE',
					birth_date: '1964-09-01',
					hire_date: '2026-01-01'
				}
			]
		},
		(world) => {
			const row = world.allowance_catalogue.find(
				(item) => item.code === 'INSURANCE_EQUIVALENT' && item.settings_id === version.id
			)!;
			for (const [index, key] of [
				'VN-PENSION',
				'VN-TRANSFEREE',
				'VN-F-RETIRED',
				'VN-F-NOT-YET'
			].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-0000000000d${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: 'art.168(3)',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const charge = (key: string, code: string) => {
		const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	const equivalent = (key: string) =>
		slips.get(key)!.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount;
	// The pensioner: no SI, HI or UI; 17.5% + 1% of 20,000,000 = 3,700,000 with the wage (HI is the
	// SI agency's, HI Law art.13(5)(d)).
	assert.deepEqual(charge('VN-PENSION', 'SI'), [0, 0]);
	assert.deepEqual(charge('VN-PENSION', 'UI'), [0, 0]);
	assert.equal(equivalent('VN-PENSION'), 3_700_000);
	// The transferee and the retirement-age hire: no SI or HI; 20.5% = 4,100,000 (no UI for a foreigner).
	assert.deepEqual(charge('VN-TRANSFEREE', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-TRANSFEREE'), 4_100_000);
	assert.deepEqual(charge('VN-F-RETIRED', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-F-RETIRED'), 4_100_000);
	// Under the age at hire: insured; the row the catalogue declines to price pays nothing.
	assert.deepEqual(charge('VN-F-NOT-YET', 'SI'), [1_600_000, 3_500_000]);
	assert.equal(equivalent('VN-F-NOT-YET'), undefined);
});

test('Vietnam — the insurance equivalent is owed with no allowance row: a working pensioner and a foreigner hired past retirement age (Labour Code art.168(3); Law 41/2024 art.2(2), 2(7))', () => {
	// No `assignAllowance`: the statute owes the amount with each wage, whatever HR has recorded.
	const { slips } = buildStatutory({
		code: 'VN',
		period: '2026-09',
		region: 'I',
		people: [
			{ key: 'VN-PEN', wage: 25_000_000, citizenship: 'CITIZEN', receiving_pension: true },
			// Born 1 June 1962, hired 5 January 2026: 63 years 7 months, past 2026's 61 years 6.
			{
				key: 'VN-FR',
				wage: 30_000_000,
				citizenship: 'FOREIGNER',
				gender: 'MALE',
				birth_date: '1962-06-01',
				hire_date: '2026-01-05'
			}
		]
	});
	const equivalent = (key: string) =>
		slips.get(key)!.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount;
	// Pensioner: 17.5% SI + 1% UI of 25,000,000 = 4,625,000; no HI share (HI Law art.13(5)(d)).
	assert.equal(equivalent('VN-PEN'), 4_625_000);
	// Foreigner: 17.5% + 3% of 30,000,000 = 6,150,000; no UI share for a foreigner.
	assert.equal(equivalent('VN-FR'), 6_150_000);
	for (const key of ['VN-PEN', 'VN-FR'])
		for (const code of ['SI', 'HI', 'UI']) {
			const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
			assert.deepEqual(
				[row?.employee_amount ?? 0, row?.employer_amount ?? 0],
				[0, 0],
				`${key} ${code}`
			);
		}
});

test('Vietnam — 2026-09: a pensioner aged 63 is owed SI and UI equivalents, not HI (Labour Code art.168(3); HI Law art.12(2)(a), 13(5)(d); Law 41/2024 art.2(7)(a))', () => {
	// Labour Code art.168(3) pays the employer's rate only for the schemes the worker is outside
	// ("không thuộc đối tượng tham gia"). A pensioner is outside SI (Law 41/2024 art.2(7)(a)) and UI
	// (Law 74/2025 art.31(2)) but inside HI: art.12(2)(a) lists him in the SI agency's group and
	// art.13(5)(d) keeps him there whatever else he is.
	const { slips } = buildStatutory({
		code: 'VN',
		period: '2026-09',
		region: 'I',
		people: [
			{
				key: 'VN-PEN-63',
				wage: 30_000_000,
				citizenship: 'CITIZEN',
				gender: 'MALE',
				birth_date: '1963-01-01',
				receiving_pension: true
			}
		]
	});
	const slip = slips.get('VN-PEN-63')!;
	const charge = (code: string) => {
		const row = slip.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	for (const code of ['SI', 'HI', 'UI']) assert.deepEqual(charge(code), [0, 0], code);
	// 30,000,000 × (17.5% + 1%) = 5,550,000 (under the 46,800,000 SI and 106,200,000 UI caps).
	assert.equal(
		slip.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount,
		5_550_000
	);
	assert.equal(slip.gross, 35_550_000);
	// Law 109/2025 art.4 counts the equivalent as salary income: 35,550,000 − 15,500,000 =
	// 20,050,000 → 10,000,000 × 5% + 10,050,000 × 10% = 1,505,000.
	assert.deepEqual(charge('PIT'), [1_505_000, 0]);
	assert.equal(slip.net, 34_045_000); // 35,550,000 − 1,505,000
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Verification pass 2026-09-28: the scenarios the register's closure cases name that no golden
// above priced — a leaver's final pay with unused leave, a raise inside the month, a bonus (with
// and without the employer's year-end finalisation), every contribution seam and the PIT bracket
// seams, the age branches for citizens, and the whole-đồng rounding of each contribution.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Unused annual leave paid on exit: the entry the separation flow raises. */
const encashOnExit = (
	world: PayrollWorld,
	key: string,
	id: string,
	days: number,
	settingsId: string,
	exit: string
) => {
	if (!world.leave_catalogue.some((row) => row.code === 'ANNUAL_LEAVE'))
		world.leave_catalogue.push(
			...leaveCatalogue('VN').map((row) => ({ ...row, approval_id: null }))
		);
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const annual = world.leave_catalogue.find(
		(row) => row.settings_id === settingsId && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id,
		employment_id: employment.id,
		catalogue_id: annual.id,
		leave_code: 'ANNUAL_LEAVE',
		reference: `exit:${employment.id}:ANNUAL_LEAVE`,
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days,
		encash_days: days,
		effective_on: exit,
		due_on: exit,
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
};

test('Vietnam — a mid-month leaver: final pay on working days, unused leave at the prior month’s wage, exempt for a resident and taxed at 20% for a non-resident before July 2026', () => {
	// Last day Wednesday 15 April 2026 (no holiday planted). April has 22 weekdays; the leaver
	// worked 11 (1–3, 6–10, 13–15): 44,000,000 × 11 ÷ 22 = 22,000,000 (the contractual working-day
	// divisor, VN-PRORATE-01). Four untaken days are paid on termination (Labour Code art.113(3)) at
	// the contract wage of the month before the exit month (Decree 145/2020 art.67(3)): March 2026,
	// also 22 working days, so a day is 2,000,000 whichever month divides it — 8,000,000.
	// Law 41/2024 art.33(5): 11 unpaid working days (<14) insures the whole contractual salary,
	// 44,000,000 (under the 46,800,000 cap): SI 8% = 3,520,000 / 17.5% = 7,700,000; HI 1.5% = 660,000
	// / 3% = 1,320,000; UI 1% = 440,000 each (Region I cap 106,200,000). Leave pay is not insured.
	// PIT, resident, tax year 2026: Decree 253/2026 art.26(2) exempts pay for untaken leave within
	// Labour Code art.113(3) (applied to resident salary from tax period 2026, art.69(1)(a)):
	// 22,000,000 of taxable wages is paid after termination. Circular 111/2013 art.25(1)(i) (Gazette
	// 563+564 pp.69–70) withholds 10% on each payment of at least VND2m to a resident paid without a
	// labour contract; the register treats a payment after the contract ended as one (owner rule
	// 2026-09-28, as GDT letter 51/TCT-DNNCN of 2021 also directs): 2,200,000. Net 30,000,000 − 4,620,000 − 2,200,000.
	// Non-resident: Decree 253/2026 took effect 1 July 2026 (art.69), so April still taxes the leave
	// pay with the salary (Circular 111/2013 art.2(2)): 30,000,000 × 20% = 6,000,000 (Law 04/2007
	// art.26 as carried; no deductions).
	const april = settingsIdOn('VN', '2026-04-15');
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-04',
			region: 'I',
			people: [
				{
					key: 'VN-LEAVER-R',
					wage: 44_000_000,
					citizenship: 'CITIZEN',
					tax_residency: 'RESIDENT',
					exit_date: '2026-04-15',
					exit_reason: 'RESIGNATION',
					registrations: {
						PIT: {
							kind: 'REGISTERED',
							unit_assessments: [
								{
									period: '2026-04',
									gross: 22_000_000,
									units: 1,
									reference: 'FINAL-WAGE',
									paid_on: '2026-04-30'
								}
							]
						}
					}
				},
				{
					key: 'VN-LEAVER-NR',
					wage: 44_000_000,
					citizenship: 'CITIZEN',
					tax_residency: 'NON_RESIDENT',
					exit_date: '2026-04-15',
					exit_reason: 'RESIGNATION'
				}
			]
		},
		(world) => {
			encashOnExit(
				world,
				'VN-LEAVER-R',
				'a3000000-0000-4000-8000-0000000000a1',
				4,
				april,
				'2026-04-15'
			);
			encashOnExit(
				world,
				'VN-LEAVER-NR',
				'a3000000-0000-4000-8000-0000000000a2',
				4,
				april,
				'2026-04-15'
			);
		}
	);
	for (const key of ['VN-LEAVER-R', 'VN-LEAVER-NR']) {
		const slip = slips.get(key)!;
		assert.deepEqual(
			slip.proration
				.filter((row) => row.component_code === 'BASIC')
				.map((row) => [row.days, row.denominator, row.prorated_amount]),
			[[11, 22, 22_000_000]]
		);
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
			8_000_000
		);
		assert.equal(slip.gross, 30_000_000);
		assert.deepEqual(charge(slip, 'SI'), [44_000_000, 3_520_000, 7_700_000]);
		assert.deepEqual(charge(slip, 'HI'), [44_000_000, 660_000, 1_320_000]);
		assert.deepEqual(charge(slip, 'UI'), [44_000_000, 440_000, 440_000]);
		// Service wholly under UI: Labour Code art.46(1) leaves no severance year to pay.
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'SEVERANCE_ALLOWANCE'),
			undefined
		);
	}
	assert.deepEqual(charge(slips.get('VN-LEAVER-R')!, 'PIT'), [22_000_000, 2_200_000, 0]);
	assert.equal(slips.get('VN-LEAVER-R')!.net, 23_180_000);
	assert.deepEqual(charge(slips.get('VN-LEAVER-NR')!, 'PIT'), [30_000_000, 6_000_000, 0]);
	assert.equal(slips.get('VN-LEAVER-NR')!.net, 19_380_000);
});

test('Vietnam — a raise inside the month pays each salary on its own working days, and PIT relieves the insurance actually deducted', () => {
	// 20,000,000 to Thursday 15 January 2026, 30,000,000 from Friday the 16th: 11 of January's 22
	// working days each, 20,000,000 × 11 ÷ 22 + 30,000,000 × 11 ÷ 22 = 25,000,000 (Labour Code
	// art.95: the wage agreed for the time worked; the working-day divisor is the contract's).
	// PIT is withheld on the income paid (Decree 253/2026 art.46(3)) less the month's compulsory
	// insurance contributed (art.46(2)(a)) and 15,500,000 (Resolution 110/2025). The statute does
	// not say which of two contract salaries a split month insures (Law 41/2024 art.31(1)(b) speaks
	// of the monthly salary); the golden therefore pins the PIT relief to whatever insurance the
	// slip deducted, not a figure of its own.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'VN-RAISE', wage: 20_000_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 30_000_000,
				effective_range: { start: '2026-01-16', end: null }
			});
			old.effective_range = { start: old.effective_range.start, end: '2026-01-15' };
		}
	);
	const slip = slips.get('VN-RAISE')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[
			[11, 22, 10_000_000],
			[11, 22, 15_000_000]
		]
	);
	assert.equal(slip.gross, 25_000_000);
	const insurance = ['SI', 'HI', 'UI'].reduce((sum, code) => sum + charge(slip, code)[1], 0);
	const taxable = 25_000_000 - insurance - 15_500_000;
	const tax = taxable <= 10_000_000 ? taxable * 0.05 : 500_000 + (taxable - 10_000_000) * 0.1;
	assert.deepEqual(charge(slip, 'PIT'), [25_000_000, Math.round(tax), 0]);
});

test('Vietnam — a Tết bonus is salary income of the month paid, outside the insurance salary and the union fund', () => {
	// No statute obliges a private employer to pay a 13th-month or Tết bonus (Labour Code art.104;
	// VN-LC104-02), so the bank carries no bonus class; the world adds the employer's own.
	// Cash bonuses are taxable salary income (Decree 253/2026 art.8(2)(i)) taxed when paid on the
	// monthly table (art.50(1)); they are not a wage, allowance or regular supplement of the SI
	// salary (Law 41/2024 art.31(1)(b); Decree 158/2025 art.7(1)), so SI/HI/UI and the 2% union
	// fund (Law 50/2024 art.29(1)(b)) stay on the 20,000,000 salary.
	// Resident: 20,000,000 + 20,000,000 − 2,100,000 − 15,500,000 = 22,400,000 → 500,000 +
	// 12,400,000 × 10% = 1,740,000. Non-resident: 40,000,000 × 20% = 8,000,000.
	const january = settingsIdOn('VN', '2026-01-15');
	const BONUS = 'c1c1c1c1-0000-4000-8000-0000000000b0';
	const { slips, companyCharges } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{ key: 'VN-BONUS', wage: 20_000_000, citizenship: 'CITIZEN' },
				{
					key: 'VN-BONUS-NR',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT'
				}
			]
		},
		(world) => {
			world.adhoc_catalogue.push({
				id: BONUS,
				settings_id: january,
				code: 'TET_BONUS',
				name: 'Thưởng Tết',
				authority: 'Employer bonus regulation (Labour Code art.104)',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['PIT'],
				raised_by: 'MANUAL',
				approval_id: null
			});
			for (const [index, employment] of world.employments.entries())
				world.adhoc_requests!.push({
					id: `d4000000-0000-4000-8000-00000000000${index}`,
					employment_id: employment.id,
					catalogue_id: BONUS,
					amount: 20_000_000,
					event_date: '2026-01-15',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'Tết',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	const resident = slips.get('VN-BONUS')!;
	assert.equal(resident.gross, 40_000_000);
	assert.deepEqual(charge(resident, 'SI'), [20_000_000, 1_600_000, 3_500_000]);
	assert.deepEqual(charge(resident, 'HI'), [20_000_000, 300_000, 600_000]);
	assert.deepEqual(charge(resident, 'UI'), [20_000_000, 200_000, 200_000]);
	assert.deepEqual(charge(resident, 'PIT'), [40_000_000, 1_740_000, 0]);
	assert.deepEqual(charge(slips.get('VN-BONUS-NR')!, 'PIT'), [40_000_000, 8_000_000, 0]);
	assert.deepEqual(companyCharges.get('UNION_FEE'), [40_000_000, 800_000]);
});

test('Vietnam — a December bonus under the employer’s finalisation is taxed on the year, not the month (Decree 253/2026 arts.46, 51(2))', () => {
	// A resident on 20,000,000 all of 2026 who authorised this employer to finalise. January to
	// November stand on file at the monthly figures: insurance 2,100,000 (SI 1,600,000 + HI 300,000
	// + UI 200,000; neither cap binds) and PIT (20,000,000 − 2,100,000 − 15,500,000) × 5% = 120,000.
	// December adds a 20,000,000 bonus. The year: 260,000,000 − 25,200,000 − 186,000,000 (12 ×
	// 15,500,000) = 48,800,000 on the annual table (≤120,000,000 at 5%, Law 109/2025 art.9) =
	// 2,440,000; less 11 × 120,000 = 1,320,000 withheld, December charges 1,120,000 — where the
	// monthly table alone would take (40,000,000 − 2,100,000 − 15,500,000) × rates = 1,740,000.
	const december = settingsIdOn('VN', '2026-12-15');
	const BONUS = 'c1c1c1c1-0000-4000-8000-0000000000b1';
	const book = assessStatutory(
		{
			code: 'VN',
			period: '2026-12',
			region: 'I',
			people: [
				{
					key: 'VN-13TH',
					wage: 20_000_000,
					citizenship: 'CITIZEN',
					registrations: {
						PIT: { kind: 'REGISTERED', elections: { finalisation_authorised: true } }
					}
				}
			]
		},
		(world) => {
			const employment = world.employments[0]!;
			for (let month = 1; month <= 11; month += 1) {
				const period = `2026-${String(month).padStart(2, '0')}`;
				world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `payslip-VN-13TH-${period}`,
					payroll_run_id: `prior-${period}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${period}-28T00:00:00.000Z`,
					currency: 'VND',
					base: [],
					adjustments: [],
					statutory: (
						[
							['SI', 1_600_000],
							['HI', 300_000],
							['UI', 200_000],
							['PIT', 120_000]
						] as const
					).map(([scheme_code, employee_amount]) => ({
						scheme_code,
						employee_amount,
						employer_amount: 0,
						base_amount: 20_000_000,
						rule_when: null,
						authority: null
					}))
				});
			}
			world.adhoc_catalogue.push({
				id: BONUS,
				settings_id: december,
				code: 'TET_BONUS',
				name: 'Thưởng tháng 13',
				authority: 'Employer bonus regulation (Labour Code art.104)',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['PIT'],
				raised_by: 'MANUAL',
				approval_id: null
			});
			world.adhoc_requests!.push({
				id: 'd4000000-0000-4000-8000-0000000000c1',
				employment_id: employment.id,
				catalogue_id: BONUS,
				amount: 20_000_000,
				event_date: '2026-12-15',
				pay_period: '2026-12',
				payslip_id: null,
				reason: '13th month',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	expectStatutory(book, 'VN-13TH', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-13TH', 'PIT', 1_120_000, 0);
});

test('Vietnam — resident overtime in December 2025 exempts only the premium above the ordinary rate (Law 04/2007 art.4(9))', () => {
	// December 2025 has 23 weekdays: 18,400,000 ÷ 23 ÷ 8 = 100,000 an hour. Two hours beyond the
	// normal day on Monday 8 December at 150% (Labour Code art.98(1)(a)) pay 300,000; the 200,000 at
	// the ordinary rate is taxable, the 100,000 premium is not (Circular 111/2013 art.3(1)(i)).
	// PIT base 18,600,000 − 1,932,000 (8% + 1.5% + 1% of 18,400,000) − 11,000,000 (Resolution
	// 954/2020) = 5,668,000: 250,000 + 668,000 × 10% = 316,800.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2025-12',
			region: 'I',
			people: [{ key: 'VN-OT-2025', wage: 18_400_000, citizenship: 'CITIZEN' }]
		},
		(world) => punch(world, 'VN-OT-2025', '2025-12-08', '09:00', '20:00', '13:00')
	);
	const slip = slips.get('VN-OT-2025')!;
	assert.deepEqual(workLines(slip), [['2025-12-08', 'OT-1.5X', 2, 300_000]]);
	assert.deepEqual(charge(slip, 'SI'), [18_400_000, 1_472_000, 3_220_000]);
	assert.deepEqual(charge(slip, 'PIT'), [18_600_000, 316_800, 0]);
});

test('Vietnam — every seam: the SI/HI ceiling, the UI regional ceiling, the monthly PIT brackets and whole-đồng rounding', () => {
	const people = [
		// One đồng-cent over 46,800,000 is charged on the ceiling (Law 41/2024 art.31(1)(đ)).
		{ key: 'CAP+', wage: 46_800_000.01, citizenship: 'CITIZEN' },
		// Twenty times Region I's 5,310,000 (Decree 293/2025 art.3) = 106,200,000: exactly on it, and
		// one đồng above.
		{ key: 'UI-CAP', wage: 106_200_000, citizenship: 'CITIZEN' },
		{ key: 'UI-CAP+', wage: 106_200_001, citizenship: 'CITIZEN' },
		// A wage that divides by nothing: SI 8% 987,654.24 → 987,654; 17.5% 2,160,493.65 → 2,160,494;
		// HI 1.5% 185,185.17 → 185,185; 3% 370,370.34 → 370,370; UI 1% 123,456.78 → 123,457 — the
		// nearest whole đồng (no statutory rounding rule exists; VN-PRORATE-01; VSS bills whole đồng).
		{ key: 'ROUND', wage: 12_345_678, citizenship: 'CITIZEN' },
		// Resident foreigners above the SI cap and outside UI: insurance is a fixed 4,446,000, so
		// the wage lands the taxable income on each seam of Law 109/2025 art.9 (≤10M 5%, ≤30M 10%,
		// ≤60M 20%, ≤100M 30%, above 35%): taxable = wage − 4,446,000 − 15,500,000.
		{ key: 'F-30M', wage: 49_946_000, citizenship: 'FOREIGNER' },
		{ key: 'F-60M', wage: 79_946_000, citizenship: 'FOREIGNER' },
		{ key: 'F-60M+1', wage: 79_946_001, citizenship: 'FOREIGNER' },
		{ key: 'F-100M', wage: 119_946_000, citizenship: 'FOREIGNER' }
	];
	const january = assessStatutory({ code: 'VN', period: '2026-01', region: 'I', people });
	expectStatutory(january, 'CAP+', 'SI', 3_744_000, 8_190_000);
	expectStatutory(january, 'CAP+', 'HI', 702_000, 1_404_000);
	expectStatutory(january, 'UI-CAP', 'UI', 1_062_000, 1_062_000);
	expectStatutory(january, 'UI-CAP+', 'UI', 1_062_000, 1_062_000);
	expectStatutory(january, 'ROUND', 'SI', 987_654, 2_160_494);
	expectStatutory(january, 'ROUND', 'HI', 185_185, 370_370);
	expectStatutory(january, 'ROUND', 'UI', 123_457, 123_457);
	// Taxable exactly 30,000,000: 500,000 + 2,000,000 = 2,500,000. Exactly 60,000,000: + 6,000,000
	// = 8,500,000; one đồng more adds 0.3 → still 8,500,000. Exactly 100,000,000: + 12,000,000 =
	// 20,500,000.
	expectStatutory(january, 'F-30M', 'PIT', 2_500_000, 0);
	expectStatutory(january, 'F-60M', 'PIT', 8_500_000, 0);
	expectStatutory(january, 'F-60M+1', 'PIT', 8_500_000, 0);
	expectStatutory(january, 'F-100M', 'PIT', 20_500_000, 0);
	// The union fund: seven capped salaries (7 × 46,800,000) + 12,345,678 = 339,945,678 × 2% =
	// 6,798,913.56 → 6,798,914.
	expectStatutory(january, COMPANY, 'UNION_FEE', 0, 6_798_914);

	// December 2025: the UI cap is 20 × 4,960,000 (Decree 74/2024 art.3) = 99,200,000 → 992,000;
	// the seven-rung table of Law 04/2007 art.22 with 11,000,000 (Resolution 954/2020).
	const december = assessStatutory({ code: 'VN', period: '2025-12', region: 'I', people });
	expectStatutory(december, 'UI-CAP', 'UI', 992_000, 992_000);
	// ROUND: 12,345,678 − 1,296,296 − 11,000,000 = 49,382 × 5% = 2,469.1 → 2,469.
	expectStatutory(december, 'ROUND', 'PIT', 2_469, 0);
	// F-30M: 34,500,000 → 4,750,000 + 2,500,000 × 25% = 5,375,000. F-60M: 64,500,000 → 9,750,000 +
	// 12,500,000 × 30% = 13,500,000. F-100M: 104,500,000 → 18,150,000 + 24,500,000 × 35% = 26,725,000.
	expectStatutory(december, 'F-30M', 'PIT', 5_375_000, 0);
	expectStatutory(december, 'F-60M', 'PIT', 13_500_000, 0);
	expectStatutory(december, 'F-100M', 'PIT', 26_725_000, 0);
});

test('Vietnam — a citizen past retirement age is still insured; one qualified for a pension is outside UI from 2026 (Law 41/2024 art.2(1); Law 74/2025 art.31(2))', () => {
	// Law 41/2024 art.2(1) makes no age exception for a Vietnamese employee; only one already
	// receiving a pension leaves compulsory SI (art.2(7)). Law 74/2025 art.31(2) excludes from UI an
	// employee who qualifies for a monthly pension (the `pension_qualified` election); under Law
	// 38/2013 (December 2025) only one receiving it was out.
	const people = [
		{ key: 'C-65', wage: 20_000_000, age: 65, citizenship: 'CITIZEN' },
		{
			key: 'C-PQ',
			wage: 20_000_000,
			age: 63,
			citizenship: 'CITIZEN',
			registrations: { UI: { kind: 'REGISTERED', elections: { pension_qualified: true } } }
		}
	];
	const january = assessStatutory({ code: 'VN', period: '2026-01', region: 'I', people });
	expectStatutory(january, 'C-65', 'SI', 1_600_000, 3_500_000);
	expectStatutory(january, 'C-65', 'UI', 200_000, 200_000);
	expectStatutory(january, 'C-PQ', 'SI', 1_600_000, 3_500_000);
	expectStatutorySkipped(january, 'C-PQ', 'UI');
	// Without UI: 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 × 5% = 130,000.
	expectStatutory(january, 'C-PQ', 'PIT', 130_000, 0);
	const december = assessStatutory({ code: 'VN', period: '2025-12', region: 'I', people });
	expectStatutory(december, 'C-PQ', 'UI', 200_000, 200_000);
});

// ─── Separation: severance, job loss and the settlement deadline (Labour Code arts.46–48) ─────

/**
 * Leavers hired 1 July 2006 whose unemployment insurance began 1 January 2009 — the scheme's
 * own start under the Law on Social Insurance 71/2006 — so 30 months of service were never
 * covered by UI. Each is on 60,000,000 for the whole of the six months before leaving.
 */
const separation = (
	people: readonly { key: string; exit_date: string; exit_reason: string; pit_gross?: number }[],
	claims: readonly (readonly [string, string])[],
	{
		period = '2026-09',
		wage = 60_000_000,
		tax_residency = 'RESIDENT'
	}: { period?: string; wage?: number; tax_residency?: string } = {}
) =>
	buildStatutory(
		{
			code: 'VN',
			period,
			region: 'I',
			people: people.map((person) => ({
				...person,
				wage,
				citizenship: 'CITIZEN',
				tax_residency,
				hire_date: '2006-07-01',
				...(person.pit_gross == null
					? {}
					: {
							registrations: {
								PIT: {
									kind: 'REGISTERED' as const,
									unit_assessments: [
										{
											period,
											gross: person.pit_gross,
											units: 1,
											reference: 'FINAL-WAGE',
											paid_on: `${period}-30`
										}
									]
								}
							}
						})
			}))
		},
		(world) => {
			const ui = new Set(
				contributionSchemes('VN')
					.filter((scheme: { code: string }) => scheme.code === 'UI')
					.map((scheme: { id: string }) => scheme.id)
			);
			for (const fact of world.employment_statutory_facts)
				if (ui.has(fact.statutory_contribution_id)) fact.status.since = '2009-01-01';
			for (const [index, [key, code]] of claims.entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				const exit = people.find((person) => person.key === key)!.exit_date;
				// Labour Code art.46(1): no severance for one who qualifies for a pension — declared.
				employment.exit_facts = { pension_eligible: false };
				world.adhoc_requests!.push({
					id: `d5000000-0000-4000-8000-00000000000${index}`,
					employment_id: employment.id,
					catalogue_id: rowIn(adhocCatalogue('VN'), settingsIdOn('VN', exit), code),
					amount: 0,
					event_date: exit,
					pay_period: period,
					payslip_id: null,
					reason: code,
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				} as never);
			}
		}
	);

test('Vietnam — severance and job-loss pay the uncovered service on the six-month average, outside PIT, and the 14-working-day settlement clock (Labour Code arts.46–48; Decree 145/2020 art.8; Decree 253/2026 art.8(3)(h))', () => {
	// Last day Tuesday 15 September 2026 (1 July 2026 version; no holiday planted). September has
	// 22 weekdays; 11 worked (1–4, 7–11, 14–15): 60,000,000 × 11 ÷ 22 = 30,000,000.
	//
	// Severance, END_OF_CONTRACT (art.34(1)): Labour Code art.46(1) half a month's salary per year
	// of service; art.46(2) and Decree 145/2020 art.8(3) count the total time actually worked less
	// the time under UI; art.8(3)(c) a leftover of ≤ 6 months is half a year. Service 1 July 2006 –
	// 15 September 2026 less UI 1 January 2009 – 15 September 2026 = 30 months (1 July 2006 –
	// 31 December 2008) = 2 years + 6 months → 2.5 years. Art.46(3): the average contractual
	// salary of the six months before leaving, 60,000,000. 0.5 × 60,000,000 × 2.5 = 75,000,000.
	// Job loss, REDUNDANCY (art.34(11), art.42): art.47(1) one month per year, at least two:
	// 60,000,000 × 2.5 = 150,000,000.
	//
	// Insurance: 11 unpaid working days (< 14, Law 41/2024 art.33(5)) insures the month on the
	// contractual salary: SI and HI capped at 20 × 2,530,000 = 50,600,000 (art.31(1)(đ); Decree
	// 161/2026) — SI 8% 4,048,000 / 17.5% 8,855,000, HI 1.5% 759,000 / 3% 1,518,000; UI 1% of
	// 60,000,000 = 600,000 each, under 20 × 5,310,000 = 106,200,000 (Law 74/2025 art.34(2);
	// Decree 293/2025 art.3). Neither allowance is a wage of the insurance salary (art.31(1)(b)).
	//
	// PIT, resident, tax year 2026: Decree 253/2026 art.8(3)(h) (signed text p.6; resident salary
	// from tax period 2026, art.69(1)(a)) keeps severance and job-loss allowances out of taxable
	// salary income. As the wage is paid after termination, art.50(2) withholds 10% of the
	// documented VND30,000,000 payment: VND3,000,000. Net: severance 105,000,000 − 5,407,000 −
	// 3,000,000 = 96,593,000; job loss 180,000,000 − 8,407,000 = 171,593,000.
	//
	// Settlement: Labour Code art.48(1) within 14 working days of the termination, the day of
	// termination itself not counted (Civil Code 91/2015/QH13 art.147(3)). From Tuesday 15
	// September: 16–18, 21–25, 28–30 September, 1–2 and 5 October → due Monday 5 October; the
	// month-end run pays on 30 September, in time. Redundancy is art.48(1)(b): at most 30 days, to
	// 15 October. A last day of Wednesday 9 September is due by Tuesday 29 September (10–11,
	// 14–18, 21–25, 28–29): the 30 September run is late.
	const { slips, warnings } = separation(
		[
			{
				key: 'VN-SEV',
				exit_date: '2026-09-15',
				exit_reason: 'END_OF_CONTRACT',
				pit_gross: 30_000_000
			},
			{
				key: 'VN-JOBLOSS',
				exit_date: '2026-09-15',
				exit_reason: 'REDUNDANCY',
				pit_gross: 30_000_000
			},
			{ key: 'VN-LATE', exit_date: '2026-09-09', exit_reason: 'RESIGNATION', pit_gross: 19_090_909 }
		],
		[
			['VN-SEV', 'SEVERANCE_ALLOWANCE'],
			['VN-JOBLOSS', 'JOB_LOSS_ALLOWANCE']
		]
	);
	for (const [key, code, amount, net] of [
		['VN-SEV', 'SEVERANCE_ALLOWANCE', 75_000_000, 96_593_000],
		['VN-JOBLOSS', 'JOB_LOSS_ALLOWANCE', 150_000_000, 171_593_000]
	] as const) {
		const slip = slips.get(key)!;
		assert.deepEqual(
			slip.proration
				.filter((row) => row.component_code === 'BASIC')
				.map((row) => [row.days, row.denominator, row.prorated_amount]),
			[[11, 22, 30_000_000]]
		);
		assert.equal(slip.adjustments.find((row) => row.component_code === code)!.amount, amount);
		assert.equal(slip.gross, 30_000_000 + amount);
		assert.deepEqual(charge(slip, 'SI'), [50_600_000, 4_048_000, 8_855_000]);
		assert.deepEqual(charge(slip, 'HI'), [50_600_000, 759_000, 1_518_000]);
		assert.deepEqual(charge(slip, 'UI'), [60_000_000, 600_000, 600_000]);
		assert.deepEqual(charge(slip, 'PIT'), [30_000_000, 3_000_000, 0]);
		assert.equal(slip.net, net);
	}
	const late = warnings.filter((line) => line.startsWith('FINAL_PAY_LATE'));
	assert.equal(late.length, 1);
	assert.match(
		late[0]!,
		/VN-LATE left on 2026-09-09.*14 working days.*by 2026-09-29.*pays on 2026-09-30/
	);
});

test('Vietnam — a month-end leaver counts the exit month under UI too (Labour Code art.46(2); Decree 145/2020 art.8(3))', () => {
	// Decree 145/2020/ND-CP art.8(3) (Official Gazette 1203+1204, 28-12-2020, pp.9-10): working
	// time for severance = total time actually worked less the time under UI; art.8(3)(b)-(c) a
	// leftover of <= 6 months is half a year. Last day Wednesday 30 September 2026: service
	// 1 July 2006 - 30 September 2026 = 243 months; UI 1 January 2009 - 30 September 2026 = 213
	// months (the exit month counts under both); 243 - 213 = 30 months = 2 years + 6 months ->
	// 2.5 years. Labour Code art.46(1),(3): 0.5 x 60,000,000 x 2.5 = 75,000,000 (not 31 months ->
	// 3 years -> 90,000,000).
	const { slips } = separation(
		[{ key: 'VN-SEV', exit_date: '2026-09-30', exit_reason: 'END_OF_CONTRACT' }],
		[['VN-SEV', 'SEVERANCE_ALLOWANCE']]
	);
	assert.equal(
		slips.get('VN-SEV')!.adjustments.find((row) => row.component_code === 'SEVERANCE_ALLOWANCE')!
			.amount,
		75_000_000
	);
});

test('Vietnam — the 1 July 2026 version caps UI at twenty Region I minimum wages (Law 74/2025 art.34(2); Decree 293/2025 art.3)', () => {
	// Law 74/2025 art.34(2): the UI wage is at most 20 × the regional monthly minimum the
	// Government publishes at the time of contribution. Decree 293/2025 art.3(1) Region I
	// 5,310,000 (from 1 January 2026, not moved on 1 July) → 106,200,000: 1% = 1,062,000 exactly on
	// it and one đồng above.
	for (const period of ['2026-06', '2026-09']) {
		const book = assessStatutory({
			code: 'VN',
			period,
			region: 'I',
			people: [
				{ key: 'UI-CAP', wage: 106_200_000, citizenship: 'CITIZEN' },
				{ key: 'UI-CAP+', wage: 106_200_001, citizenship: 'CITIZEN' }
			]
		});
		expectStatutory(book, 'UI-CAP', 'UI', 1_062_000, 1_062_000);
		expectStatutory(book, 'UI-CAP+', 'UI', 1_062_000, 1_062_000);
	}
});

test('Vietnam — from 1 July 2026 the salary PIT return is quarterly only (Circular 89/2026 art.22(1)(a)(a.1); Decree 252/2026 art.10(3))', () => {
	// Before 1 July 2026 Decree 126/2020 arts.8(1), 9 let a salary payer file monthly (by the 20th)
	// or, if eligible for quarterly VAT, quarterly. Circular 89/2026/TT-BTC art.22(1)(a)(a.1) (signed
	// text p.49): the salary payer declares the tax withheld by quarter; Decree 252/2026 art.10(3):
	// by the last day of the first month of the following quarter.
	const declaration = (day: string) =>
		settingsVersions('VN')
			.find((version: { id: string }) => version.id === settingsIdOn('VN', day))!
			.obligations.find((row: { code: string }) => row.code === 'PIT_WITHHOLDING_DECLARATION') as {
			timing: string;
			authority: string;
		};
	for (const day of ['2025-12-15', '2026-01-15', '2026-06-15']) {
		assert.match(declaration(day).timing, /^Monthly by the 20th .* or quarterly/);
		assert.match(declaration(day).authority, /Decree 126\/2020/);
	}
	const july = declaration('2026-09-15');
	assert.match(
		july.timing,
		/^Quarterly, by the last day of the first month of the following quarter/
	);
	assert.doesNotMatch(july.timing, /monthly|20th/i);
	assert.match(july.authority, /Circular 89\/2026\/TT-BTC art\.22\(1\)\(a\)\(a\.1\)/);
	assert.doesNotMatch(july.authority, /luatvietnam/);
});

test('Vietnam — the seed meal allowance is outside every insurance base, taxable only above 1,200,000 (Decree 158/2025 art.7(1)(c); Circular 10/2020 art.3(5)(c); Decree 253/2026 art.8(2)(g))', () => {
	// July 2026 version, 20,000,000 wage and the seed's own MEAL_ALLOWANCE of 1,500,000 on the
	// contract. Insurance salary: Law 41/2024 art.31(1)(b) with Decree 158/2025/NĐ-CP art.7(1)(c)
	// takes the other supplements (các khoản bổ sung khác) of a stated amount paid regularly with
	// the wage; Circular 10/2020/TT-BLĐTBXH art.3(5)(c) (last paragraph) sets the mid-shift meal
	// (tiền ăn giữa ca) apart from them as a benefit written as a separate contract item. So SI 8% /
	// 17.5% = 1,600,000 / 3,500,000, HI 1.5% / 3% = 300,000 / 600,000, UI 1% = 200,000 each, all
	// on 20,000,000. PIT (Decree 253/2026 art.8(2)(g), art.69(1)(b)): only 1,500,000 − 1,200,000 =
	// 300,000 of the meal is taxable; 20,300,000 − 2,100,000 − 15,500,000 (Resolution 110/2025) =
	// 2,700,000 × 5% (Law 109/2025 art.29(2)) = 135,000.
	const july = settingsIdOn('VN', '2026-07-15');
	const book = assessStatutory(
		{
			code: 'VN',
			period: '2026-07',
			region: 'I',
			people: [{ key: 'VN-MEAL', wage: 20_000_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const meal = world.allowance_catalogue.find(
				(row) => row.code === 'MEAL_ALLOWANCE' && row.settings_id === july
			)!;
			assert.deepEqual(meal.counts_toward, ['PIT.MEAL']);
			assignAllowance(world, {
				id: 'd0000000-0000-4000-8000-0000000000f1',
				employment_id: world.employments[0]!.id,
				catalogue_id: meal.id,
				amount: 1_500_000,
				effective_from: '2026-01-01',
				effective_to: null,
				reason: '',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	expectStatutory(book, 'VN-MEAL', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-MEAL', 'HI', 300_000, 600_000);
	expectStatutory(book, 'VN-MEAL', 'UI', 200_000, 200_000);
	expectStatutory(book, 'VN-MEAL', 'PIT', 135_000, 0);
});

test('Vietnam — a non-resident’s severance is outside PIT in June 2026 (Circular 111/2013 arts.2(2)(b)(b.6), 8(2)(a), 18) and in July 2026 (Decree 253/2026 art.8(3)(h))', () => {
	// June 2026 (16 May version): Tax residency is not the insurance test, so a non-resident
	// citizen is insured as usual. Last day Monday 15 June; June has 22 weekdays, 11 worked (1–5,
	// 8–12, 15): 60,000,000 × 11 ÷ 22 = 30,000,000. Severance as in the September golden: service 1
	// July 2006 – 15 June 2026 less UI from 1 January 2009 = 30 months → 2.5 years; 0.5 ×
	// 60,000,000 × 2.5 = 75,000,000 (Labour Code art.46; Decree 145/2020 art.8(3)).
	// PIT: Circular 111/2013/TT-BTC art.18(1) (Official Gazette 563+564, 12-9-2013, p.61) taxes a
	// non-resident's salary income at 20%; art.18(2) (p.62) takes that income as for a resident
	// under art.8(2)(a) (pp.35–36), which is the art.2(2) salary income; art.2(2)(b)(b.6) (p.6)
	// leaves out "trợ cấp thôi việc, trợ cấp mất việc làm" under the Labour Code. 20% × 30,000,000
	// = 6,000,000, nothing on the 75,000,000.
	const june = separation(
		[{ key: 'VN-NR-SEV', exit_date: '2026-06-15', exit_reason: 'END_OF_CONTRACT' }],
		[['VN-NR-SEV', 'SEVERANCE_ALLOWANCE']],
		{ period: '2026-06', tax_residency: 'NON_RESIDENT' }
	).slips.get('VN-NR-SEV')!;
	assert.equal(
		june.adjustments.find((row) => row.component_code === 'SEVERANCE_ALLOWANCE')!.amount,
		75_000_000
	);
	assert.equal(june.gross, 30_000_000 + 75_000_000);
	assert.deepEqual(charge(june, 'PIT'), [30_000_000, 6_000_000, 0]);

	// July 2026 (1 July version): Decree 253/2026 art.8(3)(h) (signed text p.6) keeps severance
	// out of taxable salary income. 46,000,000 wage; last day Wednesday 15 July; July has 23
	// weekdays, 11 worked (1–3, 6–10, 13–15): 46,000,000 × 11 ÷ 23 = 22,000,000. Service 1 July
	// 2006 – 15 July 2026 less UI = 30 months → 2.5 years: 0.5 × 46,000,000 × 2.5 = 57,500,000.
	// PIT 20% × 22,000,000 = 4,400,000.
	const july = separation(
		[{ key: 'VN-NR-SEV', exit_date: '2026-07-15', exit_reason: 'END_OF_CONTRACT' }],
		[['VN-NR-SEV', 'SEVERANCE_ALLOWANCE']],
		{ period: '2026-07', wage: 46_000_000, tax_residency: 'NON_RESIDENT' }
	).slips.get('VN-NR-SEV')!;
	assert.equal(
		july.adjustments.find((row) => row.component_code === 'SEVERANCE_ALLOWANCE')!.amount,
		57_500_000
	);
	assert.equal(july.gross, 22_000_000 + 57_500_000);
	assert.deepEqual(charge(july, 'PIT'), [22_000_000, 4_400_000, 0]);
});

test('Vietnam — a late wage records its due date, paid date and bank rate for the compensation class (Labour Code art.97(4))', () => {
	// Art.97(4) (Official Gazette 993+994, 26-12-2019): a delay of 15 days or more owes at least the
	// interest on the late sum at the 1-month term-deposit rate the payroll bank publishes on the
	// payment date; a force-majeure delay may not exceed 30 days. The rate is the employer's own
	// bank's, so it is recorded on the request, not seeded. This proves the inputs reach a band; the
	// band below is a fixture (4.5% is not a published rate, and it rounds to nearest; the seeded
	// LATE_WAGE_COMPENSATION class, golden below, rounds up).
	// September wages 20,000,000 due 30 September: paid 20 October is 20 days late,
	// 20,000,000 × 4.5% × 20 / 365 = 49,315.07, whole đồng 49,315; paid 14 October is 14 days, under the threshold.
	const LATE = 'c1c1c1c1-0000-4000-8000-0000000000d7';
	const { slips, warnings } = buildStatutory(
		{
			code: 'VN',
			period: '2026-10',
			region: 'I',
			people: [
				{ key: 'VN-LATE-20', wage: 20_000_000, citizenship: 'CITIZEN' },
				{ key: 'VN-LATE-14', wage: 20_000_000, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			world.adhoc_catalogue.push({
				id: LATE,
				settings_id: settingsIdOn('VN', '2026-10-15'),
				code: 'LATE_WAGE_FIXTURE',
				name: 'Late-wage compensation (fixture)',
				authority: 'Labour Code 45/2019/QH14 art.97(4)',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [
					{
						when: 'entry.late_wage.days >= 15',
						amount:
							'entry.amount * entry.late_wage.deposit_rate / 100.0 * double(entry.late_wage.days) / 365.0',
						limit: null
					}
				],
				counts_toward: [],
				raised_by: 'MANUAL',
				approval_id: null
			});
			for (const [index, [employment, paidOn]] of [
				[world.employments[0]!, '2026-10-20'],
				[world.employments[1]!, '2026-10-14']
			].entries())
				world.adhoc_requests!.push({
					id: `d4000000-0000-4000-8000-0000000000e${index}`,
					employment_id: (employment as { id: string }).id,
					catalogue_id: LATE,
					amount: 20_000_000,
					event_date: paidOn as string,
					pay_period: '2026-10',
					payslip_id: null,
					reason: 'September wages paid late',
					evidence_file: null,
					as_adjustment_entry: false,
					late_wage: {
						due_on: '2026-09-30',
						paid_on: paidOn as string,
						deposit_rate: 4.5,
						rate_reference: 'Fixture bank notice',
						force_majeure: false
					},
					approval_id: null
				});
		}
	);
	assert.equal(slips.get('VN-LATE-20')!.gross, 20_049_315);
	assert.equal(slips.get('VN-LATE-14')!.gross, 20_000_000);
	assert.ok(warnings.some((line) => line.includes('no band of the catalogue covers this entry')));
});

test('Vietnam — a work stoppage pays by its cause: full wage, nothing, or the agreed rate floored at the minimum wage for the first 14 working days (Labour Code art.99)', () => {
	// Labour Code 45/2019 art.99 (Official Gazette 993+994, 26-12-2019): (1) the employer's fault
	// pays the full contract wage; (2) the worker at fault is unpaid, and co-workers who must stop are
	// paid the agreed rate, not below the minimum wage; (3) a utility failure not the employer's fault
	// (and disaster, fire, epidemic, enemy action, ordered relocation, economic reasons) pays the
	// agreed stoppage wage, not below the minimum wage for the first 14 working days.
	// Region I from 1 January 2026 is 5,310,000 (Decree 293/2025). The contract is 11,000,000; the
	// fixture's September and October each hold 22 Monday-to-Friday working days, so a day is
	// 500,000 and the day's floor 5,310,000 / 22 = 241,363.64 (the minimum wage on the wage's own
	// working-day divisor): a floored day deducts 500,000 − 241,363.6364 = 258,636.3636.
	const july = settingsIdOn('VN', '2026-10-15');
	const code = (leave: string) => rowIn(leaveCatalogue('VN'), july, leave);
	const weekdays = (from: string, to: string) => {
		const dates: string[] = [];
		for (
			let day = new Date(`${from}T00:00:00Z`);
			day <= new Date(`${to}T00:00:00Z`);
			day.setUTCDate(day.getUTCDate() + 1)
		)
			if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
				dates.push(day.toISOString().slice(0, 10));
		return dates;
	};
	const cases: [string, string, string, string, number | null, string | null][] = [
		// A 16-working-day utility stoppage from Monday 21 September, filed as one entry per month.
		['VN-STOP-UTILITY', 'STOPPAGE_OBJECTIVE', '2026-09-21', '2026-09-30', 0.3, '2026-09-21'],
		['VN-STOP-UTILITY', 'STOPPAGE_OBJECTIVE', '2026-10-01', '2026-10-12', 0.3, '2026-09-21'],
		// The same days naming no event date: each entry is its own event, so every day is floored.
		['VN-STOP-SPLIT', 'STOPPAGE_OBJECTIVE', '2026-09-21', '2026-09-30', 0.3, null],
		['VN-STOP-SPLIT', 'STOPPAGE_OBJECTIVE', '2026-10-01', '2026-10-12', 0.3, null],
		['VN-STOP-COWORKER', 'STOPPAGE_COWORKER', '2026-10-01', '2026-10-09', 0.7, null],
		['VN-STOP-UNAGREED', 'STOPPAGE_COWORKER', '2026-10-01', '2026-10-09', null, null],
		['VN-STOP-OWN', 'STOPPAGE_WORKER_FAULT', '2026-10-01', '2026-10-09', null, null],
		['VN-STOP-EMPLOYER', 'STOPPAGE_EMPLOYER_FAULT', '2026-10-01', '2026-10-09', null, null]
	];
	const keys = [...new Set(cases.map(([key]) => key))];
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-10',
			region: 'I',
			people: keys.map((key) => ({ key, wage: 11_000_000, citizenship: 'CITIZEN' }))
		},
		(world) => {
			world.leave_catalogue.push(
				...leaveCatalogue('VN')
					.filter((row) => row.settings_id === july && row.code.startsWith('STOPPAGE_'))
					.map((row) => ({ ...row, approval_id: null }))
			);
			for (const [index, [key, leave, from, to, agreed, event]] of cases.entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				const dates = weekdays(from, to);
				world.leave_entries.push({
					id: `e1990000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: code(leave),
					leave_code: leave,
					reference: `STOP-${index}`,
					from_date: from,
					to_date: to,
					half_day_start: false,
					half_day_end: false,
					days: dates.length,
					effective_on: from,
					event_date: event,
					agreed_pay_fraction: agreed,
					reason: 'Labour Code art.99',
					allocations: [],
					charges: dates.map((date) => ({
						date,
						days: 1,
						catalogue_id: code(leave),
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				});
			}
		}
	);
	const absence = (key: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.bucket === 'ABSENCE')
			.reduce((total, row) => total + row.amount, 0);
	const last = (key: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.bucket === 'ABSENCE')
			.toSorted((a, b) => String(a.date).localeCompare(String(b.date)))
			.slice(-2)
			.map((row) => row.amount);
	// Art.99(3): days 1–14 (21 September to 8 October) at the floor, days 15–16 (9 and 12 October)
	// at the agreed 30%, whole đồng per month: September's 8 days 8 × 258,636.3636 = 2,069,090.91 →
	// 2,069,091; October's 6 floored and 2 agreed 1,551,818.18 + 2 × 350,000 = 2,251,818.18 →
	// 2,251,818. Deducted 4,320,909; paid for the stoppage 14 × 241,363.64 + 2 × 150,000 =
	// 3,679,090.91, not below 5,310,000 × 14 / 22 = 3,379,090.91 for the first fourteen days.
	assert.equal(absence('VN-STOP-UTILITY'), 4_320_909);
	assert.deepEqual(last('VN-STOP-UTILITY'), [350_000, 350_000]);
	// Unlinked, the October entry restarts the count: 16 floored days, 2,069,091 a month.
	assert.equal(absence('VN-STOP-SPLIT'), 4_138_182);
	// Art.99(2) co-workers: the agreed 70% above the floor, 7 × 150,000; with nothing agreed, the floor.
	assert.equal(absence('VN-STOP-COWORKER'), 1_050_000);
	// 7 × 258,636.3636 = 1,810,454.55 → 1,810,455.
	assert.equal(absence('VN-STOP-UNAGREED'), 1_810_455);
	// Art.99(2) the worker at fault: 7 × 500,000 unpaid. Art.99(1) the employer's fault: nothing off.
	assert.equal(absence('VN-STOP-OWN'), 3_500_000);
	assert.equal(absence('VN-STOP-EMPLOYER'), 0);
});

test('Vietnam — the seeded art.97(4) class pays interest at the payroll bank’s 1-month rate on actual days over 365 for a delay of 15 days or more, force majeure or not (Labour Code art.97(4); Circular 14/2017/TT-NHNN art.4)', () => {
	// Art.97(4) (Official Gazette 993+994, 26-12-2019, p.43): a delay of 15 days or more earns at
	// least the interest on the late sum at the 1-month term-deposit rate the payroll bank publishes on
	// the payment day. The day count is the owner rule of 2026-09-28 (VN-LC97-01): Circular
	// 14/2017/TT-NHNN art.4(1) (Official Gazette 793+794, 23-10-2017, p.29), a rate is % a year of 365
	// days; art.4(2)(a) counts the first day out and the last day in, so days = paid − due.
	// Rate: Vietcombank's published VND 1-month rate, 2.10% a year, rate table updated 09:31
	// 28/09/2026 (https://www.vietcombank.com.vn/vi-VN/KHCN/Cong-cu-tien-ich/KHCN---Lai-suat, read in
	// the in-app browser 2026-09-28; the page states actual days on a 365-day basis).
	// August wages 20,000,000 due Thursday 10 September, paid Monday 28 September: 18 days,
	// 20,000,000 × 2.10% × 18 / 365 = 20,712.33, rounded up to 20,713 (never below the minimum).
	// Force majeure changes nothing (owner rule: any delay of 15 days or more). Paid Thursday 24
	// September is 14 days: below the threshold, no band — the rate there is never read.
	const version = settingsIdOn('VN', '2026-09-28');
	const cases: [string, string, boolean][] = [
		['VN-LATE-18', '2026-09-28', false],
		['VN-LATE-FM', '2026-09-28', true],
		['VN-LATE-14', '2026-09-24', false]
	];
	const { slips, warnings } = buildStatutory(
		{
			code: 'VN',
			period: '2026-09',
			region: 'I',
			people: [...cases.map(([key]) => key), 'VN-ONTIME'].map((key) => ({
				key,
				wage: 20_000_000,
				citizenship: 'CITIZEN'
			}))
		},
		(world) => {
			for (const [index, [key, paidOn, forceMajeure]] of cases.entries())
				world.adhoc_requests!.push({
					id: `d4000000-0000-4000-8000-0000000000f${index}`,
					employment_id: world.employments.find((row) => row.employee_number === key)!.id,
					catalogue_id: rowIn(adhocCatalogue('VN'), version, 'LATE_WAGE_COMPENSATION'),
					amount: 20_000_000,
					event_date: paidOn,
					pay_period: '2026-09',
					payslip_id: null,
					reason: 'August wages paid late',
					evidence_file: null,
					as_adjustment_entry: false,
					late_wage: {
						due_on: '2026-09-10',
						paid_on: paidOn,
						deposit_rate: 2.1,
						rate_reference: 'Vietcombank VND 1-month rate table, 28/09/2026',
						force_majeure: forceMajeure
					},
					approval_id: null
				});
		}
	);
	const onTime = slips.get('VN-ONTIME')!;
	for (const key of ['VN-LATE-18', 'VN-LATE-FM']) {
		const slip = slips.get(key)!;
		assert.equal(slip.gross, 20_000_000 + 20_713);
		// Taxable (owner rule), not insured: PIT base up by 20,713, SI base unchanged.
		assert.equal(charge(slip, 'PIT')[0] - charge(onTime, 'PIT')[0], 20_713);
		assert.deepEqual(charge(slip, 'SI'), charge(onTime, 'SI'));
	}
	assert.equal(slips.get('VN-LATE-14')!.gross, 20_000_000);
	assert.ok(warnings.some((line) => line.includes('no band of the catalogue covers this entry')));
});

test('Vietnam — an open-ended contract uses progressive withholding while active and 10% when paid after resignation (Decree 253/2026 art.50(2))', () => {
	// The 14 September 2026 Hanoi Tax Authority answer applies art.50(2) to wages paid after
	// termination, including an open-ended contract. The September wage is one dated payment.
	const pit = (period: string) =>
		charge(
			buildStatutory(
				{
					code: 'VN',
					period,
					region: 'I',
					people: [
						{
							key: 'VN-RESIGN',
							wage: 30_000_000,
							citizenship: 'CITIZEN',
							hire_date: '2026-08-01',
							exit_date: '2026-09-18',
							exit_reason: 'RESIGNATION',
							...(period === '2026-09'
								? {
										registrations: {
											PIT: {
												kind: 'REGISTERED' as const,
												unit_assessments: [
													{
														period,
														gross: 19_090_909,
														units: 1,
														reference: 'FINAL-WAGE',
														paid_on: '2026-09-30'
													}
												]
											}
										}
									}
								: {})
						}
					]
				},
				(world) => {
					world.companies[0]!.pay_cutoff_day = 1;
				}
			).slips.get('VN-RESIGN')!,
			'PIT'
		)[1];
	// August: 30,000,000 − 3,150,000 (10.5%) − 15,500,000 = 11,350,000 → 500,000 + 1,350,000 × 10%.
	assert.equal(pit('2026-08'), 635_000);
	// September, 14 of 22 working days: 19,090,909 paid after exit × 10%.
	assert.equal(pit('2026-09'), 1_909_091);
});

test('Vietnam — a foreigner on an open-ended contract who resigns stays insured (Law 41/2024 art.2(2); HI Law art.12(1)(c))', () => {
	// Coverage turns on the contract signed, not the stint served: an indefinite contract resigned
	// after five and a half months never had a term under twelve months.
	const build = (period: string) =>
		buildStatutory(
			{
				code: 'VN',
				period,
				region: 'I',
				people: [
					{
						key: 'VN-F-RESIGN',
						wage: 30_000_000,
						citizenship: 'FOREIGNER',
						gender: 'MALE',
						hire_date: '2026-04-01',
						exit_date: '2026-09-18',
						exit_reason: 'RESIGNATION',
						...(period === '2026-09'
							? {
									registrations: {
										PIT: {
											kind: 'REGISTERED' as const,
											unit_assessments: [
												{
													period,
													gross: 19_090_909,
													units: 1,
													reference: 'FINAL-WAGE',
													paid_on: '2026-09-30'
												}
											]
										}
									}
								}
							: {})
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
			}
		);
	const slip = (period: string) => build(period).slips.get('VN-F-RESIGN')!;
	for (const period of ['2026-08', '2026-09']) {
		const payslip = slip(period);
		// SI 8% / 17.5%, HI 1.5% / 3% of the contract wage, union fee 2% employer.
		assert.deepEqual(charge(payslip, 'SI'), [30_000_000, 2_400_000, 5_250_000]);
		assert.deepEqual(charge(payslip, 'HI'), [30_000_000, 450_000, 900_000]);
		assert.deepEqual(build(period).companyCharges.get('UNION_FEE'), [30_000_000, 600_000]);
	}
	// August: 30,000,000 − 2,850,000 − 15,500,000 = 11,650,000 → 500,000 + 1,650,000 × 10%.
	assert.equal(charge(slip('2026-08'), 'PIT')[1], 665_000);
	// September's wage is paid after exit: 10% of 19,090,909.
	assert.equal(charge(slip('2026-09'), 'PIT')[1], 1_909_091);
});

test('Vietnam — a fixed-term contract under one full month is outside SI, HI and UI and owed the employer’s rate as wages (Law 41/2024 art.2(1)(a); HI Law art.12(1)(a); Law 74/2025 art.31(1)(a); Labour Code art.168(3))', () => {
	const september = settingsIdOn('VN', '2026-09-15');
	const short = {
		wage: 30_000_000,
		citizenship: 'CITIZEN',
		hire_date: '2026-09-01',
		exit_date: '2026-09-21',
		exit_reason: 'END_OF_CONTRACT',
		registrations: {
			PIT: {
				kind: 'REGISTERED',
				unit_assessments: [
					{
						period: '2026-09',
						gross: 24_852_272,
						units: 1,
						reference: 'SEP-PAY',
						paid_on: '2026-09-30'
					}
				]
			}
		}
	};
	const { slips, companyCharges } = buildStatutory(
		{
			code: 'VN',
			period: '2026-09',
			region: 'I',
			people: [
				{ key: 'VN-21D', ...short },
				{ key: 'VN-21D-EQ', ...short },
				// 1 to 30 September is one full month: insured.
				{
					...short,
					key: 'VN-1M',
					exit_date: '2026-09-30',
					registrations: {
						PIT: {
							kind: 'REGISTERED',
							unit_assessments: [
								{
									period: '2026-09',
									gross: 30_000_000,
									units: 1,
									reference: 'SEP-PAY',
									paid_on: '2026-09-30'
								}
							]
						}
					}
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			const row = world.allowance_catalogue.find(
				(item) => item.code === 'INSURANCE_EQUIVALENT' && item.settings_id === september
			)!;
			assignAllowance(world, {
				id: 'd0000000-0000-4000-8000-0000000000f0',
				employment_id: world.employments.find((item) => item.employee_number === 'VN-21D-EQ')!.id,
				catalogue_id: row.id,
				amount: 0,
				effective_from: '2026-09-01',
				effective_to: null,
				reason: 'art.168(3)',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const paid = (key: string, code: string) => {
		const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	for (const code of ['SI', 'HI', 'UI']) assert.deepEqual(paid('VN-21D', code), [0, 0], code);
	// 21 days (1–21 September) is no full month, so the 10% short-contract withholding applies to
	// the 15 of 22 working days paid, 30,000,000 × 15 / 22 = 20,454,545, plus the owed equivalent
	// below (4,397,727): 24,852,272 × 10% = 2,485,227.
	assert.equal(paid('VN-21D', 'PIT')[0], 2_485_227);
	// The equivalent is owed without an HR row (LC art.168(3)): the same line as the listed one.
	assert.equal(
		slips.get('VN-21D')!.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')?.amount,
		4_397_727
	);
	// The equivalent: 17.5% SI + 3% HI + 1% UI of the 30,000,000 it would have insured = 6,450,000,
	// paid like any standing row for the 15 of 22 working days: 6,450,000 × 15 / 22 = 4,397,727.
	// Art.168(3) sets no part-month rule; proration is the recorded default (register VN-LC168-01).
	assert.equal(
		slips.get('VN-21D-EQ')!.base.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')
			?.amount,
		4_397_727
	);
	// One full month: 8% / 17.5%, 1.5% / 3%, 1% / 1% of 30,000,000.
	assert.deepEqual(paid('VN-1M', 'SI'), [2_400_000, 5_250_000]);
	assert.deepEqual(paid('VN-1M', 'HI'), [450_000, 900_000]);
	assert.deepEqual(paid('VN-1M', 'UI'), [300_000, 300_000]);
	// The union fee (2% of the SI salary fund) carries only the insured contract.
	assert.deepEqual(companyCharges.get('UNION_FEE'), [30_000_000, 600_000]);
});

test('Vietnam — through December 2025 a short fixed-term contract is outside SI and HI but insured for UI (Law 38/2013 art.43(1)(b))', () => {
	const { slips } = buildStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'I',
		people: [
			{
				key: 'VN-DEC-21D',
				wage: 30_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2025-12-01',
				exit_date: '2025-12-21',
				exit_reason: 'END_OF_CONTRACT',
				registrations: {
					PIT: {
						kind: 'REGISTERED',
						unit_assessments: [
							{
								period: '2025-12',
								gross: 23_576_087,
								units: 1,
								reference: 'DEC-PAY',
								paid_on: '2025-12-31'
							}
						]
					}
				}
			}
		]
	});
	const paid = (code: string) => {
		const row = slips.get('VN-DEC-21D')!.statutory.find((item) => item.scheme_code === code);
		return [row?.base_amount ?? 0, row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	assert.deepEqual(paid('SI'), [0, 0, 0]);
	assert.deepEqual(paid('HI'), [0, 0, 0]);
	// Art.43(1)(b) names every fixed-term contract, with no minimum: 1% / 1% of 30,000,000.
	assert.deepEqual(paid('UI'), [30_000_000, 300_000, 300_000]);
});

test('Vietnam — a worker on a probation contract is outside UI from 2026 (Law 74/2025 art.31(2))', () => {
	for (const period of ['2026-01', '2026-06', '2026-09']) {
		const { slips } = buildStatutory(
			{
				code: 'VN',
				period,
				region: 'I',
				people: [
					{
						key: 'VN-PROBATION',
						wage: 20_000_000,
						citizenship: 'CITIZEN',
						employment_type: 'PROBATION',
						hire_date: `${period}-01`
					},
					{
						key: 'VN-PERMANENT',
						wage: 20_000_000,
						citizenship: 'CITIZEN',
						hire_date: `${period}-01`
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
			}
		);
		const ui = (key: string) => {
			const row = slips.get(key)!.statutory.find((item) => item.scheme_code === 'UI');
			return [row?.base_amount ?? 0, row?.employee_amount ?? 0, row?.employer_amount ?? 0];
		};
		// Art.31(2): "người lao động đang làm việc theo hợp đồng thử việc" is not a UI participant.
		assert.deepEqual(ui('VN-PROBATION'), [0, 0, 0], period);
		// Control: the same wage on a labour contract, 1% / 1% of 20,000,000.
		assert.deepEqual(ui('VN-PERMANENT'), [20_000_000, 200_000, 200_000], period);
	}
});

test('Vietnam — the 3,000,000 voluntary pension cap reaches back to January 2026 under the pre-July versions (Decree 253/2026 art.46(2)(a), art.69(1)(a))', () => {
	// Decree 253/2026 art.46(2)(a) (Official Gazette 402): supplementary pension, voluntary pension
	// and life insurance premiums are deducted up to 3,000,000 a month in total, employer and
	// employee shares together. Art.69(1)(a): the resident salary rules apply from tax period 2026,
	// so February 2026 (the 1 January 2026 version) already takes the 3,000,000 cap, not the
	// 1,000,000 of Circular 111/2013 art.9(2)(b) as replaced by Circular 92/2015 art.15.
	// 30,000,000 salary, Region I: SI 8% 2,400,000 + HI 1.5% 450,000 + UI 1% 300,000 = 3,150,000.
	// 4,000,000 paid → 3,000,000 deducted: 30,000,000 − 3,150,000 − 15,500,000 (Resolution 110/2025)
	// − 3,000,000 = 8,350,000 × 5% (first band of the 2026 table, ≤10,000,000) = 417,500.
	// 2,500,000 paid → deducted whole: 8,850,000 × 5% = 442,500.
	const claim = (amount: number) => ({
		PIT: {
			kind: 'REGISTERED',
			deduction_claims: [
				{
					period: '2026-02',
					category: 'VOLUNTARY_PENSION',
					amount,
					source: 'EMPLOYEE',
					reference: 'VP-FEB'
				}
			]
		}
	});
	const book = assessStatutory({
		code: 'VN',
		period: '2026-02',
		region: 'I',
		people: [
			{ key: 'VP-4M', wage: 30_000_000, citizenship: 'CITIZEN', registrations: claim(4_000_000) },
			{ key: 'VP-2.5M', wage: 30_000_000, citizenship: 'CITIZEN', registrations: claim(2_500_000) }
		]
	});
	expectStatutory(book, 'VP-4M', 'PIT', 417_500, 0);
	expectStatutory(book, 'VP-2.5M', 'PIT', 442_500, 0);
});
