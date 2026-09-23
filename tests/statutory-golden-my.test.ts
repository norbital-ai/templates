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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	chargeOf,
	type BuiltPayslip,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
/** A Malaysian citizen or PR: Part A / C / E, never the Part F non-citizen scheme. */
const MY_LOCAL = { EPF_NON_CITIZEN: OUT };
/** A non-citizen: Part F only. */
const MY_FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — child relief uses the tax-year declaration and full or half entitlement`, () => {
		// LHDN MTD 2026: annual income 60,012 less EPF 4,000, SOCSO 35.35 and
		// personal relief 9,000 gives P=46,976.65. In this band each RM1,000
		// child relief reduces monthly MTD by RM5, subject to the published rounding.
		const cases = [
			{ key: 'NO-CLAIM', claims: [], expected: 109.9 },
			{ key: 'FULL', category: 'UNDER_18', full: 1, half: 0, expected: 99.9 },
			{ key: 'HALF', category: 'UNDER_18', full: 0, half: 1, expected: 104.9 },
			{ key: 'MIXED', category: 'UNDER_18', full: 1, half: 1, expected: 94.9 },
			{ key: 'STUDYING', category: 'STUDYING', full: 1, half: 0, expected: 99.9 },
			{ key: 'TERTIARY', category: 'TERTIARY', full: 0, half: 1, expected: 89.9 },
			{ key: 'DISABLED', category: 'DISABLED', full: 0, half: 1, expected: 89.9 },
			{ key: 'DISABLED-TERTIARY', category: 'DISABLED_TERTIARY', full: 0, half: 1, expected: 69.9 },
			{
				key: 'PREVIOUS-YEAR',
				category: 'UNDER_18',
				full: 1,
				half: 0,
				year: '2025',
				expected: 109.9
			},
			{ key: 'NEXT-YEAR', category: 'UNDER_18', full: 1, half: 0, year: '2027', expected: 109.9 }
		];
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: cases.map((row) => ({
				key: row.key,
				wage: 5001,
				citizenship: 'CITIZEN',
				// Turns 18 during the basis year: an eligible declaration continues for that year.
				child_rows: [{ child_birthdate: '2008-01-10' }, { child_birthdate: '2015-06-01' }],
				registrations: {
					...MY_LOCAL,
					PCB: {
						kind: 'REGISTERED',
						child_claims: row.claims ?? [
							{
								year: row.year ?? '2026',
								relief_class: row.category,
								full_count: row.full,
								half_count: row.half,
								reference: 'Synthetic eligible claim'
							}
						]
					}
				}
			}))
		});
		for (const row of cases) expectStatutory(book, row.key, 'PCB', row.expected, 0);
	});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — unknown tax residence uses LHDN’s 30% withholding default`, () => {
		// LHDN MTD 2026 D(a): non-resident or not known to be resident, regardless of citizenship.
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: [
				{
					key: 'UNKNOWN-RESIDENCE',
					wage: 5001,
					citizenship: 'CITIZEN',
					tax_residency: null,
					registrations: {
						...MY_LOCAL,
						PCB: { kind: 'REGISTERED', elections: { zakat: 100, pcb_disabled: true } }
					}
				}
			]
		});
		expectStatutory(book, 'UNKNOWN-RESIDENCE', 'PCB', 1500.3, 0);
	});

test('Malaysia — a bonus month withholds the additional remuneration’s whole tax difference (MTD spec 2026, additional remuneration)', () => {
	// MY-5001 with a 12,000 bonus (the non-fixed ADJ row) in January. The spec projects the year
	// on the NORMAL remuneration alone — 5,001 × 12 = 60,012 — and takes the bonus's tax in full
	// in the month, where annualising the whole 17,001 would have taxed a 204,012 year.
	//
	// Reliefs this month: EPF on the bracketed 17,100 = 1,881, projected to the 4,000 cap;
	// SOCSO + EIS at the 6,000 ceiling = 29.75 + 11.90 = 41.65; personal 9,000.
	// Normal: 60,012 − 4,000 − 41.65 − 9,000 = 46,970.35 → 600 + 6% × 11,970.35 = 1,318.221; over
	// twelve = 109.85175. Additional: 58,970.35 → 1,500 + 11% × 8,970.35 = 2,486.7385; the
	// difference 1,168.5175 is withheld now. 1,278.36925 → 1,278.36 → 1,278.40.
	const book = assessStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [{ key: 'MY-BONUS', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) =>
					row.code === 'ADJ' &&
					row.settings_id ===
						settingsVersions('MY').find((v) =>
							String(v.effective_range.start).startsWith('2025-12')
						)!.id
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'MY-BONUS')!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-00000000ad10',
				employment_id: employment.id,
				catalogue_id: bonus.id,
				amount: 12_000,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: 'bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	expectStatutory(book, 'MY-BONUS', 'PCB', 1278.4, 0);
	assert.equal(book.get('MY-BONUS')!.get('PCB')!.base, 17_001);
});

test('Malaysia — declared relief categories remain separate from recorded family facts', () => {
	// MTD 2026: RM2,000 minor + RM8,000 tertiary + RM8,000 disabled = RM18,000.
	// At RM5,001 monthly, P=28,976.65 and annual tax after rebate is RM19.2995;
	// monthly MTD is below RM10. The same family without claims receives no child relief.
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{
				key: 'MY-CHILDREN',
				wage: 5001,
				citizenship: 'CITIZEN',
				registrations: {
					...MY_LOCAL,
					PCB: {
						kind: 'REGISTERED',
						child_claims: ['UNDER_18', 'TERTIARY', 'DISABLED'].map((relief_class) => ({
							year: '2026',
							relief_class,
							full_count: 1,
							half_count: 0,
							reference: 'Synthetic declaration'
						}))
					}
				},
				child_rows: [
					{ child_birthdate: '2015-06-01' },
					{ child_birthdate: '2006-01-15', relief_class: 'TERTIARY' },
					{ child_birthdate: '2010-03-03', relief_class: 'DISABLED' }
				]
			},
			// Family records remain available to leave eligibility when no tax claim is made.
			{
				key: 'MY-UNCLASSED',
				wage: 5001,
				citizenship: 'CITIZEN',
				registrations: MY_LOCAL,
				child_rows: [
					{ child_birthdate: '2015-06-01' },
					{ child_birthdate: '2006-01-15' },
					{ child_birthdate: '2010-03-03' }
				]
			}
		]
	});
	expectStatutory(book, 'MY-CHILDREN', 'PCB', 0, 0);
	expectStatutory(book, 'MY-UNCLASSED', 'PCB', 109.9, 0);
});

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
			{
				key: 'MY-DISABLED',
				wage: 5001,
				citizenship: 'CITIZEN',
				registrations: {
					...MY_LOCAL,
					PCB: { kind: 'REGISTERED', elections: { pcb_disabled: true } }
				}
			},
			{
				key: 'MY-DISABLED-SPOUSE',
				wage: 5001,
				spouse_status: 'WITHOUT_INCOME',
				citizenship: 'CITIZEN',
				registrations: {
					...MY_LOCAL,
					PCB: { kind: 'REGISTERED', elections: { pcb_spouse_disabled: true } }
				}
			},
			{
				key: 'MY-SPOUSE',
				wage: 5001,
				spouse_status: 'WITHOUT_INCOME',
				citizenship: 'CITIZEN',
				registrations: MY_LOCAL
			},
			{ key: 'MY-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN },
			{
				key: 'MY-FOREIGN-75',
				wage: 5001,
				age: 75,
				citizenship: 'FOREIGNER',
				registrations: MY_FOREIGN
			}
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
	// Part F para 2: "the total contribution which includes cents shall be rounded to the next
	// ringgit" — 4% × 5,001 = 200.04 → 201; the employee's 100.02 → 101 and the employer carries
	// the rest, 100. Two separate round-ups would over-collect a ringgit.
	expectStatutory(book, 'MY-FOREIGN', 'EPF_NON_CITIZEN', 101, 100);
	// EPF Act First Schedule para (13): at seventy-five the person is outside the Act — no Part F
	// row at all, not a zero one.
	expectStatutorySkipped(book, 'MY-FOREIGN-75', 'EPF_NON_CITIZEN');

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
	// LHDN reliefs read from the employment's PCB elections. The MTD 2026 specification (updated
	// 1 January 2026, reliefs (e) and (f)) puts a disabled individual at RM7,000 and a disabled
	// spouse at RM6,000 — the YA 2023 figures of 6,000 and 5,000 had been seeded. A disabled person:
	// chargeable 46,976.65 − 7,000 = 39,976.65 → 600 + 4,976.65 × 6% = 898.599 → /12 = 74.88325 →
	// 74.88 → 74.90. A disabled spouse, a further RM6,000 on top of the RM4,000 spouse relief:
	// 42,976.65 − 6,000 = 36,976.65 → 600 + 1,976.65 × 6% = 718.599 → /12 = 59.88325 → 59.90. The
	// spouse control pays 89.90.
	expectStatutory(book, 'MY-DISABLED', 'PCB', 74.9, 0);
	expectStatutory(book, 'MY-SPOUSE', 'PCB', 89.9, 0);
	expectStatutory(book, 'MY-DISABLED-SPOUSE', 'PCB', 59.9, 0);

	// HRD Corp levy, PSMB Act 2001 s.14: 1% of monthly wages, employer only, compulsory at ten or
	// more employees. Overtime is outside the base; here there is none.
	expectStatutory(book, 'MY-1000', 'HRDF', 0, 10);
	expectStatutory(book, 'MY-5001', 'HRDF', 0, 50.01);
	expectStatutory(book, 'MY-25000', 'HRDF', 0, 250);
	// The levy reaches Malaysian employees only (PSMB Act 2001 s.14): a foreign employee is
	// outside it even where the headcount band is the compulsory one.
	expectStatutorySkipped(book, 'MY-FOREIGN', 'HRDF');
	expectStatutorySkipped(book, 'MY-FOREIGN-75', 'HRDF');
});

