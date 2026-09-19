/**
 * Philippines: expected payslips against the law itself.
 *
 * SSS Circular 2024-006 (schedule effective January 2025); PhilHealth Advisory 2025-0002;
 * HDMF Circular 460; BIR Annex "E" to RR 11-2018, the monthly withholding table.
 *
 * Every contribution figure below is derived by hand from those instruments, on the monthly wage
 * itself. The regime prorates on `FIXED_DAYS: 21.75` — the DOLE factor 261/12, a *working*-day
 * denominator — and a monthly-paid employee present the whole month earns the whole monthly rate
 * (DOLE Handbook ch. 2 §E), so a full January prorates to exactly 1 and the base a scheme
 * accumulates IS the wage. The first test pins that; the rest price it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	expectStatutory,
	expectStatutoryBase,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import {
	absenceDayRate,
	ordinaryDivisorDays
} from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { priceWorkDay } from '../src/lib/payroll/work-bands.ts';
import { leaveCatalogue, settingsVersions } from './fixtures/statutory-world.ts';

const PH_PEOPLE = [
	{ key: 'PH-4000', wage: 4000, age: 25 },
	// 30,000 and not 30,250: 30,250 is the exact floor of an SSS bracket, where the published
	// schedule ("30,250 – 30,749.99 → MSC 30,500") and the engine's ceiling-inclusive band rule
	// ("exceeding 29,750 but not exceeding 30,250" → MSC 30,000) name different rows. That seam is
	// its own question; every wage here sits inside a bracket, where the two agree.
	{ key: 'PH-30000', wage: 30_000 },
	{ key: 'PH-40000', wage: 40_000, age: 61 }
];

test('Philippines — a whole month on FIXED_DAYS 21.75 prorates to one, so the base is the wage', () => {
	const book = assessStatutory({ code: 'PH', period: '2026-01', people: PH_PEOPLE });
	// The regime's proration is `FIXED_DAYS: 21.75` for every employee, monthly-paid included,
	// because `proration` takes no predicate rows (bank README NOT APPLIED #16; the `ordinary_rate`
	// predicate on `terms.payroll_group == "MONTHLY"` that separates the two populations prices
	// overtime only, never the salary line).
	//
	// 21.75 is the DOLE Monday-to-Friday factor 261/12 — a count of WORKING days — so the numerator
	// counts working days too, and a whole period is a whole month's salary whatever that month's
	// working days come to. January 2026 pays 4,000.00, not 4,000 × 31/21.75 = 5,701.15.
	expectStatutoryBase(book, 'PH-4000', 'SSS', 4000);
	expectStatutoryBase(book, 'PH-30000', 'SSS', 30_000);
	expectStatutoryBase(book, 'PH-40000', 'SSS', 40_000);
});

test('Philippines — SSS, EC, PhilHealth, Pag-IBIG and the monthly withholding table', () => {
	const book = assessStatutory({ code: 'PH', period: '2026-01', people: PH_PEOPLE });

	// SSS: 15% of the monthly salary credit, employer 10% and employee 5%, in ₱500-wide brackets.
	// 4,000 is below the ₱5,250 first rung, so it insures at the ₱5,000 minimum MSC: 250 / 500.
	// 30,000 is the MSC of the 29,750–30,250 bracket: 1,500 / 3,000.
	// 40,000 is above the last bracket, so it insures at the ₱35,000 ceiling MSC: 1,750 / 3,500
	// (the Regular SS / MPF split of Circular 2024-006 §II.B.2 is a remittance attribution the
	// seed does not carry — bank README NOT APPLIED #3 — so one employer figure is asserted).
	expectStatutory(book, 'PH-4000', 'SSS', 250, 500);
	expectStatutory(book, 'PH-30000', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-30000', 'SSS_MPF', 500, 1000);
	expectStatutory(book, 'PH-40000', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-40000', 'SSS_MPF', 750, 1500);

	// Employees' Compensation: employer only, ₱10 for MSC 14,500 and below and ₱30 from MSC 15,000
	// — the seeded seam sits at compensation 14,750.
	expectStatutory(book, 'PH-4000', 'SSS_EC', 0, 10);
	expectStatutory(book, 'PH-30000', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-40000', 'SSS_EC', 0, 30);

	// PhilHealth: one 5% premium on a monthly basic salary floored at ₱10,000 and capped at
	// ₱100,000, then split — employee = truncate_cent(premium / 2), employer = the rest (the
	// employer table; the half-centavo case is pinned below).
	// 4,000 → the floor: 2.5% × 10,000 = 250 each. 30,000 → 750 each. 40,000 → 1,000 each.
	expectStatutory(book, 'PH-4000', 'PHIC', 250, 250);
	expectStatutory(book, 'PH-30000', 'PHIC', 750, 750);
	expectStatutory(book, 'PH-40000', 'PHIC', 1000, 1000);

	// Pag-IBIG: 1% employee / 2% employer at a fund salary of ₱1,500 and below, 2% / 2% above,
	// and the fund salary is capped at ₱10,000 — so ₱200 each is the maximum.
	// 4,000 → 2% = 80 each. The two higher wages → the ₱200 cap each side.
	expectStatutory(book, 'PH-4000', 'HDMF', 80, 80);
	expectStatutory(book, 'PH-30000', 'HDMF', 200, 200);
	expectStatutory(book, 'PH-40000', 'HDMF', 200, 200);

	// Withholding tax: the BIR monthly table applied to the period directly — no annualising and
	// no spreading — on compensation net of the three mandatory employee contributions, which the
	// seed relieves into WTAX.
	//
	// 4,000 is under the region's minimum wage: a minimum wage earner's wage is exempt (NIRC
	// s.24(A)(2), RR 10-2008), so there is no compensation to withhold on and no WTAX row.
	expectStatutorySkipped(book, 'PH-4000', 'WTAX');
	// 30,000 − (1,500 + 750 + 200) = 27,550. Row "20,833–33,332 → 0 + 15% of the excess over
	// 20,833": 15% × 6,717 = 1,007.55.
	expectStatutory(book, 'PH-30000', 'WTAX', 1007.55, 0);
	// 40,000 − (1,750 + 1,000 + 200) = 37,050. Row "33,333–66,666 → 1,875.00 + 20% of the excess
	// over 33,333": 1,875 + 3,717 × 20% = 1,875 + 743.40 = 2,618.40.
	expectStatutory(book, 'PH-40000', 'WTAX', 2618.4, 0);
});

test('Philippines — February relieves February’s contributions, not the year’s (RR 2-98 s.2.78.1)', () => {
	// The monthly table is applied to the period's compensation net of the employee SSS, PhilHealth
	// and Pag-IBIG deducted from that pay. With a January payslip on file the relief read had been
	// the year to date — January's 2,450 again in February — so a ₱30,000 wage withheld 640.05 in
	// February instead of the 1,007.55 the table prescribes every month.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-02', people: [{ key: 'PH-30000', wage: 30_000 }] },
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'PH-30000');
			assert.ok(employment);
			world.payroll_runs.push({ id: 'prior-2026-01', company_id: COMPANY_ID, period: '2026-01' });
			world.payslips.push({
				id: 'payslip-2026-01',
				payroll_run_id: 'prior-2026-01',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-01-28T00:00:00.000Z',
				currency: 'PHP',
				base: [],
				adjustments: [],
				statutory: [
					['WTAX', 1_007.55, 0],
					['SSS', 1_500, 3_000],
					['PHIC', 750, 750],
					['HDMF', 200, 200]
				].map(([scheme_code, employee_amount, employer_amount]) => ({
					scheme_code,
					employee_amount,
					employer_amount,
					base_amount: 30_000,
					rule_when: null,
					authority: null
				}))
			});
		}
	);
	expectStatutory(book, 'PH-30000', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-30000', 'SSS_MPF', 500, 1000);
	expectStatutory(book, 'PH-30000', 'WTAX', 1007.55, 0);
});

test('Philippines — the December 2025 version prices the same schedules', () => {
	// The bank cuts a second version on 2026-01-01 that adds a payment code and moves no statutory
	// value: every schedule below is the one the 2026-01 golden prices.
	const book = assessStatutory({ code: 'PH', period: '2025-12', people: PH_PEOPLE });
	expectStatutory(book, 'PH-30000', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-30000', 'SSS_MPF', 500, 1000);
	expectStatutory(book, 'PH-30000', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-30000', 'PHIC', 750, 750);
	expectStatutory(book, 'PH-30000', 'HDMF', 200, 200);
	expectStatutory(book, 'PH-4000', 'SSS', 250, 500);
	expectStatutory(book, 'PH-40000', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-40000', 'SSS_MPF', 750, 1500);
});

test('Philippines — a half-centavo PhilHealth premium is split employee-down, employer-up (OPSPH010)', () => {
	// The premium is ONE figure, 5% of the monthly basic to the centavo, and the shares divide it:
	// 15,819 → 790.95 → 395.47 employee, 395.48 employer (the entity's own listing: 380.31 / 380.32
	// on its netted 15,212.40). Two independent 2.5% legs paid 395.48 twice, a centavo over the
	// premium (bank README, formerly NOT APPLIED #1).
	for (const period of ['2026-01', '2025-12']) {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [{ key: 'PH-15819', wage: 15_819 }]
		});
		expectStatutory(book, 'PH-15819', 'PHIC', 395.47, 395.48);
	}
});

test('Philippines — the rice subsidy is de minimis and outside withholding (RR 2-98 s.2.78.1(A)(3)(d))', () => {
	// OPSPH003: ₱32,000 basic, ₱2,100 transport, ₱600 communication (taxable) and a ₱1,300 rice
	// subsidy keyed on the `meal` row. The subsidy is de minimis up to ₱2,500 a month (RR 29-2025;
	// ₱2,000 under RR 11-2018 on the December 2025 version), so the monthly table reads
	// 32,000 + 2,700 − (1,750 + 800 + 200) = 31,950: 15% × (31,950 − 20,833) = 1,667.55 — the
	// entity's own cell. With the subsidy inside the base it withheld 1,862.55.
	const MEAL = {
		'2026-01': '874b6d04-8bf1-4d59-b4c4-18daf98a98e5',
		'2025-12': '89df9fab-45d9-585a-b243-4ddadcf1d0c4'
	};
	const TRANSPORT = {
		'2026-01': '92e2ca4a-bd53-42f5-8b62-84e892da9954',
		'2025-12': 'a3fbd97a-0b76-546d-bc4c-e56ac46dc4ce'
	};
	for (const period of ['2026-01', '2025-12'] as const) {
		const book = assessStatutory(
			{ code: 'PH', period, people: [{ key: 'OPSPH003', wage: 32_000 }] },
			(world) => {
				const employment = world.employments[0]!;
				for (const [index, [catalogue_id, amount]] of [
					[MEAL[period], 1300],
					[TRANSPORT[period], 2700]
				].entries())
					world.allowances.push({
						id: `d3000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
						employment_id: employment.id,
						catalogue_id: String(catalogue_id),
						amount: Number(amount),
						effective_from: `${period}-01`,
						effective_to: null,
						reason: '',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
			}
		);
		// SSS and Pag-IBIG read the allowances, subsidy included (36,000 → MSC 35,000; the 10,000
		// fund-salary ceiling); PhilHealth reads the basic alone.
		expectStatutoryBase(book, 'OPSPH003', 'SSS', 36_000);
		expectStatutory(book, 'OPSPH003', 'SSS', 1000, 2000);
		expectStatutory(book, 'OPSPH003', 'SSS_MPF', 750, 1500);
		expectStatutory(book, 'OPSPH003', 'PHIC', 800, 800);
		expectStatutory(book, 'OPSPH003', 'HDMF', 200, 200);
		expectStatutoryBase(book, 'OPSPH003', 'WTAX', 34_700);
		// December is the year-end rung (RR 11-2018 s.16): the annual table on one month's income
		// owes nothing, so only the January period reads the monthly column.
		if (period === '2026-01') expectStatutory(book, 'OPSPH003', 'WTAX', 1667.55, 0);
	}
});

test('Philippines — a wage on an SSS bracket floor insures at that bracket, never at nothing', () => {
	// Circular 2024-006 names each bracket by its floor: "5,250 – 5,749.99 → MSC 5,500". A ladder
	// whose lower bound was the floor plus one centavo left the floor itself outside every rule,
	// and a wage of exactly ₱5,250.00 drew no SSS row at all. The rule is "exceeding the previous
	// ceiling", so the floor belongs to its own bracket, and the cent above a ceiling too.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-01',
		people: [
			{ key: 'PH-5250', wage: 5250 },
			{ key: 'PH-14750', wage: 14_750 },
			{ key: 'PH-30250', wage: 30_250 },
			{ key: 'PH-10000.01', wage: 10_000.01 },
			{ key: 'PH-1500.01', wage: 1500.01 }
		]
	});
	expectStatutory(book, 'PH-5250', 'SSS', 275, 550);
	// 14,750 is the floor of MSC 15,000, where EC steps from ₱10 to ₱30.
	expectStatutory(book, 'PH-14750', 'SSS', 750, 1500);
	expectStatutory(book, 'PH-14750', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-30250', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-30250', 'SSS_MPF', 525, 1050);
	// PhilHealth "10,000.01 to 99,999.99" and Pag-IBIG "over ₱1,500": the first centavo over the
	// floor is charged on the higher row.
	expectStatutory(book, 'PH-10000.01', 'PHIC', 250, 250);
	expectStatutory(book, 'PH-10000.01', 'HDMF', 200, 200);
	expectStatutory(book, 'PH-1500.01', 'HDMF', 30, 30);
});

test('Philippines — a semi-monthly company: the monthly schemes once a month, Annex E by column', () => {
	// Omni Plus pays twice a month. A MONTHLY contract inside that company is paid once, in the
	// second half, and that one payslip is its whole month: SSS, EC, PhilHealth and Pag-IBIG are
	// charged in full there (the engine used to read the company's cadence and charge nothing).
	const monthly = assessStatutory({
		code: 'PH',
		period: '2026-02-2',
		payFrequency: 'SEMI_MONTHLY',
		people: [{ key: 'PH-M-43000', wage: 43_000 }]
	});
	expectStatutory(monthly, 'PH-M-43000', 'SSS', 1000, 2000);
	expectStatutory(monthly, 'PH-M-43000', 'SSS_MPF', 750, 1500);
	expectStatutory(monthly, 'PH-M-43000', 'SSS_EC', 0, 30);
	expectStatutory(monthly, 'PH-M-43000', 'PHIC', 1075, 1075);
	expectStatutory(monthly, 'PH-M-43000', 'HDMF', 200, 200);
	// Annex E MONTHLY column on 43,000 − 3,025 = 39,975: 1,875 + 20% × (39,975 − 33,333).
	expectStatutory(monthly, 'PH-M-43000', 'WTAX', 3203.4, 0);

	// A SEMI_MONTHLY contract on ₱30,000 a month: the monthly schemes are charged once, in the
	// first half, on the month's wage; withholding reads the SEMI-MONTHLY column of Annex E
	// (₱10,417 / 16,667 / 33,333 …) on each half's own relieved base.
	const person = { key: 'PH-S-30000', wage: 30_000, pay_frequency: 'SEMI_MONTHLY' as const };
	const first = assessStatutory({
		code: 'PH',
		period: '2026-02-1',
		payFrequency: 'SEMI_MONTHLY',
		people: [person]
	});
	expectStatutory(first, 'PH-S-30000', 'SSS', 1000, 2000);
	expectStatutory(first, 'PH-S-30000', 'SSS_MPF', 500, 1000);
	expectStatutory(first, 'PH-S-30000', 'PHIC', 750, 750);
	expectStatutory(first, 'PH-S-30000', 'HDMF', 200, 200);
	// 15,000 − 2,450 = 12,550, in the ₱10,417–16,666 rung: 15% × (12,550 − 10,417) = 319.95.
	expectStatutory(first, 'PH-S-30000', 'WTAX', 319.95, 0);
	const second = assessStatutory({
		code: 'PH',
		period: '2026-02-2',
		payFrequency: 'SEMI_MONTHLY',
		people: [person]
	});
	// Nothing monthly is charged twice; the half's 15,000 carries no relief: 15% × (15,000 − 10,417).
	expectStatutory(second, 'PH-S-30000', 'SSS', 0, 0);
	expectStatutory(second, 'PH-S-30000', 'WTAX', 687.45, 0);
});

test('Philippines — December annualises the year and charges the difference (RR 11-2018 s.16)', () => {
	// The annual table is the TRAIN table: 15% of the excess over 250,000 to 400,000, then
	// 22,500 + 20% to 800,000, 102,500 + 25% to 2,000,000, 402,500 + 30% to 8,000,000,
	// 2,202,500 + 35% above. The monthly Annex E rows in the seed are that table divided by twelve.
	//
	// A 30,000 monthly wage contributes SSS 1,500, PHIC 750 and HDMF 200, so the monthly taxable
	// compensation is 27,550 and the monthly table withholds 15% of (27,550 − 20,833) = 1,007.55.
	// Annualised: 15% of (330,600 − 250,000) = 12,090. December charges 12,090 − 11,083.05 =
	// 1,006.95.
	const priorPeriods = [
		'2026-01',
		'2026-02',
		'2026-03',
		'2026-04',
		'2026-05',
		'2026-06',
		'2026-07',
		'2026-08',
		'2026-09',
		'2026-10',
		'2026-11'
	];
	const book = assessStatutory({ code: 'PH', period: '2026-12', people: PH_PEOPLE }, (world) => {
		const employment = world.employments.find((row) => row.employee_number === 'PH-30000');
		assert.ok(employment, 'the PH-30000 employment exists');
		for (const period of priorPeriods) {
			const runId = `prior-${period}`;
			world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period });
			world.payslips.push({
				id: `payslip-${period}`,
				payroll_run_id: runId,
				employment_id: employment.id,
				status: 'PAID',
				paid_at: `${period}-28T00:00:00.000Z`,
				currency: 'PHP',
				base: [],
				adjustments: [],
				statutory: [
					{
						scheme_code: 'WTAX',
						employee_amount: 1_007.55,
						employer_amount: 0,
						// The assessed-on result is the gross; the monthly rule subtracts the
						// contributions inside its expression, so the stored base is 30,000.
						base_amount: 30_000,
						rule_when: null,
						authority: null
					},
					{
						scheme_code: 'SSS',
						employee_amount: 1_500,
						employer_amount: 3_000,
						base_amount: 30_000,
						rule_when: null,
						authority: null
					},
					{
						scheme_code: 'PHIC',
						employee_amount: 750,
						employer_amount: 750,
						base_amount: 30_000,
						rule_when: null,
						authority: null
					},
					{
						scheme_code: 'HDMF',
						employee_amount: 200,
						employer_amount: 200,
						base_amount: 5_000,
						rule_when: null,
						authority: null
					}
				]
			});
		}
	});

	expectStatutory(book, 'PH-30000', 'WTAX', 1_006.95, 0);
});

test('Philippines — Wage Order IVA-22 by area, and its 1 April 2026 tranche as a sealed version', () => {
	// nwpc.dole.gov.ph/region-iva: non-agriculture ₱600 in the Extended Metropolitan Area and the
	// component cities, ₱550 in 1st-class municipalities, ₱510 in reclassified 1st-class and
	// 2nd–5th-class municipalities, the last two stepping to ₱550 and ₱525 on 1 April 2026. A
	// 13,000 basic in a 2nd–5th-class municipality clears the March floor (13,302.50 = 510 × 313 ÷
	// 12) by nothing and is under April's 13,693.75 — the run warns from April.
	const march = assessStatutory({
		code: 'PH',
		period: '2026-03',
		region: 'IV-A-2ND-5TH',
		people: [{ key: 'PH-13302', wage: 13_302.5 }]
	});
	assert.equal(march.get('PH-13302')!.get('SSS')!.base, 13_302.5);
	const april = assessStatutory({
		code: 'PH',
		period: '2026-04',
		region: 'IV-A-2ND-5TH',
		people: [{ key: 'PH-13302', wage: 13_302.5 }]
	});
	assert.equal(april.get('PH-13302')!.get('SSS')!.base, 13_302.5);
	const [before, after] = settingsVersions('PH')
		.filter((version) =>
			['2026-01-01', '2026-04-01'].includes(String(version.effective_range.start).slice(0, 10))
		)
		.map((version) => version.work_rules.wages.by_region['IV-A-2ND-5TH']);
	assert.deepEqual([before, after], [13_302.5, 13_693.75]);
	assert.equal(
		settingsVersions('PH').find((version) =>
			String(version.effective_range.start).startsWith('2026-04')
		)!.work_rules.wages.by_region['IV-A'],
		15_650
	);
});

test('Philippines — a weekly-paying company withholds on Annex E’s weekly column and charges the month’s schemes in the last week', () => {
	// RR 11-2018 Annex E: a weekly payslip of 10,000 with nothing deducted this week sits in the
	// weekly column's third bracket: 432.60 + 20% × (10,000 − 7,692) = 894.20. SSS, PhilHealth and
	// Pag-IBIG are assessed over the month (RA 11199, RA 11223, RA 9679) and a weekly company
	// charges them once, in the month's last week, on the month's wage — the weekly 10,000 × 52 ÷
	// 12 = 43,333.33 (SSS Circular 2014-002): MSC 35,000 — the regular 20,000 → 1,000 / 2,000, the
	// MPF 15,000 above it → 750 / 1,500. PhilHealth reads the monthly basic salary as the
	// version's own divisor states it (a five-day week: weekly ÷ 5 × 261 ÷ 12 = 43,500): 5% →
	// 1,087.50 each; Pag-IBIG the ₱200 cap each.
	const week2 = assessStatutory({
		code: 'PH',
		period: '2026-03-2',
		payFrequency: 'WEEKLY',
		people: [{ key: 'PH-WEEKLY', wage: 10_000, pay_frequency: 'WEEKLY' }]
	});
	expectStatutory(week2, 'PH-WEEKLY', 'WTAX', 894.2, 0);
	// The other weeks of the month carry the month's schemes at zero: nothing is due, no formula read.
	expectStatutory(week2, 'PH-WEEKLY', 'SSS', 0, 0);
	expectStatutory(week2, 'PH-WEEKLY', 'PHIC', 0, 0);
	const week5 = assessStatutory({
		code: 'PH',
		period: '2026-03-5',
		payFrequency: 'WEEKLY',
		people: [{ key: 'PH-WEEKLY', wage: 10_000, pay_frequency: 'WEEKLY' }]
	});
	expectStatutoryBase(week5, 'PH-WEEKLY', 'SSS', 43_333.33);
	expectStatutory(week5, 'PH-WEEKLY', 'SSS', 1000, 2000);
	expectStatutory(week5, 'PH-WEEKLY', 'SSS_MPF', 750, 1500);
	expectStatutory(week5, 'PH-WEEKLY', 'PHIC', 1087.5, 1087.5);
	expectStatutory(week5, 'PH-WEEKLY', 'HDMF', 200, 200);
});

test('every sealed version of `PH` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('PH');
});

test('Philippines — the salary-based schemes are monthly schedules, not per-period ones', () => {
	// A semi-monthly company must charge SSS, EC, PhilHealth and Pag-IBIG once a month, on the
	// month's wage, rather than half of each twice. The engine's rule is generic; this pins the
	// catalogue to it, so a reseed that drops `assessed` fails here rather than over- or
	// under-charging every Philippine semi-monthly payroll.
	const read = (file: string): readonly { code: string; assessed?: string }[] =>
		JSON.parse(
			readFileSync(new URL(`./fixtures/statutory/PH/${file}`, import.meta.url), 'utf8')
		) as readonly { code: string; assessed?: string }[];
	const schemes = read('statutory_contributions.json');
	for (const code of ['SSS', 'SSS_EC', 'PHIC', 'HDMF']) {
		assert.equal(
			schemes.find((row) => row.code === code)?.assessment_period,
			'MONTH',
			`${code} must be assessed over the month`
		);
	}
	assert.notEqual(schemes.find((row) => row.code === 'WTAX')?.assessment_period, 'MONTH');
});

// ─────────────────────────────────────────────────────────────────────────────
// 13th month pay (P.D. 851; Revised Guidelines 1987; NIRC s.32(B)(7)(e)) — gap tracker §4.
//
// The catalogue row prices it — a twelfth of the basic salary earned in the year, to rank-and-file
// — and HR keys it as an allowance whose window is the month it is paid in; the band reads the
// year as it stands when the entry is priced. The ₱90,000 exclusion is the WTAX base entry's
// `annual_exempt`.
// ─────────────────────────────────────────────────────────────────────────────

const THIRTEENTH_MONTH_ID = '4fddc3cc-7bf8-42c4-8f43-7d9ef87605d6';

function payslipsOf(
	options: Parameters<typeof createStatutoryWorld>[0],
	window: { from: string; to: string }
) {
	const world = createStatutoryWorld(options);
	for (const [index, employment] of world.employments.entries())
		world.allowances.push({
			id: `d1000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: THIRTEENTH_MONTH_ID,
			amount: 1,
			effective_from: window.from,
			effective_to: window.to,
			reason: '13th month',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	const prepared = Effect.runSync(
		gatherPayrollRun({
			api: memoryPayrollApi(world),
			companyId: COMPANY_ID,
			period: options.period
		})
	);
	const built = buildPayrollRun(prepared);
	const slips = built.payslip_payroll_run;
	return (key: string) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		const slip = slips.find((row) => String(row.employment_id) === employment.id)!;
		const thirteenth = slip.adjustments.filter(
			(row) => row.component_code === 'THIRTEENTH_MONTH_PAY'
		);
		const wtax = slip.statutory.find((row) => row.scheme_code === 'WTAX')!;
		// The entry the run materialises for the month, priced at what the payslip paid.
		const entries = built.captures
			.filter((capture) => capture.payslipId === slip.id)
			.flatMap((capture) => capture.materialised)
			.map((row) => [row.collection, row.values.amount]);
		return { thirteenth, wtaxBase: wtax.base_amount, entries };
	};
}

test('Philippines — 13th month pay keyed for December is a twelfth of the year’s basic, and the excess over ₱90,000 is withheld on', () => {
	const slip = payslipsOf(
		{
			code: 'PH',
			period: '2026-12',
			people: [
				{ key: 'PH-30000', wage: 30_000 },
				// A twelfth above ₱90,000: the excess alone enters the withholding base.
				{ key: 'PH-1200000', wage: 1_200_000 },
				// Managerial employees are outside P.D. 851: the row's eligibility declines them.
				{ key: 'PH-MANAGER', wage: 30_000, work_classification: 'MANAGERIAL' }
			]
		},
		{ from: '2026-12-01', to: '2026-12-31' }
	);
	// No earlier payslip in the fixture year, so the year's basic is December's own salary.
	assert.deepEqual(
		slip('PH-30000').thirteenth.map((row) => [row.bucket, row.amount]),
		[['NON_WAGE_PAYMENT', 2500]]
	);
	assert.deepEqual(slip('PH-30000').entries, [['allowance_entries', 2500]]);
	assert.equal(slip('PH-30000').wtaxBase, 30_000);
	assert.deepEqual(
		slip('PH-1200000').thirteenth.map((row) => row.amount),
		[100_000]
	);
	assert.equal(slip('PH-1200000').wtaxBase, 1_210_000);
	assert.deepEqual(slip('PH-MANAGER').thirteenth, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Semi-monthly statutory timing — the entity's own sheet (OPSPH Salary Listings Jan–Jun 2026).
//
// SSS (RA 11199 s.18), PhilHealth (RA 11223 s.10) and Pag-IBIG (RA 9679 s.7) premiums are
// MONTHLY, on the month's compensation; the law leaves their timing across cut-offs to the
// employer, and the entity deducts the whole month on the mid-month cut-off
// (`semi_monthly_statutory_cutoff: FIRST`). Withholding follows the pay period (RR 2-98 Annex E,
// semi-monthly column). OPSPH006, January 2026, as the sheet shows it: basic 15,650 paid twice, a
// monthly taxable compensation of 17,761.89 — the sheet's own "To Calculate SSS/PAGIBIG" cell —
// so SSS MSC 18,000 (900 / 1,800 + EC 30), Pag-IBIG at the 10,000 ceiling (200 / 200), nothing
// statutory on the end-month cut-off, and no tax on either half.
//
// PhilHealth: the sheet nets that half's ₱600 unpaid day against the monthly basic (376.25 each
// on 15,050); RA 11223 bases the premium on the monthly basic salary itself, so the golden holds
// the law: 5% of 15,650 split, 391.25 each.
// ─────────────────────────────────────────────────────────────────────────────

const OPSPH006_ALLOWANCE = '1f36debb-0b79-4aab-966e-aae5251b1026';

function opsph006(period: string, cutoff: 'FIRST' | 'SPLIT' | 'LAST') {
	const person = { key: 'OPSPH006', wage: 15_650, pay_frequency: 'SEMI_MONTHLY' as const };
	return assessStatutory(
		{ code: 'PH', period, payFrequency: 'SEMI_MONTHLY', people: [person] },
		(world) => {
			world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			world.allowances.push({
				id: 'd2000000-0000-4000-8000-000000000001',
				employment_id: world.employments[0]!.id,
				catalogue_id: OPSPH006_ALLOWANCE,
				// The sheet's monthly taxable allowances: 17,761.89 − 15,650.
				amount: 2111.89,
				effective_from: '2026-01-01',
				effective_to: null,
				reason: '',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
}

test('Philippines — OPSPH006, January 2026: the month’s premiums on the mid-month cut-off, none at the end of the month', () => {
	const mid = opsph006('2026-01-1', 'FIRST');
	// The month's compensation is the half's lines twice over: 7,825 + 1,055.95 (the half's share
	// of 2,111.89, to the cent) × 2 — a cent above the sheet's own cell, inside the same bracket.
	expectStatutoryBase(mid, 'OPSPH006', 'SSS', 17_761.9);
	expectStatutory(mid, 'OPSPH006', 'SSS', 900, 1800);
	expectStatutory(mid, 'OPSPH006', 'SSS_EC', 0, 30);
	expectStatutory(mid, 'OPSPH006', 'PHIC', 391.25, 391.25);
	expectStatutory(mid, 'OPSPH006', 'HDMF', 200, 200);
	// The half's own taxable compensation, 8,880.95 less 1,491.25 of contributions, is under the
	// semi-monthly table's first rung of ₱10,417: nothing withheld.
	expectStatutory(mid, 'OPSPH006', 'WTAX', 0, 0);

	const end = opsph006('2026-01-2', 'FIRST');
	for (const code of ['SSS', 'SSS_EC', 'PHIC', 'HDMF'])
		expectStatutory(end, 'OPSPH006', code, 0, 0);
	expectStatutory(end, 'OPSPH006', 'WTAX', 0, 0);
});

test('Philippines — the entity may carry the month’s premiums on the end-month cut-off, or split them', () => {
	// LAST: the mid-month cut-off carries nothing and the end-month one the whole month.
	expectStatutory(opsph006('2026-01-1', 'LAST'), 'OPSPH006', 'SSS', 0, 0);
	expectStatutory(opsph006('2026-01-2', 'LAST'), 'OPSPH006', 'SSS', 900, 1800);
	// SPLIT: each half is priced on its own compensation, 8,880.95 → MSC 9,000.
	expectStatutory(opsph006('2026-01-1', 'SPLIT'), 'OPSPH006', 'SSS', 450, 900);
	expectStatutory(opsph006('2026-01-2', 'SPLIT'), 'OPSPH006', 'SSS', 450, 900);
});

// ─────────────────────────────────────────────────────────────────────────────
// Working time, the daily rate and leave: the law's numbers against the sealed regime.
// ─────────────────────────────────────────────────────────────────────────────

const rankAndFile = personContext({
	employee: null,
	employment: { service_start: '2020-01-01' },
	terms: { base_salary: { value: 30_000, currency: 'PHP' }, payroll_group: 'MONTHLY' },
	week: { ordinary_hours_per_week: 40, working_days_per_week: 5 },
	asOf: '2026-06-30'
});

/** One day priced on a version, on an hourly rate of 100 so an amount reads as hours × multiple. */
function priceDay(
	version: ReturnType<typeof settingsVersions>[number],
	dayType: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'SPECIAL_HOLIDAY',
	workedHours: number
) {
	return priceWorkDay({
		work: version.work_rules,
		person: rankAndFile,
		day: {
			workDayId: 'd',
			date: '2026-06-15',
			dayType,
			workedHours,
			normalHours: 8,
			overtimeHours: dayType === 'ORDINARY' ? workedHours - 8 : workedHours,
			breakMinutes: 60,
			holidayKind: '',
			holidayName: '',
			consecutiveHours: 4,
			continuousAttendance: false
		},
		rates: { ordinaryHour: 100, ordinaryDay: 800, dayWage: 800 }
	}).map((row) => [row.label, row.hours, Math.round(row.amount * 100) / 100]);
}

