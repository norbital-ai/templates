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
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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
import { readLawFile } from './fixtures/law-file.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { absenceDayRate, ordinaryDivisorDays } from '../src/lib/payroll/run/ordinary-rate.ts';
import { priceWorkDay } from '../src/lib/payroll/work-bands.ts';
import {
	applicableLimits,
	observedHolidays,
	projectedLimitBreaches
} from '../src/lib/scheduling/work-limits.ts';
import {
	adhocCatalogue,
	contributionSchemes,
	allowanceCatalogue,
	leaveCatalogue,
	rowIn,
	settingsIdOn,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

const PH_PEOPLE = [
	{ key: 'PH-4000', wage: 4000, age: 25 },
	// 30,000 sits inside "29,750 – 30,249.99 → MSC 30,000"; the bracket floors are priced in their
	// own golden below.
	{ key: 'PH-30000', wage: 30_000 },
	{ key: 'PH-40000', wage: 40_000, age: 61 }
];

test('Philippines — a whole month on FIXED_DAYS 21.75 prorates to one, so the base is the wage', () => {
	const book = assessStatutory({ code: 'PH', period: '2026-01', people: PH_PEOPLE });
	// The regime's proration is `FIXED_DAYS: 21.75` for every employee, monthly-paid included,
	// because `proration` takes no predicate rows (bank README NOT APPLIED #16; the `ordinary_rate`
	// predicate on `terms.paid_rest_days` that separates the two populations prices
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
	// the rows of the version in force when each period opens, by code (versions are reissued; ids are not the law)
	const row = (code: string, period: string) =>
		rowIn(allowanceCatalogue('PH'), settingsIdOn('PH', `${period}-01`), code);
	const MEAL = { '2026-01': row('meal', '2026-01'), '2025-12': row('meal', '2025-12') };
	const TRANSPORT = {
		'2026-01': row('transport', '2026-01'),
		'2025-12': row('transport', '2025-12')
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
					assignAllowance(world, {
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

test('Philippines — RR 29-2025’s ₱2,500 rice ceiling, in the formula and its authority (PH-S6)', () => {
	// RR 29-2025 s.2.78.1(A)(3)(d): rice subsidy of ₱2,500 a month, from 6 January 2026. February
	// 2026, OPSPH003: ₱32,000 basic, ₱2,700 transport, ₱2,400 rice. The rice sits under ₱2,500, so
	// the WTAX base is 32,000 + 2,700 = 34,700 (₱2,000 would tax 400 more: 35,100). Less SSS 1,000,
	// MPF 750, PhilHealth 800, Pag-IBIG 200: 31,950; 15% × (31,950 − 20,833) = 1,667.55.
	// SSS reads 37,100, capped at MSC 35,000.
	const period = '2026-02';
	const settings = settingsIdOn('PH', `${period}-01`);
	const book = assessStatutory(
		{ code: 'PH', period, people: [{ key: 'OPSPH003', wage: 32_000 }] },
		(world) => {
			const employment = world.employments[0]!;
			for (const [index, [code, amount]] of (
				[
					['meal', 2400],
					['transport', 2700]
				] as const
			).entries())
				assignAllowance(world, {
					id: `d3100000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: rowIn(allowanceCatalogue('PH'), settings, code),
					amount,
					effective_from: `${period}-01`,
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	expectStatutoryBase(book, 'OPSPH003', 'SSS', 37_100);
	expectStatutory(book, 'OPSPH003', 'SSS', 1000, 2000);
	expectStatutoryBase(book, 'OPSPH003', 'WTAX', 34_700);
	expectStatutory(book, 'OPSPH003', 'WTAX', 1667.55, 0);
	// Every version's WTAX authority names the ceiling its formula reads, and no other.
	const starts = new Map(settingsVersions('PH').map((v) => [v.id, v.effective_range.start]));
	for (const scheme of contributionSchemes('PH').filter((row) => row.code === 'WTAX')) {
		const text = JSON.stringify(scheme.assessed_on);
		const ceiling = /monthly_excess\('WTAX\.RICE', (\d+)\.0\)/.exec(text)?.[1];
		const expected = String(starts.get(scheme.settings_id)) >= '2026-01-06' ? '2500' : '2000';
		assert.equal(ceiling, expected, `${scheme.settings_id} formula`);
		const stale = expected === '2500' ? '₱2,000 a month' : '₱2,500 a month';
		assert.ok(!scheme.authority.includes(`de minimis to ${stale}`), `${scheme.settings_id} text`);
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
	// The first half charged the month on an estimate (its own 15,000 as the month's 30,000). The
	// second half prices the month on what was actually paid — the first half's settled lines plus
	// its own — and charges the difference: nothing more where the month came out as estimated.
	const firstHalfSlip = (world: PayrollWorld, basic: number, sss: [number, number]) => {
		const employment = world.employments.find((row) => row.employee_number === 'PH-S-30000')!;
		world.payroll_runs.push({
			id: 'ph-feb-1',
			company_id: COMPANY_ID,
			period: '2026-02-1',
			lifecycle: 'PAID'
		} as never);
		world.payslips.push({
			id: 'ph-feb-1-slip',
			payroll_run_id: 'ph-feb-1',
			employment_id: employment.id,
			status: 'PAID',
			paid_at: '2026-02-14T00:00:00.000Z',
			base: [{ component_code: 'BASIC', amount: basic }],
			adjustments: [],
			statutory: [
				{
					scheme_code: 'SSS',
					base_amount: 30_000,
					employee_amount: sss[0],
					employer_amount: sss[1]
				},
				{
					scheme_code: 'SSS_MPF',
					base_amount: 30_000,
					employee_amount: 500,
					employer_amount: 1000
				},
				{ scheme_code: 'SSS_EC', base_amount: 30_000, employee_amount: 0, employer_amount: 30 },
				{ scheme_code: 'PHIC', base_amount: 30_000, employee_amount: 750, employer_amount: 750 },
				{ scheme_code: 'HDMF', base_amount: 30_000, employee_amount: 200, employer_amount: 200 }
			]
		} as never);
	};
	const second = assessStatutory(
		{ code: 'PH', period: '2026-02-2', payFrequency: 'SEMI_MONTHLY', people: [person] },
		(world) => firstHalfSlip(world, 15_000, [1000, 2000])
	);
	// The month came out at 30,000: nothing more; the half's 15,000 carries no relief for
	// withholding: 15% × (15,000 − 10,417).
	expectStatutory(second, 'PH-S-30000', 'SSS', 0, 0);
	expectStatutory(second, 'PH-S-30000', 'WTAX', 687.45, 0);
	// RA 11199 s.18: the contribution is on the month's actual compensation. A day of leave
	// without pay in the second half (30,000 × 12 ÷ 261 = 1,379.31 on the five-day factor) makes
	// the month 28,620.69 — MSC 28,500, SSS 1,425 / 2,850 where the first half charged
	// 1,500 / 3,000 on the estimate: this half returns 75 / 150.
	const secondShort = buildStatutory(
		{ code: 'PH', period: '2026-02-2', payFrequency: 'SEMI_MONTHLY', people: [person] },
		(world) => {
			firstHalfSlip(world, 15_000, [1000, 2000]);
			withNoPayLeaveRow(world);
			noPayLeave(world, 'PH-S-30000', ['2026-02-17']);
		}
	);
	const short = secondShort.slips.get('PH-S-30000')!;
	const sss = short.statutory.find((row) => row.scheme_code === 'SSS')!;
	const mpf = short.statutory.find((row) => row.scheme_code === 'SSS_MPF')!;
	assert.equal(sss.employee_amount + mpf.employee_amount, -75);
	assert.equal(sss.employer_amount + mpf.employer_amount, -150);
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
	// charges them once, in the month's last week, on the month's actual pay — the five weeks
	// paid in March, 50,000 (RA 11199 s.18: the month's compensation): MSC 35,000 — the regular
	// 20,000 → 1,000 / 2,000, the MPF 15,000 above it → 750 / 1,500. PhilHealth reads the monthly
	// basic salary as the version's own divisor states it (a five-day week: weekly ÷ 5 × 261 ÷ 12
	// = 43,500): 5% → 1,087.50 each; Pag-IBIG the ₱200 cap each.
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
	const week5 = assessStatutory(
		{
			code: 'PH',
			period: '2026-03-5',
			payFrequency: 'WEEKLY',
			people: [{ key: 'PH-WEEKLY', wage: 10_000, pay_frequency: 'WEEKLY' }]
		},
		(world) => {
			// The month's four earlier weeks, settled: 10,000 each, the month's schemes at zero.
			const employment = world.employments.find((row) => row.employee_number === 'PH-WEEKLY')!;
			for (const week of [1, 2, 3, 4]) {
				world.payroll_runs.push({
					id: `ph-mar-${week}`,
					company_id: COMPANY_ID,
					period: `2026-03-${week}`,
					lifecycle: 'PAID'
				} as never);
				world.payslips.push({
					id: `ph-mar-${week}-slip`,
					payroll_run_id: `ph-mar-${week}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `2026-03-0${week}T00:00:00.000Z`,
					base: [{ component_code: 'BASIC', amount: 10_000 }],
					adjustments: [],
					statutory: []
				} as never);
			}
		}
	);
	expectStatutoryBase(week5, 'PH-WEEKLY', 'SSS', 50_000);
	expectStatutory(week5, 'PH-WEEKLY', 'SSS', 1000, 2000);
	expectStatutory(week5, 'PH-WEEKLY', 'SSS_MPF', 750, 1500);
	expectStatutory(week5, 'PH-WEEKLY', 'PHIC', 1087.5, 1087.5);
	expectStatutory(week5, 'PH-WEEKLY', 'HDMF', 200, 200);
});

test('Philippines — the week of 1–4 January 2026 is priced on the version before RR 29-2025 commenced', () => {
	// RR 29-2025 s.3: in force fifteen days after its 22 December 2025 posting, i.e. 6 January
	// 2026, so the week whose Sunday is 4 January is governed by the 1 January version (RR
	// 11-2018's de minimis figures). Its Annex E weekly column is unchanged: a weekly payslip of
	// 10,000 with nothing deducted this week is in the third bracket, 432.60 + 20% × (10,000 −
	// 7,692) = 432.60 + 461.60 = 894.20. SSS, PhilHealth and Pag-IBIG wait for January's last week.
	const week1 = assessStatutory({
		code: 'PH',
		period: '2026-01-1',
		payFrequency: 'WEEKLY',
		people: [{ key: 'PH-WEEKLY', wage: 10_000, pay_frequency: 'WEEKLY' }]
	});
	expectStatutory(week1, 'PH-WEEKLY', 'WTAX', 894.2, 0);
	expectStatutory(week1, 'PH-WEEKLY', 'SSS', 0, 0);
});

test('Philippines — NCR-DW-06 holds a kasambahay to ₱7,800 from 7 February 2026, NCR-DW-05’s ₱7,000 before it', () => {
	// RA 10361 s.24 and the NCR domestic-worker orders (nwpc.dole.gov.ph/ncr/): NCR-DW-05 ₱7,000 a
	// month from 4 January 2025; NCR-DW-06 ₱7,000 + ₱800 = ₱7,800, published 22 January 2026 and
	// effective 7 February 2026. A ₱7,500 kasambahay meets the January floor (7,500 ≥ 7,000) and
	// falls below February's (7,500 < 7,800), so that run refuses.
	const below = (period: string) =>
		buildStatutory({
			code: 'PH',
			period,
			region: 'NCR',
			people: [{ key: 'DW-7500', wage: 7_500, employment_type: 'DOMESTIC' }]
		});
	assert.deepEqual(
		below('2026-01').warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW')),
		[]
	);
	assert.throws(
		() => below('2026-02'),
		/MINIMUM_WAGE_BELOW: DW-7500 is contracted at 7500 a month, below the NCR\/Manila minimum wage of 7800/
	);
});

test('Philippines — NCR-28’s ₱755 is mandatory: an unexempted contract below the five-day floor of 16,421.25 refuses the run', () => {
	// Wage Order No. NCR-28 s.2 (₱755 non-agriculture, effective 26 September 2026) s.4 (all minimum
	// wage earners in the private sector) s.6 (non-payment under RA 6727 s.12); only an exemption
	// the board approves lowers it (RA 6727 s.4(c)). A five-day worker whose rest days are unpaid is
	// held to 755 × 261 ÷ 12 = 16,421.25 a month (DOLE Handbook ch.2), not the 313-day 19,692.92.
	const run = (wage: number, exempt = false) =>
		buildStatutory({
			code: 'PH',
			period: '2026-11',
			region: 'NCR',
			companyFacts: { minimum_wage_exemption_approved: exempt },
			people: [{ key: 'J', wage, hire_date: '2026-11-17' }]
		});
	assert.throws(
		() => run(7_777.77),
		/MINIMUM_WAGE_BELOW: J is contracted at 7777\.77 a month, below the NCR\/Manila minimum wage of 16421\.25 \(19692\.92 restated on this person's factor\)/
	);
	// A centavo under the floor still refuses; the floor itself does not.
	assert.throws(() => run(16_421.24), /MINIMUM_WAGE_BELOW: J .*16421\.25/);
	// Hired Tuesday 17 November: 10 working days (17–20, 23–27, 30) of 21.75 —
	// 16,421.25 × 10 ÷ 21.75 = 755 × 10 = 7,550.00.
	const floor = run(16_421.25);
	assert.deepEqual(
		floor.warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW')),
		[]
	);
	assert.equal(floor.slips.get('J')?.gross, 7_550);
	// An approved exemption pays the contract (7,777.77 × 10 ÷ 21.75 = 3,575.99) and warns.
	const exempted = run(7_777.77, true);
	assert.equal(exempted.slips.get('J')?.gross, 3_575.99);
	assert.match(
		exempted.warnings.find((line) => line.startsWith('MINIMUM_WAGE_BELOW')) ?? '',
		/J is contracted at 7777\.77 a month, below the NCR\/Manila minimum wage of 16421\.25/
	);
	// 20,000 is below the six-day 19,692.92 but above this person's 16,421.25: no warning.
	assert.deepEqual(
		run(20_000).warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW')),
		[]
	);
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
		readLawFile(
			fileURLToPath(
				new URL(`../seed/jurisdiction/PH/${file.replace(/\.json$/, '')}`, import.meta.url)
			)
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

const THIRTEENTH_MONTH_ID = rowIn(
	adhocCatalogue('PH'),
	settingsIdOn('PH', '2026-12-15'),
	'THIRTEENTH_MONTH_PAY'
);

function payslipsOf(
	options: Parameters<typeof createStatutoryWorld>[0],
	window: { from: string; to: string }
) {
	const world = createStatutoryWorld(options);
	for (const [index, employment] of world.employments.entries())
		world.adhoc_requests!.push({
			id: `d1000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: THIRTEENTH_MONTH_ID,
			amount: 1,
			event_date: window.from,
			pay_period: null,
			payslip_id: null,
			reason: '13th month',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	const prepared = gatherPayrollRun({
		world: payrollWorld(world),
		companyId: COMPANY_ID,
		period: options.period
	});
	const built = buildPayrollRun(prepared);
	const slips = built.payslip_payroll_run;
	return (key: string) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		const slip = slips.find((row) => String(row.employment_id) === employment.id)!;
		const thirteenth = slip.adjustments.filter(
			(row) => row.component_code === 'THIRTEENTH_MONTH_PAY'
		);
		const wtax = slip.statutory.find((row) => row.scheme_code === 'WTAX')!;
		// The ad hoc request the payslip captured: pinned, its money on the adjustment above.
		const captured = built.captures
			.filter((capture) => capture.payslipId === slip.id)
			.flatMap((capture) => capture.adhoc);
		return { thirteenth, wtaxBase: wtax.base_amount, captured };
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
	assert.deepEqual(slip('PH-30000').captured, ['d1000000-0000-4000-8000-000000000000']);
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

// the entity's `allowance` row in the version that opens January 2026 (versions are reissued; the code is the law's name)
const OPSPH006_ALLOWANCE = rowIn(
	allowanceCatalogue('PH'),
	settingsIdOn('PH', '2026-01-01'),
	'allowance'
);

/**
 * OPSPH006 in January 2026; `firstHalf` seeds the mid-month payslip as settled (its own lines,
 * and the statutory rows it charged) so the end-month run prices the month on what was paid.
 */
function opsph006(
	period: string,
	cutoff: 'FIRST' | 'SPLIT' | 'LAST',
	firstHalf?: { readonly sss: [number, number]; readonly others: boolean }
) {
	const person = { key: 'OPSPH006', wage: 15_650, pay_frequency: 'SEMI_MONTHLY' as const };
	return assessStatutory(
		{ code: 'PH', period, payFrequency: 'SEMI_MONTHLY', people: [person] },
		(world) => {
			world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			if (firstHalf != null) {
				world.payroll_runs.push({
					id: 'opsph-jan-1',
					company_id: COMPANY_ID,
					period: '2026-01-1',
					lifecycle: 'PAID'
				} as never);
				world.payslips.push({
					id: 'opsph-jan-1-slip',
					payroll_run_id: 'opsph-jan-1',
					employment_id: world.employments[0]!.id,
					status: 'PAID',
					paid_at: '2026-01-15T00:00:00.000Z',
					base: [{ component_code: 'BASIC', amount: 7825 }],
					adjustments: [
						{
							component_code: 'duty_allowance',
							bucket: 'EARNING',
							amount: 1055.95,
							catalogue_id: OPSPH006_ALLOWANCE
						}
					],
					statutory: [
						{
							scheme_code: 'SSS',
							base_amount: 17_761.9,
							employee_amount: firstHalf.sss[0],
							employer_amount: firstHalf.sss[1]
						},
						...(firstHalf.others
							? [
									{
										scheme_code: 'SSS_EC',
										base_amount: 17_761.9,
										employee_amount: 0,
										employer_amount: 30
									},
									{
										scheme_code: 'PHIC',
										base_amount: 17_761.9,
										employee_amount: 391.25,
										employer_amount: 391.25
									},
									{
										scheme_code: 'HDMF',
										base_amount: 17_761.9,
										employee_amount: 200,
										employer_amount: 200
									}
								]
							: [])
					]
				} as never);
			}
			assignAllowance(world, {
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

	// The end-month run prices the month on what was paid — the mid-month lines plus its own, the
	// same 17,761.90 the estimate assumed — and charges the difference: nothing.
	const end = opsph006('2026-01-2', 'FIRST', { sss: [900, 1800], others: true });
	for (const code of ['SSS', 'SSS_EC', 'PHIC', 'HDMF'])
		expectStatutory(end, 'OPSPH006', code, 0, 0);
	expectStatutory(end, 'OPSPH006', 'WTAX', 0, 0);
});

test('Philippines — the entity may carry the month’s premiums on the end-month cut-off, or split them', () => {
	// LAST: the mid-month cut-off carries nothing and the end-month one the whole month.
	expectStatutory(opsph006('2026-01-1', 'LAST'), 'OPSPH006', 'SSS', 0, 0);
	expectStatutory(
		opsph006('2026-01-2', 'LAST', { sss: [0, 0], others: false }),
		'OPSPH006',
		'SSS',
		900,
		1800
	);
	// SPLIT: each half carries half of the monthly MSC 18,000 contribution.
	expectStatutory(opsph006('2026-01-1', 'SPLIT'), 'OPSPH006', 'SSS', 450, 900);
	expectStatutory(
		opsph006('2026-01-2', 'SPLIT', { sss: [450, 900], others: false }),
		'OPSPH006',
		'SSS',
		450,
		900
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Working time, the daily rate and leave: the law's numbers against the sealed regime.
// ─────────────────────────────────────────────────────────────────────────────

const rankAndFile = personContext({
	employee: null,
	employment: { service_start: '2020-01-01' },
	terms: { base_salary: 30_000, currency: 'PHP', paid_rest_days: true },
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
		// `rankAndFile` is monthly-paid on the 365 factor: the salary already pays every day of the
		// month at 100% (Handbook ch.2 §E), rest days and holidays included, so a band adds only what
		// the Handbook's total rate exceeds it by; hours beyond eight are paid by no base.
		// Art.93(a): 130% for the first eight hours on a rest day → 8 × 100 × (1.3 − 1) = 240; art.87
		// on top beyond: 2 × 100 × 1.69 = 338.
		assert.deepEqual(priceDay(version, 'REST_DAY', 10), [
			['OT-1.3X', 8, 240],
			['OT-1.69X', 2, 338]
		]);
		// Art.94(b): 200% for work on a regular holiday → 8 × 100 × (2.0 − 1) = 800; 260% beyond
		// eight hours → 2 × 100 × 2.6 = 520.
		assert.deepEqual(priceDay(version, 'PUBLIC_HOLIDAY', 10), [
			['OT-2.0X', 8, 800],
			['OT-2.6X', 2, 520]
		]);
		// Special (non-working) day: 130% → 8 × 100 × 0.3 = 240, and 169% → 338 (DOLE Handbook
		// ch.3 §D.1, ch.4 §C.3).
		assert.deepEqual(priceDay(version, 'SPECIAL_HOLIDAY', 10), [
			['OT-1.3X', 8, 240],
			['OT-1.69X', 2, 338]
		]);
		// Art.82: managerial employees are outside Title I, so outside the premiums.
		// Art.82: managerial staff, domestic helpers, field personnel and workers paid by results are
		// outside the hours-of-work rules.
		assert.equal(
			version.work_rules.overtime_when,
			'employment.classification != "MANAGERIAL" && employment.type != "DOMESTIC" && !(terms.statutory_work_category in ["FIELD_PERSONNEL", "PIECE_RATE", "TASK_BASIS"])'
		);
		// Art.94(b) over art.93: a regular holiday on a rest day is priced as the holiday.
		assert.equal(version.work_rules.holiday_rest_precedence, 'PUBLIC_HOLIDAY');
		// Art.83 and art.85: the eight-hour day and the unpaid hour for meals; art.91: one rest day
		// in seven. RA 10361 s.20: a kasambahay's eight hours of daily rest, sixteen worked hours.
		assert.deepEqual(
			version.work_rules.limits
				.filter((limit) => limit.measure !== 'CONSECUTIVE_WORK_DAYS')
				.map((limit) => [limit.measure, limit.max_hours]),
			[
				['NORMAL_HOURS', 8],
				['TOTAL_WORK_HOURS', 16]
			]
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
		const divisor = (paid_rest_days: boolean, hours: number, days: number) =>
			ordinaryDivisorDays({
				expression: version.work_rules.ordinary_divisor_days,
				person: personContext({
					employee: null,
					employment: { service_start: '2020-01-01' },
					terms: { base_salary: 30_000, currency: 'PHP', paid_rest_days },
					week: { ordinary_hours_per_week: hours, working_days_per_week: days },
					asOf: '2026-06-30'
				})
			});
		// The factors as the Handbook derives them — 365, 261 and 313 days over twelve months —
		// stated as the fractions, so a daily floor of ₱600 × 313 ÷ 12 meets the wage order's
		// ₱15,650 exactly rather than by a rounded 26.0833.
		assert.equal(divisor(true, 40, 5), 365 / 12);
		assert.equal(divisor(false, 40, 5), 261 / 12);
		assert.equal(divisor(false, 48, 6), 313 / 12);
		// Handbook ch.2 §E on the salary line too (`proration_by`): a daily-paid employee’s absent
		// day on the 261 factor is ₱30,000 × 12 ÷ 261 = ₱1,379.31; a monthly-paid one’s (paid for
		// every day of the month, `terms.paid_rest_days`) is ÷ 30.4167 = ₱986.30, and their part month prorates on the same divisor.
		const absent = (paid_rest_days: boolean, hours = 40, days = 5) =>
			absenceDayRate({
				terms: {
					base_salary: { value: 30_000, currency: 'PHP' },
					pay_frequency: 'MONTHLY',
					ordinary_hours_per_week: hours,
					working_days_per_week: days
				},
				work: version.work_rules,
				person: personContext({
					employee: null,
					employment: { service_start: '2020-01-01' },
					terms: { base_salary: 30_000, currency: 'PHP', paid_rest_days },
					week: { ordinary_hours_per_week: hours, working_days_per_week: days },
					asOf: '2026-02-28'
				}),
				period: { start: '2026-02-01', end: '2026-02-28' },
				workingDaysIn: () => 20
			});
		assert.equal(absent(false), 30_000 / (261 / 12));
		assert.equal(absent(true), 30_000 / (365 / 12));
		// A six-day week's absent day is on the 313 factor the overtime hour is built on: ₱30,000
		// ÷ 26.0833 = ₱1,150.16 — the ₱15,650 daily-paid floor comes back as its ₱600 day.
		assert.equal(absent(false, 48, 6), 30_000 / (313 / 12));
		assert.deepEqual(version.work_rules.proration_by, [
			{ when: 'terms.paid_rest_days', basis: { by: 'FIXED_DAYS', days: 365 / 12 } },
			{
				when: 'terms.pay_frequency != "DAILY" && !terms.paid_rest_days && terms.ordinary_hours_per_week > 40.0',
				basis: { by: 'FIXED_DAYS', days: 313 / 12 }
			}
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
			'employment.type != "DOMESTIC" && employment.classification != "MANAGERIAL" && !(terms.statutory_work_category in ["FIELD_PERSONNEL", "TASK_BASIS"]) && !(has(company.facts.small_establishment) && company.facts.small_establishment)',
			[['employment.service_months >= 12', 5]]
		],
		MATERNITY_LEAVE: [
			// RA 11210 grants the private-sector leave; three SSS contributions qualify its cash benefit.
			'employee.gender == "FEMALE" && event.kind in ["BIRTH", "MISCARRIAGE", "EMERGENCY_TERMINATION"]',
			[
				['event.kind in ["MISCARRIAGE", "EMERGENCY_TERMINATION"]', 60],
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

const PH_2026 = settingsIdOn('PH', '2026-01-02');
// The version governing 31 January 2026 since RR 29-2025 split January on the 6th: a separation
// row must come from the catalogue in force on the final service day.
const PH_2026_JAN6 = settingsIdOn('PH', '2026-01-31');

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
				base_salary: 21_000,
				currency: 'PHP',
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
/** The version's leave-without-pay row, which the fixture world does not carry. */
const withNoPayLeaveRow = (world: PayrollWorld) => {
	if (world.leave_catalogue.some((row) => row.id === PH_NPL)) return;
	world.leave_catalogue.push({
		id: PH_NPL,
		settings_id: PH_2026,
		code: 'LEAVE_WITHOUT_PAY',
		name: 'Leave without pay',
		eligibility: '',
		evidence: 'NONE',
		evidence_after_days: null,
		entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
		is_npl: true,
		can_encash: false,
		bands: [],
		approval_id: null
	});
};
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
	const { slips, allowances } = buildStatutory(
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
			withNoPayLeaveRow(world);
			for (const [index, employment] of world.employments.entries())
				assignAllowance(world, {
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
		const [segment] = allowances.get(key)!;
		return [segment!.days, segment!.denominator, segment!.unpaid_days, segment!.prorated_amount];
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

/** `HH:MM` one hour later, for the meal break that separates two worked intervals. */
const anHourLater = (time: string) => {
	const minutes = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + 60) % 1440;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

/**
 * A punch from `start` to `end` on `date`, in Manila's +08:00 frame. `mealStart` names the hour the
 * shift's granted meal break is taken: only a gap between worked intervals proves it, so a break the
 * punches do not show stays worked time (PD 442 art.84(b); `work_rules.breaks` owes the 60 minutes).
 */
const punchPh = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	mealStart?: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const interval = (from: string, to: string) => ({
		start: `${date}T${from}:00+08:00`,
		end: `${date}T${to}:00+08:00`
	});
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals:
			mealStart == null
				? [interval(start, end)]
				: [interval(start, mealStart), interval(anHourLater(mealStart), end)],
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

test('Philippines — a regular holiday worked on the rest day is 260% and 338%, a special day 150% (Handbook ch.3 §D, ch.4 §C)', () => {
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
			punchPh(world, 'PH-COMP', '2026-01-04', '08:00', '19:00'); // eleven hours, no gap punched
			punchPh(world, 'PH-COMP', '2026-01-11', '08:00', '17:00'); // nine hours, no gap punched
		}
	);
	// 21,750 ÷ 21.75 = 1,000 a day, 125.00 an hour. The rest day has no shift; the version's
	// `work_rules.breaks` second rule (continuous_attendance unasserted) provides 60 minutes under
	// PD 442 art.85, and the punch shows no gap, so the provided hour comes off the span
	// (Owner directive 2026-09-29: the provided break is deducted from the entry). Regular holiday
	// on the rest day: 11 − 1 = 10 hours → 8 × 125 × 2.6 = 2,600 and 2 × 125 × 3.38 = 845; the
	// special day on the rest day: 9 − 1 = 8 hours → 8 × 125 × 1.5 = 1,500, no overtime.
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
		(world) => {
			// From the 09:00 shift start, ten net hours with the meal taken: two of overtime. Overtime
			// is planned, not derived from the clock (owner's rule 2026-09-23), and `assessStatutory`
			// plans nothing, so the day states its own.
			punchPh(world, 'PH-MWE', '2026-01-05', '08:00', '20:00', '13:00');
			world.work_days.at(-1)!.approved_overtime_hours = 2;
		}
	);
	// The whole compensation of a minimum-wage earner — basic, overtime, night differential — is
	// exempt; the WTAX base is nothing, so the scheme is skipped outright.
	expectStatutorySkipped(book, 'PH-MWE', 'WTAX');
	// Wage Order NCR-28 (s.2: ₱695 + ₱60 = ₱755 non-agriculture; s.7: fifteen days after its
	// 11 September 2026 publication): from 26 September 2026 the NCR floor is 755 × 313 ÷ 12 =
	// 19,692.92 (313 factor). A ₱16,000 earner is above the NCR-26 floor on the fixture's five-day
	// factor (₱695 × 261 ÷ 12 = 15,116.25) and below NCR-28's (₱755 × 261 ÷ 12 = 16,421.25). The
	// order fixes the SMW from its effective date (RR 11-2018 s.2.78.1(B)(13): the SMW is "the rate
	// fixed by the RTWPB"), and the exemption attaches to the pay for the days on which the employee
	// is an MWE (RR 10-2008 / RR 11-2018): above NCR-26's floor to 25 September, at or below NCR-28's
	// from the 26th. August is taxed whole: ₱16,000. September on the fixture's Mon–Fri pattern has
	// 22 paid days, 19 to the 25th and 3 from the 26th (28–30), so ₱16,000 × 3 ÷ 22 = ₱2,181.82 is
	// exempt and ₱16,000 × 19 ÷ 22 = ₱13,818.18 taxed. October is exempt whole. This golden once
	// said September was exempt (NCR-28 read back to the 1st, audit PH §5G), then taxed it whole
	// against the day-weighted floor (15,333.75); both were wrong. The NWPC matrix as of 28 September
	// 2026 (PH-S1) also lists NCR-28 effective 26 September; its withdrawn 11 September predecessor
	// said the 21st, which would have taxed only 14 of the 22 days: 16,000 × 14 ÷ 22 = 10,181.82.
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
	for (const [period, base] of [
		['2026-08', 16_000],
		['2026-09', 13_818.18],
		['2026-10', undefined]
	] as const) {
		const ncr = assessStatutory({
			code: 'PH',
			period,
			region: 'NCR',
			people: [{ key: 'PH-NCR-MWE', wage: 16_000 }]
		});
		assert.equal(ncr.get('PH-NCR-MWE')!.get('WTAX')?.base, base, period);
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
			punchPh(world, 'PH-DAILY-6', '2026-01-05', '09:00', '20:00', '13:00'); // two hours beyond eight
		}
	);
	// A daily-paid worker's hour is the day over eight — 75.00 — whatever the factor; the factor
	// decides the monthly-paid divisor. Two hours at 125%: 187.50.
	assert.deepEqual(workLinesPh(slips.get('PH-DAILY-6')!), [['2026-01-05', 'OT-1.25X', 2, 187.5]]);
	assert.deepEqual(warnings, []);
});

/** Synthetic cash-out and history used to check the BIR exemption limits independently. */
function phCashOut(world: PayrollWorld, days: number, period: string) {
	const annual = leaveCatalogue('PH').find(
		(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === PH_2026
	)!;
	world.leave_catalogue.push({ ...annual, approval_id: null } as never);
	world.leave_entries.push({
		id: 'e1000000-0000-4000-8000-0000000enc01',
		employment_id: world.employments[0]!.id,
		catalogue_id: annual.id,
		leave_code: 'ANNUAL_LEAVE',
		reference: 'ENCASH-PH',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		half_day_start: false,
		half_day_end: false,
		days,
		encash_days: days,
		effective_on: `${period}-15`,
		due_on: `${period}-28`,
		reason: 'Agreed',
		allocations: [],
		charges: [],
		approval_id: null
	} as never);
}

function phPaidBenefits(world: PayrollWorld, days: number, bonus: number, rice = 0) {
	world.payroll_runs.push({ id: 'paid-benefits', company_id: COMPANY_ID, period: '2026-01' });
	world.payslips.push({
		id: 'paid-benefits-slip',
		payroll_run_id: 'paid-benefits',
		employment_id: world.employments[0]!.id,
		status: 'PAID',
		paid_at: '2026-01-31T00:00:00.000Z',
		currency: 'PHP',
		base: [],
		statutory: [],
		adjustments: [
			...(days > 0
				? [
						{
							component_code: 'ANNUAL_LEAVE_ENCASHMENT',
							bucket: 'EARNING',
							amount: days * 1000,
							quantity: days,
							rate: 1000
						}
					]
				: []),
			{ component_code: 'bonus', bucket: 'EARNING', amount: bonus },
			{ component_code: 'meal', bucket: 'EARNING', amount: rice }
		]
	} as never);
}

test('Philippines — excess monetised vacation enters the shared ₱90,000 benefits exemption (RMC 50-2018 Q5)', () => {
	// 15 days at 30,000 / 21.75 = 20,689.66. Twelve days are de minimis;
	// the remainder fits within the unused ₱90,000 pool, so only salary is taxable.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-ENCASH', wage: 30_000 }] },
		(world) => phCashOut(world, 15, '2026-01')
	);
	expectStatutoryBase(book, 'PH-ENCASH', 'WTAX', 30_000);
});

test('Philippines — a pay rise does not renew the twelve-day cash-out exemption', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-02', people: [{ key: 'PH-ENCASH', wage: 43_500 }] },
		(world) => {
			phPaidBenefits(world, 12, 90_000);
			phCashOut(world, 3, '2026-02');
		}
	);
	// January used all 12 days at 1,000 and the whole benefits pool.
	// February's three days at 2,000 are fully taxable: 43,500 + 6,000.
	expectStatutoryBase(book, 'PH-ENCASH', 'WTAX', 49_500);
});

test('Philippines — earlier excess leave consumes the shared cap at its original salary rate', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-02', people: [{ key: 'PH-ENCASH', wage: 43_500 }] },
		(world) => {
			phPaidBenefits(world, 15, 86_000);
			phCashOut(world, 3, '2026-02');
		}
	);
	// Prior benefits: 86,000 + (15 - 12) × 1,000 = 89,000.
	// Of this month's 6,000, only 1,000 remains exempt.
	expectStatutoryBase(book, 'PH-ENCASH', 'WTAX', 48_500);
});

test('Philippines — earlier rice excess and current leave excess share the benefits cap', () => {
	const book = assessStatutory(
		{ code: 'PH', period: '2026-02', people: [{ key: 'PH-ENCASH', wage: 43_500 }] },
		(world) => {
			phPaidBenefits(world, 0, 88_000, 3500);
			phCashOut(world, 15, '2026-02');
			const rice = world.allowance_catalogue.find(
				(row) => row.code === 'meal' && row.settings_id === PH_2026
			)!;
			world.employment_terms[0]!.allowances = [{ catalogue_id: rice.id, amount: 3500 }];
			// Rice is excluded from the conversion salary, as an allowance distinct from basic pay.
			for (const version of world.jurisdiction_settings)
				version.work_rules.encashment!.exclude_allowances = ['meal'];
		}
	);
	// January: 88,000 + 1,000 rice excess. February: 6,000 leave excess
	// + 1,000 rice excess, less the remaining 1,000 exemption = 6,000 taxable.
	expectStatutoryBase(book, 'PH-ENCASH', 'WTAX', 49_500);
});

test('Philippines — missing paid cash-out quantities stop exemption calculation', () => {
	assert.throws(
		() =>
			assessStatutory(
				{ code: 'PH', period: '2026-02', people: [{ key: 'PH-ENCASH', wage: 43_500 }] },
				(world) => {
					phPaidBenefits(world, 12, 90_000);
					delete world.payslips[0]!.adjustments[0]!.quantity;
					phCashOut(world, 3, '2026-02');
				}
			),
		/positive paid day quantities/
	);
});

test('Philippines — SSS covers an employee not over sixty when first covered (RA 11199 s.9(a)); a member stays covered past it', () => {
	// Hired — and so first covered — at 58, now 62: still a member, still charged. Hired at 61:
	// never within compulsory coverage. The fixture registers on the hire date, which is the day
	// `employee.age_on(scheme.since)` reads.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-01',
		people: [
			{ key: 'PH-58-AT-HIRE', wage: 30_000, birth_date: '1963-06-15', hire_date: '2022-01-01' },
			{ key: 'PH-61-AT-HIRE', wage: 30_000, birth_date: '1963-06-15', hire_date: '2025-01-01' }
		]
	});
	expectStatutory(book, 'PH-58-AT-HIRE', 'SSS', 1000, 2000);
	expectStatutorySkipped(book, 'PH-61-AT-HIRE', 'SSS');
});

test('Philippines — separation pay: a month per year on redundancy, half a month on retrenchment, closure or disease (Labor Code art.298–299)', () => {
	// Five years and two months at ₱30,000: redundancy pays 5 × 30,000 = 150,000 (a fraction of
	// six months would have counted a year); retrenchment 5 × 15,000 = 75,000; a leaver of eight
	// months on retrenchment gets the one-month floor, 30,000.
	const separation = (key: string, wage: number, hire: string, reason: string) => ({
		key,
		wage,
		hire_date: hire,
		exit_date: '2026-01-31',
		exit_reason: reason
	});
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				separation('PH-REDUNDANT', 30_000, '2020-11-15', 'REDUNDANCY'),
				separation('PH-RETRENCHED', 30_000, '2020-11-15', 'RETRENCHMENT'),
				separation('PH-RETRENCHED-8M', 30_000, '2025-05-15', 'RETRENCHMENT')
			]
		},
		(world) => {
			const row = world.adhoc_catalogue!.find(
				(item) => item.code === 'SEPARATION_PAY' && item.settings_id === PH_2026_JAN6
			)!;
			for (const [index, key] of ['PH-REDUNDANT', 'PH-RETRENCHED', 'PH-RETRENCHED-8M'].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				// Labor Code arts.298–299: the authorised cause, recorded on the departure.
				employment.exit_facts = {
					termination_cause: key === 'PH-REDUNDANT' ? 'REDUNDANCY' : 'RETRENCHMENT'
				};
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000000f${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'separation pay',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'SEPARATION_PAY')?.amount;
	assert.equal(paid('PH-REDUNDANT'), 150_000);
	assert.equal(paid('PH-RETRENCHED'), 75_000);
	assert.equal(paid('PH-RETRENCHED-8M'), 30_000);
});

test('Philippines — a non-resident alien not engaged in trade or business is withheld 25% of the gross (NIRC s.25(B))', () => {
	// ₱80,000 with ₱2,000 of meal allowance (de minimis to a resident): 25% of the entire
	// compensation, 82,000 × 25% = 20,500 — no exemption, no table; the same alien engaged in
	// trade or business is on the graduated table like a resident.
	const book = assessStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{
					key: 'PH-NETB',
					wage: 80_000,
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT_NETB'
				},
				{ key: 'PH-NRA-ETB', wage: 80_000, citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' }
			]
		},
		(world) => {
			const rice = world.allowance_catalogue.find(
				(row) => row.code === 'meal' && row.settings_id === PH_2026
			);
			if (rice == null) return;
			for (const [index, key] of ['PH-NETB', 'PH-NRA-ETB'].entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-0000000000c${index}`,
					employment_id: employment.id,
					catalogue_id: rice.id,
					amount: 2000,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: 'meal',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const netb = book.get('PH-NETB')!.get('WTAX')!;
	const etb = book.get('PH-NRA-ETB')!.get('WTAX')!;
	assert.equal(netb.base, 82_000);
	assert.equal(netb.employee, 20_500);
	assert.ok(etb.employee < netb.employee, 'the graduated table withholds less than the flat 25%');
});

test('a reversed deduction lands as a payment of its magnitude, never a deduction of a negative figure', () => {
	// A PhilHealth adjustment of −750 (a refund of an earlier over-deduction) on the NET/SUBTRACT
	// `STATUTORY_ADJUSTMENT` row, entered as an adjustment entry: the payslip carries a
	// NON_WAGE_PAYMENT of 750 and the net rises by 750; no line stores a sign.
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-REFUND', wage: 30_000 }] },
		(world) => {
			const row = world.adhoc_catalogue!.find(
				(item) => item.code === 'STATUTORY_ADJUSTMENT' && item.settings_id === PH_2026
			)!;
			const employment = world.employments.find((item) => item.employee_number === 'PH-REFUND')!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000000a9',
				employment_id: employment.id,
				catalogue_id: row.id,
				amount: 750,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: 'PhilHealth adjustment Dec 2025',
				evidence_file: null,
				as_adjustment_entry: true,
				approval_id: null
			});
		}
	);
	const slip = slips.get('PH-REFUND')!;
	const line = slip.adjustments.find((row) => row.component_code === 'STATUTORY_ADJUSTMENT')!;
	assert.deepEqual([line.bucket, line.amount], ['NON_WAGE_PAYMENT', 750]);
	assert.ok(
		slip.adjustments.every((row) => row.amount >= 0),
		'every line is a magnitude'
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 6 (2026-09-28): the payslip scenarios, each figure computed by hand from the instrument.
//
// SSS: Circular 2024-006 (schedule from January 2025) — 15% of the MSC, employer 10% / employee
// 5%; MSC ₱5,000–35,000 in ₱500 rungs named by their floor ("14,750 – 15,249.99 → 15,000"); the
// first ₱20,000 is Regular SS, the excess MPF; EC ₱10 to the 14,250–14,749.99 rung, ₱30 above.
// PhilHealth: Advisory 2025-0002 — 5% of the Monthly Basic Salary, ₱10,000 floor, ₱100,000
// ceiling; "the fixed basic rate", excluding allowances, overtime, 13th-month pay and bonuses, and
// excluding "deductions … occasioned by … leave(s) without pay, absences"
// (philhealth.gov.ph/advisories/2025/PA2025-0002.pdf, read 2026-09-28).
// Pag-IBIG: Circular 460 (15 January 2024, from February 2024; DMW Advisory 37-2025 annex,
// wcms.dmw.gov.ph/uploads/DMW_ADVISORY_37_2025_01225b9fec.pdf, read 2026-09-28) p.1: 1% / 2% at a
// fund salary of ₱1,500 and below, 2% / 2% over; p.2: "Fund Salary shall refer to the basic salary
// and other allowances", maximum ₱10,000; p.3: a kasambahay under ₱5,000 fund salary pays nothing,
// the employer 3% / 4%.
// Withholding: RR 11-2018 Annex E (2023-onward monthly column: ≤20,833 nil; 15% over 20,833;
// 1,875 + 20% over 33,333; 8,541.80 + 25% over 66,667 …), s.2.79(B)(5)(a)–(b) (supplementary pay
// on the regular-pay bracket; cumulative averaging; annualisation on a leaver's last payment);
// RR 2-98 s.2.78.1(A)(3)(a) as amended by RR 29-2025 (bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf,
// read 2026-09-28): monetised unused vacation leave to twelve days is de minimis.
// Daily rate: DOLE Handbook ch.2 §E, ₱ × 12 ÷ 261 for a five-day week not paid on rest days.
// ─────────────────────────────────────────────────────────────────────────────

import { exitEncashments } from '../src/lib/leave/exit-encashment.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { id as leaveId, leaveContext } from './helpers/manual-leave-context.ts';

/** Paid monthly payslips before the run, each at `wage` with its settled statutory rows. */
function paidMonths(
	world: PayrollWorld,
	key: string,
	months: readonly string[],
	wage: number,
	rows: readonly (readonly [string, number, number])[]
) {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	for (const period of months) {
		world.payroll_runs.push({ id: `paid-${key}-${period}`, company_id: COMPANY_ID, period });
		world.payslips.push({
			id: `paid-${key}-${period}-slip`,
			payroll_run_id: `paid-${key}-${period}`,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${period}-28T00:00:00.000Z`,
			currency: 'PHP',
			base: [{ component_code: 'BASIC', amount: wage }],
			adjustments: [],
			statutory: rows.map(([scheme_code, employee_amount, employer_amount]) => ({
				scheme_code,
				employee_amount,
				employer_amount,
				base_amount: wage,
				rule_when: null,
				authority: null
			}))
		} as never);
	}
}
/** ₱30,000 a month as the table charges it: SSS 1,500 / 3,000, PHIC 750, HDMF 200, WTAX 1,007.55. */
const PAID_30000 = [
	['WTAX', 1007.55, 0],
	['SSS', 1500, 3000],
	['PHIC', 750, 750],
	['HDMF', 200, 200]
] as const;

const adhoc = (world: PayrollWorld, index: number, code: string, day: string, amount: number) =>
	world.adhoc_requests!.push({
		id: `d6000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		employment_id: world.employments[0]!.id,
		catalogue_id: rowIn(adhocCatalogue('PH'), settingsIdOn('PH', day), code),
		amount,
		event_date: day,
		pay_period: null,
		payslip_id: null,
		reason: code,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});

const standing = (world: PayrollWorld, key: string, code: string, amount: number, from: string) =>
	assignAllowance(world, {
		id: `d6100000-0000-4000-8000-${String(world.allowances.length).padStart(12, '0')}`,
		employment_id: world.employments.find((row) => row.employee_number === key)!.id,
		catalogue_id: String(rowIn(allowanceCatalogue('PH'), settingsIdOn('PH', from), code)),
		amount,
		effective_from: from,
		effective_to: null,
		reason: '',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});

test('Philippines — a joiner on 16 January is paid the days worked, and charged on what was paid', () => {
	// January 2026 from Friday the 16th: 16, 19–23, 26–30 = 11 working days at ₱60,000 × 12 ÷ 261
	// = 2,758.62 a day: 60,000 × 11 ÷ 21.75 = 30,344.83.
	const { slips } = buildStatutory({
		code: 'PH',
		period: '2026-01',
		people: [{ key: 'PH-JOIN', wage: 60_000, hire_date: '2026-01-16' }]
	});
	const slip = slips.get('PH-JOIN')!;
	assert.equal(slip.gross, 30_344.83);
	const charge = (code: string) => {
		const row = slip.statutory.find((line) => line.scheme_code === code)!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	// SSS (RA 11199 s.18: the month's actual compensation): 30,344.83 is in "30,250 – 30,749.99 →
	// 30,500": Regular SS 20,000 → 1,000 / 2,000; MPF 10,500 → 525 / 1,050; EC ₱30.
	assert.deepEqual(charge('SSS'), [30_344.83, 1000, 2000]);
	assert.deepEqual(charge('SSS_MPF'), [30_344.83, 525, 1050]);
	assert.deepEqual(charge('SSS_EC'), [30_344.83, 0, 30]);
	// PhilHealth on the fixed monthly basic, not the days paid: 5% × 60,000 = 3,000 → 1,500 each.
	assert.deepEqual(charge('PHIC'), [60_000, 1500, 1500]);
	assert.deepEqual(charge('HDMF'), [60_000, 200, 200]);
	// 30,344.83 − (1,525 + 1,500 + 200) = 27,119.83: 15% × (27,119.83 − 20,833) = 943.0245 → 943.02.
	assert.deepEqual(charge('WTAX'), [30_344.83, 943.02, 0]);
});

test('Philippines — a leaver on 13 March: part month, SIL conversion, pro-rata 13th month and the annualised refund', () => {
	// Hired 2020, resigns effective Friday 13 March 2026, ₱30,000 a month.
	const EXIT = '2026-03-13';
	const exitVersion = settingsIdOn('PH', EXIT);
	const annual = leaveCatalogue('PH').find(
		(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === exitVersion
	)!;
	// SIL (Labor Code art.95; Handbook ch.7 §D, pro rata on separation): the leave year earns five
	// days over its completed months — January and February — so 5 × 2 ÷ 12 = 0.8333 days, unused.
	const context = leaveContext();
	context.catalogues = [{ ...annual, id: leaveId(7), settings_id: leaveId(6) } as never];
	context.employments[0]!.effective_range = { start: '2020-01-01', end: EXIT };
	context.terms[0]!.effective_range = { start: '2020-01-01', end: EXIT };
	const [encash] = exitEncashments({
		employmentId: leaveId(1),
		exitDate: EXIT,
		summaries: leaveBalanceSummaries(context, leaveId(1), EXIT),
		encashable: new Set([leaveId(7)]),
		posted: new Set(),
		reason: 'departure'
	});
	assert.equal(Math.round(encash!.encash_days! * 1e6) / 1e6, 0.833333);
	// Art.95 grants SIL only after a year of service: a nine-month leaver converts nothing.
	const short = leaveContext();
	short.catalogues = context.catalogues;
	short.employments[0]!.effective_range = { start: '2025-06-01', end: EXIT };
	short.terms[0]!.effective_range = { start: '2025-06-01', end: EXIT };
	assert.deepEqual(leaveBalanceSummaries(short, leaveId(1), EXIT), []);

	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-03',
			people: [
				{
					key: 'PH-LEAVER',
					wage: 30_000,
					hire_date: '2020-01-01',
					exit_date: EXIT,
					exit_reason: 'RESIGNATION'
				}
			]
		},
		(world) => {
			world.leave_catalogue.push({ ...annual, approval_id: null } as never);
			world.leave_entries.push({
				...encash!,
				id: 'e6000000-0000-4000-8000-000000000001',
				employment_id: world.employments[0]!.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				half_day_start: false,
				half_day_end: false,
				allocations: [],
				charges: [],
				approval_id: null
			} as never);
			paidMonths(world, 'PH-LEAVER', ['2026-01', '2026-02'], 30_000, PAID_30000);
			// P.D. 851 Revised Guidelines ¶6: a leaver's 13th month is a twelfth of the basic salary
			// earned in the year, paid on separation.
			adhoc(world, 1, 'THIRTEENTH_MONTH_PAY', EXIT, 1);
		}
	);
	const slip = slips.get('PH-LEAVER')!;
	// 2–6 and 9–13 March: 10 working days, 30,000 × 10 ÷ 21.75 = 13,793.10.
	assert.deepEqual(
		slip.proration.map((row) => [row.days, row.prorated_amount]),
		[[10, 13_793.1]]
	);
	const line = (code: string) =>
		slip.adjustments.find((row) => row.component_code === code)?.amount;
	// 0.8333 × 1,379.31 (30,000 × 12 ÷ 261, the rate on the conversion date) = 1,149.43.
	assert.equal(line('ANNUAL_LEAVE_ENCASHMENT'), 1149.43);
	// (30,000 + 30,000 + 13,793.10) ÷ 12 = 6,149.425 → 6,149.43.
	assert.equal(line('THIRTEENTH_MONTH_PAY'), 6149.43);
	const charge = (code: string) => {
		const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	// SSS on the month's remuneration, the conversion included: 14,942.53 → MSC 15,000: 750 /
	// 1,500, EC ₱30. The 13th month is outside it: DOLE Handbook 2024 ch.13 §I (Revised
	// Guidelines on PD 851) excludes it from SSS contributions; SSS IRR Rule 12 s.6(iii).
	assert.deepEqual(charge('SSS'), [14_942.53, 750, 1500]);
	assert.deepEqual(charge('SSS_EC'), [14_942.53, 0, 30]);
	assert.deepEqual(charge('PHIC'), [30_000, 750, 750]);
	// The last payment annualises (RR 11-2018 s.2.79(B)(5)(b)): 73,793.10 taxable regular pay (the
	// 0.83 days de minimis, the 13th month inside ₱90,000) less 6,600 of contributions = 67,193.10,
	// under the ₱250,000 annual threshold: nil due, so January's and February's 2,015.10 is refunded.
	assert.deepEqual(charge('WTAX'), [13_793.1, -2015.1, 0]);
});

test('Philippines — two days of leave without pay: SSS and Pag-IBIG read the reduced pay, PhilHealth the fixed basic', () => {
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'PH-LWOP2', wage: 30_000 }] },
		(world) => {
			withNoPayLeaveRow(world);
			noPayLeave(world, 'PH-LWOP2', ['2026-06-02', '2026-06-03']);
		}
	);
	const slip = slips.get('PH-LWOP2')!;
	// Two days at 30,000 × 12 ÷ 261 = 1,379.31: 30,000 − 2,758.62 = 27,241.38.
	assert.equal(slip.gross, 27_241.38);
	const charge = (code: string) => {
		const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	// "26,750 – 27,249.99 → 27,000": 1,000 / 2,000 and MPF 7,000 → 350 / 700.
	assert.deepEqual(charge('SSS'), [27_241.38, 1000, 2000]);
	assert.deepEqual(charge('SSS_MPF'), [27_241.38, 350, 700]);
	// Advisory 2025-0002: leave-without-pay deductions are excluded from the MBS: 750 each.
	assert.deepEqual(charge('PHIC'), [30_000, 750, 750]);
	assert.deepEqual(charge('HDMF'), [27_241.38, 200, 200]);
	// 27,241.38 − (1,350 + 750 + 200) = 24,941.38: 15% × 4,108.38 = 616.257 → 616.26.
	assert.deepEqual(charge('WTAX'), [27_241.38, 616.26, 0]);
});

test('Philippines — overtime, rest day, regular holiday, special day and the night hour, on one payslip', () => {
	// ₱21,750 a month: a day 1,000, an hour 125. Each day is worked 09:00 to 20:00, ten hours net of
	// the shift's unpaid hour (art.85); the rest day on the 13th has no shift, and the version's
	// `work_rules.breaks` provides 60 minutes when continuous_attendance is unasserted (art.85), so
	// its continuous eleven-hour span takes the provided hour off — ten hours worked. The salary
	// pays a working holiday at 100% (261 factor); the rest day is unpaid. Handbook ch.2–4 totals:
	// ordinary overtime 125% (art.87); rest day 130%, beyond eight 169% (art.93); regular holiday
	// 200%, beyond eight 260% (art.94); special day 130%, beyond eight 169%; the night hour 10% of
	// the hour's own rate (art.86).
	const holiday = (world: PayrollWorld, date: string, kind: string) =>
		world.jurisdiction_holidays.push({
			id: `h-${date}`,
			company_id: COMPANY_ID,
			date,
			name: kind,
			kind,
			replaces: null,
			given_to: null,
			source: null,
			published_at: '2025-12-01T00:00:00.000Z',
			approval_id: null
		});
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'PH-OT', wage: 21_750 }] },
		(world) => {
			holiday(world, '2026-06-12', 'PUBLIC_HOLIDAY'); // Friday, Independence Day
			holiday(world, '2026-06-17', 'SPECIAL_HOLIDAY'); // a Wednesday declared special
			for (const date of ['2026-06-08', '2026-06-12', '2026-06-17'])
				punchPh(world, 'PH-OT', date, '09:00', '20:00', '13:00');
			punchPh(world, 'PH-OT', '2026-06-13', '09:00', '20:00'); // the rest day: no shift, the provided 60 minutes still come off
			punchPh(world, 'PH-OT', '2026-06-15', '09:00', '23:00', '13:00'); // thirteen net: five of overtime
		}
	);
	const slip = slips.get('PH-OT')!;
	assert.deepEqual(workLinesPh(slip), [
		['2026-06-08', 'OT-1.25X', 2, 312.5], // 2 × 125 × 1.25
		['2026-06-12', 'OT-2.0X', 8, 1000], // 8 × 125 × (2.0 − 1.0)
		['2026-06-12', 'OT-2.6X', 2, 650], // 2 × 125 × 2.6
		['2026-06-13', 'OT-1.3X', 8, 1300], // 8 × 125 × 1.3
		['2026-06-13', 'OT-1.69X', 2, 422.5], // 2 × 125 × 1.69: 11 clocked − 1 provided = 10
		// 22:00–23:00 on the 15th is an overtime hour: 10% × 156.25 = 15.625 → 15.63.
		['2026-06-15', 'NIGHT_PREMIUM', 1, 15.63],
		['2026-06-15', 'OT-1.25X', 5, 781.25], // 5 × 125 × 1.25
		['2026-06-17', 'OT-1.3X', 8, 300], // 8 × 125 × (1.3 − 1.0)
		['2026-06-17', 'OT-1.69X', 2, 422.5] // 2 × 125 × 1.69
	]);
	// 21,750 + 5,204.38 = 26,954.38.
	assert.equal(slip.gross, 26_954.38);
	const charge = (code: string) => {
		const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	// SSS on the month's compensation, overtime included: MSC 27,000 → 1,000 / 2,000 + 350 / 700.
	assert.deepEqual(charge('SSS'), [26_954.38, 1000, 2000]);
	assert.deepEqual(charge('SSS_MPF'), [26_954.38, 350, 700]);
	// PhilHealth on the basic alone (overtime excluded): 5% × 21,750 = 1,087.50 → 543.75 each.
	assert.deepEqual(charge('PHIC'), [21_750, 543.75, 543.75]);
	// Regular pay net of contributions, 21,750 − 2,093.75 = 19,656.25, is under ₱20,833 while
	// supplementary pay is paid: s.2.79(B)(5)(a) cumulative averaging, which in the year's first
	// averaged month is the table on the whole: 26,954.38 − 2,093.75 = 24,860.63 →
	// 15% × 4,027.63 = 604.1445 → 604.14.
	assert.deepEqual(charge('WTAX'), [26_954.38, 604.14, 0]);
});

test('Philippines — a late start with no overtime earns the ordinary 10% night rate on its night hour (Labor Code art.86)', () => {
	// Rostered 14:00–23:00, a late starter's eight paid hours, worked 14:00–23:00 with the meal
	// taken: eight net hours, no overtime (art.87 counts hours beyond eight). The 22:00–23:00 hour is
	// an ordinary night hour: 10% × 125 = 12.50, and its 125 inside the salary is shown, not paid
	// again (NIGHT_WAGE). The roster must cover the hours actually worked: clocked outside it, the
	// day reads hours outside ordinary paid work (work.ts, "Reconcile the work day before payroll").
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'PH-ND', wage: 21_750 }] },
		(world) => {
			world.shift_definitions[0]!.variant = {
				kind: 'WORK',
				start_time: '14:00',
				end_time: '23:00',
				break_minutes: 60
			};
			punchPh(world, 'PH-ND', '2026-06-15', '14:00', '23:00', '18:00');
		}
	);
	assert.deepEqual(
		slips
			.get('PH-ND')!
			.adjustments.map((row) => [row.component_code, row.label, row.quantity, row.amount]),
		[
			['NIGHT_PREMIUM', 'NIGHT_PREMIUM', 1, 12.5],
			['NIGHT_WAGE', 'NIGHT_WAGE', 1, 125]
		]
	);
});

test('Philippines — a 21:00–06:00 punch rostered to a night shift with no overtime prices every night hour at the ordinary 10% (Labor Code art.86)', () => {
	// Rostered 21:00–06:00, eight paid hours, worked across the night with the meal taken: eight net
	// hours, none of them overtime (art.87). The roster must cover the hours actually worked; clocked
	// outside it, the day reads hours outside ordinary paid work (work.ts, "Reconcile the work day
	// before payroll"). Art.86 reaches only the 22:00–06:00 window: of the nine clocked hours, the
	// meal break is unworked and 21:00–22:00 is not a night hour, leaving seven.
	// 7 × 10% × 125 = 87.50.
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'PH-ND2', wage: 21_750 }] },
		(world) => {
			world.shift_definitions[0]!.variant = {
				kind: 'WORK',
				start_time: '21:00',
				end_time: '06:00',
				break_minutes: 60
			};
			punchPh(world, 'PH-ND2', '2026-06-15', '21:00', '23:00');
			world.work_days.at(-1)!.worked_intervals = [
				{ start: '2026-06-15T21:00:00+08:00', end: '2026-06-16T01:00:00+08:00' },
				{ start: '2026-06-16T02:00:00+08:00', end: '2026-06-16T06:00:00+08:00' }
			];
		}
	);
	assert.deepEqual(
		slips
			.get('PH-ND2')!
			.adjustments.filter((row) => row.component_code === 'NIGHT_PREMIUM')
			.map((row) => [row.quantity, row.amount]),
		[[7, 87.5]]
	);
});