test('Malaysia — prior contribution liability survives a change of employer', () => {
	// Act 4 First Schedule 12(i), Act 800 First Schedule 9: liability history is independent
	// of the current employer's registration date. The later local hire has earlier coverage.
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		headcount: 16,
		people: [
			{
				key: 'MY-EARLY-58',
				wage: 5001,
				age: 58,
				hire_date: '2000-01-01',
				citizenship: 'CITIZEN',
				registrations: MY_LOCAL
			},
			{
				key: 'MY-LATE-58',
				wage: 5001,
				age: 58,
				hire_date: '2025-01-01',
				citizenship: 'CITIZEN',
				registrations: {
					...MY_LOCAL,
					SOCSO: { kind: 'REGISTERED', first_contribution_due_on: '2000-01-01' },
					EIS: { kind: 'REGISTERED', first_contribution_due_on: '2018-01-01' }
				}
			},
			{
				key: 'MY-FOREIGN-LATE-58',
				wage: 5001,
				age: 58,
				hire_date: '2025-01-01',
				citizenship: 'FOREIGNER',
				registrations: MY_FOREIGN
			}
		]
	});

	// Entered at 32: First Category on the 5,000.01–5,100 row, and EIS applies.
	expectStatutory(book, 'MY-EARLY-58', 'SOCSO', 25.25, 88.35);
	expectStatutory(book, 'MY-EARLY-58', 'EIS', 10.1, 10.1);
	// A citizen hired at 57 stays First Category and inside EIS: the employment's first day says
	// nothing about the person's first contribution.
	expectStatutory(book, 'MY-LATE-58', 'SOCSO', 25.25, 88.35);
	expectStatutory(book, 'MY-LATE-58', 'EIS', 10.1, 10.1);
	// A non-citizen first registered at 57: Second Category on the same row (employer 1.25% only);
	// EIS never reaches a non-citizen, which the NOT_REGISTERED fact already says (a zero row).
	expectStatutory(book, 'MY-FOREIGN-LATE-58', 'SOCSO', 0, 63.1);
	expectStatutory(book, 'MY-FOREIGN-LATE-58', 'EIS', 0, 0);
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
				registrations: {
					...MY_LOCAL,
					PCB: {
						kind: 'REGISTERED',
						child_claims: [
							{
								year: '2026',
								relief_class: 'UNDER_18',
								full_count: 2,
								half_count: 0,
								reference: 'Synthetic declaration'
							}
						]
					}
				}
			},
			// Two households at the same wage, differing only in whether the spouse has income of
			// their own. MTD Category 3 (married, spouse working) is assessed on the Category 1
			// schedule; the s.6D rebate belongs to Category 2 alone. The two ladders differ by
			// exactly RM400 in the B constant, and only across a chargeable income of 5,000 to
			// 35,000 — which is why a seed reading marital status alone looked right at most wages
			// and, at this one, withheld nothing at all from a household that owes 16.60 a month.
			{
				key: 'MY-SPOUSE-DEPENDENT',
				wage: 4000,
				citizenship: 'CITIZEN',
				marital_status: 'MARRIED',
				spouse_status: 'WITHOUT_INCOME',
				registrations: MY_LOCAL
			},
			{
				key: 'MY-SPOUSE-WORKING',
				wage: 4000,
				citizenship: 'CITIZEN',
				marital_status: 'MARRIED',
				spouse_status: 'WITH_INCOME',
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
	// The dependent-spouse household carries the s.47 relief and the s.6D rebate and owes nothing;
	// the working-spouse household carries neither and owes 16.60. Reading marital status alone put
	// both on Category 2 and withheld nothing from either.
	expectStatutory(book, 'MY-SPOUSE-DEPENDENT', 'PCB', 0, 0);
	expectStatutory(book, 'MY-SPOUSE-WORKING', 'PCB', 16.6, 0);
	assert.notEqual(
		chargeOf(book, 'MY-SPOUSE-WORKING', 'PCB').employee,
		chargeOf(book, 'MY-SPOUSE-DEPENDENT', 'PCB').employee,
		'the MTD category turns on the spouse’s income, not on being married'
	);
});

