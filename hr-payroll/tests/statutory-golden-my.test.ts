/**
 * Malaysia: expected payslips against the law itself.
 *
 * Every figure asserted below is derived by hand from the instrument the seed bank's vetting
 * report names — a published band table, a rate, a ceiling, a rounding rule — and written with
 * that derivation beside it. See `statutory-golden-ph.test.ts` for what "against the law itself"
 * means where the sealed stack deliberately deviates, and for the shared harness contract.
 *
 * EPF Act 1991 Third Schedule (1 Oct 2025) Parts A / C / E / F; Employees' Social Security Act
 * 1969 (Act 4) Third Schedule; EIS Act 2017 Second Schedule; LHDN MTD 2026 specification;
 * PSMB Act 2001 s.14.
 *
 * The three EPF Parts overlap on their predicates alone, so each person carries a registration
 * that names the one Part they belong to — which is what `EPF.authority` says decides it.
 */

import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
/** A Malaysian citizen or PR: Part A / C / E, never the Part F non-citizen scheme. */
const MY_LOCAL = { EPF_NON_CITIZEN: OUT };
/** A non-citizen: Part F only. */
const MY_FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

test('Malaysia — EPF, SOCSO, EIS, PCB and HRDF on the 2025-12-01 law', () => {
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		// HRDF bands on headcount: ten or more Malaysian employees is the compulsory 1% band,
		// so the world is padded to sixteen employments.
		headcount: 16,
		people: [
			{ key: 'MY-1000', wage: 1000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{ key: 'MY-5001', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{ key: 'MY-25000', wage: 25_000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{ key: 'MY-60', wage: 5001, age: 61, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{
				key: 'MY-PR-60',
				wage: 5001,
				age: 61,
				citizenship: 'PERMANENT_RESIDENT',
				registrations: MY_LOCAL
			},
			{ key: 'MY-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
		]
	});

	// EPF Part A, employee 11% / employer 13% up to RM5,000 and 12% above, on the Third Schedule's
	// bracketed wage. The brackets are RM10 to RM20, RM20 to RM5,000, RM100 to RM20,000.
	// 1,000 → bracket 1,000 → 11% = 110, 13% = 130.
	expectStatutory(book, 'MY-1000', 'EPF', 110, 130);
	// 5,001 → bracket up to the next RM100 = 5,100; the wage exceeds RM5,000 so the employer rate
	// is 12%: 11% × 5,100 = 561, 12% × 5,100 = 612. (Vet §1 sample point, "the 13%→12% employer
	// drop is reproduced".)
	expectStatutory(book, 'MY-5001', 'EPF', 561, 612);
	// Above RM20,000 the Schedule's closing paragraph charges the exact percentage on the wage
	// itself: 11% × 25,000 = 2,750 and 12% × 25,000 = 3,000.
	expectStatutory(book, 'MY-25000', 'EPF', 2750, 3000);
	// Part E — a Malaysian citizen aged 60 to 75: employee 0%, employer 4%, no wage split.
	// 4% × 5,100 = 204.
	expectStatutory(book, 'MY-60', 'EPF', 0, 204);
	// Part C — a permanent resident aged 60 or above: employee 5.5%, employer 6.5% up to RM5,000
	// and 6% above. On the bracket 5,100: ceil(5,100 × 5.5%) = ceil(280.50) = 281; the wage exceeds
	// RM5,000 so the employer leg is ceil(5,100 × 6%) = 306. Part E does not reach them.
	expectStatutory(book, 'MY-PR-60', 'EPF_PR', 281, 306);
	expectStatutorySkipped(book, 'MY-PR-60', 'EPF');
	// Part F — a non-citizen, 2% each on the wage as it stands, no bracket table and no ceiling.
	// 2% × 5,001 = 100.02, rounded up to the next ringgit = 101, each side.
	expectStatutory(book, 'MY-FOREIGN', 'EPF_NON_CITIZEN', 101, 101);

	// SOCSO, Act 4 Third Schedule. First Category (employment injury + invalidity) below 60;
	// Second Category (injury only, employer alone) at 60 and above. RM6,000 wage ceiling.
	// The rows are the printed table — all 64 in both categories were machine-diffed during
	// vetting with 0 mismatches — and the band is chosen by its ceiling.
	expectStatutory(book, 'MY-1000', 'SOCSO', 4.75, 16.65); // "exceeding 900, not exceeding 1,000"
	expectStatutory(book, 'MY-5001', 'SOCSO', 25.25, 88.35); // "exceeding 5,000, not exceeding 5,100"
	expectStatutory(book, 'MY-25000', 'SOCSO', 29.75, 104.15); // at the RM6,000 ceiling
	expectStatutory(book, 'MY-60', 'SOCSO', 0, 63.1); // Second Category on the same 5,000–5,100 row

	// EIS, Act 800 Second Schedule: 0.2% each side on the same band edges, RM6,000 ceiling,
	// and the scheme reaches only ages 18 to 60.
	expectStatutory(book, 'MY-1000', 'EIS', 1.9, 1.9);
	expectStatutory(book, 'MY-5001', 'EIS', 10.1, 10.1);
	expectStatutory(book, 'MY-25000', 'EIS', 11.9, 11.9); // 0.2% × 6,000 ceiling
	expectStatutory(book, 'MY-60', 'EIS', 0, 0); // outside the 18–60 window

	// PCB / MTD 2026, computerised calculation. Annualise, relieve, scale, spread, round twice.
	// A January monthly payslip projects twelve payslips: annual = wage × 12.
	//
	// MY-1000: annual 12,000. EPF relief 110 projected over the eleven months still to run =
	// 110 + 110 × 11 = 1,320 (well under the RM4,000 cap). SOCSO+EIS = 4.75 + 1.90 = 6.65 (cap
	// 350). Personal relief 9,000. Chargeable = 12,000 − 1,326.65 − 9,000 = 1,673.35, which is in
	// the 0%..RM5,000 band: no tax, and below the RM10 minimum in any case.
	expectStatutory(book, 'MY-1000', 'PCB', 0, 0);
	// MY-5001: annual 60,012. EPF 561 projected = 561 + min(561, (4,000−561)/11) × 11 = 4,000, the
	// cap. SOCSO+EIS = 25.25 + 10.10 = 35.35. Personal 9,000. Chargeable = 60,012 − 4,035.35 −
	// 9,000 = 46,976.65. Category 1 band M=35,000 R=6% B=600: 600 + 11,976.65 × 6% = 1,318.599.
	// Spread over 12 = 109.88325 → truncate to the cent 109.88 → up to the next 5 cents 109.90.
	expectStatutory(book, 'MY-5001', 'PCB', 109.9, 0);
	// MY-25000: annual 300,000. EPF relief capped at 4,000; SOCSO+EIS = 29.75 + 11.90 = 41.65.
	// Chargeable = 300,000 − 4,041.65 − 9,000 = 286,958.35. Band M=100,000 R=25% B=9,400:
	// 9,400 + 186,958.35 × 25% = 56,139.5875 → /12 = 4,678.29896 → 4,678.29 → 4,678.30.
	expectStatutory(book, 'MY-25000', 'PCB', 4678.3, 0);
	// MY-60: no EPF employee share and no SOCSO/EIS employee share at 60+, so the only relief is
	// the RM9,000 personal one. Chargeable = 60,012 − 9,000 = 51,012. Band M=50,000 R=11%
	// B=1,500: 1,500 + 1,012 × 11% = 1,611.32 → /12 = 134.27666 → 134.27 → 134.30.
	expectStatutory(book, 'MY-60', 'PCB', 134.3, 0);

	// HRD Corp levy, PSMB Act 2001 s.14: 1% of monthly wages, employer only, compulsory at ten or
	// more employees. Overtime is outside the base; here there is none.
	expectStatutory(book, 'MY-1000', 'HRDF', 0, 10);
	expectStatutory(book, 'MY-5001', 'HRDF', 0, 50.01);
	expectStatutory(book, 'MY-25000', 'HRDF', 0, 250);
});

test('Malaysia — the RM4,000 EPF relief cap and the RM10 minimum monthly deduction', () => {
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			// Chargeable income just inside the first taxable band, so the annual tax spreads to a
			// few ringgit a month and the P.U.(A) 123/2021 minimum suppresses it.
			{ key: 'MY-MIN', wage: 2600, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			// A married taxpayer whose spouse has no income: MTD Category 2, and the s.47 spouse
			// relief of RM4,000 on top of the RM9,000 personal one.
			{
				key: 'MY-MARRIED',
				wage: 5001,
				citizenship: 'CITIZEN',
				marital_status: 'MARRIED',
				spouse_status: 'WITHOUT_INCOME',
				children: 2,
				registrations: MY_LOCAL
			}
		]
	});

	// MY-MIN: annual 31,200. EPF 286 (11% of the 2,600 bracket) projected = 286 × 12 = 3,432, under
	// the RM4,000 cap. SOCSO 12.25 + EIS 4.90 = 17.15. Personal 9,000. Chargeable = 31,200 − 3,449.15
	// − 9,000 = 18,750.85. Band M=5,000 R=1% B=−400: −400 + 13,750.85 × 1% = −262.49 → the scale
	// gives nothing to withhold, and the RM10 monthly minimum does not create a liability.
	expectStatutory(book, 'MY-MIN', 'PCB', 0, 0);
	// MY-MARRIED: annual 60,012. EPF relief 4,000 (cap), SOCSO+EIS 35.35, personal 9,000, spouse
	// 4,000, two children at RM2,000 = 4,000. Chargeable = 60,012 − 4,035.35 − 17,000 = 38,976.65.
	// Category 2 shares Category 1's B from M=35,000 (only the first two bands differ): 600 +
	// 3,976.65 × 6% = 838.599 → /12 = 69.88325 → 69.88 → 69.90.
	expectStatutory(book, 'MY-MARRIED', 'PCB', 69.9, 0);
});

test('Malaysia — SKBBK is levied from 1 June 2026 and is foreigners-only from 9 July 2026', () => {
	const people = [
		{ key: 'MY-LOCAL', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
		{ key: 'MY-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
	];

	// Before 1 June 2026 the scheme does not exist at all.
	const january = assessStatutory({ code: 'MY', period: '2026-01', people });
	expectStatutorySkipped(january, 'MY-LOCAL', 'SKBBK');

	// 1 June 2026: Act 4's non-employment-injury scheme opens, phase 1 at 0.75%, employee share
	// only, on SOCSO's own 65 wage rows and the same RM6,000 ceiling — charged in both categories.
	// The 5,000.01–5,100 row of PERKESO's published Act 4 schedule including SKBBK is 37.85 (0.75%
	// of the band reference would give 37.875, so the figure is the printed one, not a formula).
	const june = assessStatutory({ code: 'MY', period: '2026-06', people });
	expectStatutory(june, 'MY-LOCAL', 'SKBBK', 37.85, 0);
	expectStatutory(june, 'MY-FOREIGN', 'SKBBK', 37.85, 0);

	// 9 July 2026: made voluntary for Malaysian employees and left mandatory for foreign workers.
	// The seeded predicate is `citizenship == "FOREIGNER"`, so a local is outside the scheme.
	const july = assessStatutory({ code: 'MY', period: '2026-07', people });
	expectStatutorySkipped(july, 'MY-LOCAL', 'SKBBK');
	expectStatutory(july, 'MY-FOREIGN', 'SKBBK', 37.85, 0);
	// Nothing else moved across the two seams: SOCSO, EIS and EPF are unchanged.
	expectStatutory(july, 'MY-LOCAL', 'SOCSO', 25.25, 88.35);
	expectStatutory(july, 'MY-LOCAL', 'EIS', 10.1, 10.1);
	expectStatutory(july, 'MY-LOCAL', 'EPF', 561, 612);
});

test('Malaysia — a non-resident PCB override is a flat 30% without resident reliefs', () => {
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{
				key: 'MY-NR',
				wage: 5001,
				citizenship: 'FOREIGNER',
				registrations: {
					EPF: OUT,
					EPF_PR: OUT,
					EIS: OUT,
					PCB: { kind: 'REGISTERED', rate_override: 30 }
				}
			}
		]
	});

	// The non-resident flat-rate branch (`contribute.ts`: a `PROGRESSIVE` scheme with a
	// registration `rate_override`): 30% of the month's remuneration, without resident reliefs,
	// annualising or spreading. 30% × 5,001 = 1,500.30.
	expectStatutory(book, 'MY-NR', 'PCB', 1500.3, 0);
	// The rest of the statute prices them as the foreign worker they are: Part F EPF, 2% each.
	expectStatutory(book, 'MY-NR', 'EPF_NON_CITIZEN', 101, 101);
});

test('MY-nihon prices the same statute as MY', () => {
	const book = assessStatutory({
		code: 'MY-nihon',
		period: '2026-01',
		people: [{ key: 'N-5001', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
	});
	// The fork differs only in one company overtime boundary; every statutory figure is Malaysia's.
	expectStatutory(book, 'N-5001', 'EPF', 561, 612);
	expectStatutory(book, 'N-5001', 'SOCSO', 25.25, 88.35);
	expectStatutory(book, 'N-5001', 'EIS', 10.1, 10.1);
	expectStatutory(book, 'N-5001', 'PCB', 109.9, 0);
});
