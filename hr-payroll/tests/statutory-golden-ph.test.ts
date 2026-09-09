/**
 * Philippines: expected payslips against the sealed stack.
 *
 * SSS Circular 2024-006 (schedule effective January 2025); PhilHealth Advisory 2025-0002;
 * HDMF Circular 460; BIR Annex "E" to RR 11-2018, the monthly withholding table.
 *
 * Every contribution figure below is derived by hand from those instruments — on the base the
 * sealed stack actually accumulates. That base is NOT the monthly wage: the seeded work regime
 * prices salary on `FIXED_DAYS: 21.75` proration for every employee, monthly-paid included, so a
 * full January pays wage × 31/21.75 (see the first test). The law for a monthly-paid employee is
 * the monthly wage itself — DOLE Handbook ch. 2 §E, factor 365 — and the bank records the gap as
 * NOT APPLIED #16 in its README ("`proration` takes no predicate rows"). The figures pin the
 * sealed stack; the law's base sits beside them in that test.
 */

import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutoryBase
} from './fixtures/statutory-world.ts';

const PH_PEOPLE = [
	{ key: 'PH-4000', wage: 4000, age: 25 },
	{ key: 'PH-30250', wage: 30_250 },
	{ key: 'PH-40000', wage: 40_000, age: 61 }
];

test('Philippines — a full January prices on FIXED_DAYS 21.75, not on the monthly wage', () => {
	const book = assessStatutory({ code: 'PH', period: '2026-01', people: PH_PEOPLE });
	// The regime's proration is `FIXED_DAYS: 21.75` — the daily-paid Monday–Friday factor — with
	// calendar days as the numerator, for every employee including monthly-paid ones, because
	// `proration` takes no predicate rows (bank README NOT APPLIED #16; the `ordinary_rate`
	// predicate on `terms.payroll_group == "MONTHLY"` that separates the two populations prices
	// overtime only, never the salary line).
	//
	// 4,000 × 31/21.75 = 5,701.1494… → 5,701.15. The law's figure for a monthly-paid employee
	// present the whole month is 4,000.00.
	expectStatutoryBase(book, 'PH-4000', 'SSS', 5701.15);
	// 30,250 × 31/21.75 = 937,750/21.75 = 43,114.9425… → 43,114.94 (law: 30,250.00).
	expectStatutoryBase(book, 'PH-30250', 'SSS', 43114.94);
	// 40,000 × 31/21.75 = 1,240,000/21.75 = 57,011.4942… → 57,011.49 (law: 40,000.00).
	expectStatutoryBase(book, 'PH-40000', 'SSS', 57011.49);
});

test('Philippines — SSS, EC, PhilHealth, Pag-IBIG and the monthly withholding table', () => {
	const book = assessStatutory({ code: 'PH', period: '2026-01', people: PH_PEOPLE });

	// SSS: 15% of the monthly salary credit, employer 10% and employee 5%, in ₱500-wide brackets
	// read on the FIXED_DAYS base above.
	// 5,701.15 → the 5,250–5,750 row, MSC 5,500: 5% = 275, 10% = 550.
	// 43,114.94 and 57,011.49 → the "34,750 – Over" row, MSC 35,000, the ceiling: 1,750 / 3,500
	// (the Regular SS / MPF split of Circular 2024-006 §II.B.2 is a remittance attribution the
	// seed does not carry — bank README NOT APPLIED #3 — so one employer figure is asserted).
	expectStatutory(book, 'PH-4000', 'SSS', 275, 550);
	expectStatutory(book, 'PH-30250', 'SSS', 1750, 3500);
	expectStatutory(book, 'PH-40000', 'SSS', 1750, 3500);

	// Employees' Compensation: employer only, ₱10 for MSC 14,500 and below and ₱30 from MSC 15,000
	// — the seeded seam sits at compensation 14,750.
	expectStatutory(book, 'PH-4000', 'SSS_EC', 0, 10);
	expectStatutory(book, 'PH-30250', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-40000', 'SSS_EC', 0, 30);

	// PhilHealth: 5% premium split 2.5% / 2.5%, on a monthly basic salary floored at ₱10,000 and
	// capped at ₱100,000 — where the bank's vetting left one centavo on the table at half-centavo
	// premia (two independent 2.5% legs instead of premium-then-split; README NOT APPLIED #1),
	// which none of these bases reaches.
	// 5,701.15 → the floor: 2.5% × 10,000 = 250 each.
	// 43,114.94 → 2.5% = 1,077.8735 → 1,077.87 each.
	// 57,011.49 (under the ₱100,000 ceiling) → 2.5% = 1,425.28725 → 1,425.29 each.
	expectStatutory(book, 'PH-4000', 'PHIC', 250, 250);
	expectStatutory(book, 'PH-30250', 'PHIC', 1077.87, 1077.87);
	expectStatutory(book, 'PH-40000', 'PHIC', 1425.29, 1425.29);

	// Pag-IBIG: 1% employee / 2% employer at a fund salary of ₱1,500 and below, 2% / 2% above,
	// and the fund salary is capped at ₱10,000 — so ₱200 each is the maximum.
	// 5,701.15 → 2% = 114.023 → 114.02 each. The two higher bases → the ₱200 cap each side.
	expectStatutory(book, 'PH-4000', 'HDMF', 114.02, 114.02);
	expectStatutory(book, 'PH-30250', 'HDMF', 200, 200);
	expectStatutory(book, 'PH-40000', 'HDMF', 200, 200);

	// Withholding tax: the BIR monthly table applied to the period directly — no annualising and
	// no spreading — on compensation net of the three mandatory employee contributions, which the
	// seed relieves into WTAX.
	//
	// 5,701.15 − (275 + 250 + 114.02) = 5,062.13, under ₱20,833: nothing withheld.
	expectStatutory(book, 'PH-4000', 'WTAX', 0, 0);
	// 43,114.94 − (1,750 + 1,077.87 + 200) = 40,087.07. Row "33,333–66,666 → 1,875.00 + 20% of
	// the excess over 33,333": 1,875 + 6,754.07 × 20% = 1,875 + 1,350.814 = 3,225.814 → 3,225.81.
	expectStatutory(book, 'PH-30250', 'WTAX', 3225.81, 0);
	// 57,011.49 − (1,750 + 1,425.29 + 200) = 53,636.20. Same row: 1,875 + 20,303.20 × 20% =
	// 1,875 + 4,060.64 = 5,935.64.
	expectStatutory(book, 'PH-40000', 'WTAX', 5935.64, 0);
});