test('Malaysia — SKBBK is levied from 1 June 2026, and a local leaves it by releasing', () => {
	const people = [
		{ key: 'MY-LOCAL', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
		{ key: 'MY-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN },
		// A citizen who filed the Notis Perakuan Pelepasan Liabiliti: out of the scheme by their own
		// election, which is a registration fact and not a property of the statute.
		{
			key: 'MY-RELEASED',
			wage: 5001,
			citizenship: 'CITIZEN',
			registrations: { ...MY_LOCAL, SKBBK: OUT }
		}
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

	// 9 July 2026: the Cabinet made the employee contribution voluntary for citizens and permanent
	// residents on 8 July, and PERKESO's election ran 13 July to 31 August through a Notis Perakuan
	// Pelepasan Liabiliti. Voluntary here is opt-OUT — an employee who files no release continues to
	// participate and contributions continue — so the scheme still reaches every local. Seeding the
	// version as foreigners-only instead skipped every citizen from the seam onward, RM44.65 a month
	// each at the ceiling, whether or not they had ever filed anything.
	const july = assessStatutory({ code: 'MY', period: '2026-07', people });
	expectStatutory(july, 'MY-LOCAL', 'SKBBK', 37.85, 0);
	expectStatutory(july, 'MY-FOREIGN', 'SKBBK', 37.85, 0);
	// The release is what takes a person out, and it is theirs alone. A filed release is a
	// NOT_REGISTERED fact, which gates the charge to zero rather than removing the scheme — the
	// person is inside a scheme they owe nothing under, which is exactly what a release means.
	expectStatutory(july, 'MY-RELEASED', 'SKBBK', 0, 0);
	expectStatutory(july, 'MY-RELEASED', 'SOCSO', 25.25, 88.35);
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
				tax_residency: 'NON_RESIDENT',
				registrations: {
					EPF: OUT,
					EPF_PR: OUT,
					EIS: OUT,
					PCB: { kind: 'REGISTERED', rate_override: 30 }
				}
			}
		]
	});

	// The declared non-resident status selects 30% without resident reliefs.
	// The redundant matching override does not replace that declaration. 5,001×30%=1,500.30.
	expectStatutory(book, 'MY-NR', 'PCB', 1500.3, 0);
	// The rest of the statute prices them as the foreign worker they are: Part F EPF, 2% each,
	// the total rounded up (201) and split 101 / 100.
	expectStatutory(book, 'MY-NR', 'EPF_NON_CITIZEN', 101, 100);
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

for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code}: recorded non-resident tax status selects 30% without a second rate entry`, () => {
		// LHDN MTD 2026 section D(a), p.9: non-resident remuneration is subject to 30%.
		// The contract already captures this status; a manual override must not be required.
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: [
				{
					key: 'DECLARED-NONRESIDENT',
					wage: 5001,
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT',
					registrations: MY_FOREIGN
				},
				{
					key: 'NONRESIDENT-RELIEF',
					wage: 5001,
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT',
					registrations: {
						...MY_FOREIGN,
						PCB: { kind: 'REGISTERED', rate_override: 15, elections: { zakat: 100 } }
					}
				}
			]
		});
		expectStatutory(book, 'DECLARED-NONRESIDENT', 'PCB', 1500.3, 0);
		// ITA s.6A(3), LHDN PR 6/2018 §5.5.1: zakat rebate is for a resident individual.
		expectStatutory(book, 'NONRESIDENT-RELIEF', 'PCB', 1500.3, 0);
	});
}

test('MY-nihon carries Malaysia’s two later sealed versions, SKBBK seams and all', () => {
	const people = [
		{ key: 'N-5001', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
		{ key: 'N-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
	];

	// The fork clones every Malaysian version, so its own timeline has the same two seams. 1 June
	// 2026: SKBBK opens for everyone, phase 1 at 0.75% employee-only on SOCSO's 65 wage rows — the
	// 5,000.01–5,100 row of PERKESO's published Act 4 schedule is the printed 37.85.
	const june = assessStatutory({ code: 'MY-nihon', period: '2026-06', people });
	expectStatutory(june, 'N-5001', 'SKBBK', 37.85, 0);
	expectStatutory(june, 'N-FOREIGN', 'SKBBK', 37.85, 0);

	// 9 July 2026: voluntary for Malaysians by release, mandatory for foreign workers. The fork
	// carries the parent's correction — the scheme still reaches a local who has filed nothing.
	const july = assessStatutory({ code: 'MY-nihon', period: '2026-07', people });
	expectStatutory(july, 'N-5001', 'SKBBK', 37.85, 0);
	expectStatutory(july, 'N-FOREIGN', 'SKBBK', 37.85, 0);
	// Nothing else moved across either seam: the fork prices EPF, SOCSO and EIS as Malaysia does,
	// including the Part F non-citizen 2% each on the wage as it stands (2% × 5,001 = 100.02 → 101).
	expectStatutory(july, 'N-5001', 'EPF', 561, 612);
	expectStatutory(july, 'N-5001', 'SOCSO', 25.25, 88.35);
	expectStatutory(july, 'N-5001', 'EIS', 10.1, 10.1);
	expectStatutory(july, 'N-FOREIGN', 'EPF_NON_CITIZEN', 101, 100);
});

test('Malaysia — the Third Schedule brackets a wage in tens, then twenties, then hundreds', () => {
	// KWSP Third Schedule Part A: rows are RM10 wide to RM20, RM20 wide to RM5,000, RM100 wide to
	// RM20,000. Each row charges the rate on its own ceiling, so RM970 is "960.01 – 980.00" →
	// 108 / 128, RM15 is "10.01 – 20.00" → 3 / 3. A composition of three `bracket()` calls
	// re-rounded 980 to 1,000 and 20 to 100; the rounding is one ladder, not a chain.
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{ key: 'MY-15', wage: 15, age: 40, citizenship: 'CITIZEN' },
			{ key: 'MY-970', wage: 970, age: 40, citizenship: 'CITIZEN' },
			{ key: 'MY-1748', wage: 1748, age: 40, citizenship: 'CITIZEN' },
			{ key: 'MY-1748-60', wage: 1748, age: 60, citizenship: 'CITIZEN' },
			{ key: 'MY-PR-970-61', wage: 970, age: 61, citizenship: 'PERMANENT_RESIDENT' },
			// The cent above a published ceiling belongs to the next row, never to no row.
			{ key: 'MY-5000.01', wage: 5000.01, age: 40, citizenship: 'CITIZEN' },
			{ key: 'MY-6000.01', wage: 6000.01, age: 40, citizenship: 'CITIZEN' },
			{ key: 'MY-20000.01', wage: 20_000.01, age: 40, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'MY-15', 'EPF', 3, 3);
	expectStatutory(book, 'MY-970', 'EPF', 108, 128);
	// "1,740.01 – 1,760.00": 11% and 13% of 1,760 → 193.60 → 194, 228.80 → 229.
	expectStatutory(book, 'MY-1748', 'EPF', 194, 229);
	// Part E at sixty: employee nil, employer 4% of 1,760 = 70.40 → 71.
	expectStatutory(book, 'MY-1748-60', 'EPF', 0, 71);
	// Part C for a permanent resident of sixty-one: 5.5% / 6.5% of 980 → 53.90 → 54, 63.70 → 64.
	expectStatutory(book, 'MY-PR-970-61', 'EPF_PR', 54, 64);
	// Act 4 "exceeding RM5,000 but not exceeding RM5,100" → 25.25 / 88.35; EIS 10.10 / 10.10.
	expectStatutory(book, 'MY-5000.01', 'SOCSO', 25.25, 88.35);
	expectStatutory(book, 'MY-5000.01', 'EIS', 10.1, 10.1);
	// Above the RM6,000 ceiling: the open row.
	expectStatutory(book, 'MY-6000.01', 'SOCSO', 29.75, 104.15);
	expectStatutory(book, 'MY-6000.01', 'EIS', 11.9, 11.9);
	// Third Schedule closing words, "wages exceed RM20,000": 11% and 12% of the wage itself, and
	// "the total contribution which includes cents shall be rounded to the next ringgit" — 23% ×
	// 20,000.01 = 4,600.0023 → 4,601; the employee's 2,200.0011 → 2,201, the employer the rest.
	expectStatutory(book, 'MY-20000.01', 'EPF', 2201, 2400);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Employment Act 1955 Part XII: the pay side of the statute. The world's shift is 09:00–18:00 with
// a sixty-minute break — eight normal hours, Monday to Friday — so every figure below is a hand
// derivation from s.60I (ordinary rate = monthly ÷ 26, hourly = ordinary ÷ normal hours), s.60A(3)
// (1.5× beyond normal hours), s.60(3)(b)–(c) (rest day: half a day's wages up to half the normal
// hours, a day's wages up to the normal hours, 2× beyond them), s.60D(3)(a)(i) and (aa) (holiday:
// two days' wages, 3× beyond normal hours), s.18A (an incomplete month, unpaid leave included, is
// monthly wages × eligible days ÷ days of the wage period) and First Schedule para 1A (the ladder
// stops at wages over RM4,000 save for the para 2 categories). Wages are chosen so the rates are
// exact in cents; other cases verify that intermediate rates retain full precision.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const REGISTERED_LOCAL = MY_LOCAL;
const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
/** A punch from `start` to `end` on `date`, in the jurisdiction's own +08:00 frame. */
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		approval_id: null
	});
};
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

test('Malaysia — overtime, rest-day and holiday work at the s.60I ordinary rate', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				// RM2,600: ordinary rate 100.00 a day, 12.50 an hour; inside the RM4,000 ladder.
				{ key: 'MY-EA', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				// RM5,200 non-manual: over RM4,000, so First Schedule para 1A takes the ladder away.
				{ key: 'MY-OVER', wage: 5200, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				// RM5,200 manual labour: para 2(1) keeps the ladder irrespective of wages —
				// 200.00 a day, 25.00 an hour.
				{
					key: 'MY-MANUAL',
					wage: 5200,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR',
					registrations: REGISTERED_LOCAL
				}
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(
				holiday('2026-01-01', 'New Year'),
				holiday('2026-01-14', 'Thaipusam')
			);
			// s.59(1): where more than one day off is allowed in a week, the LAST is the rest day
			// for Part XII. The world's pattern rests on both Saturday and Sunday, so Saturday is
			// made an OFF day here and Sunday stays the rest day.
			world.shift_definitions.push({
				...world.shift_definitions[1]!,
				id: 'off-day',
				code: 'OFF',
				name: 'Off day',
				variant: { kind: 'OFF' }
			});
			const pattern = world.shift_patterns[0]!.pattern as {
				days: { roster_code_id: string }[];
			};
			pattern.days[5] = { roster_code_id: 'off-day' };
			for (const key of ['MY-EA', 'MY-OVER', 'MY-MANUAL']) {
				punch(world, key, '2026-01-05', '09:00', '20:00'); // Monday: two hours past the shift
				punch(world, key, '2026-01-10', '09:00', '13:00'); // Saturday off day: four hours
				punch(world, key, '2026-01-04', '09:00', '13:00'); // Sunday rest day: four hours
				punch(world, key, '2026-01-11', '09:00', '16:00'); // Sunday rest day: seven hours
				punch(world, key, '2026-01-18', '09:00', '20:00'); // Sunday rest day: eleven hours
				punch(world, key, '2026-01-01', '09:00', '18:00'); // Thursday holiday: the normal day
				punch(world, key, '2026-01-14', '09:00', '20:00'); // Wednesday holiday: ten hours
			}
		}
	);

	// s.60A(3)(a): 2 h × 12.50 × 1.5 = 37.50; an off day is not a rest day, so its four hours are
	// hours beyond the normal week at the same 1.5× = 75.00. s.60(3)(b)(i): four hours is not more
	// than half of eight, half a day's wages = 50.00. s.60(3)(b)(ii): seven hours is more than half
	// but not more than eight, one day's wages = 100.00. s.60(3)(c): eleven hours on a rest day — a
	// day's wages for the first eight, then 3 h × 12.50 × 2 = 75.00. s.60D(3)(a)(i): work on a
	// holiday is two days' wages = 200.00 "regardless that the period of work done on that day is
	// less than the normal hours"; s.60D(3)(aa): 2 h beyond them × 12.50 × 3 = 75.00. The shift's
	// hour of break comes off a scheduled day's clock (09:00–20:00 is ten hours worked); a rest or
	// off day has no shift, so its whole clock is work.
	assert.deepEqual(workLines(slips.get('MY-EA')!), [
		['2026-01-01', 'HOLIDAY-2-DAYS-PAY', 8, 200],
		['2026-01-04', 'RESTDAY-HALF-DAY-PAY', 4, 50],
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 37.5],
		['2026-01-10', 'WORKDAY-OT-1.5X', 4, 75],
		['2026-01-11', 'RESTDAY-FULL-DAY-PAY', 7, 100],
		['2026-01-14', 'HOLIDAY-2-DAYS-PAY', 8, 200],
		['2026-01-14', 'HOLIDAY-OT-3.0X', 2, 75],
		['2026-01-18', 'RESTDAY-FULL-DAY-PAY', 8, 100],
		['2026-01-18', 'RESTDAY-OT-2.0X', 3, 75]
	]);
	assert.equal(slips.get('MY-EA')!.gross, 2600 + 200 + 50 + 37.5 + 75 + 100 + 200 + 75 + 100 + 75);
	// Which schemes see the overtime is each scheme's own `assessed_on`: EPF Act 1991 s.2 keeps
	// overtime out of wages, Act 4 and Act 800 take it in, HRD Corp levies basic and fixed
	// allowances only.
	const charge = (code: string) =>
		slips.get('MY-EA')!.statutory.find((row) => row.scheme_code === code)!;
	assert.equal(charge('EPF').base_amount, 2600);
	assert.equal(charge('HRDF').base_amount, 2600);
	assert.equal(charge('SOCSO').base_amount, 3512.5);
	assert.equal(charge('EIS').base_amount, 3512.5);
	// SOCSO on 3,512.50 is the "exceeding 3,500, not exceeding 3,600" row: 17.75 / 62.15.
	assert.deepEqual(
		[charge('SOCSO').employee_amount, charge('SOCSO').employer_amount],
		[17.75, 62.15]
	);

	// Over RM4,000 and outside para 2: the same six days produce no Part XII line at all.
	assert.deepEqual(workLines(slips.get('MY-OVER')!), []);
	assert.equal(slips.get('MY-OVER')!.gross, 5200);

	// Manual labour at the same wage: the ladder applies at 200.00 a day and 25.00 an hour.
	assert.deepEqual(workLines(slips.get('MY-MANUAL')!), [
		['2026-01-01', 'HOLIDAY-2-DAYS-PAY', 8, 400],
		['2026-01-04', 'RESTDAY-HALF-DAY-PAY', 4, 100],
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 75],
		['2026-01-10', 'WORKDAY-OT-1.5X', 4, 150],
		['2026-01-11', 'RESTDAY-FULL-DAY-PAY', 7, 200],
		['2026-01-14', 'HOLIDAY-2-DAYS-PAY', 8, 400],
		['2026-01-14', 'HOLIDAY-OT-3.0X', 2, 150],
		['2026-01-18', 'RESTDAY-FULL-DAY-PAY', 8, 200],
		['2026-01-18', 'RESTDAY-OT-2.0X', 3, 150]
	]);
});

test('Malaysia — s.18A prices an incomplete month and unpaid absence on the calendar month', () => {
	const { slips, warnings } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			// `wages.by_region` is keyed by the company's region; the Order is one figure nationwide.
			region: 'Malaysia',
			people: [
				// Joined on the 11th of a 31-day month.
				{
					key: 'MY-JOINER',
					wage: 3100,
					hire_date: '2026-01-11',
					citizenship: 'CITIZEN',
					registrations: REGISTERED_LOCAL
				},
				// A rostered Tuesday with no attendance and no leave: one day of absence without pay.
				{ key: 'MY-ABSENT', wage: 3100, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				// Minimum Wages Order 2024 [P.U.(A) 376/2024]: RM1,700; a contract below it is reported.
				{ key: 'MY-UNDER', wage: 1500, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			const absent = world.employments.find((row) => row.employee_number === 'MY-ABSENT')!;
			world.work_days.push({
				id: 'wd-MY-ABSENT-2026-01-06',
				employment_id: absent.id,
				work_date: '2026-01-06',
				shift_definition_id: null,
				worked_intervals: [],
				approval_id: null
			});
		}
	);

	// s.18A(a): 3,100 × 21 ÷ 31 = 2,100.00 — calendar days of the wage period, not the 26 of
	// s.60I, which the section displaces "notwithstanding".
	const joiner = slips.get('MY-JOINER')!;
	assert.deepEqual(
		joiner.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[21, 31, 2100]]
	);
	assert.equal(joiner.gross, 2100);
	// EPF on the month's wages actually paid, 2,100 → the "2,080.01 – 2,100.00" row: 231 / 273.
	assert.deepEqual(
		joiner.statutory
			.filter((row) => row.scheme_code === 'EPF')
			.map((row) => [row.base_amount, row.employee_amount, row.employer_amount]),
		[[2100, 231, 273]]
	);

	// s.18A(c): one day of leave of absence without pay is 3,100 ÷ 31 = 100.00 off the month; the
	// contributions see 3,000. EPF's "2,980.01 – 3,000.00" row: 330 / 390.
	const absent = slips.get('MY-ABSENT')!;
	assert.deepEqual(
		absent.adjustments.map((row) => [row.component_code, row.quantity, row.amount]),
		[['ABSENCE', 1, 100]]
	);
	assert.equal(absent.gross, 3000);
	assert.deepEqual(
		absent.statutory
			.filter((row) => row.scheme_code === 'EPF')
			.map((row) => [row.base_amount, row.employee_amount, row.employer_amount]),
		[[3000, 330, 390]]
	);

	// The run still builds — the Order is enforced by the Labour Department, not by refusing a
	// payslip — and names the person and the figure.
	assert.ok(
		warnings.some((line) =>
			/MY-UNDER is contracted at 1500 a month, below the Malaysia minimum wage of 1700/.test(line)
		),
		warnings.join('\n')
	);
});

test('Malaysia — regulation 4’s 104-hour month is a ceiling on the employer, not on the pay', () => {
	// Employment (Limitation of Overtime Work) Regulations 1980 reg.4: an employer shall not require
	// overtime beyond 104 hours in a month. s.60A(3)(a) still pays every planned hour at 1.5×; the
	// write stores the planned excess as incentive hours (`splitPlannedOvertime`), paid on the
	// INCENTIVE line at the band's own award. Fourteen January weekdays of eight hours past the
	// shift (18:00 → 02:00) are 112 h. The s.60A(7) twelve-hour day splits first: each day's eight
	// shift hours leave four within it and four incentive, so the month holds 56 and never reaches
	// 104 (owner's rule, 2026-09-23: every statutory overtime limit splits).
	const next = (date: string) =>
		new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	const { slips, warnings } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'MY-CAP', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			const employment = world.employments[0]!;
			for (let date = '2026-01-01'; date <= '2026-01-20'; date = next(date)) {
				const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
				if (weekday === 0 || weekday === 6) continue;
				world.work_days.push({
					id: `wd-${date}`,
					employment_id: employment.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [
						{ start: `${date}T09:00:00+08:00`, end: `${next(date)}T02:00:00+08:00` }
					],
					approval_id: null
				});
			}
		}
	);
	const lines = workLines(slips.get('MY-CAP')!);
	const hours = (label: string) =>
		lines.filter((row) => row[1] === label).reduce((total, row) => total + row[2]!, 0);
	assert.equal(
		lines.reduce((total, row) => total + row[2]!, 0),
		112
	);
	// The whole 112 h at 12.50 × 1.5 = 18.75: 2,100.00 on top of the month's wages.
	assert.equal(slips.get('MY-CAP')!.gross, 2600 + 112 * 18.75);
	// The lines say where the ceilings fell: 56 h as overtime, 56 h as incentive at the same rate.
	assert.equal(
		slips
			.get('MY-CAP')!
			.adjustments.filter((row) => row.statutory_rule_key?.startsWith('OVERTIME:'))
			.reduce((total, row) => total + row.quantity!, 0),
		56
	);
	assert.equal(
		slips
			.get('MY-CAP')!
			.adjustments.filter((row) => row.statutory_rule_key?.startsWith('INCENTIVE:'))
			.reduce((total, row) => total + row.quantity!, 0),
		56
	);
	assert.equal(hours('WORKDAY-OT-1.5X'), 112);
	// Paying the excess as incentive does not undo the breach: reg.4 limits the hours required, so
	// the run reports all 112 regulated hours against the 104-hour ceiling.
	assert.ok(
		warnings.some((line) => line.startsWith('OVERTIME_LIMIT_EXCEEDED') && /112/.test(line)),
		warnings.join('\n')
	);
});

test('MY-nihon — overtime past twelve hours worked is incentive at the customer’s rate', () => {
	// The eleven-hour incentive boundary is withdrawn: incentive is only overtime beyond the
	// statutory limits — here s.60A(7)'s twelve worked hours a day (`daily_total`). 09:00–22:30 is
	// 12.5 h worked, 4.5 h past the normal eight at round(2,600 × 12 ÷ (52 × 45)) = 13.33 × 1.5 =
	// 19.995: 4 h within twelve, 4 × 19.995 = 79.98; 0.5 h beyond, 0.5 × 19.995 = 9.9975 → 10.00.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [
				{ key: 'N-2600', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => punch(world, 'N-2600', '2026-01-05', '09:00', '22:30')
	);
	assert.deepEqual(
		slips
			.get('N-2600')!
			.adjustments.map((row) => [row.statutory_rule_key, row.quantity, row.amount]),
		[
			['OVERTIME:WORKDAY-OT-1.5X', 4, 79.98],
			['INCENTIVE:WORKDAY-OT-1.5X', 0.5, 10]
		]
	);
});

test('Nihon cash allowances enter the contribution bases but not the overtime hour', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [
				{ key: 'N-GROSS', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			world.employment_terms[0]!.allowances = [
				{
					catalogue_id: world.allowance_catalogue.find((row) => row.code === 'SUA')!.id,
					amount: 260
				}
			];
			punch(world, 'N-GROSS', '2026-01-05', '09:00', '22:00');
		}
	);
	const slip = slips.get('N-GROSS')!;
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'EPF')!.base_amount, 2860);
	for (const code of ['SOCSO', 'EIS', 'PCB'])
		assert.equal(slip.statutory.find((row) => row.scheme_code === code)!.base_amount, 2939.98);

	// The customer’s hour is basic only: round(2,600 ÷ 195) = 13.33, not (2,600 + 260) ÷ 26 ÷ 8.
	// Four hours past the normal eight: 4 × 13.33 × 1.5 = 79.98.
	assert.deepEqual(
		slip.adjustments.map((row) => [row.statutory_rule_key, row.quantity, row.amount]),
		[['OVERTIME:WORKDAY-OT-1.5X', 4, 79.98]]
	);
});

test('MY overtime uses the salary on the worked day across a mid-month pay rise', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'M-DATED', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-000000001234',
				base_salary: { value: 3120, currency: 'MYR' },
				effective_range: { start: '2026-01-10', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-09T23:59:59.999Z' };
			punch(world, 'M-DATED', '2026-01-05', '09:00', '20:00');
			punch(world, 'M-DATED', '2026-01-12', '09:00', '20:00');
		}
	);
	assert.deepEqual(workLines(slips.get('M-DATED')!), [
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 37.5],
		['2026-01-12', 'WORKDAY-OT-1.5X', 2, 45]
	]);
});

test('Malaysia — s.60A(3) overtime is work in excess of the normal hours, not the clock-out past the shift', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'MY-LATE', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				{ key: 'MY-LATE-LONG', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			// Two hours late, two hours past the end: eight hours worked, a normal day.
			punch(world, 'MY-LATE', '2026-01-05', '11:00', '20:00');
			// Two hours late, four past the end: ten hours worked, two beyond the normal eight.
			punch(world, 'MY-LATE-LONG', '2026-01-06', '11:00', '22:00');
		}
	);
	// s.60A(3)(a): "work carried out in excess of the normal hours of work" — 11:00–20:00 less the
	// hour of break is the eight normal hours and no more. The clock-out overrun priced the two
	// hours the person had not worked at 1.5×; the Act pays nothing.
	assert.deepEqual(workLines(slips.get('MY-LATE')!), []);
	assert.equal(slips.get('MY-LATE')!.gross, 2600);
	assert.deepEqual(workLines(slips.get('MY-LATE-LONG')!), [
		['2026-01-06', 'WORKDAY-OT-1.5X', 2, 37.5]
	]);
});

/** A rostered person: an as-assigned pattern, a 7.5-hour shift, and a work day per assigned day. */
const ROSTER_PATTERN = 'c0000000-0000-4000-8000-0000000000e2';
const SHIFT_7H30 = 'c0000000-0000-4000-8000-0000000000e1';
const rostered = (
	world: PayrollWorld,
	key: string,
	from: string,
	to: string,
	daysPerWeek: number
) => {
	world.shift_definitions.push({
		id: SHIFT_7H30,
		company_id: COMPANY_ID,
		code: 'D75',
		name: 'Day, 7.5 h',
		variant: { kind: 'WORK', start_time: '08:00', end_time: '16:30', break_minutes: 60 },
		effective_range: { start: '2000-01-01', end: null },
		approval_id: null
	});
	world.shift_patterns.push({
		id: ROSTER_PATTERN,
		company_id: COMPANY_ID,
		code: 'ROSTER',
		name: 'As assigned',
		pattern: {
			expectation: {
				days_per_week: daysPerWeek,
				minimum_paid_minutes_per_week: null,
				maximum_paid_minutes_per_week: null
			}
		},
		effective_range: { start: '2000-01-03', end: null },
		approval_id: null
	});
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	term.shift_pattern_id = ROSTER_PATTERN;
	for (let date = from; date <= to;) {
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		if (weekday !== 0 && (daysPerWeek === 6 || weekday !== 6))
			world.work_days.push({
				id: `wd-${key}-${date}`,
				employment_id: employment.id,
				work_date: date,
				shift_definition_id: SHIFT_7H30,
				worked_intervals: [{ start: `${date}T08:00:00+08:00`, end: `${date}T16:30:00+08:00` }],
				approval_id: null
			});
		date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	}
};

test('MY-nihon — a rostered person’s hour is the contract week’s, whatever the month rostered', () => {
	// NHPMY0339: RM1,700 on 7.5-hour shifts, six days a week. The customer’s hour is
	// 1,700 × 12 ÷ (52 × 45) = 8.7179… → 8.72 to the sen — not the month's rostered minutes
	// spread over its calendar, which priced the same wage at a different rate every month.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [
				{ key: 'NHPMY0339', wage: 1700, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			rostered(world, 'NHPMY0339', '2025-12-01', '2026-01-31', 6);
			// Monday 5 January to 18:30: 9.5 h worked, two beyond the 7.5-hour normal day.
			world.work_days.find((row) => row.id === 'wd-NHPMY0339-2026-01-05')!.worked_intervals = [
				{ start: '2026-01-05T08:00:00+08:00', end: '2026-01-05T18:30:00+08:00' }
			];
		}
	);
	// 2 × 8.72 × 1.5 = 26.16.
	assert.deepEqual(workLines(slips.get('NHPMY0339')!), [
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 26.16]
	]);
	assert.equal(slips.get('NHPMY0339')!.gross, 1726.16);
});

test('MY-nihon — a deferred rostered joiner is paid their arrears without a roster in the deferred window', () => {
	// Joined on 22 January, after the January run's window closed on the 20th: January is deferred
	// and paid as arrears by the February run, measured over January's own attendance window (21
	// December to 20 January) — where a joiner on the 22nd has no rostered day at all. That zero
	// workload used to derive an infinite ordinary hour and refuse the run at the rounding step; the
	// rate falls back to a neutral week and the arrears is January's calendar-day share, s.18A:
	// 1,700 × 10 ÷ 31 = 548.39, beside February's whole 1,700.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-02',
			people: [
				{
					key: 'NHPMY-JOINER',
					wage: 1700,
					hire_date: '2026-01-22',
					citizenship: 'CITIZEN',
					registrations: REGISTERED_LOCAL
				}
			]
		},
		(world) => rostered(world, 'NHPMY-JOINER', '2026-01-22', '2026-02-28', 6)
	);
	const slip = slips.get('NHPMY-JOINER')!;
	assert.deepEqual(
		slip.base.map((row) => [row.component_code, row.amount]),
		[
			['BASIC', 548.39],
			['BASIC', 1700]
		]
	);
	assert.equal(slip.gross, 2248.39);
});

test('Malaysia — HRD Corp counts Malaysian employees alone, and zakat is set off against the MTD', () => {
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{
				key: 'MY-ZAKAT',
				wage: 25_000,
				citizenship: 'CITIZEN',
				registrations: { ...MY_LOCAL, PCB: { kind: 'REGISTERED', elections: { zakat: 100 } } }
			},
			{ key: 'MY-CITIZEN', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			...Array.from({ length: 9 }, (_, index) => ({
				key: `MY-FW-${index}`,
				wage: 2000,
				citizenship: 'FOREIGNER' as const,
				registrations: {
					EPF: OUT,
					EPF_PR: OUT,
					EIS: OUT,
					PCB: OUT,
					SOCSO: OUT,
					SKBBK: OUT,
					HRDF: OUT
				}
			}))
		]
	});
	// Eleven on the books, two of them Malaysian: PSMB Act 2001 s.13 and the Registration Order
	// count Malaysian employees, so the employer is under the five-employee threshold and no levy
	// is due — where the whole headcount would have read the compulsory 1% band.
	expectStatutory(book, 'MY-CITIZEN', 'HRDF', 0, 0);
	// r.3(3A): the RM100 zakat paid through the employer comes off the month's MTD, 4,678.30 −
	// 100 = 4,578.30.
	expectStatutory(book, 'MY-ZAKAT', 'PCB', 4578.3, 0);
});

test('Malaysia — the normal day is at most nine hours under the s.60A(1) proviso, and a daily-rated rest day pays one or two days’ wages (s.60(3)(a))', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'MY-TEN', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				// RM100 a day, daily-rated: rest-day work pays whole days, not the monthly halves.
				{
					key: 'MY-DAILY',
					wage: 100,
					pay_frequency: 'DAILY',
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR',
					registrations: REGISTERED_LOCAL
				}
			]
		},
		(world) => {
			// A ten-hour shift (09:00–20:00 with an hour's break) on the five-day week: the contract
			// agrees a 50-hour week, so the proviso's nine-hour day does not apply and the normal
			// day is eight — two hours of every shift are overtime.
			world.shift_definitions[0]!.variant = {
				kind: 'WORK',
				start_time: '09:00',
				end_time: '20:00',
				break_minutes: 60
			};
			punch(world, 'MY-TEN', '2026-01-05', '09:00', '20:00');
			punch(world, 'MY-DAILY', '2026-01-04', '09:00', '13:00'); // Sunday rest day, four hours
			punch(world, 'MY-DAILY', '2026-01-11', '09:00', '16:00'); // Sunday rest day, seven hours
			// s.60I(1C): a daily rate is priced from the preceding complete wage period — 2,600 over
			// 26 qualifying days is the contract's 100 a day.
			const daily = world.employments.find((row) => row.employee_number === 'MY-DAILY')!;
			world.employment_wage_periods ??= [];
			world.employment_wage_periods.push({
				id: 'b9000000-0000-4000-8000-0000000000d1',
				employment_id: daily.id,
				period: { start: '2025-12-01T00:00:00.000Z', end: '2025-12-31T00:00:00.000Z' },
				normal_wages: null,
				ordinary_wages: { currency: 'MYR', value: 2600 },
				ordinary_days: 26,
				due_on: '2026-01-07',
				paid_on: null,
				reference: 'SYNTHETIC 2025-12',
				approval_id: null
			} as never);
		}
	);
	// 2,600 ÷ 26 = 100.00 a day; the hourly rate is the day over the *normal hours of work*
	// (s.60I(1)(b)), which s.60A(3)(c) caps at the s.60A(1) eight — 12.50, not the ten-hour
	// shift's 10.00: two hours at 1.5× = 37.50.
	assert.deepEqual(workLines(slips.get('MY-TEN')!), [['2026-01-05', 'WORKDAY-OT-1.5X', 2, 37.5]]);
	// s.60(3)(a): a daily-rated employee's rest-day work pays one day's wages up to half the
	// normal hours and two days' wages beyond — 100 and 200 — where a monthly-rated one gets half
	// and one.
	assert.deepEqual(workLines(slips.get('MY-DAILY')!), [
		['2026-01-04', 'RESTDAY-ONE-DAY-PAY', 4, 100],
		['2026-01-11', 'RESTDAY-TWO-DAYS-PAY', 7, 200]
	]);
});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — SKBBK Second and Third Phases follow Act A1788 Third Schedule Parts II and III`, () => {
		// P.U. (B) 196/2026: Second Phase 1 June 2028 – 31 May 2031, Third Phase from 1 June 2031.
		// Act A1788 s.17, Third Schedule column (4)(B) "Non-employment injury", employee only:
		// row 36 (RM3,500–3,600): Part II RM35.50 (1.00% × 3,550), Part III RM44.40 (1.25% × 3,550 =
		// 44.375, printed 44.40); rows 64–65 (RM5,900 and above, the RM6,000 ceiling): RM59.50 and RM74.40.
		const people = [
			{ key: 'W-3550', wage: 3550, citizenship: 'CITIZEN' },
			{ key: 'W-7000', wage: 7000, citizenship: 'CITIZEN' }
		];
		const second = assessStatutory({ code, period: '2028-07', people });
		expectStatutory(second, 'W-3550', 'SKBBK', 35.5, 0);
		expectStatutory(second, 'W-7000', 'SKBBK', 59.5, 0);
		const third = assessStatutory({ code, period: '2031-07', people });
		expectStatutory(third, 'W-3550', 'SKBBK', 44.4, 0);
		expectStatutory(third, 'W-7000', 'SKBBK', 74.4, 0);
		// The last First Phase month stays at Part I: row 36 RM26.65 (0.75% × 3,550 = 26.625).
		expectStatutory(
			assessStatutory({ code, period: '2028-05', people }),
			'W-3550',
			'SKBBK',
			26.65,
			0
		);
	});