test('Philippines — 13th month in December nets the unpaid days, and the annual table relieves it', () => {
	// Eleven months paid at ₱30,000; December's run charges 24–25 November without pay.
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-12', people: [{ key: 'PH-13TH', wage: 30_000 }] },
		(world) => {
			withNoPayLeaveRow(world);
			noPayLeave(world, 'PH-13TH', ['2026-11-24', '2026-11-25']);
			paidMonths(
				world,
				'PH-13TH',
				Array.from({ length: 11 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
				30_000,
				PAID_30000
			);
			adhoc(world, 2, 'THIRTEENTH_MONTH_PAY', '2026-12-01', 1);
		}
	);
	const slip = slips.get('PH-13TH')!;
	// P.D. 851 s.1 / Revised Guidelines ¶4: a twelfth of the basic salary earned, the unpaid days
	// out: (12 × 30,000 − 2 × 1,379.31) ÷ 12 = 357,241.38 ÷ 12 = 29,770.115 → 29,770.12.
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'THIRTEENTH_MONTH_PAY')!.amount,
		29_770.12
	);
	// Annualised (RR 11-2018 s.2.79(B)(5)(b)): 330,000 + 27,241.38 = 357,241.38, the 13th month
	// inside ₱90,000 (NIRC s.32(B)(7)(e)); contributions 11 × 2,450 + (1,350 + 750 + 200) =
	// 29,250; 327,991.38 → 15% × 77,991.38 = 11,698.71, less 11 × 1,007.55 = 615.66.
	const wtax = slip.statutory.find((row) => row.scheme_code === 'WTAX')!;
	assert.deepEqual([wtax.base_amount, wtax.employee_amount], [27_241.38, 615.66]);
});

