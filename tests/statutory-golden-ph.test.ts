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

import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutoryBase
} from './fixtures/statutory-world.ts';

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
	expectStatutory(book, 'PH-30000', 'SSS', 1500, 3000);
	expectStatutory(book, 'PH-40000', 'SSS', 1750, 3500);

	// Employees' Compensation: employer only, ₱10 for MSC 14,500 and below and ₱30 from MSC 15,000
	// — the seeded seam sits at compensation 14,750.
	expectStatutory(book, 'PH-4000', 'SSS_EC', 0, 10);
	expectStatutory(book, 'PH-30000', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-40000', 'SSS_EC', 0, 30);

	// PhilHealth: 5% premium split 2.5% / 2.5%, on a monthly basic salary floored at ₱10,000 and
	// capped at ₱100,000 — where the bank's vetting left one centavo on the table at half-centavo
	// premia (two independent 2.5% legs instead of premium-then-split; README NOT APPLIED #1),
	// which none of these wages reaches.
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
	// 4,000 − (250 + 250 + 80) = 3,420, under ₱20,833: nothing withheld.
	expectStatutory(book, 'PH-4000', 'WTAX', 0, 0);
	// 30,000 − (1,500 + 750 + 200) = 27,550. Row "20,833–33,332 → 0 + 15% of the excess over
	// 20,833": 15% × 6,717 = 1,007.55.
	expectStatutory(book, 'PH-30000', 'WTAX', 1007.55, 0);
	// 40,000 − (1,750 + 1,000 + 200) = 37,050. Row "33,333–66,666 → 1,875.00 + 20% of the excess
	// over 33,333": 1,875 + 3,717 × 20% = 1,875 + 743.40 = 2,618.40.
	expectStatutory(book, 'PH-40000', 'WTAX', 2618.4, 0);
});