test('every sealed version of `MY` and `MY-nihon` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('MY');
	assertEveryVersionPriced('MY-nihon');
});

test('Malaysia — a mid-year joiner’s PCB reads the previous employer’s TP3 as the year’s opening', () => {
	// MTD Specification 2026: a joiner declares on Form TP3 the year's accumulated remuneration
	// (Y), EPF (K) and PCB (X) already paid by the earlier employer. The fact's `opening` carries
	// them as the year to date this employer starts from, so June annualises the whole year:
	// 25,005 already earned + 5,001 × (1 + 6 remaining) = 60,012 — the same as a January
	// full-year MY-5001 — less the 549.50 already withheld, spread over the 7 payslips left.
	// EPF relief: 2,805 declared + 561 this month, projected to the RM4,000 cap. SOCSO, EIS and
	// (from June) SKBBK share the RM350 cap and are not projected: 126.25 + 50.50 declared plus
	// 25.25 + 10.10 + 37.85 this month = 249.95.
	// Chargeable = 60,012 − 4,000 − 249.95 − 9,000 = 46,762.05 → 600 + 11,762.05 × 6% =
	// 1,305.723; − 549.50 = 756.223; ÷ 7 = 108.032 → 108.03 → 108.05.
	const tp3 = (base: number, employee: number, employer: number, months?: number) => ({
		kind: 'REGISTERED',
		opening: [
			{
				year: '2026',
				base,
				employee,
				employer,
				...(months == null ? {} : { months }),
				reference: 'TP3'
			}
		]
	});
	const book = assessStatutory({
		code: 'MY',
		period: '2026-06',
		people: [
			{
				key: 'MY-TP3',
				wage: 5001,
				hire_date: '2026-06-01',
				citizenship: 'CITIZEN',
				registrations: {
					...MY_LOCAL,
					PCB: tp3(25_005, 549.5, 0, 5),
					EPF: tp3(25_005, 2805, 3255),
					SOCSO: tp3(25_005, 126.25, 441.75),
					EIS: tp3(25_005, 50.5, 50.5)
				}
			},
			// The same joiner with nothing declared: the engine sees June as the first month.
			{
				key: 'MY-FRESH',
				wage: 5001,
				hire_date: '2026-06-01',
				citizenship: 'CITIZEN',
				registrations: MY_LOCAL
			}
		]
	});
	expectStatutory(book, 'MY-TP3', 'PCB', 108.05, 0);
	// Fresh: 5,001 × 7 = 35,007 annualised; EPF 561 × 7 = 3,927; the 350 pool; personal 9,000 →
	// 21,730 in the 20,000–35,000 band: −650 + 1,730 × 3% = −598.10 → nothing withheld.
	expectStatutory(book, 'MY-FRESH', 'PCB', 0, 0);
});