test('Philippines — a June bonus sits inside the ₱90,000 pool; its excess is taxed on the regular bracket', () => {
	// NIRC s.32(B)(7)(e)(iv): 13th-month pay and other benefits to ₱90,000 are excluded. ₱50,000
	// leaves the base at the salary; ₱100,000 puts 10,000 in. The bonus is SSS compensation (SSS
	// IRR Rule 12 s.6(iii)), so either amount takes SSS to the ₱35,000 MSC ceiling: employee
	// 1,000 + 750 MPF = 1,750, excluded from gross income with PhilHealth 750 and HDMF 200 (NIRC
	// s.32(B)(7)(f)). Regular pay net 30,000 − 2,700 = 27,300 selects the 15% rung (R45; RR 11-2018
	// s.2.79(B)): 15% × (27,300 − 20,833) = 970.05; 15% × (27,300 + 10,000 − 20,833) = 2,470.05. The
	// supplement is below the regular pay, so no cumulative averaging.
	for (const [bonus, base, tax] of [
		[50_000, 30_000, 970.05],
		[100_000, 40_000, 2470.05]
	] as const) {
		const book = assessStatutory(
			{ code: 'PH', period: '2026-06', people: [{ key: 'PH-BONUS', wage: 30_000 }] },
			(world) => adhoc(world, 3, 'bonus', '2026-06-15', bonus)
		);
		expectStatutoryBase(book, 'PH-BONUS', 'WTAX', base);
		expectStatutory(book, 'PH-BONUS', 'WTAX', tax, 0);
	}
});

