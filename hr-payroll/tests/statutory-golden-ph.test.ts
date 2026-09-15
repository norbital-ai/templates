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
	createStatutoryWorld,
	expectStatutory,
	expectStatutoryBase,
	assertEveryVersionPriced,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { scheduleOccurrences } from '../src/lib/payroll/money.ts';

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

test('Philippines — the December 2025 version prices the same schedules', () => {
	// The bank cuts a second version on 2026-01-01 that adds a payment code and moves no statutory
	// value: every schedule below is the one the 2026-01 golden prices.
	const book = assessStatutory({ code: 'PH', period: '2025-12', people: PH_PEOPLE });
	expectStatutory(book, 'PH-30000', 'SSS', 1500, 3000);
	expectStatutory(book, 'PH-30000', 'SSS_EC', 0, 30);
	expectStatutory(book, 'PH-30000', 'PHIC', 750, 750);
	expectStatutory(book, 'PH-30000', 'HDMF', 200, 200);
	expectStatutory(book, 'PH-4000', 'SSS', 250, 500);
	expectStatutory(book, 'PH-40000', 'SSS', 1750, 3500);
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
	expectStatutory(book, 'PH-30250', 'SSS', 1525, 3050);
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
	expectStatutory(monthly, 'PH-M-43000', 'SSS', 1750, 3500);
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
	expectStatutory(first, 'PH-S-30000', 'SSS', 1500, 3000);
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
// 13th month pay (P.D. 851; Revised Guidelines 1987; NIRC s.32(B)(7)(e)) — RFC 0004 S1.
//
// The row is a SCHEDULE source: every 24 December, one twelfth of the basic salary earned in the
// year, to rank-and-file with at least a month of service, and on separation to a leaver whose
// year closes before the day. The ₱90,000 exclusion is the WTAX base entry's `annual_exempt`.
// ─────────────────────────────────────────────────────────────────────────────

function payslipsOf(options: Parameters<typeof createStatutoryWorld>[0]) {
	const world = createStatutoryWorld(options);
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
		// The request row the run materialises for the occurrence, priced at what the payslip paid.
		const materialised = built.captures
			.filter((capture) => capture.payslipId === slip.id)
			.flatMap((capture) => capture.materialised)
			.map((row) => [row.collection, row.values.amount, row.values.schedule_key]);
		return { thirteenth, wtaxBase: wtax.base_amount, materialised };
	};
}

test('Philippines — 13th month pay is raised by the December schedule, a twelfth of the year’s basic', () => {
	const slip = payslipsOf({
		code: 'PH',
		period: '2026-12',
		people: [
			{ key: 'PH-30000', wage: 30_000 },
			// A twelfth above ₱90,000: the excess alone enters the withholding base.
			{ key: 'PH-1200000', wage: 1_200_000 },
			// Under a month of service on the day.
			{ key: 'PH-JOINER', wage: 30_000, hire_date: '2026-12-10' },
			// Managerial employees are outside P.D. 851.
			{ key: 'PH-MANAGER', wage: 30_000, work_classification: 'MANAGERIAL' }
		]
	});
	// No earlier payslip in the fixture year, so the year's basic is December's own salary.
	assert.deepEqual(
		slip('PH-30000').thirteenth.map((row) => [row.bucket, row.amount]),
		[['NON_WAGE_PAYMENT', 2500]]
	);
	assert.equal(slip('PH-30000').wtaxBase, 30_000);
	assert.deepEqual(
		slip('PH-1200000').thirteenth.map((row) => row.amount),
		[100_000]
	);
	assert.equal(slip('PH-1200000').wtaxBase, 1_210_000);
	assert.deepEqual(slip('PH-JOINER').thirteenth, []);
	assert.deepEqual(slip('PH-MANAGER').thirteenth, []);
});

test('Philippines — a leaver is paid the 13th month on separation; the rest wait for December', () => {
	const slip = payslipsOf({
		code: 'PH',
		period: '2026-03',
		people: [
			{ key: 'PH-30000', wage: 30_000 },
			{ key: 'PH-LEAVER', wage: 30_000, exit_date: '2026-03-31' }
		]
	});
	assert.deepEqual(slip('PH-30000').thirteenth, []);
	assert.deepEqual(
		slip('PH-LEAVER').thirteenth.map((row) => row.amount),
		[2500]
	);
});

test('schedule occurrences clamp the day to the month and honour the window', () => {
	const year = {
		every: 'YEAR',
		month: 2,
		day: 30,
		when: '',
		from_service_months: 0,
		on_separation: false
	} as const;
	assert.deepEqual(scheduleOccurrences(year, { start: '2026-01-01', end: '2026-12-31' }), [
		'2026-02-28'
	]);
	assert.deepEqual(scheduleOccurrences(year, { start: '2026-03-01', end: '2026-12-31' }), []);
	const month = { ...year, every: 'MONTH', month: null, day: 31 } as const;
	assert.deepEqual(scheduleOccurrences(month, { start: '2026-04-01', end: '2026-05-31' }), [
		'2026-04-30',
		'2026-05-31'
	]);
});