test('Malaysia — a paid CP38 instalment does not reduce the following month’s normal PCB', () => {
	// LHDN MTD 2026 section D, definition of X (p.11): accumulated MTD excludes
	// tax instalments. January's RM1,000 CP38 is retained separately on its payslip.
	const people = [{ key: 'MY-CP38', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL }];
	const january = buildStatutory({ code: 'MY', period: '2026-01', people }, (world) => {
		const pcbIds = new Set(
			world.statutory_contributions.filter((row) => row.code === 'PCB').map((row) => row.id)
		);
		for (const fact of world.employment_statutory_facts)
			if (pcbIds.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
				fact.status = {
					...fact.status,
					instalments: [{ amount: 1000, from: '2026-01', to: '2026-01', reference: 'CP38-TEST' }]
				};
	});
	const prior = january.slips.get('MY-CP38')!;
	const januaryTax = prior.statutory.find((row) => row.scheme_code === 'PCB')!;
	assert.equal(januaryTax.employee_amount, 1109.9);
	assert.equal(januaryTax.directed_amount, 1000);
	const february = assessStatutory({ code: 'MY', period: '2026-02', people }, (world) => {
		world.payroll_runs.push({ id: 'paid-january', company_id: COMPANY_ID, period: '2026-01' });
		world.payslips.push({
			...prior,
			id: 'cp38-january-slip',
			payroll_run_id: 'paid-january',
			status: 'PAID',
			paid_at: '2026-01-31'
		});
	});
	// P = 60,012 − 4,000 − (35.35 × 2) − 9,000 = 46,941.30.
	// Tax = 600 + 11,941.30 × 6% = 1,316.478; (tax − 109.90) / 11 → 109.70.
	expectStatutory(february, 'MY-CP38', 'PCB', 109.7, 0);
});

test('Malaysia — paid zakat remains in the next month’s accumulated rebate', () => {
	const people = [
		{
			key: 'MY-ZAKAT-HISTORY',
			wage: 5001,
			citizenship: 'CITIZEN',
			registrations: { ...MY_LOCAL, PCB: { kind: 'REGISTERED', elections: { zakat: 100 } } }
		}
	];
	const january = buildStatutory({ code: 'MY', period: '2026-01', people });
	const prior = january.slips.get('MY-ZAKAT-HISTORY')!;
	assert.equal(prior.statutory.find((row) => row.scheme_code === 'PCB')!.employee_amount, 9.9);
	assert.equal(prior.statutory.find((row) => row.scheme_code === 'PCB')!.rebate_amount, 100);
	const february = assessStatutory({ code: 'MY', period: '2026-02', people }, (world) => {
		world.payroll_runs.push({ id: 'zakat-january', company_id: COMPANY_ID, period: '2026-01' });
		world.payslips.push({
			...prior,
			id: 'zakat-paid',
			payroll_run_id: 'zakat-january',
			status: 'PAID',
			paid_at: '2026-01-31'
		});
	});
	// LHDN 2026 D(1): annual tax 1,316.478 less January MTD 9.90 and zakat 100,
	// divided by 11 gives 109.6889... -> 109.70. February zakat 100 leaves 9.70.
	expectStatutory(february, 'MY-ZAKAT-HISTORY', 'PCB', 9.7, 0);
});

test('Malaysia — excess zakat is retained in full and TP3 can declare prior-employer rebates', () => {
	const january = buildStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{
				key: 'MY-ZAKAT-EXCESS',
				wage: 5001,
				citizenship: 'CITIZEN',
				registrations: { ...MY_LOCAL, PCB: { kind: 'REGISTERED', elections: { zakat: 1000 } } }
			}
		]
	});
	const prior = january.slips.get('MY-ZAKAT-EXCESS')!;
	const tax = prior.statutory.find((row) => row.scheme_code === 'PCB')!;
	assert.equal(tax.employee_amount, 0);
	assert.equal(tax.rebate_amount, 1000, 'retain the payment, not just the offset against tax');
	const february = assessStatutory(
		{
			code: 'MY',
			period: '2026-02',
			people: [
				{
					key: 'MY-ZAKAT-EXCESS',
					wage: 5001,
					citizenship: 'CITIZEN',
					registrations: MY_LOCAL
				}
			]
		},
		(world) => {
			world.payroll_runs.push({ id: 'excess-january', company_id: COMPANY_ID, period: '2026-01' });
			world.payslips.push({
				...prior,
				id: 'excess-paid',
				payroll_run_id: 'excess-january',
				status: 'PAID',
				paid_at: '2026-01-31'
			});
		}
	);
	// (1,316.478 annual tax − 1,000 January zakat − 0 prior MTD) / 11 → 28.80.
	expectStatutory(february, 'MY-ZAKAT-EXCESS', 'PCB', 28.8, 0);
	const opening = (base: number, employee: number, rebate = 0) => ({
		kind: 'REGISTERED',
		opening: [{ year: '2026', base, employee, employer: 0, rebate, months: 1, reference: 'TP3' }]
	});
	const joiner = assessStatutory({
		code: 'MY',
		period: '2026-02',
		people: [
			{
				key: 'MY-ZAKAT-TP3',
				wage: 5001,
				citizenship: 'CITIZEN',
				hire_date: '2026-02-01',
				registrations: {
					...MY_LOCAL,
					PCB: opening(5001, 0, 1000),
					EPF: opening(5001, 561),
					SOCSO: opening(5001, 25.25),
					EIS: opening(5001, 10.1)
				}
			}
		]
	});
	expectStatutory(joiner, 'MY-ZAKAT-TP3', 'PCB', 28.8, 0);
});