test('Philippines — every contribution seam, a centavo either side', () => {
	const book = assessStatutory({
		code: 'PH',
		period: '2026-06',
		people: [
			{ key: 'S-5249.99', wage: 5249.99 },
			{ key: 'S-14749.99', wage: 14_749.99 },
			{ key: 'S-20249.99', wage: 20_249.99 },
			{ key: 'S-20250', wage: 20_250 },
			{ key: 'S-34749.99', wage: 34_749.99 },
			{ key: 'S-34750', wage: 34_750 },
			{ key: 'P-9999.99', wage: 9999.99 },
			{ key: 'P-100000', wage: 100_000 },
			{ key: 'P-100000.01', wage: 100_000.01 },
			{ key: 'H-1500', wage: 1500 },
			{ key: 'H-10000', wage: 10_000 },
			{ key: 'W-23283', wage: 23_283 }
		]
	});
	// SSS: "below 5,250 → 5,000"; "14,250 – 14,749.99 → 14,500" (EC ₱10); "19,750 – 20,249.99 →
	// 20,000" (no MPF); "20,250 – 20,749.99 → 20,500" (MPF 500 → 25 / 50); "34,250 – 34,749.99 →
	// 34,500" (MPF 725 / 1,450); "34,750 and over → 35,000" (MPF 750 / 1,500).
	expectStatutory(book, 'S-5249.99', 'SSS', 250, 500);
	expectStatutory(book, 'S-14749.99', 'SSS', 725, 1450);
	expectStatutory(book, 'S-14749.99', 'SSS_EC', 0, 10);
	expectStatutory(book, 'S-20249.99', 'SSS', 1000, 2000);
	expectStatutorySkipped(book, 'S-20249.99', 'SSS_MPF');
	expectStatutory(book, 'S-20250', 'SSS_MPF', 25, 50);
	expectStatutory(book, 'S-34749.99', 'SSS_MPF', 725, 1450);
	expectStatutory(book, 'S-34750', 'SSS_MPF', 750, 1500);
	// PhilHealth: 9,999.99 → the ₱500 floor; 5% × 100,000 = 5,000; above → capped. Rounding:
	// 5% × 20,249.99 = 1,012.4995 → 1,012.50 → 506.25 each; 5% × 23,283 = 1,164.15 → 582.07 /
	// 582.08 (employee truncated, employer the remainder).
	expectStatutory(book, 'P-9999.99', 'PHIC', 250, 250);
	expectStatutory(book, 'P-100000', 'PHIC', 2500, 2500);
	expectStatutory(book, 'P-100000.01', 'PHIC', 2500, 2500);
	expectStatutory(book, 'S-20249.99', 'PHIC', 506.25, 506.25);
	expectStatutory(book, 'W-23283', 'PHIC', 582.07, 582.08);
	// Pag-IBIG: ₱1,500 is "₱1,500 and below": 1% → 15, employer 2% → 30; ₱10,000 is the ceiling.
	expectStatutory(book, 'H-1500', 'HDMF', 15, 30);
	expectStatutory(book, 'H-10000', 'HDMF', 200, 200);
	expectStatutory(book, 'S-5249.99', 'HDMF', 105, 105);
	// Withholding, rounded to the centavo:
	// 34,749.99 − (1,725 + 868.75 + 200) = 31,956.24 → 15% × 11,123.24 = 1,668.486 → 1,668.49;
	// 34,750 − (1,750 + 868.75 + 200) = 31,931.25 → 15% × 11,098.25 = 1,664.7375 → 1,664.74;
	// 100,000 − 4,450 = 95,550 → 8,541.80 + 25% × 28,883 = 15,762.55;
	// 23,283 − (1,175 + 582.07 + 200) = 21,325.93 → 15% × 492.93 = 73.9395 → 73.94.
	expectStatutory(book, 'S-34749.99', 'WTAX', 1668.49, 0);
	expectStatutory(book, 'S-34750', 'WTAX', 1664.74, 0);
	expectStatutory(book, 'P-100000', 'WTAX', 15_762.55, 0);
	expectStatutory(book, 'W-23283', 'WTAX', 73.94, 0);
	// 20,249.99 − 1,706.25 = 18,543.74, under ₱20,833: nil.
	expectStatutory(book, 'S-20249.99', 'WTAX', 0, 0);
});

