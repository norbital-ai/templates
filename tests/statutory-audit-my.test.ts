/**
 * Malaysia (Peninsular and Labuan) — independent audit goldens, September 2026.
 *
 * Every expected figure is derived by hand from the published instrument named beside it; none is
 * a pasted engine output and none comes from a script that re-implements a formula. Where the
 * engine disagrees with the law the case is left red and the report names the engine change.
 *
 * Sources read for this file (primary unless noted):
 * - KWSP, Employer Mandatory Contribution, worked examples 1.1–2.4 (Wayback 2026-08-10 copy of
 *   kwsp.gov.my/en/employer/responsibilities/mandatory-contribution).
 * - KWSP, Third Schedule EPF Act 1991 (jadual-ketiga-bi-pdf-1, Parts A/C/E as in force from July
 *   2022; Act A1760 deleted Parts B and D and added Part F from 1 October 2025 without touching
 *   A, C or E), including the Part A and Part C notes on a bonus month.
 * - Act A1760 (2025), Part F.
 * - PERKESO, "Employees' Social Security Act 1969 (Act 4): new contribution rate including SKBBK"
 *   (NewContributionRateIncludingSKBBK.pdf), rows 22, 44, 45, 64, 65.
 * - Employment Insurance System Act 2017 (Act 800), Second Schedule rows 22, 44, 45; First
 *   Schedule para 8 and 10.
 * - LHDN, Specification for MTD Calculations Using Computerized Calculation for 2026, section D
 *   Table 1 and section E(1)–(3).
 * - Employment (Termination and Lay-Off Benefits) Regulations 1980 regs. 3, 4, 6; JTKSM FAQ
 *   "How is the termination benefit payment calculated" (12 months' wages ÷ 365 days).
 * - Employment Act 1955 ss.12(2)–(3), 13(1).
 * - Minimum Wages Order 2024 [P.U.(A) 376/2024] para 4: RM1,700 a month; RM65.38 / RM78.46 /
 *   RM98.08 a day for a six-, five- or four-day week; RM8.72 an hour.
 * - HRD Corp Employers FAQ (Wayback copy): compulsory at ten or more Malaysian employees (1%),
 *   optional at five to nine (0.5%).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	chargeOf,
	expectStatutory,
	expectStatutorySkipped,
	settingsVersions,
	type Person
} from './fixtures/statutory-world.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
const LOCAL = { EPF_NON_CITIZEN: OUT };
const FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

const baseVersionId = () =>
	settingsVersions('MY').find((v) => String(v.effective_range.start).startsWith('2025-12'))!.id;

/** Plant one ad hoc request of catalogue `code` for `key`, priced in the run's period. */
function adhoc(world: PayrollWorld, key: string, code: string, amount: number, date: string) {
	const row = world.adhoc_catalogue!.find(
		(candidate) => candidate.code === code && candidate.settings_id === baseVersionId()
	)!;
	const employment = world.employments.find((candidate) => candidate.employee_number === key)!;
	world.adhoc_requests!.push({
		id: `d0000000-0000-4000-8000-${String(world.adhoc_requests!.length + 900).padStart(12, '0')}`,
		employment_id: employment.id,
		catalogue_id: row.id,
		amount,
		event_date: date,
		pay_period: date.slice(0, 7),
		payslip_id: null,
		reason: code,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EPF — the Board's own worked examples (KWSP Employer Mandatory Contribution, 2025–2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — EPF Parts A, C, E and F reproduce KWSP’s published worked examples', () => {
	const people: Person[] = [
		// Example 1.1: citizen < 60, RM3,250.00 → Part A row "3,240.01 – 3,260.00".
		{ key: 'A-3250', wage: 3250, citizenship: 'CITIZEN', registrations: LOCAL },
		// Example 1.2: citizen < 60, RM6,710.80 → Part A row "6,700.01 – 6,800.00".
		{ key: 'A-6710.80', wage: 6710.8, citizenship: 'CITIZEN', registrations: LOCAL },
		// Example 2.1: citizen < 60, RM21,250.00 → percentage above RM20,000.
		{ key: 'A-21250', wage: 21250, citizenship: 'CITIZEN', registrations: LOCAL },
		// Example 1.3 / 2.2: citizen ≥ 60 → Part E.
		{ key: 'E-3250', wage: 3250, age: 61, citizenship: 'CITIZEN', registrations: LOCAL },
		{ key: 'E-21250', wage: 21250, age: 61, citizenship: 'CITIZEN', registrations: LOCAL },
		// Example 1.4 / 2.3: permanent resident ≥ 60 → Part C.
		{ key: 'C-3250', wage: 3250, age: 61, citizenship: 'PERMANENT_RESIDENT', registrations: LOCAL },
		{
			key: 'C-21250',
			wage: 21250,
			age: 61,
			citizenship: 'PERMANENT_RESIDENT',
			registrations: LOCAL
		},
		// Example 2.4: non-citizen → Part F.
		{ key: 'F-3250', wage: 3250, citizenship: 'FOREIGNER', registrations: FOREIGN },
		{ key: 'F-6710', wage: 6710, citizenship: 'FOREIGNER', registrations: FOREIGN }
	];
	const book = assessStatutory({ code: 'MY', period: '2026-01', people });

	// 1.1: ceil(11% × 3,260) = ceil(358.60) = 359; ceil(13% × 3,260) = ceil(423.80) = 424 (KWSP: 424 / 359).
	expectStatutory(book, 'A-3250', 'EPF', 359, 424);
	// 1.2: wage > 5,000 so employer 12%: 12% × 6,800 = 816; 11% × 6,800 = 748 (KWSP: 816 / 748).
	expectStatutory(book, 'A-6710.80', 'EPF', 748, 816);
	// 2.1: 12% × 21,250 = 2,550.00 + 11% × 21,250 = 2,337.50 = 4,887.50 → total rounded up to the
	// next ringgit = 4,888 (KWSP). The Schedule rounds the TOTAL; the split of the rounded ringgit is
	// not prescribed, so only the total and the employer's un-rounded 2,550 floor are asserted.
	const a21 = chargeOf(book, 'A-21250', 'EPF');
	assert.equal(a21.employee + a21.employer, 4888);
	assert.ok(a21.employer >= 2550 && a21.employee >= 2337.5);
	// 1.3: Part E, 4% × 3,260 = 130.40 → 131; employee nil (KWSP: 131 / 0).
	expectStatutory(book, 'E-3250', 'EPF', 0, 131);
	// 2.2: 4% × 21,250 = 850.00 (KWSP: 850).
	expectStatutory(book, 'E-21250', 'EPF', 0, 850);
	// 1.4: Part C, ceil(5.5% × 3,260) = ceil(179.30) = 180; ceil(6.5% × 3,260) = ceil(211.90) = 212.
	expectStatutory(book, 'C-3250', 'EPF_PR', 180, 212);
	expectStatutorySkipped(book, 'C-3250', 'EPF');
	// 2.3: 6% × 21,250 = 1,275.00 + 5.5% × 21,250 = 1,168.75 = 2,443.75 → 2,444 (KWSP).
	const c21 = chargeOf(book, 'C-21250', 'EPF_PR');
	assert.equal(c21.employee + c21.employer, 2444);
	// 2.4: Part F, 2% × 3,250 = 65.00 each, total 130 (KWSP).
	expectStatutory(book, 'F-3250', 'EPF_NON_CITIZEN', 65, 65);
	// 2.4: 2% × 6,710 = 134.20 each, 268.40 → total rounded to the next ringgit, 269 (KWSP). Part F
	// para 2 (Act A1760): "The total contribution which includes cents shall be rounded to the next
	// ringgit." (KWSP's separate non-citizen FAQ rounds each share — RM1,751 → 36 + 36 = 72; the
	// statute and the Board's own mandatory-contribution page round the total.)
	const f67 = chargeOf(book, 'F-6710', 'EPF_NON_CITIZEN');
	assert.equal(f67.employee + f67.employer, 269);
});

test('MY audit — Third Schedule Part A note: a bonus that lifts a ≤RM5,000 wage over RM5,000 keeps the employer at 13%', () => {
	// KWSP Third Schedule, Part A note under the RM5,000 row: "Where the employer pays bonus to an
	// employee who receives monthly wages of RM5,000.00 and below, and upon receiving the said bonus
	// renders the wages received for that month to exceed RM5,000.00, the employer's contribution
	// shall be calculated at the rate of 13% of the amount of wages for the month. The total
	// contribution which includes cents shall be rounded to the next ringgit."
	//
	// RM4,000 salary + RM2,000 bonus (ADJ, counts toward EPF.ADDITIONAL) = RM6,000 for the month.
	// Employee: the table row "5,900.01 – 6,000.00" → 11% × 6,000 = 660.
	// Employer: 13% × 6,000 = 780.00 (the table's 12% row would give 720).
	// RM4,000 salary + RM2,050.50 bonus = RM6,050.50: employee row "6,000.01 – 6,100.00" → 11% × 6,100
	// = 671; employer 13% × 6,050.50 = 786.565; total 671 + 786.565 = 1,457.565 → 1,458, employer 787.
	// Control: RM5,000.01 salary, no bonus — the monthly wage itself exceeds RM5,000, so 12%.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'BONUS-6000', wage: 4000, citizenship: 'CITIZEN', registrations: LOCAL },
				{ key: 'BONUS-6050.50', wage: 4000, citizenship: 'CITIZEN', registrations: LOCAL },
				{ key: 'SALARY-5000.01', wage: 5000.01, citizenship: 'CITIZEN', registrations: LOCAL },
				{
					key: 'PR61-BONUS-6000',
					wage: 4000,
					age: 61,
					citizenship: 'PERMANENT_RESIDENT',
					registrations: LOCAL
				}
			]
		},
		(world) => {
			adhoc(world, 'BONUS-6000', 'ADJ', 2000, '2026-01-10');
			adhoc(world, 'BONUS-6050.50', 'ADJ', 2050.5, '2026-01-10');
			adhoc(world, 'PR61-BONUS-6000', 'ADJ', 2000, '2026-01-10');
		}
	);
	const epf = (key: string) => {
		const row = slips.get(key)!.statutory.find((charge) => charge.scheme_code === 'EPF')!;
		return [row.base_amount, row.employee_amount, row.employer_amount];
	};
	assert.deepEqual(epf('BONUS-6000'), [6000, 660, 780]);
	assert.deepEqual(epf('BONUS-6050.50'), [6050.5, 671, 787]);
	// Row "5,000.01 – 5,100.00": 11% × 5,100 = 561; 12% × 5,100 = 612.
	assert.deepEqual(epf('SALARY-5000.01'), [5000.01, 561, 612]);
	// Part C's own note (PR aged 60+): the employer stays at 6.5% of the month's wages. RM4,000 +
	// RM2,000: employee row "5,900.01 – 6,000.00" → 5.5% × 6,000 = 330; employer 6.5% × 6,000 = 390
	// (the 6% row would give 360).
	const pr = slips.get('PR61-BONUS-6000')!.statutory.find((row) => row.scheme_code === 'EPF_PR')!;
	assert.deepEqual([pr.base_amount, pr.employee_amount, pr.employer_amount], [6000, 330, 390]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SOCSO (Act 4), EIS (Act 800) and SKBBK — printed rows
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — SOCSO, EIS and SKBBK on the printed rows, the ceiling and the age and citizenship splits', () => {
	const people: Person[] = [
		{ key: 'L-1750', wage: 1750, citizenship: 'CITIZEN', registrations: LOCAL },
		{ key: 'L-1750-61', wage: 1750, age: 61, citizenship: 'CITIZEN', registrations: LOCAL },
		{ key: 'L-6500', wage: 6500, citizenship: 'CITIZEN', registrations: LOCAL },
		{ key: 'F-1750', wage: 1750, citizenship: 'FOREIGNER', registrations: FOREIGN }
	];
	const january = assessStatutory({ code: 'MY', period: '2026-01', people });
	// Act 4 row 22 ("exceed RM1,700, not exceed RM1,800"), First Category: employer 30.65,
	// employee (invalidity) 8.75 — 1.75% and 0.5% of the 1,750 mid-point.
	expectStatutory(january, 'L-1750', 'SOCSO', 8.75, 30.65);
	// Act 800 Second Schedule row 22: 3.50 / 3.50.
	expectStatutory(january, 'L-1750', 'EIS', 3.5, 3.5);
	// Second Category at 60+: employer only, 21.90 (row 22, 1.25%). Act 800 First Schedule para 8:
	// an employee who has attained sixty is outside EIS — no charge.
	expectStatutory(january, 'L-1750-61', 'SOCSO', 0, 21.9);
	assert.equal(chargeOf(january, 'L-1750-61', 'EIS').employee, 0);
	// RM6,000 ceiling (PERKESO, from 1 October 2024): row 65 = row 64 → 29.75 / 104.15; EIS 11.90.
	expectStatutory(january, 'L-6500', 'SOCSO', 29.75, 104.15);
	expectStatutory(january, 'L-6500', 'EIS', 11.9, 11.9);
	// PERKESO Foreign Worker page: employer 1.25% EIS + 0.5% invalidity, worker 0.5% invalidity —
	// the First Category row: 8.75 / 30.65.
	expectStatutory(january, 'F-1750', 'SOCSO', 8.75, 30.65);
	// No SKBBK before 1 June 2026.
	expectStatutorySkipped(january, 'L-1750', 'SKBBK');

	// June 2026 (SKBBK Phase 1, 0.75%, employee only): row 22 non-employment injury column 13.15, in
	// both categories and for a foreign worker.
	const june = assessStatutory({ code: 'MY', period: '2026-06', people });
	expectStatutory(june, 'L-1750', 'SKBBK', 13.15, 0);
	expectStatutory(june, 'L-1750-61', 'SKBBK', 13.15, 0);
	expectStatutory(june, 'F-1750', 'SKBBK', 13.15, 0);
	// Ceiling row 65: 44.65.
	expectStatutory(june, 'L-6500', 'SKBBK', 44.65, 0);

	// September 2026: voluntary for locals who released (NOT_REGISTERED); mandatory for foreigners.
	const september = assessStatutory({
		code: 'MY',
		period: '2026-09',
		people: [
			{
				key: 'L-RELEASED',
				wage: 1750,
				citizenship: 'CITIZEN',
				registrations: { ...LOCAL, SKBBK: OUT }
			},
			{ key: 'F-1750', wage: 1750, citizenship: 'FOREIGNER', registrations: FOREIGN }
		]
	});
	expectStatutory(september, 'L-RELEASED', 'SKBBK', 0, 0);
	expectStatutory(september, 'F-1750', 'SKBBK', 13.15, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// HRD levy — the headcount bands at their edges
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — HRD levy bands at 4/5 and 9/10 Malaysian employees', () => {
	const citizens = (count: number): Person[] =>
		Array.from({ length: count }, (_, index) => ({
			key: `C${index}`,
			wage: 3000,
			citizenship: 'CITIZEN',
			registrations: LOCAL
		}));
	// HRD Corp FAQ: fewer than five Malaysian employees — outside the Act: 0.
	assert.equal(
		chargeOf(assessStatutory({ code: 'MY', period: '2026-01', people: citizens(4) }), 'C0', 'HRDF')
			.employer,
		0
	);
	// Five to nine: optional registration at 0.5% — 0.5% × 3,000 = 15.00 once registered.
	assert.equal(
		chargeOf(assessStatutory({ code: 'MY', period: '2026-01', people: citizens(5) }), 'C0', 'HRDF')
			.employer,
		15
	);
	assert.equal(
		chargeOf(assessStatutory({ code: 'MY', period: '2026-01', people: citizens(9) }), 'C0', 'HRDF')
			.employer,
		15
	);
	// Ten or more: compulsory 1% — 30.00.
	assert.equal(
		chargeOf(assessStatutory({ code: 'MY', period: '2026-01', people: citizens(10) }), 'C0', 'HRDF')
			.employer,
		30
	);
	// A foreign employee does not count toward the ten: nine citizens plus one foreigner stays 0.5%.
	const mixed = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			...citizens(9),
			{ key: 'F', wage: 3000, citizenship: 'FOREIGNER', registrations: FOREIGN }
		]
	});
	assert.equal(chargeOf(mixed, 'C0', 'HRDF').employer, 15);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PCB / MTD 2026 — the RM400 rebate cliff at P = 35,000
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — MTD 2026 either side of the RM35,000 rebate cliff (Table 1, Category 1)', () => {
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{ key: 'PCB-4000', wage: 4000, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'PCB-4100', wage: 4100, citizenship: 'CITIZEN', registrations: LOCAL }
		]
	});
	// RM4,000, January (n = 11). K1 = EPF Part A row 3,980.01–4,000 = 440. K2 = min(440,
	// (4,000 − 440) ÷ 11 = 323.636…) so K + K1 + K2·n = 4,000 (the qualifying cap).
	// Σ(Y−K) = 0; (Y1−K1) = 3,560; (Y2−K2)·n = 4,000·11 − 3,560 = 40,440 → 44,000.
	// LP1 = SOCSO row 44 employee 19.75 + EIS row 44 employee 7.90 = 27.65. D = 9,000.
	// P = 44,000 − 9,000 − 27.65 = 34,972.35 → band 20,001–35,000: M 20,000, R 3%, B −250.
	// (14,972.35 × 3%) − 250 = 449.1705 − 250 = 199.1705; ÷ 12 = 16.5975… → 16.59 (E(1)) → 16.60 (E(2)).
	expectStatutory(book, 'PCB-4000', 'PCB', 16.6, 0);
	// RM4,100: K1 = row 4,080.01–4,100 = 451; K capped at 4,000 → net 49,200 − 4,000 = 45,200.
	// LP1 = SOCSO row 45 20.25 + EIS row 45 8.10 = 28.35. P = 45,200 − 9,000 − 28.35 = 36,171.65 →
	// band 35,001–50,000: M 35,000, R 6%, B 600 (no rebate). 1,171.65 × 6% = 70.299 + 600 = 670.299;
	// ÷ 12 = 55.858… → 55.85 → 55.85.
	expectStatutory(book, 'PCB-4100', 'PCB', 55.85, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Separation — termination benefit (Regs 1980) and notice (EA s.12(3))
// ─────────────────────────────────────────────────────────────────────────────────────────────

function separation(exitReason: string, noticeDays: number | null, code: string) {
	return buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{
					key: 'LEAVER',
					wage: 3000,
					citizenship: 'CITIZEN',
					registrations: LOCAL,
					hire_date: '2023-05-15',
					exit_date: '2026-01-31',
					exit_reason: exitReason
				}
			]
		},
		(world) => {
			if (noticeDays != null) world.employment_terms[0]!.notice_days = noticeDays;
			// reg.6(2) reads the wages paid: twelve earlier payslips at the RM3,000 wage.
			priorWages(world, 'LEAVER', monthsAt('2025-01', '2025-12', 3000));
			adhoc(world, 'LEAVER', code, 0, '2026-01-31');
		}
	).slips.get('LEAVER')!;
}
const amountOf = (slip: ReturnType<typeof separation>, code: string) =>
	slip.adjustments.find((row) => row.component_code === code)?.amount;