test('Malaysia — EPF stops at seventy-five for citizen and foreigner alike (First Schedule para 13)', () => {
	// EPF Act 1991 First Schedule para (13): a person who has attained seventy-five is not an
	// employee for the Act; s.51(2B)(a) credits nothing after seventy-five. Act A1760's Part F
	// prints no age because the exclusion lives in the First Schedule. SOCSO and EIS have their own
	// ages and are unaffected here.
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{ key: 'MY-74', wage: 5001, age: 74, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{ key: 'MY-75', wage: 5001, age: 75, citizenship: 'CITIZEN', registrations: MY_LOCAL },
			{ key: 'MY-F75', wage: 5001, age: 75, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
		]
	});
	// Part E (over 60, citizen): 5,001 → employee 0, employer 4% = 200.04 → 201 (Part E rounds up).
	assert.notEqual(book.get('MY-74')!.get('EPF')!.employer, 0);
	assert.equal(book.get('MY-75')!.get('EPF'), undefined);
	assert.equal(book.get('MY-F75')!.get('EPF_NON_CITIZEN'), undefined);
});

test('Malaysia — a non-citizen is Part F whatever the registration says (EPF Act Third Schedule)', () => {
	// A forty-year-old foreigner whose facts carry an EPF registration — a legacy election, a
	// wrong fact — is still no Part A member: the Third Schedule's Part A is citizens and
	// permanent residents, and a non-citizen's contribution is Part F's 2% (from October 2025).
	const book = assessStatutory({
		code: 'MY',
		period: '2026-01',
		people: [
			{
				key: 'MY-F40',
				wage: 3000,
				age: 40,
				citizenship: 'FOREIGNER',
				// The declarations an EPF/EIS-registered non-citizen must carry (round 5, D15).
				registrations: {
					EPF: { kind: 'REGISTERED', elections: { member_before_1998: false } },
					EIS: { kind: 'REGISTERED', elections: { mykas_resident: false } }
				}
			}
		]
	});
	assert.equal(book.get('MY-F40')!.get('EPF'), undefined);
	expectStatutory(book, 'MY-F40', 'EPF_NON_CITIZEN', 60, 60);
});