test('Philippines — Pag-IBIG reads the fund salary, allowances included (Circular 460 pp.2–3)', () => {
	// ₱8,000 basic + ₱1,000 transport: fund salary 9,000 → 2% = 180 each (the basic alone gave 160).
	const worker = assessStatutory(
		{ code: 'PH', period: '2026-10', people: [{ key: 'H-FUND', wage: 8000 }] },
		(world) => standing(world, 'H-FUND', 'transport', 1000, '2026-10-01')
	);
	expectStatutoryBase(worker, 'H-FUND', 'HDMF', 9000);
	expectStatutory(worker, 'H-FUND', 'HDMF', 180, 180);
	// A synthetic ₱4,800 kasambahay would test the ₱5,000 contribution threshold, but falls below
	// NCR-DW-06's ₱7,800 mandatory wage floor and cannot produce a payroll run.
	const household = (allowance: number) =>
		assessStatutory(
			{
				code: 'PH',
				period: '2026-10',
				region: 'NCR',
				people: [{ key: 'DW', wage: 4800, employment_type: 'DOMESTIC' }]
			},
			(world) => {
				if (allowance > 0) standing(world, 'DW', 'allowance', allowance, '2026-10-01');
			}
		);
	assert.throws(() => household(0), /MINIMUM_WAGE_BELOW: DW/);
	assert.throws(() => household(400), /MINIMUM_WAGE_BELOW: DW/);
});