test('Philippines — Labor Code arts. 87, 93 and 94 premiums on every version', () => {
	for (const version of settingsVersions('PH')) {
		// Art.87: 25% on the hourly rate beyond eight hours.
		assert.deepEqual(priceDay(version, 'ORDINARY', 10), [['OT-1.25X', 2, 250]]);
		// Art.93(a): 130% for the first eight hours on a rest day; art.87 on top beyond: 169%.
		assert.deepEqual(priceDay(version, 'REST_DAY', 10), [
			['OT-1.3X', 8, 1040],
			['OT-1.69X', 2, 338]
		]);
		// Art.94(b): 200% for work on a regular holiday; 260% beyond eight hours.
		assert.deepEqual(priceDay(version, 'PUBLIC_HOLIDAY', 10), [
			['OT-2.0X', 8, 1600],
			['OT-2.6X', 2, 520]
		]);
		// Special (non-working) day: 130% and 169% (DOLE Handbook ch.3 §D.1, ch.4 §C.3).
		assert.deepEqual(priceDay(version, 'SPECIAL_HOLIDAY', 10), [
			['OT-1.3X', 8, 1040],
			['OT-1.69X', 2, 338]
		]);
		// Art.82: managerial employees are outside Title I, so outside the premiums.
		// Art.82: managerial staff, domestic helpers, field personnel and workers paid by results are
		// outside the hours-of-work rules.
		assert.equal(
			version.work_rules.overtime_when,
			'employment.classification != "MANAGERIAL" && employment.type != "DOMESTIC" && !(terms.statutory_work_category in ["FIELD_PERSONNEL", "PAID_BY_RESULTS"])'
		);
		// Art.94(b) over art.93: a regular holiday on a rest day is priced as the holiday.
		assert.equal(version.work_rules.holiday_rest_precedence, 'PUBLIC_HOLIDAY');
		// Art.83 and art.85: the eight-hour day and the unpaid hour for meals; art.91: one rest day
		// in seven.
		assert.deepEqual(
			version.work_rules.limits
				.filter((limit) => limit.measure !== 'CONSECUTIVE_WORK_DAYS')
				.map((limit) => [limit.measure, limit.max_hours]),
			[['NORMAL_HOURS', 8]]
		);
		// Art.85: the 60-minute unpaid meal period, and the 20-minute compensable one where the
		// work is continuous.
		assert.deepEqual(version.work_rules.breaks, [
			{ when: 'continuous_attendance', owed_minutes: '20.0', counts_as_worked_time: true },
			{ when: 'true', owed_minutes: '60.0', counts_as_worked_time: false }
		]);
		assert.equal(
			version.work_rules.limits.find((limit) => limit.measure === 'CONSECUTIVE_WORK_DAYS')
				?.max_days,
			6
		);
	}
});