test('Malaysia — the termination benefit counts a part year to the nearest month (Termination and Lay-Off Benefits Regulations 1980 reg. 6(1))', () => {
	// Hired 15 May 2023, made redundant on 31 January 2026 at RM3,000: 993 days of service is
	// 32.6 months, the nearest month 33 — two years and nine months, inside the fifteen-day tier
	// (two years or more, under five). A day's wages is twelve months' wages ÷ 365 (JTKSM's
	// published reg. 6 formula): 3,000 × 12 ÷ 365 = 98.6301; 15 × 33/12 × 98.6301 = 4,068.49.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{
					key: 'MY-REDUNDANT',
					wage: 3000,
					citizenship: 'CITIZEN',
					registrations: MY_LOCAL,
					hire_date: '2023-05-15',
					exit_date: '2026-01-31',
					exit_reason: 'REDUNDANCY'
				}
			]
		},
		(world) => {
			const benefit = world.adhoc_catalogue!.find(
				(row) =>
					row.code === 'TERMINATION_BENEFIT' &&
					row.settings_id ===
						settingsVersions('MY').find((v) =>
							String(v.effective_range.start).startsWith('2025-12')
						)!.id
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'MY-REDUNDANT')!;
			// reg.6(2) reads the wages paid: twelve earlier payslips at the RM3,000 wage.
			priorWages(world, 'MY-REDUNDANT', monthsAt('2025-01', '2025-12', 3000));
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-00000000ad21',
				employment_id: employment.id,
				catalogue_id: benefit.id,
				amount: 0,
				event_date: '2026-01-31',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'termination benefit',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('MY-REDUNDANT')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'TERMINATION_BENEFIT')?.amount,
		4068.49
	);
});