test('Philippines — a non-resident alien engaged in business is on the graduated table, to the centavo', () => {
	// NIRC s.25(A)(1): graduated like a resident. 80,000 − (1,750 + 2,000 + 200) = 76,050 →
	// 8,541.80 + 25% × 9,383 = 10,887.55.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-06',
		people: [
			{ key: 'PH-ETB', wage: 80_000, citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' }
		]
	});
	expectStatutory(book, 'PH-ETB', 'WTAX', 10_887.55, 0);
});

test('Philippines — SSS age at first coverage: hired the day before the 60th birthday is covered (RA 11199 s.9(a))', () => {
	// Born 10 June 1966, hired 9 June 2026 at 59: covered, on June's 16 paid days —
	// 30,000 × 16 ÷ 21.75 = 22,068.97 → MSC 22,000: 1,000 / 2,000 and MPF 100 / 200.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-06',
		people: [{ key: 'PH-59', wage: 30_000, birth_date: '1966-06-10', hire_date: '2026-06-09' }]
	});
	expectStatutoryBase(book, 'PH-59', 'SSS', 22_068.97);
	expectStatutory(book, 'PH-59', 'SSS', 1000, 2000);
	expectStatutory(book, 'PH-59', 'SSS_MPF', 100, 200);
});

test('Philippines — a mid-month raise is charged on the month it paid', () => {
	// The raise golden above pays 20,227.27; "19,750 – 20,249.99 → 20,000": 1,000 / 2,000, no MPF.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-01', people: [{ key: 'PH-RAISE', wage: 20_000 }] },
		(world) => {
			const term = world.employment_terms[0]!;
			term.effective_range = { start: term.effective_range.start, end: '2026-01-23' };
			world.employment_terms.push({
				...term,
				id: 'b0000000-0000-4000-8000-0000000000fe',
				base_salary: 21_000,
				effective_range: { start: '2026-01-24', end: null }
			});
		}
	);
	expectStatutoryBase(book, 'PH-RAISE', 'SSS', 20_227.27);
	expectStatutory(book, 'PH-RAISE', 'SSS', 1000, 2000);
	expectStatutorySkipped(book, 'PH-RAISE', 'SSS_MPF');
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 7 (2026-09-28): the completeness critic's work list, each figure by hand from the law.
// ─────────────────────────────────────────────────────────────────────────────

test('Philippines — final pay: thirty days from separation holds even at the widest gap a monthly run allows, and a later settlement run warns (LA 06-20 §II as seeded)', () => {
	// The seeded deadline is 30 calendar days from the separation date (`final_pay_deadlines`,
	// basis EVENT_DATE; LA 06-20's signed text is unread — dole.gov.ph serves a Cloudflare
	// challenge — so the 30 days rest on the seed row and DOLE's own title, PH-SRC07). A leaver is
	// settled in the run of the separation month, which pays on the month's last day, so the widest
	// gap is a separation on the 1st of a 31-day month: 1 January 2026 + 30 = 31 January, the pay
	// date itself — on the deadline, not after it, so no FINAL_PAY_LATE.
	for (const exit of ['2026-01-01', '2026-01-31']) {
		const { slips, warnings } = buildStatutory({
			code: 'PH',
			period: '2026-01',
			people: [
				{
					key: 'PH-FP',
					wage: 30_000,
					hire_date: '2020-01-01',
					exit_date: exit,
					exit_reason: 'RESIGNATION'
				}
			]
		});
		assert.ok(slips.get('PH-FP'), `the separation month's run settles the leaver (${exit})`);
		assert.deepEqual(
			warnings.filter((warning) => warning.includes('FINAL_PAY_LATE')),
			[],
			exit
		);
	}
	// A final pay settled after the separation month runs in the month it is paid: an outstanding
	// request keeps the ended contract in February's run (gather.ts `hasOutstandingRequest`), and
	// the deadline is read against that run's pay date. 10 January + 30 = 9 February; February
	// pays on 28 February, so FINAL_PAY_LATE. With nothing owed there is no February slip at all.
	const leaver = {
		code: 'PH' as const,
		period: '2026-02',
		people: [
			{
				key: 'PH-FP',
				wage: 30_000,
				hire_date: '2020-01-01',
				exit_date: '2026-01-10',
				exit_reason: 'RESIGNATION'
			}
		]
	};
	assert.equal(buildStatutory(leaver).slips.size, 0);
	const later = buildStatutory(leaver, (world) => {
		(world.adhoc_requests ??= []).push({
			id: 'PH-FP-final',
			employment_id: world.employments[0]!.id,
			catalogue_id: world.adhoc_catalogue!.find((row) => row.code === 'BACKPAY_BASIC')!.id,
			amount: 5_000,
			event_date: '2026-02-05',
			reason: 'Final pay balance',
			approval_id: null,
			as_adjustment_entry: false
		});
	});
	assert.equal(later.slips.get('PH-FP')?.gross, 5_000);
	assert.deepEqual(
		later.warnings.filter((warning) => warning.includes('FINAL_PAY_LATE')),
		[
			'FINAL_PAY_LATE: PH-FP left on 2026-01-10; the final pay is due within 30 days of the last ' +
				'day, by 2026-02-09, and this run pays on 2026-02-28 (DOLE Labor Advisory No.06-20 §II).'
		]
	);
});

test('Philippines — 13th-month pay is outside SSS and PhilHealth, a Christmas-season benefit (Revised Guidelines on PD 851; SSS IRR Rule 12 s.6(iii))', () => {
	// SSS IRR (RA 11199) Rule 12 s.6: compensation includes "Bonuses (except Christmas bonus)";
	// DOLE Handbook 2024 ch.13 §I (Revised Guidelines on PD 851): the 13th-month pay "is not part of
	// the regular wage … for purposes of … contributions to … Social Security System, National
	// Health Insurance Program". Eleven months paid at ₱30,000, December's 13th month = 360,000 ÷ 12
	// = 30,000.
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-12', people: [{ key: 'PH-13-SSS', wage: 30_000 }] },
		(world) => {
			paidMonths(
				world,
				'PH-13-SSS',
				Array.from({ length: 11 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
				30_000,
				PAID_30000
			);
			adhoc(world, 20, 'THIRTEENTH_MONTH_PAY', '2026-12-01', 1);
		}
	);
	const slip = slips.get('PH-13-SSS')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'THIRTEENTH_MONTH_PAY')!.amount,
		30_000
	);
	const charge = (code: string) => {
		const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	// SSS on the salary alone: MSC 30,000 → Regular SS 1,000 / 2,000, MPF 500 / 1,000 (not the
	// ₱35,000 ceiling a ₱60,000 base would reach).
	assert.deepEqual(charge('SSS'), [30_000, 1000, 2000]);
	assert.deepEqual(charge('SSS_MPF'), [30_000, 500, 1000]);
	// PhilHealth on the fixed basic: 5% × 30,000 = 1,500 → 750 each.
	assert.deepEqual(charge('PHIC'), [30_000, 750, 750]);
});

test('Philippines — a performance bonus is SSS compensation (SSS IRR Rule 12 s.6(iii))', () => {
	// SSS IRR of RA 11199, Rule 12 s.6 (p.28, https://www.sss.gov.ph/wp-content/uploads/2022/04/IRR-RA11199-SS-Act-of-2018_2.pdf):
	// compensation is all actual remuneration (RA 11199 s.8(f)), including "Bonuses (except
	// Christmas bonus)". ₱30,000 salary + ₱50,000 bonus = 80,000, above the last bracket: MSC
	// ₱35,000 (the ceiling, as PH-40000 above). Regular SS on 20,000: 5% / 10% = 1,000 / 2,000; MPF
	// on the 15,000 above it: 750 / 1,500; EC ₱30 from MSC 15,000.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'B', wage: 30_000 }] },
		(world) => adhoc(world, 3, 'bonus', '2026-06-15', 50_000)
	);
	expectStatutoryBase(book, 'B', 'SSS', 80_000);
	expectStatutory(book, 'B', 'SSS', 1000, 2000);
	expectStatutory(book, 'B', 'SSS_MPF', 750, 1500);
	expectStatutory(book, 'B', 'SSS_EC', 0, 30);
});

test('Philippines — separation pay for an authorised cause is outside the withholding base (NIRC s.32(B)(6)(b))', () => {
	// RA 8424 s.32(B)(6)(b): "Any amount received … as a consequence of separation … for any cause
	// beyond the control of the said official or employee" is excluded from gross income. Redundancy
	// after five years and two months at ₱30,000 (art.298): 5 × 30,000 = 150,000.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{
					key: 'PH-SEP-TAX',
					wage: 30_000,
					hire_date: '2020-11-15',
					exit_date: '2026-01-31',
					exit_reason: 'REDUNDANCY'
				}
			]
		},
		(world) => {
			const employment = world.employments[0]!;
			employment.exit_facts = { termination_cause: 'REDUNDANCY' };
			world.adhoc_requests!.push({
				id: 'd7000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: world.adhoc_catalogue!.find(
					(item) => item.code === 'SEPARATION_PAY' && item.settings_id === PH_2026_JAN6
				)!.id,
				amount: 0,
				event_date: '2026-01-31',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'separation pay',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('PH-SEP-TAX')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'SEPARATION_PAY')!.amount,
		150_000
	);
	const wtax = slip.statutory.find((row) => row.scheme_code === 'WTAX')!;
	// The last payment annualises (RR 11-2018 s.2.79(B)(5)(b)): 30,000 − 2,450 = 27,550 for the
	// year, under the ₱250,000 zero bracket: nil. The 150,000 is in neither base.
	assert.deepEqual([wtax.base_amount, wtax.employee_amount], [30_000, 0]);
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'SSS')!.base_amount, 30_000);
});

test('Philippines — a small employer still withholds on wages: the EOPT micro exemption is s.57(B) creditable tax only (RA 11976 s.8)', () => {
	// RA 11976 s.8 adds to NIRC s.57 "micro taxpayers shall not be required to withhold taxes under
	// Subsection (b)" — the creditable (expanded) withholding. Compensation is withheld under s.79
	// and returned under s.81 (amended by RA 11976 s.12, no size exemption). A fewer-than-ten
	// establishment at ₱30,000 in July: 30,000 − (1,500 + 750 + 200) = 27,550 → 15% × 6,717 =
	// 1,007.55, the same as any employer.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-07',
		companyFacts: { small_establishment: true },
		people: [{ key: 'PH-MICRO', wage: 30_000 }]
	});
	expectStatutory(book, 'PH-MICRO', 'WTAX', 1007.55, 0);
});

test('Philippines — a local special non-working day by Republic Act reaches the Navotas worksite only: 16 January earns the special-day premium there, a Manila site of the same company works an ordinary day (RA 12271)', () => {
	// RA 12271 s.1 (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/99770; lapsed into law
	// 7 Sep 2025; Manila Bulletin 13 Sep 2025, s.2 in force fifteen days after): "January 16 of every
	// year is hereby declared a special non-working holiday in the City of Navotas". The day is the
	// city's, not the employer's: one company, one calendar row scoped to the Navotas worksite.
	// ₱21,750 a month, an hour 125. Both worked 09:00–18:00 on Friday 16 January 2026, eight net
	// hours: at Navotas, Handbook ch.4 §C, 130% of which the salary already pays 100% →
	// 8 × 125 × 0.3 = 300. At Manila an ordinary day inside the normal hours: nothing extra.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'PH-NAV', wage: 21_750, worksite: 'NCR/Navotas' },
				{ key: 'PH-MNL', wage: 21_750, worksite: 'NCR/Manila' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push({
				id: 'h-navotas-2026',
				company_id: COMPANY_ID,
				date: '2026-01-16',
				name: 'Navotas foundation anniversary (RA 12271)',
				kind: 'SPECIAL_HOLIDAY',
				replaces: null,
				given_to: null,
				worksite: 'NCR/Navotas',
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			});
			punchPh(world, 'PH-NAV', '2026-01-16', '09:00', '18:00', '13:00');
			punchPh(world, 'PH-MNL', '2026-01-16', '09:00', '18:00', '13:00');
		}
	);
	assert.deepEqual(workLinesPh(slips.get('PH-NAV')!), [['2026-01-16', 'OT-1.3X', 8, 300]]);
	assert.deepEqual(workLinesPh(slips.get('PH-MNL')!), []);
});