test('Philippines — the DOLE daily-rate factors 365, 261 and 313', () => {
	// Handbook ch.2 §E: a monthly-paid employee's daily rate is monthly × 12 ÷ 365; a daily-paid
	// employee on a five-day week is ÷ 261 (21.75 a month), on a six-day week ÷ 313 (26.0833).
	for (const version of settingsVersions('PH')) {
		const divisor = (payroll_group: string, hours: number, days: number) =>
			ordinaryDivisorDays({
				expression: version.work_rules.ordinary_divisor_days,
				person: personContext({
					employee: null,
					employment: { service_start: '2020-01-01' },
					terms: { base_salary: { value: 30_000, currency: 'PHP' }, payroll_group },
					week: { ordinary_hours_per_week: hours, working_days_per_week: days },
					asOf: '2026-06-30'
				})
			});
		// The factors as the Handbook derives them — 365, 261 and 313 days over twelve months —
		// stated as the fractions, so a daily floor of ₱600 × 313 ÷ 12 meets the wage order's
		// ₱15,650 exactly rather than by a rounded 26.0833.
		assert.equal(divisor('MONTHLY', 40, 5), 365 / 12);
		assert.equal(divisor('', 40, 5), 261 / 12);
		assert.equal(divisor('', 48, 6), 313 / 12);
		// Handbook ch.2 §E on the salary line too (`proration_by`): a daily-paid employee’s absent
		// day on the 261 factor is ₱30,000 × 12 ÷ 261 = ₱1,379.31; a monthly-paid one’s (payroll
		// group MONTHLY) is ÷ 30.4167 = ₱986.30, and their part month prorates on the same divisor.
		const absent = (payroll_group) =>
			absenceDayRate({
				terms: {
					base_salary: { value: 30_000, currency: 'PHP' },
					pay_frequency: 'MONTHLY',
					ordinary_hours_per_week: 40,
					working_days_per_week: 5
				},
				work: version.work_rules,
				person: personContext({
					employee: null,
					employment: { service_start: '2020-01-01' },
					terms: { base_salary: { value: 30_000, currency: 'PHP' }, payroll_group },
					asOf: '2026-02-28'
				}),
				period: { start: '2026-02-01', end: '2026-02-28' },
				workingDaysIn: () => 20
			});
		assert.equal(absent('BI-MONTHLY'), 1379.31);
		assert.equal(absent('MONTHLY'), 986.3);
		assert.deepEqual(version.work_rules.proration_by, [
			{ when: 'terms.payroll_group == "MONTHLY"', basis: { by: 'FIXED_DAYS', days: 30.4167 } }
		]);
	}
});