test('Malaysia — the 45-hour week pays nothing from the clock; its excess is paid only where it was planned (s.60A(1)(d))', () => {
	// A six-day, 8-hour pattern is a 48-hour week: three hours beyond s.60A(1)(d) every week. Since
	// overtime is planned (owner's rule, 2026-09-23), the weekly limit derives no pay: SIX8-SAT
	// clocks Saturday and plans nothing, so nothing is paid; SIX8-PLAN plans the three hours on its
	// Saturday — 3 × 12.50 × 1.5 = 56.25 (the 44-hour rate week: 2,600 ÷ 26 ÷ 8 = 12.50).
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'SIX8-SAT', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL },
				{ key: 'SIX8-PLAN', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			const pattern = world.shift_patterns[0]!;
			const [monday, , , , , , sunday] = pattern.pattern.days;
			pattern.pattern = { days: [monday!, monday!, monday!, monday!, monday!, monday!, sunday!] };
			punch(world, 'SIX8-SAT', '2026-01-10', '09:00', '18:00');
			punch(world, 'SIX8-PLAN', '2026-01-10', '09:00', '18:00');
			world.work_days.at(-1)!.approved_overtime_hours = 3;
		}
	);
	assert.deepEqual(workLines(slips.get('SIX8-SAT')!), []);
	assert.deepEqual(workLines(slips.get('SIX8-PLAN')!), [
		['2026-01-10', 'WORKDAY-OT-1.5X', 3, 56.25]
	]);
});

test('Malaysia — a part-timer’s hours beyond their own day up to a full-timer’s eight are the hourly rate, beyond that 1.5× (Part-Time Employees Regulations 2010 reg. 5)', () => {
	// Contracted 09:00–13:00 five days (twenty hours) at RM1,040: the day is 1,040 ÷ 26 = 40.00
	// and the hour is the day over the contract's four — 10.00. A ten-hour Monday (09:00–19:00,
	// no break): four hours up to the full-timer's eight at 1.0× = 40.00, two beyond at 1.5× =
	// 30.00.
	const SHORT_ID = 'c0000000-0000-4000-8000-0000000000f2';
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{
					key: 'MY-PT',
					wage: 1040,
					citizenship: 'CITIZEN',
					employment_type: 'PART_TIME',
					statutory_work_category: 'MANUAL_LABOUR',
					registrations: REGISTERED_LOCAL
				}
			]
		},
		(world) => {
			world.shift_definitions.push({
				...world.shift_definitions[0]!,
				id: SHORT_ID,
				code: 'HALF',
				name: 'Half day',
				variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 }
			});
			const pattern = world.shift_patterns[0]!;
			pattern.pattern.days = pattern.pattern.days.map((day: { roster_code_id: string }) =>
				day.roster_code_id === world.shift_definitions[0]!.id ? { roster_code_id: SHORT_ID } : day
			);
			punch(world, 'MY-PT', '2026-01-05', '09:00', '19:00');
		}
	);
	assert.deepEqual(workLines(slips.get('MY-PT')!), [
		['2026-01-05', 'PT-1.0X', 4, 40],
		['2026-01-05', 'PT-1.5X', 2, 30]
	]);
});

test('MY-nihon — a roster that mixes 7.5-hour and 9-hour shifts owes no overtime on a 9-hour shift worked whole (s.60A(1) proviso)', () => {
	// Rostered six 7.5-hour days a week through 18 January, then five 9-hour days a week on a
	// five-day pattern: both are 45-hour weeks inside the proviso, so a 9-hour shift is its own
	// normal day. The roster's
	// average day (8.2 h) is nobody's normal hours: it priced 0.8 h of overtime on every 9-hour
	// shift. The hourly rate stays the shift over the agreed week — 1,700 ÷ 26 over the rostered
	// average day; only the overtime threshold moves. Clocked whole on 19 January: no line.
	// Clocked to 19:30 on the 20th: one hour beyond the nine.
	const NINE = 'c0000000-0000-4000-8000-0000000000e1';
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [
				{ key: 'NHPMY0357', wage: 1700, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
			]
		},
		(world) => {
			rostered(world, 'NHPMY0357', '2025-12-01', '2026-01-18', 6);
			// The terms in force declare the five-day week the 9-hour shifts run on.
			world.shift_patterns.find((row) => row.id === ROSTER_PATTERN)!.pattern = {
				expectation: {
					days_per_week: 5,
					minimum_paid_minutes_per_week: null,
					maximum_paid_minutes_per_week: null
				}
			};
			world.shift_definitions.push({
				...world.shift_definitions.find((row) => row.id === SHIFT_7H30)!,
				id: NINE,
				code: 'AM0830',
				name: 'Day, 9 h',
				variant: { kind: 'WORK', start_time: '08:30', end_time: '18:30', break_minutes: 60 }
			});
			const employment = world.employments.find((row) => row.employee_number === 'NHPMY0357')!;
			for (const day of ['19', '20', '21', '22', '23', '26', '27', '28', '29', '30'])
				world.work_days.push({
					id: `wd-NHPMY0357-2026-01-${day}`,
					employment_id: employment.id,
					work_date: `2026-01-${day}`,
					shift_definition_id: NINE,
					worked_intervals: null,
					approval_id: null
				});
			world.work_days.find((row) => row.id === 'wd-NHPMY0357-2026-01-19')!.worked_intervals = [
				{ start: '2026-01-19T08:30:00+08:00', end: '2026-01-19T18:30:00+08:00' }
			];
			world.work_days.find((row) => row.id === 'wd-NHPMY0357-2026-01-20')!.worked_intervals = [
				{ start: '2026-01-20T08:30:00+08:00', end: '2026-01-20T19:30:00+08:00' }
			];
		}
	);
	const lines = workLines(slips.get('NHPMY0357')!);
	assert.deepEqual(
		lines.map((line) => [line[0], line[1], line[2]]),
		[['2026-01-20', 'WORKDAY-OT-1.5X', 1]]
	);
});