test('MY audit — termination benefit is 12 months’ wages ÷ 365 per day (reg. 6(2); JTKSM formula)', () => {
	// Hired 15 May 2023, out 31 January 2026: 993 days ≈ 32.6 months → nearest month 33 (reg. 6(1)
	// "pro-rata … calculated to the nearest month") = 2.75 years; two years or more and under five →
	// fifteen days' wages a year (reg. 6(1)(b)).
	// reg. 6(2): "a day's wages … average true day's wages calculated over the period of twelve
	// completed months' service immediately preceding the relevant date"; JTKSM: "12 Months/365
	// days' salary". Twelve months at RM3,000 = 36,000 ÷ 365 = 98.630137 a day.
	// 15 × 2.75 × 98.630137 = 4,068.4932 → 4,068.49.
	assert.equal(
		amountOf(separation('REDUNDANCY', null, 'TERMINATION_BENEFIT'), 'TERMINATION_BENEFIT'),
		4068.49
	);
	// reg. 4(1): payable where the contract is terminated "for any reason whatsoever" other than
	// retirement, misconduct after due inquiry or voluntary resignation — a retrenchment and an
	// employer's unilateral termination are inside it.
	assert.equal(
		amountOf(separation('RETRENCHMENT', null, 'TERMINATION_BENEFIT'), 'TERMINATION_BENEFIT'),
		4068.49
	);
	assert.equal(
		amountOf(separation('UNILATERAL', null, 'TERMINATION_BENEFIT'), 'TERMINATION_BENEFIT'),
		4068.49
	);
	// reg. 4(1)(c): voluntary resignation is outside.
	assert.equal(
		amountOf(separation('RESIGNATION', null, 'TERMINATION_BENEFIT'), 'TERMINATION_BENEFIT'),
		undefined
	);
});