test('Philippines — the roster board and the work-day import observe the Navotas local day as payroll prices it: 16 January 2026 is a holiday for the Navotas worksite only (RA 12271)', () => {
	// RA 12271 s.1 (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/99770): "a special
	// non-working holiday in the City of Navotas". The board and the import read `observedHolidays`;
	// it takes the worksite each date's terms record, as payroll's `atWorksite` does, so the same
	// Navotas-scoped row that pays PH-NAV its premium in the golden above marks only PH-NAV's day.
	const work = settingsVersions('PH').at(-1)!.work_rules;
	const codes = [
		{
			id: 'W',
			code: 'W',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
			effective_range: { start: '2020-01-01', end: null }
		},
		{
			id: 'R',
			code: 'R',
			variant: { kind: 'REST' },
			effective_range: { start: '2020-01-01', end: null }
		}
	] as never;
	// Monday to Friday, anchored on Monday 5 January 2026: Friday the 16th is a working day.
	const pattern = {
		kind: 'CYCLE',
		days: ['W', 'W', 'W', 'W', 'W', 'R', 'R'].map((roster_code_id) => ({ roster_code_id }))
	} as never;
	const holidays = [
		{
			id: 'h-navotas-2026',
			company_id: COMPANY_ID,
			date: '2026-01-16',
			name: 'Navotas foundation anniversary (RA 12271)',
			kind: 'SPECIAL_HOLIDAY',
			replaces: null,
			given_to: null,
			worksite: 'NCR/Navotas',
			published_at: '2025-12-01T00:00:00.000Z'
		}
	] as never;
	const observedAt = (worksite: string) =>
		observedHolidays({
			dates: ['2026-01-16'],
			cutoffDay: 1,
			companyId: COMPANY_ID,
			holidays,
			codes,
			work,
			plans: [],
			rosterPeriods: [],
			patternOn: () => ({ pattern, anchor: '2026-01-05' }),
			worksiteOn: () => worksite
		});
	assert.deepEqual(
		[...observedAt('NCR/Navotas')],
		[['2026-01-16', { name: 'Navotas foundation anniversary (RA 12271)', from: null }]]
	);
	assert.deepEqual([...observedAt('NCR/Manila')], []);
});

test('Philippines — two cities’ local special days on one date: 27 March 2026 is San Juan’s (RA 7669) and Las Piñas’ (Proclamation 1186); each worksite earns its own premium, a Manila site works an ordinary day', () => {
	// RA 7669 s.1 (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/2082): March 27 of
	// every year a special nonworking public holiday in San Juan. Proclamation 1186, s.2026
	// (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/101020): Friday 27 March 2026 a
	// special (non-working) day in the City of Las Piñas. Each is the city's day: one company, two
	// calendar rows on one date, one per worksite (the key is company, date and worksite).
	// ₱21,750 a month, an hour 125; 09:00–18:00, eight net hours: at either city Handbook ch.4 §C,
	// 130% of which the salary pays 100% → 8 × 125 × 0.3 = 300. Manila: nothing extra. The pay
	// cutoff is the 21st, so 27 March is the April run's attendance.
	const local = (id: string, name: string, worksite: string) => ({
		id,
		company_id: COMPANY_ID,
		date: '2026-03-27',
		name,
		kind: 'SPECIAL_HOLIDAY',
		replaces: null,
		given_to: null,
		worksite,
		source: null,
		published_at: '2026-03-01T00:00:00.000Z',
		approval_id: null
	});
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-04',
			people: [
				{ key: 'PH-SJ', wage: 21_750, worksite: 'NCR/San Juan' },
				{ key: 'PH-LP', wage: 21_750, worksite: 'NCR/Las Piñas' },
				{ key: 'PH-MNL', wage: 21_750, worksite: 'NCR/Manila' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(
				local('h-san-juan-2026', 'Araw ng San Juan (RA 7669)', 'NCR/San Juan'),
				local('h-las-pinas-2026', 'Las Piñas Day (Proclamation 1186)', 'NCR/Las Piñas')
			);
			for (const key of ['PH-SJ', 'PH-LP', 'PH-MNL'])
				punchPh(world, key, '2026-03-27', '09:00', '18:00', '13:00');
		}
	);
	assert.deepEqual(workLinesPh(slips.get('PH-SJ')!), [['2026-03-27', 'OT-1.3X', 8, 300]]);
	assert.deepEqual(workLinesPh(slips.get('PH-LP')!), [['2026-03-27', 'OT-1.3X', 8, 300]]);
	assert.deepEqual(workLinesPh(slips.get('PH-MNL')!), []);
});

test('Philippines — a commission is SSS, Pag-IBIG and withholding compensation, never PhilHealth’s basic (SSS IRR Rule 12 s.6(ii); Circular 460 p.2)', () => {
	// SSS IRR of RA 11199 Rule 12 s.6 (p.28, https://www.sss.gov.ph/wp-content/uploads/2022/04/IRR-RA11199-SS-Act-of-2018_2.pdf):
	// compensation includes "Commission expense" (ii) and "Commission advances" (xii). ₱20,000
	// salary + ₱5,000 commission = 25,000 → MSC 25,000: Regular SS on 20,000 at 5% / 10% = 1,000 /
	// 2,000, MPF on the 5,000 above it = 250 / 500, EC ₱30. PhilHealth reads the monthly basic
	// salary alone: 5% × 20,000 = 1,000 → 500 each. Pag-IBIG: fund salary capped at 10,000 → 200
	// each. Withholding (NIRC s.32(A)(1), monthly table): 25,000 − (1,250 + 500 + 200) = 23,050 →
	// 15% × (23,050 − 20,833) = 332.55.
	const book = assessStatutory(
		{ code: 'PH', period: '2026-06', people: [{ key: 'C', wage: 20_000 }] },
		(world) => adhoc(world, 30, 'COMMISSION', '2026-06-15', 5_000)
	);
	expectStatutoryBase(book, 'C', 'SSS', 25_000);
	expectStatutory(book, 'C', 'SSS', 1000, 2000);
	expectStatutory(book, 'C', 'SSS_MPF', 250, 500);
	expectStatutory(book, 'C', 'SSS_EC', 0, 30);
	expectStatutory(book, 'C', 'PHIC', 500, 500);
	expectStatutory(book, 'C', 'HDMF', 200, 200);
	expectStatutoryBase(book, 'C', 'WTAX', 25_000);
	expectStatutory(book, 'C', 'WTAX', 332.55, 0);
	// Circular 460 p.2 (15 January 2024, from February 2024): fund salary is remuneration "ascertained
	// on a time, task, or piece or commission basis". ₱8,000 + ₱1,000 commission → 9,000 → 2% = 180
	// each (the salary alone gave 160).
	const fund = assessStatutory(
		{ code: 'PH', period: '2026-10', people: [{ key: 'C-FUND', wage: 8000 }] },
		(world) => adhoc(world, 31, 'COMMISSION', '2026-10-15', 1_000)
	);
	expectStatutoryBase(fund, 'C-FUND', 'HDMF', 9000);
	expectStatutory(fund, 'C-FUND', 'HDMF', 180, 180);
});

test('Philippines — the 13th month: a commission is outside the basic, piece-rate workers are covered, task-basis workers are not (PD 851; Boie-Takeda)', () => {
	// DOLE Handbook 2024 ch.13 (https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf),
	// the Revised Guidelines on PD 851: §B.4 excludes employers of those "paid on purely
	// commission, boundary, or task basis" except piece-rate workers; §F.1 piece workers are
	// entitled; §F.2 with Boie-Takeda Chemicals v. De la Serna (G.R. 92174 & 102552, 10 December
	// 1993): commissions "do not form part of the basic salary". Eleven months paid at ₱30,000 and
	// a ₱5,000 December commission: 12 × 30,000 ÷ 12 = 30,000, the commission out.
	const run = (statutory_work_category: string) =>
		buildStatutory(
			{
				code: 'PH',
				period: '2026-12',
				people: [{ key: 'PH-13-PAY', wage: 30_000, statutory_work_category }]
			},
			(world) => {
				paidMonths(
					world,
					'PH-13-PAY',
					Array.from({ length: 11 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
					30_000,
					PAID_30000
				);
				adhoc(world, 32, 'COMMISSION', '2026-12-10', 5_000);
				adhoc(world, 33, 'THIRTEENTH_MONTH_PAY', '2026-12-01', 1);
			}
		).slips.get('PH-13-PAY')!;
	const thirteenth = (slip: ReturnType<typeof run>) =>
		slip.adjustments
			.filter((row) => row.component_code === 'THIRTEENTH_MONTH_PAY')
			.map((row) => row.amount);
	assert.deepEqual(thirteenth(run('NON_MANUAL')), [30_000]);
	assert.deepEqual(thirteenth(run('PIECE_RATE')), [30_000]);
	assert.deepEqual(thirteenth(run('TASK_BASIS')), []);
	// The commission itself is paid whatever the category.
	assert.ok(run('TASK_BASIS').adjustments.some((row) => row.component_code === 'COMMISSION'));
});

test('Philippines — a settlement run after the exit month charges no PhilHealth or Pag-IBIG: no employment, no monthly basic, no fund salary (RA 11223 s.10; RA 9679 s.7)', () => {
	// PhilHealth is a premium on the monthly basic salary of an employed member (RA 11223 s.10;
	// Advisory 2025-0002 ¶1); Pag-IBIG 2% of an employee's monthly fund salary (RA 9679 s.7; HDMF
	// Circular 460 pp.1-2). A month after the last day has neither: separation pay and the 13th
	// month are not basic salary. Redundancy on 31 October 2026 at ₱35,000, hired 1 July 2023:
	// 3 years 4 months, the fraction under six months dropped (art.298: one month a year) =
	// 3 × 35,000 = 105,000, settled in November (event 31 October, after the 20th cut-off).
	// ₱35,000 a month as the table charges it: SSS MSC 35,000 → Regular SS 20,000 at 5% / 10% =
	// 1,000 / 2,000, MPF 15,000 → 750 / 1,500, EC ₱30; PHIC 5% × 35,000 = 1,750 → 875 each; HDMF
	// 200; WTAX 35,000 − 2,825 = 32,175 → 15% × (32,175 − 20,833) = 1,701.30.
	const PAID_35000 = [
		['WTAX', 1701.3, 0],
		['SSS', 1000, 2000],
		['SSS_MPF', 750, 1500],
		['SSS_EC', 0, 30],
		['PHIC', 875, 875],
		['HDMF', 200, 200]
	] as const;
	const months = (through: number) =>
		Array.from({ length: through }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-11',
			people: [
				{
					key: 'PH-RED',
					wage: 35_000,
					hire_date: '2023-07-01',
					exit_date: '2026-10-31',
					exit_reason: 'REDUNDANCY'
				}
			]
		},
		(world) => {
			world.employments[0]!.exit_facts = { termination_cause: 'REDUNDANCY' };
			paidMonths(world, 'PH-RED', months(10), 35_000, PAID_35000);
			adhoc(world, 40, 'SEPARATION_PAY', '2026-10-31', 0);
		}
	);
	const slip = slips.get('PH-RED')!;
	assert.deepEqual(slip.base, []);
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'SEPARATION_PAY')!.amount,
		105_000
	);
	const codes = slip.statutory.map((row) => row.scheme_code);
	assert.ok(!codes.includes('PHIC'), 'no PhilHealth after the exit month');
	assert.ok(!codes.includes('HDMF'), 'no Pag-IBIG after the exit month');
	// The last payment annualises (RR 11-2018 s.2.79(B)(5)(b)); the separation pay is excluded
	// (NIRC s.32(B)(6)(b)). 350,000 − 10 × 2,825 = 321,750 → 15% × 71,750 = 10,762.50 due against
	// 10 × 1,701.30 = 17,013.00 withheld: 6,250.50 refunded.
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'WTAX')!.employee_amount, -6250.5);

	// A 15 October resignation whose 13th month is settled in November: the same, nothing due.
	const late13 = buildStatutory(
		{
			code: 'PH',
			period: '2026-11',
			people: [
				{
					key: 'PH-RES',
					wage: 35_000,
					hire_date: '2023-07-01',
					exit_date: '2026-10-15',
					exit_reason: 'RESIGNATION'
				}
			]
		},
		(world) => {
			paidMonths(world, 'PH-RES', months(10), 35_000, PAID_35000);
			adhoc(world, 41, 'THIRTEENTH_MONTH_PAY', '2026-10-25', 1);
		}
	).slips.get('PH-RES')!;
	const lateCodes = late13.statutory.map((row) => row.scheme_code);
	assert.ok(!lateCodes.includes('PHIC') && !lateCodes.includes('HDMF'), lateCodes.join(','));
});

// DOLE Handbook 2024 edition, ch.7 §D Conversion — the only edition on the NWPC handbook page
// (https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/), superseding 2023:
// https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf
// Its illustration: 5.000 + 2/12 × 5 = 5.833 days at the ₱610.00 daily rate on the commutation
// date = 5.833 × 610 = ₱3,558.13.
const HANDBOOK_2024 =
	'https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf';
test('Philippines — every version cites the 2024 Handbook and prices its SIL illustration', () => {
	for (const version of settingsVersions('PH')) {
		const text = JSON.stringify(version);
		assert.ok(!text.includes('2023_edition'), version.id);
		assert.ok(version.sources.urls.includes(HANDBOOK_2024), version.id);
		assert.ok(version.work_rules.encashment.authority.includes(HANDBOOK_2024), version.id);
	}
	const { slips } = buildStatutory(
		{ code: 'PH', period: '2026-03', people: [{ key: 'SIL', wage: 610, pay_frequency: 'DAILY' }] },
		(world) => {
			world.leave_catalogue.push(
				...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null }))
			);
			const catalogue = world.leave_catalogue.find(
				(row) => row.settings_id === settingsIdOn('PH', '2026-03-01') && row.code === 'ANNUAL_LEAVE'
			)!;
			world.leave_entries.push({
				id: 'f2400000-0000-4000-8000-000000000001',
				employment_id: world.employments[0]!.id,
				catalogue_id: catalogue.id,
				leave_code: catalogue.code,
				reference: 'SIL-HANDBOOK-2024',
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				days: 5.833,
				encash_days: 5.833,
				effective_on: '2026-03-01',
				due_on: '2026-03-20',
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
		}
	);
	const line = slips
		.get('SIL')!
		.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT');
	assert.equal(line?.amount, 3558.13);
});