test('Philippines — the statutory leave ladder on every version', () => {
	// Labor Code art.95 (SIL 5 days after a year, rank and file), RA 11210 s.3 (maternity 105
	// days, 120 for a solo parent), RA 8187 s.2 (paternity 7 days, married male), RA 8972 s.8 as
	// amended by RA 11861 (solo parent 7 days after six months), RA 9262 s.43 (VAWC 10 days),
	// RA 9710 s.18 (special leave for women 60 days after six months).
	// Art.82 / Handbook ch.7 §B take SIL away from field personnel, workers paid by results,
	// domestic helpers and an establishment of fewer than ten; maternity, paternity and the
	// gynaecological-surgery leave are grants per event (RA 11210 s.3: 60 days for a miscarriage;
	// RA 8187 s.2: the first four deliveries; RA 9710 s.18: two months per surgery).
	const expected: Record<string, [string, [string, number][]]> = {
		// RA 10361 s.29 gives a kasambahay the five days on their own row (never encashed), so
		// DOMESTIC leaves this one.
		ANNUAL_LEAVE: [
			'employment.type != "DOMESTIC" && employment.classification != "MANAGERIAL" && !(terms.statutory_work_category in ["FIELD_PERSONNEL", "PAID_BY_RESULTS"]) && !(has(company.facts.small_establishment) && company.facts.small_establishment)',
			[['employment.service_months >= 12', 5]]
		],
		MATERNITY_LEAVE: [
			'employee.gender == "FEMALE" && event.kind in ["BIRTH", "MISCARRIAGE"] && facts.SSS.since_months >= 3',
			[
				['event.kind == "MISCARRIAGE"', 60],
				['employee.solo_parent', 120],
				['', 105]
			]
		],
		// RA 8187 s.2: the delivery of, or miscarriage by, the legitimate spouse.
		PATERNITY_LEAVE: [
			'employee.gender == "MALE" && employee.marital_status == "MARRIED" && event.kind in ["BIRTH", "MISCARRIAGE"]',
			[['', 7]]
		],
		SOLO_PARENT_LEAVE: ['employee.solo_parent', [['employment.service_months >= 6', 7]]],
		VAWC_LEAVE: ['employee.gender == "FEMALE"', [['', 10]]],
		SPECIAL_LEAVE_FOR_WOMEN: [
			'employee.gender == "FEMALE" && event.kind == "SURGERY" && employment.service_months >= 6',
			[['', 60]]
		]
	};
	for (const version of settingsVersions('PH')) {
		const rows = leaveCatalogue('PH').filter((row) => row.settings_id === version.id);
		for (const [code, [eligibility, bands]] of Object.entries(expected)) {
			const row = rows.find((candidate) => candidate.code === code);
			assert.ok(row, `${code} on ${version.name}`);
			assert.equal(row.eligibility, eligibility, `${code} eligibility`);
			assert.deepEqual(
				row.entitlement.bands.map((band) => [band.eligibility, band.days]),
				bands,
				`${code} bands`
			);
			assert.equal(row.is_npl, false, `${code} is paid`);
		}
		assert.equal(
			rows.find((row) => row.code === 'PATERNITY_LEAVE')!.entitlement.lifetime_events,
			4
		);
		assert.equal(rows.find((row) => row.code === 'SOLO_PARENT_LEAVE')!.evidence, 'REQUIRED');
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixed factor caps the month, and "no work, no pay" reaches the allowance.
// ─────────────────────────────────────────────────────────────────────────────

const PH_2026 = 'bb5137fd-d7fd-4a26-8eae-77211521f892';

test('Philippines — a salary change mid-month is one month of pay, never more (DOLE Handbook ch.2 §E)', () => {
	// January 2026 holds 22 Monday-to-Friday working days — 17 to the 23rd and 5 from the 24th —
	// against the DOLE factor of 21.75. Measured row by row against the factor, a raise on the 24th
	// paid 20,000 × 17/21.75 + 21,000 × 5/21.75 = 20,459.77: 105.75% of a month to someone present
	// for all of it (OPSPH026, January 2026). The factor is what a whole month is worth, so the two
	// rows share it: 20,000 × 17/22 + 21,000 × 5/22 = 20,227.27, the month at the weighted rate.
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-RAISE', wage: 20_000 }] },
		(world) => {
			const term = world.employment_terms.find(
				(row) => row.employment_id === world.employments[0]!.id
			)!;
			term.effective_range = { start: term.effective_range.start, end: '2026-01-23' };
			world.employment_terms.push({
				...term,
				id: 'b0000000-0000-4000-8000-0000000000ff',
				base_salary: { value: 21_000, currency: 'PHP' },
				effective_range: { start: '2026-01-24', end: null }
			});
		}
	);
	const slip = slips.get('PH-RAISE')!;
	assert.deepEqual(
		slip.proration.map((row) => [
			Math.round(row.days * 10_000) / 10_000,
			row.denominator,
			row.contract_amount,
			row.prorated_amount
		]),
		[
			[16.8068, 21.75, 20_000, 15_454.55],
			[4.9432, 21.75, 21_000, 4772.72]
		]
	);
	assert.equal(slip.gross, 20_227.27);
});

const PH_NPL = 'c1c1c1c1-0000-4000-8000-0000000000aa';
/** A no-pay leave entry over `dates`, charged one day each. */
const noPayLeave = (world: PayrollWorld, key: string, dates: readonly string[]) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	world.leave_entries.push({
		id: `e1000000-0000-4000-8000-${key
			.replace(/[^0-9a-f]/gi, '0')
			.padStart(12, '0')
			.slice(-12)}`,
		employment_id: employment.id,
		catalogue_id: PH_NPL,
		leave_code: 'LEAVE_WITHOUT_PAY',
		reference: `LWOP-${key}`,
		from_date: dates[0]!,
		to_date: dates.at(-1)!,
		half_day_start: false,
		half_day_end: false,
		days: dates.length,
		effective_on: dates[0]!,
		reason: 'no work, no pay',
		allocations: [],
		charges: dates.map((date) => ({
			date,
			days: 1,
			catalogue_id: PH_NPL,
			employment_term_id: term.id,
			holiday_id: null,
			shift_definition_id: null,
			work_day_id: null
		})),
		approval_id: null
	});
};

test('Philippines — an allowance loses the unpaid days of the window it covers, wherever the cut-off falls', () => {
	// `payroll.allowance_npl_prorates` is true: "no work, no pay" reaches the allowance. The January
	// run pays the 1–31 January salary and charges attendance from 21 December to 20 January, so
	// the unpaid days that net a whole-month allowance are the ones this run charges — four days of
	// leave without pay on 22–25 December (OPSPH035), and a rostered Tuesday with no punch and no
	// leave on 6 January — not the ones dated inside the salary month that the next run will charge.
	// A ₱2,175 allowance is ₱100 a day on the factor: 17.75 and 20.75 of 21.75.
	const { slips, entries } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'PH-LWOP', wage: 15_650 },
				{ key: 'PH-ABSENT', wage: 15_650 },
				{ key: 'PH-FULL', wage: 15_650 }
			]
		},
		(world) => {
			world.leave_catalogue.push({
				id: PH_NPL,
				settings_id: PH_2026,
				code: 'LEAVE_WITHOUT_PAY',
				name: 'Leave without pay',
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
			for (const [index, employment] of world.employments.entries())
				world.allowances.push({
					id: `d3000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: OPSPH006_ALLOWANCE,
					amount: 2175,
					effective_from: '2025-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			noPayLeave(world, 'PH-LWOP', ['2025-12-22', '2025-12-23', '2025-12-24', '2025-12-25']);
			const absent = world.employments.find((row) => row.employee_number === 'PH-ABSENT')!;
			world.work_days.push({
				id: 'wd-PH-ABSENT-2026-01-06',
				employment_id: absent.id,
				work_date: '2026-01-06',
				shift_definition_id: null,
				worked_intervals: [],
				approval_id: null
			});
		}
	);
	const facts = (key: string) => {
		const entry = entries.get(key)![0]!;
		return [
			entry.values.days,
			entry.values.denominator,
			entry.values.unpaid_days,
			entry.values.amount
		];
	};
	assert.deepEqual(facts('PH-LWOP'), [17.75, 21.75, 4, 1775]);
	assert.deepEqual(facts('PH-ABSENT'), [20.75, 21.75, 1, 2075]);
	assert.deepEqual(facts('PH-FULL'), [21.75, 21.75, 0, 2175]);
	// The days themselves come off the salary at the factor's day rate, 15,650 ÷ 21.75 = 719.54
	// each, one line per charged day; the absent Tuesday the same.
	const absences = (key: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.bucket === 'ABSENCE')
			.map((row) => [row.quantity, row.amount]);
	assert.deepEqual(
		absences('PH-LWOP'),
		Array.from({ length: 4 }, () => [1, 719.54])
	);
	assert.deepEqual(absences('PH-ABSENT'), [[1, 719.54]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Compounded day types, the minimum-wage earner, the apprentice floor, the daily factor.
// ─────────────────────────────────────────────────────────────────────────────

/** A punch from `start` to `end` on `date`, in Manila's +08:00 frame. */
const punchPh = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		approval_id: null
	});
};
const workLinesPh = (
	slip: ReturnType<typeof buildStatutory>['slips'] extends Map<string, infer S> ? S : never
) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

test('Philippines — a regular holiday worked on the rest day is 260% and 338%, a special day 150% and 195% (Handbook ch.3 §D, ch.4 §C)', () => {
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-COMP', wage: 21_750 }] },
		(world) => {
			// Sunday the 4th is the rest day and a regular holiday; Sunday the 11th a special day.
			world.jurisdiction_holidays.push(
				{
					id: 'h-1',
					company_id: COMPANY_ID,
					date: '2026-01-04',
					name: 'Regular',
					kind: 'PUBLIC_HOLIDAY',
					replaces: null,
					given_to: null,
					source: null,
					published_at: '2025-12-01T00:00:00.000Z',
					approval_id: null
				},
				{
					id: 'h-2',
					company_id: COMPANY_ID,
					date: '2026-01-11',
					name: 'Special',
					kind: 'SPECIAL_HOLIDAY',
					replaces: null,
					given_to: null,
					source: null,
					published_at: '2025-12-01T00:00:00.000Z',
					approval_id: null
				}
			);
			punchPh(world, 'PH-COMP', '2026-01-04', '08:00', '19:00'); // eleven hours, ten net of the meal period
			punchPh(world, 'PH-COMP', '2026-01-11', '08:00', '17:00'); // nine hours, eight net
		}
	);
	// 21,750 ÷ 21.75 = 1,000 a day, 125.00 an hour. Regular holiday on the rest day: 8 × 125 × 2.6
	// = 2,600 and 2 × 125 × 3.38 = 845; the special day on the rest day: 8 × 125 × 1.5 = 1,500.
	assert.deepEqual(workLinesPh(slips.get('PH-COMP')!), [
		['2026-01-04', 'OT-2.6X-REST', 8, 2600],
		['2026-01-04', 'OT-3.38X-REST', 2, 845],
		['2026-01-11', 'OT-1.5X-REST', 8, 1500]
	]);
});

test('Philippines — a minimum-wage earner’s overtime and night differential are outside withholding (RA 9504), and an apprentice’s floor is 75% of the wage', () => {
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				// ₱13,050 is ₱600 × 261 ÷ 12: the IVA-22 floor on the five-day factor the fixture's
				// pattern works (`wages.scale`), so a minimum-wage earner.
				{ key: 'PH-MWE', wage: 13_050 },
				{ key: 'PH-APPRENTICE', wage: 12_000, employment_type: 'APPRENTICE' }
			]
		},
		(world) => punchPh(world, 'PH-MWE', '2026-01-05', '08:00', '20:00') // eleven net hours, three of overtime
	);
	// The whole compensation of a minimum-wage earner — basic, overtime, night differential — is
	// exempt; the WTAX base is nothing, so the scheme is skipped outright.
	expectStatutorySkipped(book, 'PH-MWE', 'WTAX');
	// Wage Order NCR-28 (s.2: ₱695 + ₱60 = ₱755 non-agriculture; s.7: fifteen days after its
	// 11 September 2026 publication): from 26 September 2026 the NCR floor is 755 × 313 ÷ 12 =
	// 19,692.92 (313 factor). A version is read at the period's end, so a ₱16,000 earner — above
	// the NCR-26 floor on the fixture's five-day factor (₱695 × 261 ÷ 12 = 15,116.25) — is
	// withheld on in August and is a minimum-wage earner in September, when the floor is ₱755 ×
	// 261 ÷ 12 = 16,421.25 (RA 9504: at or below the statutory minimum).
	assert.deepEqual(
		settingsVersions('PH')
			.filter((version) => String(version.effective_range.start).slice(0, 10) >= '2026-04-01')
			.map((version) => [
				String(version.effective_range.start).slice(0, 10),
				version.work_rules.wages.by_region['NCR']
			]),
		[
			['2026-04-01', 18_127.92],
			['2026-09-26', 19_692.92]
		]
	);
	for (const [period, withheld] of [
		['2026-08', 1],
		['2026-09', 0]
	] as const) {
		const ncr = assessStatutory({
			code: 'PH',
			period,
			region: 'NCR',
			people: [{ key: 'PH-NCR-MWE', wage: 16_000 }]
		});
		assert.equal((ncr.get('PH-NCR-MWE')!.get('WTAX')?.base ?? 0) > 0, withheld === 1, period);
	}
	// An apprentice at ₱12,000 is above three quarters of the ₱15,650 floor (₱11,737.50): no warning.
	const { warnings } = buildStatutory({
		code: 'PH',
		period: '2026-01',
		people: [
			{ key: 'PH-APPRENTICE', wage: 12_000, employment_type: 'APPRENTICE' },
			{ key: 'PH-UNDER', wage: 12_000 }
		]
	});
	// Art.61: an apprentice may be paid 75% of the minimum wage — ₱11,737.50 — so ₱12,000 is
	// lawful for the apprentice and under the floor for anyone else.
	assert.ok(!warnings.some((warning) => warning.includes('PH-APPRENTICE')), warnings.join(' | '));
	assert.ok(
		warnings.some((warning) => warning.includes('PH-UNDER')),
		warnings.join(' | ')
	);
});

test('Philippines — a daily-paid employee’s hour is the day over eight, whatever the week (Handbook ch.2)', () => {
	const { slips, warnings } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [{ key: 'PH-DAILY-6', wage: 600, pay_frequency: 'DAILY' }]
		},
		(world) => {
			const terms = world.employment_terms.find(
				(row) =>
					row.employment_id ===
					world.employments.find((e) => e.employee_number === 'PH-DAILY-6')!.id
			)!;
			world.shift_patterns[0]!.pattern.days[5] = world.shift_patterns[0]!.pattern.days[0]!;
			punchPh(world, 'PH-DAILY-6', '2026-01-05', '09:00', '20:00'); // two hours beyond eight
		}
	);
	// A daily-paid worker's hour is the day over eight — 75.00 — whatever the factor; the factor
	// decides the monthly-paid divisor. Two hours at 125%: 187.50.
	assert.deepEqual(workLinesPh(slips.get('PH-DAILY-6')!), [['2026-01-05', 'OT-1.25X', 2, 187.5]]);
	assert.deepEqual(warnings, []);
});

test('Philippines — monetised leave beyond the de minimis days is compensation (RR 2-98 s.2.78.1(A)(3)(a), RR 29-2025)', () => {
	// Fifteen days of leave encashed in one entry. The 2026 versions exempt twelve; the three
	// beyond — at the ordinary day the engine encashes at, 30,000 ÷ 21.75 = 1,379.31 — join the
	// withholding base: 30,000 + 3 × 1,379.31 = 34,137.93.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-ENCASH', wage: 30_000 }] },
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'PH-ENCASH')!;
			const annual = leaveCatalogue('PH').find(
				(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === PH_2026
			)!;
			world.leave_catalogue.push({ ...annual, approval_id: null } as never);
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-0000000enc01',
				employment_id: employment.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: 'ENCASH-PH',
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				half_day_start: false,
				half_day_end: false,
				days: 15,
				encash_days: 15,
				effective_on: '2026-01-15',
				due_on: '2026-01-31',
				reason: 'Agreed',
				allocations: [],
				charges: [],
				approval_id: null
			} as never);
		}
	);
	assert.equal(Math.round(book.get('PH-ENCASH')!.get('WTAX')!.base * 100) / 100, 34_137.93);
});