test('MY audit — a retrenchment notice is never shorter than s.12(2) whatever the contract says (s.12(3))', () => {
	// Two years or more but under five on the notice date → s.12(2)(b) six weeks = 42 days.
	// s.12(3): for a termination attributable to redundancy/closure the notice "shall be not less
	// than that provided under paragraph (2)(a), (b) or (c) … regardless of anything to the contrary
	// contained in the contract". A contract stating 14 days still owes 42.
	// s.13(1) indemnity at the seed's monthly-wage-over-30 rate: 3,000 × 42 ÷ 30 = 4,200.00.
	assert.equal(amountOf(separation('REDUNDANCY', 14, 'NOTICE_IN_LIEU'), 'NOTICE_IN_LIEU'), 4200);
	// A contract notice longer than the statute stands: 60 days → 3,000 × 60 ÷ 30 = 6,000.00.
	assert.equal(amountOf(separation('REDUNDANCY', 60, 'NOTICE_IN_LIEU'), 'NOTICE_IN_LIEU'), 6000);
	// Outside s.12(3) the written contract term governs s.12(2): 14 days → 3,000 × 14 ÷ 30 = 1,400.00.
	assert.equal(amountOf(separation('UNILATERAL', 14, 'NOTICE_IN_LIEU'), 'NOTICE_IN_LIEU'), 1400);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Minimum Wages Order 2024 — the daily rate depends on the working week
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — a daily rate is measured against the Order’s rate for the person’s working week', () => {
	// MWO 2024 para 4 table: a five-day week's daily minimum is RM78.46 (1,700 × 12 ÷ 52 ÷ 5). The
	// fixture pattern is Monday–Friday. RM70 a day is above the six-day RM65.38 but below the
	// five-day RM78.46 — the run must report it. RM80 a day is above it and must not.
	const { warnings } = buildStatutory({
		code: 'MY',
		period: '2026-01',
		region: 'Malaysia',
		people: [
			{
				key: 'DAILY-70',
				wage: 70,
				pay_frequency: 'DAILY',
				citizenship: 'CITIZEN',
				registrations: LOCAL
			},
			{
				key: 'DAILY-80',
				wage: 80,
				pay_frequency: 'DAILY',
				citizenship: 'CITIZEN',
				registrations: LOCAL
			}
		]
	});
	assert.ok(
		warnings.some((line) =>
			/DAILY-70 is contracted at .* below the Malaysia minimum wage/.test(line)
		),
		warnings.join('\n')
	);
	assert.ok(!warnings.some((line) => /DAILY-80 is contracted/.test(line)), warnings.join('\n'));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The obligation register outside the calculation
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY audit — each version carries the obligation register, SKBBK rows only where the scheme stood', () => {
	const [base, june, july] = settingsVersions('MY').map(
		(version) => version.obligations as { code: string; status: string; authority: string }[]
	);
	for (const register of [base!, june!, july!]) {
		const codes = register.map((row) => row.code);
		assert.equal(new Set(codes).size, codes.length, 'codes unique');
		for (const row of register) {
			assert.match(row.code, /^[A-Z0-9_]+$/);
			assert.ok(['EXTERNAL', 'PARTIAL', 'UNVERIFIED'].includes(row.status), row.code);
			assert.ok(row.authority.length > 0, row.code);
		}
		for (const code of [
			'EPF_MONTHLY_CONTRIBUTION',
			'SOCSO_EIS_MONTHLY_CONTRIBUTION',
			'HRD_LEVY_MONTHLY',
			'PCB_REMITTANCE',
			'CP22_NEW_EMPLOYEE',
			'CP22A_CESSATION_AND_WITHHOLDING',
			'CP21_LEAVING_MALAYSIA',
			'EA_FORM',
			'FORM_E_CP8D',
			'PAYSLIP_ISSUE',
			'EMPLOYEE_REGISTER',
			'WAGE_PAYMENT_DEADLINE',
			'RETRENCHMENT_NOTIFICATION',
			'TERMINATION_BENEFIT_PAYMENT',
			'FOREIGN_EMPLOYEE_TERMINATION_NOTICE'
		])
			assert.ok(codes.includes(code), code);
	}
	// SKBBK came into operation on 1 June 2026 and became releasable for locals on 8 July 2026.
	assert.ok(!base!.some((row) => row.code.startsWith('SKBBK_')));
	assert.deepEqual(
		june!.filter((row) => row.code.startsWith('SKBBK_')).map((row) => row.code),
		['SKBBK_CONTRIBUTION']
	);
	assert.deepEqual(
		july!.filter((row) => row.code.startsWith('SKBBK_')).map((row) => row.code),
		['SKBBK_CONTRIBUTION', 'SKBBK_RELEASE_RECORD']
	);
	// Outside those rows the three registers are the same law.
	const rest = (register: { code: string }[]) =>
		register.filter((row) => !row.code.startsWith('SKBBK_'));
	assert.deepEqual(rest(june!), rest(base!));
	assert.deepEqual(rest(july!), rest(base!));
});