// PH-SRC04: the pagibigfund.gov.ph Circular 275 PDF answers a reCAPTCHA page, and the HDMF scheme
// applies Circular 460, which the issuer's host will not serve. Its readable copy is the annex to
// DMW Advisory 37-2025 (6 scanned pages; Circular 460 on pp.2–6).
const CIRCULAR_460_ANNEX = 'https://wcms.dmw.gov.ph/uploads/DMW_ADVISORY_37_2025_01225b9fec.pdf';
const CIRCULAR_275_LIVE =
	'https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf';

test('Philippines — every version cites Circular 460 from the DMW annex and prices its table (PH-SRC04)', () => {
	const schemes = readLawFile(
		fileURLToPath(new URL('../seed/jurisdiction/PH/statutory_contributions', import.meta.url))
	);
	for (const version of settingsVersions('PH')) {
		assert.ok(version.sources.urls.includes(CIRCULAR_460_ANNEX), version.id);
		assert.ok(!version.sources.urls.includes(CIRCULAR_275_LIVE), version.id);
		const remittance = version.obligations.find(
			(row: { code: string }) => row.code === 'HDMF_CONTRIBUTION_REMITTANCE'
		);
		assert.ok(remittance.authority.includes(CIRCULAR_460_ANNEX), version.id);
		const hdmf = schemes.find(
			(row: { settings_id: string; code: string }) =>
				row.settings_id === version.id && row.code === 'HDMF'
		);
		assert.ok(hdmf.authority.includes(CIRCULAR_460_ANNEX), version.id);
	}
	// Circular 460 p.1: "Over P1,500" is 2% each; p.2: the maximum fund salary is ₱10,000.
	// ₱1,500.01 × 2% = 30.0002 → 30.00 each; ₱25,000 is held to ₱10,000 → 200 each.
	for (const period of ['2025-12', '2026-10']) {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'H-1500.01', wage: 1500.01 },
				{ key: 'H-25000', wage: 25_000 }
			]
		});
		expectStatutory(book, 'H-1500.01', 'HDMF', 30, 30);
		expectStatutoryBase(book, 'H-25000', 'HDMF', 25_000);
		expectStatutory(book, 'H-25000', 'HDMF', 200, 200);
	}
});

// PH-S4: PA2025-0002 ¶1 names PhilHealth Circular 2020-0005 (Revision 1) as the premium schedule;
// 2019-0009 is the one it superseded. PH-S5: PA2026-0042 is an OFW overseas-reimbursement and
// payment-mode advisory, not an employer premium advisory, and PA2026-0001–0050 carry no CY2026
// premium change, so PA2025-0002 with the circular stays the cited pair in every version. The circular is a 5-page scan: §V.A the
// 2024–2025 row (₱10,000 → ₱500; ₱10,000.01–₱99,999.99 → ₱500–₱5,000; ₱100,000 → ₱5,000 at 5%),
// §V.B "equally shared between the employee and employer", §V.C the floor and ceiling.
const PC_2020_0005 = 'https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf';
const PA_2025_0002 = 'https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf';

test('Philippines — every version cites PhilHealth Circular 2020-0005 Rev.1 and PA2025-0002, not PA2026-0042, and prices its schedule (PH-S4, PH-S5)', () => {
	const schemes = readLawFile(
		fileURLToPath(new URL('../seed/jurisdiction/PH/statutory_contributions', import.meta.url))
	);
	for (const version of settingsVersions('PH')) {
		assert.ok(version.sources.urls.includes(PC_2020_0005), version.id);
		assert.ok(version.sources.urls.includes(PA_2025_0002), version.id);
		assert.ok(!version.sources.urls.some((url: string) => url.includes('PA2026-0042')), version.id);
		const phic = schemes.find(
			(row: { settings_id: string; code: string }) =>
				row.settings_id === version.id && row.code === 'PHIC'
		);
		assert.ok(phic.authority.includes(PC_2020_0005), version.id);
		assert.ok(!phic.authority.includes('2019-0009'), version.id);
	}
	// 5% × 8,000 floored to 10,000 = 500 → 250 / 250; 5% × 100,000 = 5,000 → 2,500 / 2,500;
	// 5% × 150,000 capped at 100,000 = 5,000; 5% × 57,777 = 2,888.85 → 1,444.425 a side: the
	// circular is silent on the odd centavo, so the employee half truncates (1,444.42) and the
	// employer carries the remainder (1,444.43), the default recorded in PH-SRC01.
	for (const period of ['2025-12', '2026-10']) {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'P-8000', wage: 8000 },
				{ key: 'P-100000', wage: 100_000 },
				{ key: 'P-150000', wage: 150_000 },
				{ key: 'P-57777', wage: 57_777 }
			]
		});
		expectStatutory(book, 'P-8000', 'PHIC', 250, 250);
		expectStatutory(book, 'P-100000', 'PHIC', 2500, 2500);
		expectStatutory(book, 'P-150000', 'PHIC', 2500, 2500);
		expectStatutory(book, 'P-57777', 'PHIC', 1444.42, 1444.43);
	}
});

// PH-HR45: RA 10361 s.32 (E-Library 2/51514), read 28 Sep 2026: "If the domestic worker is unjustly
// dismissed, the domestic worker shall be paid the compensation already earned plus the equivalent
// of fifteen (15) days work by way of indemnity." The Act names no day; the default is the
// version's ordinary day, the monthly basic over `ordinary_divisor_days` (PH-HR45 in the register).
test('Philippines — a kasambahay dismissed without just cause is paid fifteen days’ work as indemnity; a just-cause dismissal and an ordinary employee are not (RA 10361 s.32)', () => {
	// ₱7,500 a month, no paid rest days, a 40-hour week: the ordinary divisor is 261 ÷ 12 = 21.75,
	// the day 7,500 ÷ 21.75 = 344.8276, fifteen of them 5,172.41.
	const leaver = (key: string, type: string) => ({
		key,
		wage: type === 'DOMESTIC' ? 7_500 : 30_000,
		employment_type: type,
		hire_date: '2024-03-01',
		exit_date: '2026-01-31',
		exit_reason: 'DISMISSAL'
	});
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			// NCR-DW-05's ₱7,000 floor applies in January, so the kasambahay's withholding status is known.
			region: 'NCR',
			people: [
				leaver('KB-UNJUST', 'DOMESTIC'),
				leaver('KB-JUST', 'DOMESTIC'),
				leaver('PH-UNJUST', 'PERMANENT')
			]
		},
		(world) => {
			const row = world.adhoc_catalogue!.find(
				(item) => item.code === 'KASAMBAHAY_INDEMNITY' && item.settings_id === PH_2026_JAN6
			)!;
			for (const [index, key] of ['KB-UNJUST', 'KB-JUST', 'PH-UNJUST'].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				employment.exit_facts = { kasambahay_unjust_dismissal: key !== 'KB-JUST' };
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000004a${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'kasambahay indemnity',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'KASAMBAHAY_INDEMNITY')
			?.amount ?? 0;
	assert.equal(paid('KB-UNJUST'), 5_172.41);
	assert.equal(paid('KB-JUST'), 0);
	assert.equal(paid('PH-UNJUST'), 0);
	for (const version of settingsVersions('PH')) {
		const fact = version.exit_facts.find(
			(row: { key: string }) => row.key === 'kasambahay_unjust_dismissal'
		);
		assert.ok(fact, version.id);
		assert.ok(
			adhocCatalogue('PH').some(
				(row: { code: string; settings_id: string }) =>
					row.code === 'KASAMBAHAY_INDEMNITY' && row.settings_id === version.id
			),
			version.id
		);
	}
});

// PH-HR44: RA 10361 s.20 "an aggregate daily rest period of eight (8) hours per day": at most sixteen
// worked hours in a day for a kasambahay (a break is rest). s.21's 24 consecutive hours a week is
// the version's `weekly_rest` (a rest after six consecutive work days), which covers everyone.
test('Philippines — a kasambahay keeps eight hours of daily rest: a 17-hour day is refused, 16 hours is not, and the limit binds domestic workers only (RA 10361 ss.20–21)', () => {
	const person = (type: string) =>
		personContext({
			employee: null,
			employment: { service_start: '2024-01-01' },
			terms: { base_salary: 7_500, currency: 'PHP', paid_rest_days: false, employment_type: type },
			week: { ordinary_hours_per_week: 40, working_days_per_week: 5 },
			asOf: '2026-06-30'
		});
	const plan = (hours: number) =>
		new Map([
			[
				'2026-06-15',
				{
					date: '2026-06-15',
					kind: 'WORK' as const,
					paid_minutes: hours * 60,
					break_minutes: 0,
					spread_hours: hours
				}
			]
		]);
	for (const version of settingsVersions('PH')) {
		assert.ok(
			version.work_rules.limits.some(
				(limit: { key: string; measure: string }) =>
					limit.key === 'weekly_rest' && limit.measure === 'CONSECUTIVE_WORK_DAYS'
			),
			version.id
		);
		const domestic = applicableLimits(version.work_rules.limits, person('DOMESTIC'));
		const permanent = applicableLimits(version.work_rules.limits, person('PERMANENT'));
		assert.equal(domestic.find((limit) => limit.key === 'kasambahay_daily_rest')?.max_hours, 16);
		assert.equal(
			permanent.some((limit) => limit.key === 'kasambahay_daily_rest'),
			false,
			version.id
		);
		const breaches = (hours: number) =>
			projectedLimitBreaches({
				subject: 'KB',
				changedDates: new Set(['2026-06-15']),
				planByDate: plan(hours),
				limits: domestic
			}).map((row) => [row.key, row.projected, row.maximum]);
		assert.deepEqual(breaches(17), [['kasambahay_daily_rest', 17, 16]], version.id);
		assert.deepEqual(breaches(16), [], version.id);
	}
});

// PH-HR42: NIRC s.235 as amended by RA 11976 s.33 (E-Library 2/96948): books of accounts and other
// accounting records "shall be preserved … for a period of five (5) years reckoned from the day
// following the deadline in filing a return". PH-HR43: Omnibus Rules Book VI Rule I s.6(b), (d)
// (E-Library 2/85819): probation "shall not exceed six (6) months reckoned from the date the
// employee actually started working", with the standards made known "at the time of his engagement".
test('Philippines — every version keeps tax records five years (NIRC s.235 per RA 11976) and states the probation duty (Omnibus Rules Book VI Rule I s.6)', () => {
	for (const version of settingsVersions('PH')) {
		const retention = version.obligations.find(
			(row: { code: string }) => row.code === 'EMPLOYMENT_RECORDS_RETENTION'
		);
		assert.match(retention.timing, /At least three years from the date of the last entry/);
		assert.match(retention.timing, /five years from the day after the return’s filing deadline/);
		assert.match(retention.authority, /NIRC s\.235 as amended by RA 11976 s\.33/);
		const probation = version.obligations.find(
			(row: { code: string }) => row.code === 'PROBATIONARY_STANDARDS_AND_LIMIT'
		);
		assert.match(probation.timing, /six months from the actual start/);
		assert.match(probation.authority, /Book VI Rule I ss\.5\(c\), 6/);
	}
});

test('Philippines — a six-day kasambahay’s indemnity uses the 313-day divisor (RA 10361 s.32)', () => {
	const key = 'KB-SIX';
	const slip = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			region: 'NCR',
			people: [
				{
					key,
					wage: 7_500,
					employment_type: 'DOMESTIC',
					ordinary_hours_per_week: 48,
					exit_date: '2026-01-31',
					exit_reason: 'DISMISSAL'
				}
			]
		},
		(world) => {
			world.shift_patterns[0]!.pattern.days[5] = world.shift_patterns[0]!.pattern.days[0]!;
			world.employments[0]!.exit_facts = { kasambahay_unjust_dismissal: true };
			adhoc(world, 991, 'KASAMBAHAY_INDEMNITY', '2026-01-31', 0);
			world.adhoc_requests!.at(-1)!.pay_period = '2026-01';
		}
	).slips.get(key)!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'KASAMBAHAY_INDEMNITY')?.amount,
		4_313.1
	);
});

test('Philippines — unjustified kasambahay departure forfeits at most unpaid salary or fifteen days (RA 10361 s.32)', () => {
	for (const [exit, capped] of [
		['2026-01-10', false],
		['2026-01-31', true]
	] as const) {
		const key = capped ? 'KB-FULL' : 'KB-PART';
		const slip = buildStatutory(
			{
				code: 'PH',
				period: '2026-01',
				region: 'NCR',
				people: [
					{
						key,
						wage: 7_500,
						employment_type: 'DOMESTIC',
						exit_date: exit,
						exit_reason: 'RESIGNATION'
					}
				]
			},
			(world) => {
				world.employments[0]!.exit_facts = { kasambahay_unjustified_departure: true };
				adhoc(world, 992, 'KASAMBAHAY_FORFEITURE', exit, 0);
				world.adhoc_requests!.at(-1)!.pay_period = '2026-01';
			}
		).slips.get(key)!;
		const salary = slip.base.find((row) => row.component_code === 'BASIC')!.amount;
		const forfeited = slip.adjustments.find(
			(row) => row.component_code === 'KASAMBAHAY_FORFEITURE'
		)?.amount;
		assert.equal(forfeited, capped ? 5_172.41 : salary);
	}
});
