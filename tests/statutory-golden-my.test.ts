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
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	expectStatutoryBase,
	assertEveryVersionPriced,
	chargeOf,
	type BuiltPayslip,
	settingsVersions,
	settingsIdOn,
	contributionSchemes,
	leaveCatalogue,
	rowIn
} from './fixtures/statutory-world.ts';
import { resolveWindow } from '../src/lib/payroll/run/period.ts';
import {
	applicableLimits,
	observedDays,
	observedPlan,
	splitPlannedOvertime
} from '../src/lib/scheduling/work-limits.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
/** A Malaysian citizen or PR: Part A / C / E, never the Part F non-citizen scheme. */
const MY_LOCAL = { EPF_NON_CITIZEN: OUT };
/** A non-citizen: Part F only. */
const MY_FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

for (const version of settingsVersions('MY')) {
	const period = String(version.effective_range.start).slice(0, 7);
	for (const [citizenship, age, scheme, employee, normalEmployer, bonusEmployer] of [
		['CITIZEN', 40, 'EPF', 704, 768, 825],
		['PERMANENT_RESIDENT', 60, 'EPF_PR', 352, 384, 413],
		['FOREIGNER', 40, 'EPF', 704, 768, 825],
		['FOREIGNER', 60, 'EPF_PR', 352, 384, 413]
	] as const)
		for (const [label, payments, employer] of [
			['non-bonus', [['ADJ', 1346.15]], normalEmployer],
			['bonus', [['BONUS', 1346.15]], bonusEmployer],
			[
				'non-bonus wages already above 5000',
				[
					['ADJ', 200],
					['BONUS', 1146.15]
				],
				normalEmployer
			]
		] as const)
			test(`MY ${period} ${citizenship} ${scheme} — EPF bonus exception: ${label}`, () => {
				const book = assessStatutory(
					{
						code: 'MY',
						period,
						people: [
							{
								key: 'W',
								wage: 5000,
								citizenship,
								age,
								registrations:
									citizenship === 'FOREIGNER'
										? {
												...MY_LOCAL,
												EIS: OUT,
												EPF: { kind: 'REGISTERED', elections: { member_before_1998: true } }
											}
										: MY_LOCAL
							}
						]
					},
					(world) => {
						for (const [code, amount] of payments)
							world.adhoc_requests!.push({
								id: `d0000000-0000-4000-8000-${code === 'ADJ' ? '000000000001' : '000000000002'}`,
								employment_id: world.employments[0]!.id,
								catalogue_id: rowIn(world.adhoc_catalogue!, version.id, code),
								amount,
								event_date: `${period}-15`,
								pay_period: null,
								payslip_id: null,
								reason: label,
								evidence_file: null,
								as_adjustment_entry: false,
								approval_id: null
							});
					}
				);
				// Third Schedule Part A, p.13: 6300.01–6400 yields employee 704 / employer 768.
				// The bonus-only note on p.12 instead yields ceil(704 + 6346.15 × 13%) − 704 = 825.
				// Part C, pp.30–31: the corresponding shares are 352 / 384, or
				// ceil(352 + 6346.15 × 6.5%) − 352 = 413 with the bonus exception.
				expectStatutoryBase(book, 'W', scheme, 6346.15);
				expectStatutory(book, 'W', scheme, employee, employer);
			});
}

for (const code of ['MY'] as const)
	test(`${code} — child relief uses the tax-year declaration and full or half entitlement`, () => {
		// LHDN MTD 2026: annual income 60,012 less EPF 3,999.93 (K2 312.63) and personal relief
		// 9,000 gives P=47,012.07 (no TP1, so no SOCSO/EIS relief: D.2(ii) item k). In this band
		// each RM1,000 child relief reduces monthly MTD by RM5, subject to the published rounding.
		const cases = [
			{ key: 'NO-CLAIM', claims: [], expected: 110.1 },
			{ key: 'FULL', category: 'UNDER_18', full: 1, half: 0, expected: 100.1 },
			{ key: 'HALF', category: 'UNDER_18', full: 0, half: 1, expected: 105.1 },
			// ITA 1967 s.48(4): each shared claimant gets fifty per cent, so two halves = one whole.
			{ key: 'TWO-HALVES', category: 'UNDER_18', full: 0, half: 2, expected: 100.1 },
			{ key: 'MIXED', category: 'UNDER_18', full: 1, half: 1, expected: 95.1 },
			{ key: 'STUDYING', category: 'STUDYING', full: 1, half: 0, expected: 100.1 },
			{ key: 'TERTIARY', category: 'TERTIARY', full: 0, half: 1, expected: 90.1 },
			{ key: 'DISABLED', category: 'DISABLED', full: 0, half: 1, expected: 90.1 },
			{ key: 'DISABLED-TERTIARY', category: 'DISABLED_TERTIARY', full: 0, half: 1, expected: 70.1 },
			{
				key: 'PREVIOUS-YEAR',
				category: 'UNDER_18',
				full: 1,
				half: 0,
				year: '2025',
				expected: 110.1
			},
			{ key: 'NEXT-YEAR', category: 'UNDER_18', full: 1, half: 0, year: '2027', expected: 110.1 }
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

for (const code of ['MY'] as const)
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
		// D(a) states the unknown case, so it is priced, not refused: 30% × 5,001 = 1,500.30. The
		// run names the employee whose residence is unrecorded; an explicit NON_RESIDENT, a known
		// status, is priced the same and warns nothing.
		const unknownNote = (tax_residency: string | null) =>
			buildStatutory({
				code,
				period: '2026-01',
				people: [
					{
						key: 'MY-RES',
						wage: 5001,
						citizenship: 'CITIZEN',
						tax_residency,
						registrations: MY_LOCAL
					}
				]
			}).warnings.filter((line) => line.includes('PCB: tax residence is not recorded'));
		assert.deepEqual(
			unknownNote(null).map((line) => line.startsWith('CONTRIBUTION_RULE_WARNING: MY-RES: PCB:')),
			[true]
		);
		assert.deepEqual(unknownNote('NON_RESIDENT'), []);
		assert.deepEqual(unknownNote('RESIDENT'), []);
	});

test('Malaysia — a bonus month withholds the additional remuneration’s whole tax difference (MTD spec 2026, additional remuneration)', () => {
	// MY-5001 with a 12,000 bonus (the non-fixed ADJ row) in January. The spec projects the year
	// on the NORMAL remuneration alone — 5,001 × 12 = 60,012 — and takes the bonus's tax in full
	// in the month, where annualising the whole 17,001 would have taxed a 204,012 year.
	//
	// Reliefs this month: EPF K1 561 on the normal 5,001; on the bracketed 17,100 = 1,881, Kt = 1,320;
	// personal 9,000. No TP1, so no SOCSO/EIS relief (MTD spec 2026 D.2(ii) item k).
	// Step 1: K2 = (4,000 − 561)/11 = 312.63; P = 4,440 + 4,688.37 × 11 − 9,000 = 47,012.07 →
	// 600 + 6% × 12,012.07 = 1,320.7242 / 12 = 110.06 → 110.10; the year's normal tax 1,321.20.
	// Steps 2–4: K2 = (4,000 − 1,881)/11 = 192.63; P = 4,440 + 4,808.37 × 11 + 10,680 − 9,000 =
	// 59,012.07 → 1,500 + 11% × 9,012.07 = 2,491.32; 2,491.32 − 1,321.20 = 1,170.12 → 1,170.15.
	// Step 5: 110.10 + 1,170.15 = 1,280.25.
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
	expectStatutory(book, 'MY-BONUS', 'PCB', 1280.25, 0);
	assert.equal(book.get('MY-BONUS')!.get('PCB')!.base, 17_001);
});

// LHDN MTD Specification 2026 D.2 Steps 1–5 and E(1): K2 is truncated to the sen, so a full-year
// EPF projection is K1 + Kt + K2 × 11 = 3,999.93, not the RM4,000 cap (the spec's own example:
// "Total EPF = RM3,999.93 ≤ RM4,000.00"). Wage 7,777.77: EPF K1 = 11% × 7,800 = 858; no SOCSO/EIS
// relief without TP1 (D.2(ii) item k); personal 9,000; band M=70,000 R=19% B=3,700.
// Step 1: K2 = (4,000 − 858)/11 = 285.63; P = 6,919.77 + 7,492.14 × 11 − 9,000 = 80,333.31;
// MTD = (10,333.31 × 19% + 3,700)/12 = 471.94 → 471.95; the year's normal tax 471.95 × 12 = 5,663.40.
// Bonus 10,000: wage 17,777.77 → EPF 11% × 17,800 = 1,958, Kt = 1,100; K2 = 2,042/11 = 185.63;
//   P = 6,919.77 + 7,592.14 × 11 + 8,900 − 9,000 = 90,333.31; tax 7,563.32; 1,899.92 → 1,899.95;
//   PCB 471.95 + 1,899.95 = 2,371.90.
// Bonus 10,005.50: same EPF; P = 90,338.81; tax 7,564.37; 1,900.97 → 1,901.00; PCB 2,372.95.
// Bonus 3,000: wage 10,777.77 → EPF 1,188, Kt = 330; K2 = 2,812/11 = 255.63;
//   P = 6,919.77 + 7,522.14 × 11 + 2,670 − 9,000 = 83,333.31; tax 6,233.32; 569.92 → 569.95;
//   PCB 1,041.90.
// Relieving the untruncated cap instead lowered P by 0.07 and each PCB by 5 sen.
for (const code of ['MY'] as const)
	for (const [bonus, expected] of [
		[10_000, 2371.9],
		[10_005.5, 2372.95],
		[3_000, 1041.9]
	] as const)
		test(`${code} — a bonus month's EPF projection truncates K2 to the sen (MTD spec 2026 E(1)), bonus ${bonus}`, () => {
			const settingsId = settingsIdOn(code, '2026-01-15');
			const book = assessStatutory(
				{
					code,
					period: '2026-01',
					people: [{ key: 'RES', wage: 7777.77, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
				},
				(world) => {
					world.adhoc_requests!.push({
						id: 'd0000000-0000-4000-8000-0000000b0e2a',
						employment_id: world.employments[0]!.id,
						catalogue_id: rowIn(world.adhoc_catalogue!, settingsId, 'BONUS'),
						amount: bonus,
						event_date: '2026-01-15',
						pay_period: '2026-01',
						payslip_id: null,
						reason: 'bonus',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			);
			expectStatutory(book, 'RES', 'PCB', expected, 0);
		});

// MY-MM-01. LHDN MTD Specification 2026 D.2(i): the only compulsory (automatic) relief of a single
// employee is (a) the individual RM9,000; SOCSO/EIS is optional relief item k (RM350), claimed
// "by submitting Form TP1" (D.2(ii); Form TP1 (2026) item C14; ITA 1967 s.46(1)(n)). The
// specification's own worked examples carry LP1 = 0 on a RM5,500 wage. A resident single citizen,
// no TP1, January 2026 (n = 11), K2 truncated per E(1):
// (a) 5,000: EPF 11% × 5,000 = 550; K2 = (4,000 − 550)/11 = 313.63; P = 4,450 + 4,686.37 × 11 −
//     9,000 = 47,000.07; tax 600 + 12,000.07 × 6% = 1,320.0042; ÷ 12 = 110.00.
// (b) 8,000: EPF 880; K2 = 3,120/11 = 283.63; P = 7,120 + 7,716.37 × 11 − 9,000 = 83,000.07;
//     tax 3,700 + 13,000.07 × 19% = 6,170.0133; ÷ 12 = 514.16 → 514.20.
// (c) 5,000 + 10,000 bonus: Step 1 as (a), 110.00, the year's normal tax 1,320.00. EPF on 15,000 =
//     1,650, Kt = 1,100; K2 = (4,000 − 1,650)/11 = 213.63; P = 4,450 + 4,786.37 × 11 + 8,900 − 9,000
//     = 57,000.07; tax 1,500 + 7,000.07 × 11% = 2,270.00; Step 4 950.00; PCB 110 + 950 = 1,060.00.
// A TP1 SOCSO/EIS claim of RM34.65 (item k, within RM350) is what brings the relief back: on (a)
// P = 46,965.42, tax 1,317.9252, ÷ 12 = 109.82 → 109.85.
for (const code of ['MY'] as const)
	test(`${code} — SOCSO/EIS relieve PCB only through a TP1 claim (MTD spec 2026 D.2(ii) item k)`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const tp1 = {
			...MY_LOCAL,
			PCB: {
				kind: 'REGISTERED',
				deduction_claims: [
					{
						period: '2026-01',
						category: 'SOCSO_EIS',
						amount: 34.65,
						source: 'EMPLOYEE',
						reference: 'TP1 C14'
					}
				]
			}
		};
		const book = assessStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{ key: 'W-5000', wage: 5000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'W-8000', wage: 8000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'W-BONUS', wage: 5000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'W-TP1', wage: 5000, citizenship: 'CITIZEN', registrations: tp1 }
				]
			},
			(world) => {
				const employment = world.employments.find((row) => row.employee_number === 'W-BONUS')!;
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-0000000a3301',
					employment_id: employment.id,
					catalogue_id: rowIn(world.adhoc_catalogue!, settingsId, 'BONUS'),
					amount: 10_000,
					event_date: '2026-01-15',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		// The contributions are still charged in full (Act 4 Third Schedule; Act 800 Second Schedule).
		expectStatutory(book, 'W-5000', 'EPF', 550, 650);
		expectStatutory(book, 'W-5000', 'SOCSO', 24.75, 86.65);
		expectStatutory(book, 'W-5000', 'EIS', 9.9, 9.9);
		expectStatutory(book, 'W-5000', 'PCB', 110, 0);
		expectStatutory(book, 'W-8000', 'PCB', 514.2, 0);
		expectStatutory(book, 'W-BONUS', 'PCB', 1060, 0);
		expectStatutory(book, 'W-TP1', 'PCB', 109.85, 0);
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
	expectStatutory(book, 'MY-UNCLASSED', 'PCB', 110.1, 0);
});

test('Malaysia — EPF, SOCSO, EIS, PCB and HRDF on the January 2026 law', () => {
	const book = assessStatutoryUnvalidated({
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
	// Act A1760 Part F para 2: the total is rounded to the next ringgit. 2 × 100.02 = 200.04 → 201;
	// employee 100.02 (2%, never rounded up), employer 201 − 100.02 = 100.98.
	expectStatutory(book, 'MY-FOREIGN', 'EPF_NON_CITIZEN', 100.02, 100.98);
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
	// 110 + 110 × 11 = 1,320 (well under the RM4,000 cap). No TP1, so no SOCSO/EIS relief.
	// Personal relief 9,000. Chargeable = 12,000 − 1,320 − 9,000 = 1,680, which is in
	// the 0%..RM5,000 band: no tax, and below the RM10 minimum in any case.
	expectStatutory(book, 'MY-1000', 'PCB', 0, 0);
	// MY-5001: annual 60,012. EPF 561 projected = 561 + trunc((4,000−561)/11) × 11 = 561 + 312.63
	// × 11 = 3,999.93 (E(1)). No TP1, so no SOCSO/EIS relief (D.2(ii) item k; SOCSO is 25.25 and
	// EIS 10.10 on the slip all the same). Personal 9,000. P = 4,440 + 4,688.37 × 11 − 9,000 =
	// 47,012.07. Category 1 band M=35,000 R=6% B=600: 600 + 12,012.07 × 6% = 1,320.7242.
	// Spread over 12 = 110.06035 → truncate to the cent 110.06 → up to the next 5 cents 110.10.
	expectStatutory(book, 'MY-5001', 'PCB', 110.1, 0);
	// MY-25000: EPF K1 2,750, K2 = trunc(1,250/11) = 113.63; no SOCSO/EIS relief without TP1.
	// P = 22,250 + 24,886.37 × 11 − 9,000 = 287,000.07. Band M=100,000 R=25% B=9,400:
	// 9,400 + 187,000.07 × 25% = 56,150.0175 → /12 = 4,679.168 → 4,679.16 → 4,679.20.
	expectStatutory(book, 'MY-25000', 'PCB', 4679.2, 0);
	// MY-60: no EPF employee share and no SOCSO/EIS employee share at 60+, so the only relief is
	// the RM9,000 personal one. Chargeable = 60,012 − 9,000 = 51,012. Band M=50,000 R=11%
	// B=1,500: 1,500 + 1,012 × 11% = 1,611.32 → /12 = 134.27666 → 134.27 → 134.30.
	expectStatutory(book, 'MY-60', 'PCB', 134.3, 0);
	// LHDN reliefs read from the employment's PCB elections. The MTD 2026 specification (updated
	// 1 January 2026, reliefs (e) and (f)) puts a disabled individual at RM7,000 and a disabled
	// spouse at RM6,000 — the YA 2023 figures of 6,000 and 5,000 had been seeded. A disabled person:
	// chargeable 47,012.07 − 7,000 = 40,012.07 → 600 + 5,012.07 × 6% = 900.7242 → /12 = 75.06 →
	// 75.10. A disabled spouse, a further RM6,000 on top of the RM4,000 spouse relief:
	// 43,012.07 − 6,000 = 37,012.07 → 600 + 2,012.07 × 6% = 720.7242 → /12 = 60.06 → 60.10. The
	// spouse control pays 90.10.
	expectStatutory(book, 'MY-DISABLED', 'PCB', 75.1, 0);
	expectStatutory(book, 'MY-SPOUSE', 'PCB', 90.1, 0);
	expectStatutory(book, 'MY-DISABLED-SPOUSE', 'PCB', 60.1, 0);

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
	// EIS never reaches a non-citizen, so no EIS charge row is produced.
	expectStatutory(book, 'MY-FOREIGN-LATE-58', 'SOCSO', 0, 63.1);
	expectStatutorySkipped(book, 'MY-FOREIGN-LATE-58', 'EIS');
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
			// and, at this one, withheld nothing at all from a household that owes 50.00 a month.
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
	// the RM4,000 cap. No TP1, so no SOCSO/EIS relief. Personal 9,000. Chargeable = 31,200 − 3,432
	// − 9,000 = 18,768. Band M=5,000 R=1% B=−400: −400 + 13,768 × 1% = −262.32 → the scale
	// gives nothing to withhold, and the RM10 monthly minimum does not create a liability.
	expectStatutory(book, 'MY-MIN', 'PCB', 0, 0);
	// MY-MARRIED: annual 60,012. EPF relief 3,999.93 (K2 312.63), no SOCSO/EIS relief without TP1,
	// personal 9,000, spouse 4,000, two children at RM2,000 = 4,000. Chargeable = 47,012.07 − 8,000
	// = 39,012.07. Category 2 shares Category 1's B from M=35,000 (only the first two bands differ):
	// 600 + 4,012.07 × 6% = 840.7242 → /12 = 70.06 → 70.10.
	expectStatutory(book, 'MY-MARRIED', 'PCB', 70.1, 0);
	// The dependent-spouse household carries the s.47 relief and the s.6D rebate and owes nothing;
	// the working-spouse household carries neither: EPF 440, K2 = trunc(3,560/11) = 323.63, P =
	// 3,560 + 3,676.37 × 11 − 9,000 = 35,000.07, past the RM35,000 rebate band: 600 + 0.07 × 6% =
	// 600.0042 → /12 = 50.00. Reading marital status alone put both on Category 2 and withheld
	// nothing from either.
	expectStatutory(book, 'MY-SPOUSE-DEPENDENT', 'PCB', 0, 0);
	expectStatutory(book, 'MY-SPOUSE-WORKING', 'PCB', 50, 0);
	assert.notEqual(
		chargeOf(book, 'MY-SPOUSE-WORKING', 'PCB').employee,
		chargeOf(book, 'MY-SPOUSE-DEPENDENT', 'PCB').employee,
		'the MTD category turns on the spouse’s income, not on being married'
	);
});

test('Malaysia — SKBBK is levied from 1 June 2026 for local and foreign workers', () => {
	const people = [
		{ key: 'MY-LOCAL', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
		{ key: 'MY-FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
	];

	// Before 1 June 2026 the scheme does not exist at all.
	const january = assessStatutory({ code: 'MY', period: '2026-01', people });
	expectStatutorySkipped(january, 'MY-LOCAL', 'SKBBK');

	// 1 June 2026: Act 4's non-employment-injury scheme opens, phase 1 at 0.75%, employee share
	// only, on SOCSO's own 65 wage rows and the same RM6,000 ceiling — charged in both categories.
	// Act A1788 Third Schedule Part I row 55 (RM5,000–5,100), column (4)(B), is 37.85 (0.75% of the
	// band reference would give 37.875, so the figure is the printed one, not a formula).
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
	// Nothing else moved across the two seams: SOCSO, EIS and EPF are unchanged.
	expectStatutory(july, 'MY-LOCAL', 'SOCSO', 25.25, 88.35);
	expectStatutory(july, 'MY-LOCAL', 'EIS', 10.1, 10.1);
	expectStatutory(july, 'MY-LOCAL', 'EPF', 561, 612);
});

for (const code of ['MY'] as const)
	test(`${code} — SKBBK cannot treat an undated not-registered status as a release`, () => {
		for (const period of ['2026-06', '2026-07']) {
			for (const citizenship of ['CITIZEN', 'FOREIGNER'] as const)
				assert.throws(
					() =>
						assessStatutory({
							code,
							period,
							people: [
								{
									key: citizenship,
									wage: 5001,
									citizenship,
									registrations: {
										...(citizenship === 'FOREIGNER' ? MY_FOREIGN : MY_LOCAL),
										SKBBK: OUT
									}
								}
							]
						}),
					/SKBBK: the recorded not-registered status cannot establish an exemption/,
					`${code} ${period} ${citizenship}`
				);
			const ordinary = assessStatutory({
				code,
				period,
				people: [
					{ key: 'LOCAL', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'FOREIGN', wage: 5001, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
				]
			});
			expectStatutory(ordinary, 'LOCAL', 'SKBBK', 37.85, 0);
			expectStatutory(ordinary, 'FOREIGN', 'SKBBK', 37.85, 0);
		}
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
	// the total 200.04 rounded to 201 (A1760 Part F para 2): employee 100.02, employer 100.98.
	expectStatutory(book, 'MY-NR', 'EPF_NON_CITIZEN', 100.02, 100.98);
});

for (const code of ['MY'] as const) {
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

test('Malaysia — the Third Schedule brackets a wage in tens, then twenties, then hundreds', () => {
	// KWSP Third Schedule Part A: rows are RM10 wide to RM20, RM20 wide to RM5,000, RM100 wide to
	// RM20,000. Each row charges the rate on its own ceiling, so RM970 is "960.01 – 980.00" →
	// 108 / 128, RM15 is "10.01 – 20.00" → 3 / 3. A composition of three `bracket()` calls
	// re-rounded 980 to 1,000 and 20 to 100; the rounding is one ladder, not a chain.
	const book = assessStatutoryUnvalidated({
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

for (const code of ['MY'] as const)
	test(`${code} — EPF rows read off KWSP’s Third Schedule effective 1 October 2025, and its citation`, () => {
		// KWSP, "10. Effective 1 October 2025.pdf" (https://www.kwsp.gov.my/documents/d/guest/
		// third_schedule_from_-1-october-2025, read in a browser 2026-09-28, SHA-256 c4904e44…58b1),
		// columns "By the Employer / By the Employee", printed figures — not the rate rule:
		// Part A p.1 "20.01 to 40.00" 6.00 / 5.00; p.12 "5,000.01 to 5,100.00" 612.00 / 561.00;
		// p.19 "19,900.01 to 20,000.00" 2,400.00 / 2,200.00. Part C p.22 "260.01 to 280.00"
		// 19.00 / 16.00; p.30 "5,000.01 to 5,100.00" 306.00 / 281.00. Part E p.38
		// "60.01 to 80.00" 4.00 / 0.00 and "80.01 to 100.00" 4.00 / 0.00; p.52 "19,900.01 to
		// 20,000.00" 800.00 / 0.00.
		const citizen = (key: string, wage: number, age: number) =>
			({ key, wage, age, citizenship: 'CITIZEN', registrations: MY_LOCAL }) as const;
		const pr = (key: string, wage: number) =>
			({ key, wage, age: 61, citizenship: 'PERMANENT_RESIDENT', registrations: MY_LOCAL }) as const;
		const book = assessStatutoryUnvalidated({
			code,
			period: '2026-01',
			people: [
				citizen('A-30', 30, 40),
				citizen('A-5050', 5050, 40),
				citizen('A-20000', 20_000, 40),
				pr('C-270', 270),
				pr('C-5050', 5050),
				citizen('E-70', 70, 62),
				citizen('E-90', 90, 62),
				citizen('E-20000', 20_000, 62)
			]
		});
		expectStatutory(book, 'A-30', 'EPF', 5, 6);
		expectStatutory(book, 'A-5050', 'EPF', 561, 612);
		expectStatutory(book, 'A-20000', 'EPF', 2200, 2400);
		expectStatutory(book, 'C-270', 'EPF_PR', 16, 19);
		expectStatutory(book, 'C-5050', 'EPF_PR', 281, 306);
		expectStatutory(book, 'E-70', 'EPF', 0, 4);
		expectStatutory(book, 'E-90', 'EPF', 0, 4);
		expectStatutory(book, 'E-20000', 'EPF', 0, 800);

		// The Part A bonus note is cited to that October 2025 PDF (p.12) and the age limits to the
		// live mandatory-contribution page, never to the 2024 Wayback copy of the superseded
		// July 2022 schedule.
		const pdf = 'https://www.kwsp.gov.my/documents/d/guest/third_schedule_from_-1-october-2025';
		const page = 'https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution';
		const schemes = contributionSchemes(code);
		for (const version of settingsVersions(code)) {
			for (const scheme of ['EPF', 'EPF_PR']) {
				const authority: string = schemes.find(
					(row) => row.settings_id === version.id && row.code === scheme
				)!.authority;
				assert.ok(authority.includes(pdf), `${code} ${version.id} ${scheme}`);
				assert.ok(authority.includes(`note 1: ${page}`), `${code} ${version.id} ${scheme}`);
				assert.doesNotMatch(authority, /web\.archive\.org/, `${code} ${version.id} ${scheme}`);
			}
		}
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
/**
 * The worked intervals one day carries, each `[start, end]` in the jurisdiction's +08:00 frame.
 *
 * A time entry is a span, and the break a normal day provides comes off it: the shift's
 * `break_minutes`, or the statute's minimum where that is longer (EA 1955 s.60A(1)(a) owes thirty
 * minutes after five continuous hours), less any gap the punches already show. A day that means to
 * have taken its shift's hour punches the hour as one gap.
 */
const clocked = (
	world: PayrollWorld,
	key: string,
	date: string,
	spans: readonly (readonly [string, string])[]
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: spans.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${date}T${end}:00+08:00`
		})),
		approval_id: null
	});
};
/** A punch from `start` to `end` on `date`: one interval, no gap — the day's provided break comes off. */
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) =>
	clocked(world, key, date, [[start, end]]);
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

test('Malaysia — s.59(1): of two rest days in a week only the last is the rest day', () => {
	// The world's pattern codes both Saturday and Sunday REST. s.59(1): "where an employee is
	// allowed more than one rest day in a week the last of such rest days shall be the rest day for
	// the purposes of this Part", so Saturday is not a Part XII rest day and s.60(3) does not price
	// it. It has no normal hours, so every hour is s.60A(3)(a) overtime at 1.5 × the hourly rate.
	// RM3,000: s.60I(1A) ORP 3,000 ÷ 26 = 115.3846; hourly 115.3846 ÷ 8 = 14.4231.
	// Sat 8 Aug, 4 h: 4 × 14.4231 × 1.5 = 86.54 (the rest-day price was 57.69).
	// Sat 8 Aug, 08:00–13:00 and 14:00–19:00, 10 h: 10 × 14.4231 × 1.5 = 216.35 (was 115.38 + 57.69).
	// Sun 9 Aug stays the rest day: 4 h is not more than half the normal hours, s.60(3)(b)(i) half a
	// day's wages = 57.69.
	//
	// The MY lineage resolves the earlier rest day as s.59(1) reads (`earlier_rest_day_work:
	// RESOLVE_AS_OFF`, applied 2026-10-01; the former REFUSE is withdrawn): Saturday is an off day
	// and its hours are s.60A(3)(a) overtime. The company term prices them at its own hour, RM15.38
	// (the customer divisor), not the Act's 14.4231 — a term above the statute:
	// Sat 4 h: 4 × 15.38 × 1.5 = 92.28 (Act floor 86.54); 10 h: 10 × 15.38 × 1.5 = 230.70 (floor
	// 216.35). Sunday keeps the company's 2.0× rest-day rate: 4 × 15.38 × 2.0 = 123.04, above the
	// s.60(3)(b)(i) half day's wages of 57.69. (EARLIER-REST-2.0X is keyed on payroll group 5D;
	// this world records none, so Saturday takes the 1.5 column.)
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-08',
			people: [
				{ key: 'SAT-4', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'SAT-10', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }
			]
		},
		(world) => {
			punch(world, 'SAT-4', '2026-08-08', '09:00', '13:00');
			punch(world, 'SAT-4', '2026-08-09', '09:00', '13:00');
			const employment = world.employments.find((row) => row.employee_number === 'SAT-10')!;
			world.work_days.push({
				id: 'wd-SAT-10-2026-08-08',
				employment_id: employment.id,
				work_date: '2026-08-08',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-08-08T08:00:00+08:00', end: '2026-08-08T13:00:00+08:00' },
					{ start: '2026-08-08T14:00:00+08:00', end: '2026-08-08T19:00:00+08:00' }
				],
				approval_id: null
			});
		}
	);
	assert.deepEqual(workLines(slips.get('SAT-4')!), [
		// Company term (5-day week): earlier rest-day work at 2.0x, above the EA s.60A(3) 1.5x floor.
		['2026-08-08', 'EARLIER-REST-2.0X', 4, 123.04],
		// Sunday's 4 h are within the normal 8, so s.60(3)(b) rest-day pay, not s.60A(3) overtime:
		// RESTDAY-2.0X on REST_DAY_WORK.
		['2026-08-09', 'RESTDAY-2.0X', 4, 123.04]
	]);
	assert.deepEqual(
		workLines(slips.get('SAT-10')!),
		[['2026-08-08', 'EARLIER-REST-2.0X', 10, 307.6]] /* company 2.0x; EA s.60A(3) floor 216.35 */
	);
});

test('Malaysia — s.59(1): the earlier of two rest days counts toward the 104-hour month, and a holiday on it is not substituted', () => {
	// Mon–Fri 09:00–18:00 less a 60-minute break (8 h), Saturday and Sunday both coded REST.
	// s.59(1): "where an employee is allowed more than one rest day in a week the last of such rest
	// days shall be the rest day for the purposes of this Part": Sunday is the rest day, Saturday is
	// not. The 104-hour month (Employment (Limitation of Overtime Work) Regulations 1980 reg. 2,
	// s.60A(4)(a)) excludes work on the rest day and the s.60D(1) holidays; Saturday's is ordinary
	// overtime and counts. s.60D(1) proviso: only a holiday that falls on a REST day moves to the
	// working day next following, so a holiday on Saturday is observed on Saturday.
	//
	// August 2026 (cutoff 1), holidays on Sat 15 and Sun 23. Planned overtime: Sat 1 and Sat 8
	// 12 h each (the s.60A(7) twelve-hour day holds all 12 on a day with no shift), Sat 22 4 h —
	// 28 h that count. Sun 2 12 h and Sat 15 12 h: the rest day and a holiday, outside the cap. Every
	// weekday 4 h (8 h shift + 4 = the twelve-hour day); Mon 24 is Sunday's substitute holiday,
	// outside the cap, so 19 weekdays to Fri 28 count 76. The cap is full after Fri 28 (28 + 76 =
	// 104); Mon 31's 4 h are incentive. Reading Saturday as the rest day would count 80 and approve
	// every hour.
	//
	// The MY lineage resolves Saturday as s.59(1) reads (`earlier_rest_day_work: RESOLVE_AS_OFF`,
	// applied 2026-10-01; the former REFUSE is withdrawn): every Saturday is an OFF day whose hours
	// count. A holiday keeps its own date over the rest day (`holiday_rest_precedence:
	// PUBLIC_HOLIDAY`, the company's term): the s.60D(1) proviso's substitute is the published
	// replacement holiday row, not a derived one, so this world has no Mon 24 substitute and Mon 24
	// counts. 28 Saturday hours + 19 weekdays × 4 (Mon 3 to Thu 27) = 104: the cap is full after
	// Thu 27, and Fri 28 and Mon 31 are incentive. Counting Mon 24 fills the cap a day earlier than
	// the statutory reading, never later.
	const settingsId = settingsIdOn('MY', '2026-08-15');
	const work = settingsVersions('MY').find((row) => row.id === settingsId)!.work_rules;
	assert.equal(work.last_rest_day_only ?? null, null);
	assert.equal(work.earlier_rest_day_work, 'RESOLVE_AS_OFF');
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
	];
	const pattern = {
		kind: 'CYCLE',
		days: ['W', 'W', 'W', 'W', 'W', 'R', 'R'].map((roster_code_id) => ({ roster_code_id }))
	};
	const holiday = (date: string) => ({
		id: `h-${date}`,
		company_id: COMPANY_ID,
		date,
		name: 'Holiday',
		kind: 'PUBLIC',
		replaces: null,
		given_to: null,
		published_at: '2026-01-01T00:00:00.000Z'
	});
	const observed = observedDays({
		dates: ['2026-08-15'],
		cutoffDay: 1,
		companyId: COMPANY_ID,
		// Sat 15 August and Sun 23 August, each a holiday for this test.
		holidays: [holiday('2026-08-15'), holiday('2026-08-23')],
		codes,
		work,
		plans: [],
		rosterPeriods: [],
		patternOn: () => ({ pattern, anchor: '2026-08-03' }),
		worksiteOn: () => null
	} as Parameters<typeof observedDays>[0]);
	// Sat 15 and Sun 23 are each observed on their own date; every Saturday is an OFF day.
	assert.deepEqual([...observed.holidays].toSorted(), ['2026-08-15', '2026-08-23']);
	assert.deepEqual([...observed.offDays].toSorted(), [
		'2026-08-01',
		'2026-08-08',
		'2026-08-15',
		'2026-08-22',
		'2026-08-29'
	]);
	const days = [];
	for (let n = 1; n <= 31; n++) {
		const date = `2026-08-${String(n).padStart(2, '0')}`;
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		const rest = weekday === 0 || weekday === 6;
		const total = ['2026-08-01', '2026-08-02', '2026-08-08', '2026-08-15'].includes(date)
			? 12
			: rest && date !== '2026-08-22'
				? 0
				: 4;
		days.push({
			...observedPlan(
				rest
					? { date, kind: 'REST' as const, paid_minutes: 0, break_minutes: 0, spread_hours: 0 }
					: { date, kind: 'WORK' as const, paid_minutes: 480, break_minutes: 60, spread_hours: 9 },
				observed
			),
			total_overtime_hours: total
		});
	}
	const split = splitPlannedOvertime({
		days,
		limits: applicableLimits(work.limits ?? [], null),
		cutoffDay: 1,
		unitHours: work.overtime_unit_hours
	});
	const row = (date: string) => {
		const day = split.get(date)!;
		return [day.approved_overtime_hours, day.incentive_hours];
	};
	assert.deepEqual(row('2026-08-01'), [12, 0]);
	assert.deepEqual(row('2026-08-02'), [12, 0]);
	assert.deepEqual(row('2026-08-08'), [12, 0]);
	assert.deepEqual(row('2026-08-15'), [12, 0]);
	assert.deepEqual(row('2026-08-22'), [4, 0]);
	assert.deepEqual(row('2026-08-24'), [4, 0]);
	assert.deepEqual(row('2026-08-27'), [4, 0]);
	assert.deepEqual(row('2026-08-28'), [0, 4]);
	assert.deepEqual(row('2026-08-31'), [0, 4]);
});

test('MY — the last rest day keeps its 2.0× rate; earlier rest-day work is priced as off-day overtime', () => {
	// A contractual Sat+Sun rest pattern makes only Sunday the Act's s.59(1) rest day. Since
	// 2026-10-01 (`earlier_rest_day_work: RESOLVE_AS_OFF`) Saturday resolves as an off day: 4 h of
	// s.60A(3)(a) overtime at the company hour, 4 × 15.38 × 1.5 = 92.28 (Act floor 86.54).
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-08',
			people: [{ key: 'SUN-4', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
		},
		(world) => punch(world, 'SUN-4', '2026-08-09', '09:00', '13:00')
	);
	// 4 h within the normal 8: s.60(3)(b) rest-day pay (RESTDAY-2.0X), not s.60A(3) overtime.
	assert.deepEqual(workLines(slips.get('SUN-4')!), [['2026-08-09', 'RESTDAY-2.0X', 4, 123.04]]);
	const saturday = buildStatutory(
		{
			code: 'MY',
			period: '2026-08',
			people: [{ key: 'SAT-4', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
		},
		(world) => punch(world, 'SAT-4', '2026-08-08', '09:00', '13:00')
	);
	assert.deepEqual(workLines(saturday.slips.get('SAT-4')!), [
		// Company term (5-day week): earlier rest-day work at 2.0x, above the EA s.60A(3) 1.5x floor.
		['2026-08-08', 'EARLIER-REST-2.0X', 4, 123.04]
	]);
});

test('Malaysia — overtime, rest-day and holiday work at the s.60I ordinary rate', () => {
	const { slips, warnings } = buildStatutory(
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
				// A scheduled day punches the shift's hour as a gap: 09:00–12:00 and 13:00–20:00 is
				// ten hours worked, two beyond the normal eight.
				clocked(world, key, '2026-01-05', [
					['09:00', '12:00'],
					['13:00', '20:00']
				]); // Monday: two hours past the shift
				punch(world, key, '2026-01-10', '09:00', '13:00'); // Saturday off day: four hours
				punch(world, key, '2026-01-04', '09:00', '13:00'); // Sunday rest day: four hours
				punch(world, key, '2026-01-11', '09:00', '16:00'); // Sunday rest day: seven hours
				punch(world, key, '2026-01-18', '09:00', '20:00'); // Sunday rest day: eleven hours
				// A holiday the shift still runs: eight hours worked is the normal day, ten is two
				// beyond it.
				clocked(world, key, '2026-01-01', [
					['09:00', '13:00'],
					['14:00', '18:00']
				]); // Thursday holiday: the normal day
				clocked(world, key, '2026-01-14', [
					['09:00', '12:00'],
					['13:00', '20:00']
				]); // Wednesday holiday: ten hours
			}
		}
	);

	// The MY lineage's company terms (Nihon Pigment's contract, owner-approved 2026-09-23) price
	// every hour at its attendance-sheet column on the customer hour, basic ÷ 195 to the sen
	// (2,600 → 13.33): 1.5 on a working or off day, 2.0 on every coded rest day, 2.0 on a holiday
	// within the normal hours and 3.0 beyond. Each line is at or above the statutory floor it
	// replaces, which still floors it (EA s.7, s.60I(2)): the s.60A(3)(a) 1.5 × 12.50, the
	// s.60(3)(b)(i) half day of 50.00, the s.60(3)(b)(ii) day of 100.00, the s.60(3)(c) 2 × 12.50,
	// the s.60D(3)(a)(i) two days of 200.00 and the s.60D(3)(aa) 3 × 12.50.
	// Mon 5, 2 h × 13.33 × 1.5 = 39.99 (s.60A(3)(a) 37.50); Sat 10 off day, 4 h × 1.5 = 79.98 (75.00);
	// Sun 4 rest day, 4 h × 2.0 = 106.64 (half day 50.00). EA s.60A(1)(a): a rest or off day has no
	// shift to grant a break, so the Act's thirty minutes after five continuous hours comes off the
	// span — Sun 11, 09:00–16:00 is 6.5 h × 2.0 = 173.29 (one day 100.00); Sun 18, 09:00–20:00 is
	// 10.5 h × 2.0 = 279.93 (100.00 + 62.50). Holidays: 8 h × 2.0 = 213.28 (two days 200.00), 2 h
	// beyond × 3.0 = 79.98 (75.00). A scheduled day's shift grants an hour and takes it as a gap
	// (09:00–20:00 punched as two intervals is ten hours worked with nothing left to deduct).
	// EA s.60A(3): only the hours beyond the normal hours are overtime. Rest-day work within the
	// normal 8 is s.60(3)(a)/(b) pay (RESTDAY-2.0X, REST_DAY_WORK); s.60(3)(c) hours beyond it stay
	// overtime (RESTDAY-OT-2.0X). Sun 18's 10.5 h split: 8 × 13.33 × 2 = 213.28 within, 2.5 × 13.33 ×
	// 2 = 66.65 beyond (s.60(3)(c) floor 2.5 × 2 × 12.50 = 62.50); 213.28 + 66.65 = 279.93 as before.
	assert.deepEqual(workLines(slips.get('MY-EA')!), [
		['2026-01-01', 'HOLIDAY-2.0X', 8, 213.28],
		['2026-01-04', 'RESTDAY-2.0X', 4, 106.64],
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 39.99],
		// Company term (5-day week): earlier rest-day work at 2.0x, above the EA s.60A(3) 1.5x floor.
		['2026-01-10', 'EARLIER-REST-2.0X', 4, 106.64],
		['2026-01-11', 'RESTDAY-2.0X', 6.5, 173.29],
		['2026-01-14', 'HOLIDAY-2.0X', 8, 213.28],
		['2026-01-14', 'HOLIDAY-OT-3.0X', 2, 79.98],
		['2026-01-18', 'RESTDAY-2.0X', 8, 213.28],
		['2026-01-18', 'RESTDAY-OT-2.0X', 2.5, 66.65]
	]);
	assert.equal(
		slips.get('MY-EA')!.gross,
		Math.round((2600 + 213.28 + 106.64 + 39.99 + 106.64 + 173.29 + 213.28 + 79.98 + 279.93) * 100) /
			100
	);
	// Which schemes see the overtime is each scheme's own `assessed_on`: EPF Act 1991 s.2 keeps
	// overtime out of wages, Act 4 and Act 800 take it in, HRD Corp levies basic and fixed
	// allowances only. The two holiday awards within the normal hours are not overtime (EA
	// s.60A(3)(b), s.60A(4) proviso) and are EPF wages (KWSP Employer FAQ 21): they settle on
	// HOLIDAY_WORK (`DAY_PAY`). Rest-day pay within the normal hours is not overtime either (EA
	// s.60A(3); EPF Act s.2 excludes only "overtime payment"): it settles on REST_DAY_WORK
	// (`DAY_PAY`). EPF = 2,600 + holidays 213.28 + 213.28 + rest days 106.64 (Sun 4) + 173.29
	// (Sun 11) + 213.28 (Sun 18 within 8 h) = 3,519.77; Sun 18's 66.65 beyond, Mon 5's 39.99 and
	// Sat 10's 106.64 are overtime and stay out. HRDF stays on 2,600.
	const charge = (code: string) =>
		slips.get('MY-EA')!.statutory.find((row) => row.scheme_code === code)!;
	assert.equal(charge('EPF').base_amount, 3519.77);
	assert.equal(charge('HRDF').base_amount, 2600);
	assert.equal(
		charge('SOCSO').base_amount,
		3813.03 /* +26.66: 5-day earlier rest day at the company 2.0x */
	);
	assert.equal(charge('EIS').base_amount, 3813.03);
	// SOCSO on 3,813.03 is the Act 4 Third Schedule row "exceeding 3,800, not exceeding 3,900": 19.25 / 67.35.
	assert.deepEqual(
		[charge('SOCSO').employee_amount, charge('SOCSO').employer_amount],
		[19.25, 67.35]
	);

	// Over RM4,000 and outside para 2: the same six days produce no Part XII line at all.
	assert.deepEqual(workLines(slips.get('MY-OVER')!), []);
	// Both company holidays MY-OVER came in on are stated for HR to grant off-in-lieu, never
	// created; the two people the ladder covers were paid for theirs and are not named.
	const holidayNotes = warnings.filter((row) => row.startsWith('HOLIDAY_WORKED_NO_OVERTIME'));
	assert.equal(holidayNotes.length, 2);
	for (const date of ['2026-01-01', '2026-01-14'])
		assert.ok(
			holidayNotes.some(
				(row) =>
					row.includes('MY-OVER') &&
					row.includes(`worked the company holiday ${date} but is not entitled to overtime pay`) &&
					row.includes('off-in-lieu (OIL) leave day')
			),
			date
		);
	assert.equal(slips.get('MY-OVER')!.gross, 5200);

	// Manual labour at the same wage: the ladder applies, priced by the company columns on the
	// customer hour 5,200 ÷ 195 = 26.67 — each above the statutory 200.00 a day and 25.00 an hour.
	assert.deepEqual(workLines(slips.get('MY-MANUAL')!), [
		['2026-01-01', 'HOLIDAY-2.0X', 8, 426.72],
		['2026-01-04', 'RESTDAY-2.0X', 4, 213.36],
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 80.01],
		['2026-01-10', 'EARLIER-REST-2.0X', 4, 213.36] /* company 2.0x; EA s.60A(3) floor 1.5x */,
		['2026-01-11', 'RESTDAY-2.0X', 6.5, 346.71],
		['2026-01-14', 'HOLIDAY-2.0X', 8, 426.72],
		['2026-01-14', 'HOLIDAY-OT-3.0X', 2, 160.02],
		// Sun 18: 8 × 26.67 × 2 = 426.72 within the normal hours, 2.5 × 26.67 × 2 = 133.35 beyond
		// (560.07 together).
		['2026-01-18', 'RESTDAY-2.0X', 8, 426.72],
		['2026-01-18', 'RESTDAY-OT-2.0X', 2.5, 133.35]
	]);
});

test('Malaysia — s.18A prices an incomplete month and unpaid absence on the calendar month', () => {
	const { slips } = buildStatutory(
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
				{ key: 'MY-ABSENT', wage: 3100, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
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

	assert.throws(
		() =>
			buildStatutory({
				code: 'MY',
				period: '2026-01',
				region: 'Malaysia',
				people: [
					{ key: 'MY-UNDER', wage: 1500, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
				]
			}),
		/MINIMUM_WAGE_BELOW: MY-UNDER is contracted at 1500 a month, below the Malaysia minimum wage of 1700/
	);
});

test('Malaysia — regulation 4’s 104-hour month is a ceiling on the employer, not on the pay', () => {
	// Employment (Limitation of Overtime Work) Regulations 1980 reg.4: an employer shall not require
	// overtime beyond 104 hours in a month. s.60A(3)(a) still pays every planned hour at 1.5×; the
	// write stores the planned excess as incentive hours (`splitPlannedOvertime`), paid on the
	// INCENTIVE line at the band's own award. Fourteen January weekdays worked 09:00–02:00 with the
	// shift's hour punched as a gap are sixteen hours each, eight past the normal day: 112 h. The
	// s.60A(7) twelve-hour day splits first: each day's twelve worked hours leave four within it and
	// four incentive, so the month holds 56 and never reaches 104 (owner's rule, 2026-09-23: every
	// statutory overtime limit splits).
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
						{ start: `${date}T09:00:00+08:00`, end: `${date}T13:00:00+08:00` },
						{ start: `${date}T14:00:00+08:00`, end: `${next(date)}T02:00:00+08:00` }
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
	// The whole 112 h at the lineage's company term (Nihon Pigment's contract, owner-approved
	// 2026-09-23): the customer hour 2,600 ÷ 195 = 13.33 × 1.5 = 19.995, at or above s.60A(3)(a)'s
	// 12.50 × 1.5 = 18.75 — 2,239.44 on top of the month's wages.
	assert.equal(slips.get('MY-CAP')!.gross, 4839.44);
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

test('MY — overtime past twelve hours worked is incentive at the customer’s rate', () => {
	// The eleven-hour incentive boundary is withdrawn: incentive is only overtime beyond the
	// statutory limits — here s.60A(7)'s twelve worked hours a day (`daily_total`). 09:00–22:30 with
	// the shift's hour punched as a gap is 12.5 h worked, 4.5 h past the normal eight at
	// round(2,600 × 12 ÷ (52 × 45)) = 13.33 × 1.5 = 19.995: 4 h within twelve, 4 × 19.995 = 79.98;
	// 0.5 h beyond, 0.5 × 19.995 = 9.9975 → 10.00.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'N-2600', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) =>
			clocked(world, 'N-2600', '2026-01-05', [
				['09:00', '13:00'],
				['14:00', '22:30']
			])
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

test('MY — a short rest day or holiday is lifted to the Act’s day awards (EA s.60I(2), s.7)', () => {
	// The customer’s columns stand only where they pay no less than the Act. RM3,000 monthly:
	// the customer’s hour is round(3,000 × 12 ÷ (52 × 45)) = 15.38; the s.60I(1A) ordinary rate of
	// pay is 3,000 ÷ 26 = 115.3846, its hour ÷ 8 = 14.4231.
	// Sunday 6 Sep, 1 h: column 1 × 15.38 × 2 = 30.76; s.60(3)(b)(i) half the ORP = 57.69.
	// Sunday 20 Sep, 09:00–20:00: the rest day has no shift to grant a break, so EA s.60A(1)(a)'s
	// thirty minutes after five continuous hours comes off — 10.5 h worked: column 8 × 15.38 × 2 =
	// 246.08 over s.60(3)(b)(ii)'s 115.38; the 2.5 h beyond at the greater hour, 2.5 × 15.38 × 2 =
	// 76.90 over s.60(3)(c)'s 72.12 — 322.98, the column price. EA s.60A(3): only the 2.5 h beyond
	// the normal hours are overtime, so the 8 h settle on REST_DAY_WORK (RESTDAY-2.0X, 246.08) and
	// the 2.5 h on OVERTIME (RESTDAY-OT-2.0X, 76.90); the 1 h Sunday is within the normal hours too.
	// Hari Malaysia, Wed 16 Sep, 10:00–12:00: the column is the one hour worked — the shift's hour
	// punched as a gap 10:30–11:30 — × 15.38 × 2 = 30.76; s.60D(3)(a)(i) two days' wages 2 ×
	// 115.3846 = 230.77 "regardless that the period of work done on that day is less than the normal
	// hours".
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-09',
			people: [{ key: 'N-3000', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-09-16', 'Hari Malaysia'));
			clocked(world, 'N-3000', '2026-09-16', [
				['10:00', '10:30'],
				['11:30', '12:00']
			]);
			punch(world, 'N-3000', '2026-09-06', '09:00', '10:00');
			punch(world, 'N-3000', '2026-09-20', '09:00', '20:00');
		}
	);
	assert.deepEqual(workLines(slips.get('N-3000')!), [
		['2026-09-06', 'RESTDAY-2.0X', 1, 57.69],
		['2026-09-16', 'HOLIDAY-2.0X', 1, 230.77],
		['2026-09-20', 'RESTDAY-2.0X', 8, 246.08],
		['2026-09-20', 'RESTDAY-OT-2.0X', 2.5, 76.9]
	]);
});

test('Nihon cash allowances enter the contribution bases and lift the overtime hour to the Act (EA s.60A(3)(a), s.60I(2))', () => {
	const { slips } = buildStatutory(
		{
			code: 'MY',
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
			clocked(world, 'N-GROSS', '2026-01-05', [
				['09:00', '13:00'],
				['14:00', '22:00']
			]);
		}
	);
	const slip = slips.get('N-GROSS')!;
	assert.equal(slip.statutory.find((row) => row.scheme_code === 'EPF')!.base_amount, 2860);
	for (const code of ['SOCSO', 'EIS', 'PCB'])
		assert.equal(slip.statutory.find((row) => row.scheme_code === code)!.base_amount, 2942.5); // 2,860 + 82.50 overtime (Act 4 s.2(24))

	// The customer’s hour is basic only: round(2,600 ÷ 195) = 13.33. EA 1955 (AGC reprint as at
	// 1 Aug 2023) s.60A(3)(a) owes 1.5 × the hourly rate, s.60I(1)(b) the ORP ÷ normal hours, and
	// s.60I(1A) the ORP of a monthly wage (s.2 "wages": the SUA is cash wages) is ÷ 26:
	// (2,600 + 260) ÷ 26 ÷ 8 = 13.75. s.60I(2)/s.7: the customer’s hour stands only where it is not
	// less, so four hours past the normal eight are 4 × 13.75 × 1.5 = 82.50 (was 79.98).
	assert.deepEqual(
		slip.adjustments.map((row) => [row.statutory_rule_key, row.quantity, row.amount]),
		[['OVERTIME:WORKDAY-OT-1.5X', 4, 82.5]]
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
				base_salary: 3120,
				currency: 'MYR',
				effective_range: { start: '2026-01-10', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-09' };
			// Ten hours worked on each day, the shift's hour punched as a gap.
			clocked(world, 'M-DATED', '2026-01-05', [
				['09:00', '12:00'],
				['13:00', '20:00']
			]);
			clocked(world, 'M-DATED', '2026-01-12', [
				['09:00', '12:00'],
				['13:00', '20:00']
			]);
		}
	);
	// Each hour at the lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23): the customer hour on the day's
	// salary, basic ÷ 195 — 2,600 → 13.33, 3,120 → 16.00 — × 1.5, at or above s.60A(3)(a)'s
	// 1.5 × the s.60I hour (12.50, 15.00).
	assert.deepEqual(workLines(slips.get('M-DATED')!), [
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 39.99],
		['2026-01-12', 'WORKDAY-OT-1.5X', 2, 48]
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
			// Two hours late, two hours past the end: eight hours worked, the shift's hour punched
			// as a gap 15:00–16:00.
			clocked(world, 'MY-LATE', '2026-01-05', [
				['11:00', '15:00'],
				['16:00', '20:00']
			]);
			// Two hours late, four past the end: ten hours worked, two beyond the normal eight.
			clocked(world, 'MY-LATE-LONG', '2026-01-06', [
				['11:00', '15:00'],
				['16:00', '22:00']
			]);
		}
	);
	// s.60A(3)(a): "work carried out in excess of the normal hours of work" — 11:00–20:00 less the
	// hour of break is the eight normal hours and no more. The clock-out overrun priced the two
	// hours the person had not worked at 1.5×; the Act pays nothing.
	//
	// OPEN — a conflict between the Act and the guard, not between the Act and this fixture. The
	// guard (work.ts:1547) measures ordinary paid work as the hours worked INSIDE the rostered
	// window (`ordinaryWorkedHours`), so it reads six of these eight hours as ordinary and demands
	// two hours of approved overtime for a day the contract fixes at eight. The engine's own
	// planner (`keyClockOverruns`) and the roster board both read the same day as eight ordinary
	// hours. A shift of 11:00–20:00 on this row makes the run agree with the Act, but then the
	// clock-out never leaves the window and the case stops testing anything: left failing instead.
	assert.deepEqual(workLines(slips.get('MY-LATE')!), []);
	assert.equal(slips.get('MY-LATE')!.gross, 2600);
	// The two hours at the lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23): 2 × 13.33
	// (2,600 ÷ 195) × 1.5 = 39.99, at or above s.60A(3)(a)'s 2 × 12.50 × 1.5 = 37.50.
	assert.deepEqual(workLines(slips.get('MY-LATE-LONG')!), [
		['2026-01-06', 'WORKDAY-OT-1.5X', 2, 39.99]
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
				// The shift's hour punched as a gap: 08:00–16:30 is seven and a half hours worked.
				worked_intervals: [
					{ start: `${date}T08:00:00+08:00`, end: `${date}T12:00:00+08:00` },
					{ start: `${date}T13:00:00+08:00`, end: `${date}T16:30:00+08:00` }
				],
				approval_id: null
			});
		date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
	}
};

test('MY — a rostered person’s hour is the contract week’s, whatever the month rostered', () => {
	// NHPMY0339: RM1,700 on 7.5-hour shifts, six days a week. The customer’s hour is
	// 1,700 × 12 ÷ (52 × 45) = 8.7179… → 8.72 to the sen — not the month's rostered minutes
	// spread over its calendar, which priced the same wage at a different rate every month.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'NHPMY0339', wage: 1700, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			rostered(world, 'NHPMY0339', '2025-12-01', '2026-01-31', 6);
			// Monday 5 January to 18:30 with the hour punched as a gap: 9.5 h worked, two beyond the
			// 7.5-hour normal day.
			world.work_days.find((row) => row.id === 'wd-NHPMY0339-2026-01-05')!.worked_intervals = [
				{ start: '2026-01-05T08:00:00+08:00', end: '2026-01-05T12:00:00+08:00' },
				{ start: '2026-01-05T13:00:00+08:00', end: '2026-01-05T18:30:00+08:00' }
			];
		}
	);
	// 2 × 8.72 × 1.5 = 26.16.
	assert.deepEqual(workLines(slips.get('NHPMY0339')!), [
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 26.16]
	]);
	assert.equal(slips.get('NHPMY0339')!.gross, 1726.16);
});

test('MY — a holiday the roster works pays its holiday award with nothing planned (EA s.60D(3)(a))', () => {
	// Probe 2026-09-30: NHPMY0394 worked the Agong's Birthday on a rostered shift, with no hours on
	// the Overtime sheet, and the slip carried no holiday line. s.60D(3)(a): an employee "required by
	// his employer to work on any paid holiday" is paid two days' wages "regardless that the period
	// of work done on that day is less than the normal hours of work". The roster is the requirement.
	// RM1,700 on 7.5-hour shifts, six days: Monday 1 June worked 08:00–16:30 with the hour as a gap,
	// 7.5 h. Column 7.5 × 8.72 × 2 = 130.80; s.60D(3)(a)(i) 2 × 1,700 ÷ 26 = 130.77. The greater.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-06',
			people: [
				{ key: 'NHPMY0394', wage: 1700, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-06-01', "Agong's Birthday"));
			rostered(world, 'NHPMY0394', '2026-05-01', '2026-06-30', 6);
			// Nothing planned: the fixture's clock-as-plan step skips a day that states its plan.
			world.work_days.find((row) => row.id === 'wd-NHPMY0394-2026-06-01')!.approved_overtime_hours =
				0;
		}
	);
	assert.deepEqual(workLines(slips.get('NHPMY0394')!), [
		['2026-06-01', 'HOLIDAY-2.0X', 7.5, 130.8]
	]);
	assert.equal(slips.get('NHPMY0394')!.gross, 1830.8);
});

test('MY — a deferred rostered joiner is paid their arrears without a roster in the deferred window', () => {
	// Joined on 22 January, after the January run's window closed on the 20th: January is deferred
	// and paid as arrears by the February run, measured over January's own attendance window (21
	// December to 20 January) — where a joiner on the 22nd has no rostered day at all. That zero
	// workload used to derive an infinite ordinary hour and refuse the run at the rounding step; the
	// rate falls back to a neutral week and the arrears is January's calendar-day share, s.18A:
	// 1,700 × 10 ÷ 31 = 548.39, beside February's whole 1,700.
	const { slips } = buildStatutory(
		{
			code: 'MY',
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
				registrations: MY_FOREIGN
			}))
		]
	});
	// Eleven on the books, two of them Malaysian: PSMB Act 2001 s.13 and the Registration Order
	// count Malaysian employees, so the employer is under the five-employee threshold and no levy
	// is due — where the whole headcount would have read the compulsory 1% band.
	expectStatutory(book, 'MY-CITIZEN', 'HRDF', 0, 0);
	// r.3(3A): the RM100 zakat paid through the employer comes off the month's MTD, 4,679.20 −
	// 100 = 4,579.20.
	expectStatutory(book, 'MY-ZAKAT', 'PCB', 4579.2, 0);
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
			// A full ten-hour shift, the hour punched as a gap: ten hours worked, two past the eight.
			clocked(world, 'MY-TEN', '2026-01-05', [
				['09:00', '14:00'],
				['15:00', '20:00']
			]);
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
				currency: 'MYR',
				ordinary_wages: 2600,
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
	// shift's 10.00: two hours at 1.5× = 37.50. The lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23) pays them on
	// the customer hour 2,600 ÷ 195 = 13.33: 2 × 13.33 × 1.5 = 39.99, at or above the Act's 37.50.
	assert.deepEqual(workLines(slips.get('MY-TEN')!), [['2026-01-05', 'WORKDAY-OT-1.5X', 2, 39.99]]);
	// s.60(3)(a): a daily-rated employee's rest-day work pays one day's wages up to half the
	// normal hours and two days' wages beyond — 100 and 200 — where a monthly-rated one gets half
	// and one. The 09:00–16:00 Sunday is a seven-hour span and no shift grants a rest-day break, so
	// EA s.60A(1)(a)'s thirty minutes after five continuous hours comes off: 6.5 h worked, still
	// beyond half of eight — two days' wages = 200; the four-hour punch owes no break.
	// The lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23) prices every rest-day hour at 2.0
	// (`RESTDAY-2.0X` within the normal hours, s.60A(3)); the s.60(3)(a) day awards floor it
	// (s.60I(2)), and here they are the greater, so the amounts are the Act's.
	assert.deepEqual(workLines(slips.get('MY-DAILY')!), [
		['2026-01-04', 'RESTDAY-2.0X', 4, 100],
		['2026-01-11', 'RESTDAY-2.0X', 6.5, 200]
	]);
});

for (const code of ['MY'] as const)
	test(`${code} — SKBBK Second and Third Phases follow Act A1788 Third Schedule Parts II and III`, () => {
		// P.U. (B) 196/2026: Second Phase 1 June 2028 – 31 May 2031, Third Phase from 1 June 2031.
		// Act A1788 s.17, Third Schedule column (4)(B) "Non-employment injury", employee only:
		// row 40 (RM3,500–3,600): Part II RM35.50 (1.00% × 3,550), Part III RM44.40 (1.25% × 3,550 =
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

for (const code of ['MY'] as const)
	test(`${code} — SKBBK First Phase is Act A1788 Third Schedule Parts I and IV`, () => {
		// P.U. (B) 196/2026 para (a)-(b): A1788 in operation, First Phase 1 June 2026 – 31 May 2028.
		// Column (4)(B) "Non-employment injury", employee only, the same in Part I (first category)
		// and Part IV (second category):
		//   row 1  (up to RM30)        RM0.20
		//   row 26 (RM2,100–2,200)     RM16.15 (0.75% × 2,150 = 16.125, printed 16.15)
		//   row 40 (RM3,500–3,600)     RM26.65 (0.75% × 3,550 = 26.625, printed 26.65)
		//   row 65 (above RM6,000)     RM44.65 (the RM6,000 ceiling, same as row 64)
		// Age 61 is Second Category (Part IV): the employee still owes the same 16.15.
		const people = [
			{ key: 'W-30', wage: 30, citizenship: 'CITIZEN' },
			{ key: 'W-2150', wage: 2150, citizenship: 'CITIZEN' },
			{ key: 'W-3550', wage: 3550, citizenship: 'CITIZEN' },
			{ key: 'W-7000', wage: 7000, citizenship: 'CITIZEN' },
			{ key: 'W-2150-61', wage: 2150, age: 61, citizenship: 'CITIZEN' }
		];
		for (const period of ['2026-06', '2026-08']) {
			const book = assessStatutoryUnvalidated({ code, period, people });
			expectStatutory(book, 'W-30', 'SKBBK', 0.2, 0);
			expectStatutory(book, 'W-2150', 'SKBBK', 16.15, 0);
			expectStatutory(book, 'W-3550', 'SKBBK', 26.65, 0);
			expectStatutory(book, 'W-7000', 'SKBBK', 44.65, 0);
			expectStatutory(book, 'W-2150-61', 'SKBBK', 16.15, 0);
		}
	});

for (const code of ['MY'] as const)
	test(`${code} — December 2025 non-citizen EPF Part F rounds the total, not each share (Act A1760 Part F para 2)`, () => {
		// Act A1760 s.10, Third Schedule Part F: 2% each; para 2 "The total contribution which
		// includes cents shall be rounded to the next ringgit". RM1,751: 35.02 + 35.02 = 70.04 → RM71.
		// Part F is silent on which share carries the rounding: the employee stays at 2% (EPF Act
		// s.48(1)-(2) recovers only the contribution payable by the employee) and the employer pays
		// 71 − 35.02 = 35.98. KWSP's foreign-worker FAQ (36 + 36 = 72) does not follow para 2.
		const book = assessStatutory({
			code,
			period: '2025-12',
			people: [
				{ key: 'DEC-FOREIGN', wage: 1751, citizenship: 'FOREIGNER', registrations: MY_FOREIGN }
			]
		});
		expectStatutory(book, 'DEC-FOREIGN', 'EPF_NON_CITIZEN', 35.02, 35.98);
	});

for (const code of ['MY'] as const)
	test(`${code} — Part F: an odd-sen wage, a whole-ringgit total and KWSP's RM6,710 example (Act A1760 Part F para 2)`, () => {
		// 2,123.05 × 2% = 42.461 → employee 42.46 (to the sen, not rounded up); total 84.922 → 85;
		// employer 85 − 42.46 = 42.54.
		// 3,250 × 2% = 65 exactly: total 130, nothing to round; 65 + 65.
		// 3,250.01 × 2% = 65.0002 → 65.00; total 130.0004 → 131; employer 66.00.
		// 6,710 × 4% = 268.40 → 269 (KWSP's general mandatory-contribution example); employee
		// 134.20, employer 134.80.
		const book = assessStatutory({
			code,
			period: '2026-01',
			people: [2123.05, 3250, 3250.01, 6710].map((wage) => ({
				key: `PF-${wage}`,
				wage,
				citizenship: 'FOREIGNER' as const,
				registrations: MY_FOREIGN
			}))
		});
		expectStatutory(book, 'PF-2123.05', 'EPF_NON_CITIZEN', 42.46, 42.54);
		expectStatutory(book, 'PF-3250', 'EPF_NON_CITIZEN', 65, 65);
		expectStatutory(book, 'PF-3250.01', 'EPF_NON_CITIZEN', 65, 66);
		expectStatutory(book, 'PF-6710', 'EPF_NON_CITIZEN', 134.2, 134.8);
	});

test('every sealed version of `MY` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('MY');
});

test('Malaysia — a mid-year joiner’s PCB reads the previous employer’s TP3 as the year’s opening', () => {
	// MTD Specification 2026: a joiner declares on Form TP3 the year's accumulated remuneration
	// (Y), EPF (K) and PCB (X) already paid by the earlier employer. The fact's `opening` carries
	// them as the year to date this employer starts from, so June annualises the whole year:
	// 25,005 already earned + 5,001 × (1 + 6 remaining) = 60,012 — the same as a January
	// full-year MY-5001 — less the 549.50 already withheld, spread over the 7 payslips left.
	// EPF relief: 2,805 declared + 561 this month, K2 = trunc((4,000 − 3,366)/6) = 105.66. No TP1,
	// so the declared and current SOCSO, EIS and SKBBK relieve nothing (MTD spec 2026 D.2(ii) k).
	// P = 22,200 + 4,440 + 4,895.34 × 6 − 9,000 = 47,012.04 → 600 + 12,012.04 × 6% = 1,320.7224;
	// − 549.50 = 771.2224; ÷ 7 = 110.17 → 110.20.
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
	expectStatutory(book, 'MY-TP3', 'PCB', 110.2, 0);
	// Fresh: 5,001 × 7 = 35,007 annualised; EPF 561 × 7 = 3,927; personal 9,000 →
	// 22,080 in the 20,000–35,000 band: −250 + 2,080 × 3% = −187.60 → nothing withheld.
	expectStatutory(book, 'MY-FRESH', 'PCB', 0, 0);
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
	assert.equal(prior.statutory.find((row) => row.scheme_code === 'PCB')!.employee_amount, 10.1);
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
	// LHDN 2026 D(1): annual tax 1,320.72 (P 47,012) less January MTD 10.10 and zakat 100,
	// divided by 11 gives 110.056... -> 110.05. February zakat 100 leaves 10.05.
	expectStatutory(february, 'MY-ZAKAT-HISTORY', 'PCB', 10.05, 0);
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
	// (1,320.72 annual tax − 1,000 January zakat − 0 prior MTD) / 11 = 29.156 → 29.15.
	expectStatutory(february, 'MY-ZAKAT-EXCESS', 'PCB', 29.15, 0);
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
	expectStatutory(joiner, 'MY-ZAKAT-TP3', 'PCB', 29.15, 0);
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

for (const code of ['MY'] as const)
	test(`${code} — the termination benefit counts a part year to the nearest month (Termination and Lay-Off Benefits Regulations 1980 reg. 6(1))`, () => {
		// Hired 15 May 2023, made redundant on 31 January 2026 at RM3,000: 993 days of service is
		// 32.6 months, the nearest month 33 — two years and nine months, inside the fifteen-day tier
		// (two years or more, under five). A day's wages is twelve months' wages ÷ 365 (JTKSM's
		// published reg. 6 formula): 3,000 × 12 ÷ 365 = 98.6301; 15 × 33/12 × 98.6301 = 4,068.49.
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{
						key: 'MY-REDUNDANT',
						wage: 3000,
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL,
						hire_date: '2023-05-15',
						exit_date: '2026-01-31',
						exit_ground: 'REDUNDANCY'
					}
				]
			},
			(world) => {
				const benefit = world.adhoc_catalogue!.find(
					(row) =>
						row.code === 'TERMINATION_BENEFIT' &&
						row.settings_id ===
							settingsVersions(code).find(
								(v) =>
									String(v.effective_range.start) <= '2026-01-31' &&
									(v.effective_range.end == null || String(v.effective_range.end) > '2026-01-31')
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
			// A full shift: the hour is punched as a gap, so eight hours are worked.
			clocked(world, 'SIX8-SAT', '2026-01-10', [
				['09:00', '13:00'],
				['14:00', '18:00']
			]);
			clocked(world, 'SIX8-PLAN', '2026-01-10', [
				['09:00', '13:00'],
				['14:00', '18:00']
			]);
			world.work_days.at(-1)!.approved_overtime_hours = 3;
		}
	);
	assert.deepEqual(workLines(slips.get('SIX8-SAT')!), []);
	// The planned three hours at the lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23):
	// 3 × 13.33 (2,600 ÷ 195) × 1.5 = 59.99, at or above s.60A(3)(a)'s 56.25.
	assert.deepEqual(workLines(slips.get('SIX8-PLAN')!), [
		['2026-01-10', 'WORKDAY-OT-1.5X', 3, 59.99]
	]);
});

test('Malaysia — a part-timer’s hours beyond their own day up to a full-timer’s eight are the hourly rate, beyond that 1.5× (Part-Time Employees Regulations 2010 reg. 5)', () => {
	// Contracted 09:00–13:00 five days (twenty hours) at RM1,040: the day is 1,040 ÷ 26 = 40.00
	// and the hour is the day over the contract's four — 10.00. A Monday punched 09:00–19:00 is a
	// ten-hour span; the short shift grants no break, so EA s.60A(1)(a)'s thirty minutes after five
	// continuous hours comes off: 9.5 h worked — four hours up to the full-timer's eight at
	// 1.0× = 40.00, 1.5 beyond at 1.5× = 22.50.
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
		['2026-01-05', 'PT-1.5X', 1.5, 22.5]
	]);
});

test('MY — a roster that mixes 7.5-hour and 9-hour shifts owes no overtime on a 9-hour shift worked whole (s.60A(1) proviso)', () => {
	// Rostered six 7.5-hour days a week through 18 January, then five 9-hour days a week on a
	// five-day pattern: both are 45-hour weeks inside the proviso, so a 9-hour shift is its own
	// normal day. The roster's
	// average day (8.2 h) is nobody's normal hours: it priced 0.8 h of overtime on every 9-hour
	// shift. The hourly rate stays the shift over the agreed week — 1,700 ÷ 26 over the rostered
	// average day; only the overtime threshold moves. Both clocks punch the shift's hour as a gap,
	// so a 9-hour shift worked whole is nine hours worked on the 19th: no line. Worked to 19:30 on
	// the 20th: ten hours worked, one beyond the nine.
	const NINE = 'c0000000-0000-4000-8000-0000000000e1';
	const { slips } = buildStatutory(
		{
			code: 'MY',
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
				{ start: '2026-01-19T08:30:00+08:00', end: '2026-01-19T13:00:00+08:00' },
				{ start: '2026-01-19T14:00:00+08:00', end: '2026-01-19T18:30:00+08:00' }
			];
			world.work_days.find((row) => row.id === 'wd-NHPMY0357-2026-01-20')!.worked_intervals = [
				{ start: '2026-01-20T08:30:00+08:00', end: '2026-01-20T13:00:00+08:00' },
				{ start: '2026-01-20T14:00:00+08:00', end: '2026-01-20T19:30:00+08:00' }
			];
		}
	);
	const lines = workLines(slips.get('NHPMY0357')!);
	assert.deepEqual(
		lines.map((line) => [line[0], line[1], line[2]]),
		[['2026-01-20', 'WORKDAY-OT-1.5X', 1]]
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Scenario sweep, 28 September 2026. Every expected figure is derived from the instrument named
// beside it; the engine's output is compared, never copied.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The sealed catalogue rows of the version in force on `day`, planted in the world. */
const plantLeaveCatalogue = (world: PayrollWorld, code: 'MY', day: string) => {
	const settingsId = settingsIdOn(code, day);
	world.leave_catalogue.push(
		...leaveCatalogue(code)
			.filter((row) => row.settings_id === settingsId)
			.map((row) => ({ ...row, approval_id: null }))
	);
	return (leaveCode: string) =>
		world.leave_catalogue.find((row) => row.settings_id === settingsId && row.code === leaveCode)!;
};
const epfOf = (slip: BuiltPayslip) =>
	slip.statutory
		.filter((row) => row.scheme_code === 'EPF')
		.map((row) => [row.base_amount, row.employee_amount, row.employer_amount]);

for (const code of ['MY'] as const)
	test(`${code} — a mid-month leaver: s.18A(b) days, s.60E(3A) untaken leave at the s.60I(1A) ordinary rate, EPF on both`, () => {
		// Hired 1 January 2015 (five years or more: s.60E(1)(c), sixteen days), resigns effective 15
		// June 2026 on RM3,100 a month. s.60E(1): the terminating year's entitlement is in direct
		// proportion to completed months — January to May, five: 16 × 5 ÷ 12 = 6.67, and the first
		// proviso deems a fraction of one-half or more one day → 7. None taken, so s.60E(3A) pays 7 days
		// at the ordinary rate, s.60I(1A) monthly ÷ 26: 7 × 3,100 ÷ 26 = 834.615… → 834.62.
		// s.18A(b): 3,100 × 15 ÷ 30 = 1,550.00. (Act 265 reprint as at 1 August 2023, ss.18A, 60E, 60I.)
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-06',
				people: [
					{
						key: 'MY-LEAVER',
						wage: 3100,
						citizenship: 'CITIZEN',
						hire_date: '2015-01-01',
						exit_date: '2026-06-15',
						exit_ground: 'RESIGNATION',
						registrations: MY_LOCAL
					}
				]
			},
			(world) => {
				const annual = plantLeaveCatalogue(world, code, '2026-06-15')('ANNUAL_LEAVE');
				const employment = world.employments[0]!;
				world.leave_entries.push({
					id: 'e2000000-0000-4000-8000-000000000001',
					employment_id: employment.id,
					catalogue_id: annual.id,
					leave_code: 'ANNUAL_LEAVE',
					reference: `exit:${employment.id}:ANNUAL_LEAVE`,
					from_date: '2026-01-01',
					to_date: '2026-06-15',
					days: 7,
					encash_days: 7,
					effective_on: '2026-06-15',
					due_on: '2026-06-15',
					charges: [],
					allocations: [],
					approval_id: null,
					payslip_id: null,
					as_adjustment_entry: false
				} as never);
			}
		);
		const slip = slips.get('MY-LEAVER')!;
		assert.deepEqual(
			slip.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
			[[15, 30, 1550]]
		);
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount,
			834.62
		);
		assert.equal(slip.gross, 2384.62);
		// KWSP employer FAQ 8 ("Components of Wage"): payment in respect of unutilised annual leave is
		// wages for EPF. 2,384.62 → the "2,380.01 – 2,400.00" row: 11% / 13% of 2,400 = 264 / 312.
		assert.deepEqual(epfOf(slip), [[2384.62, 264, 312]]);
		// Act 4 s.2(24) (PERKESO BM reprint as at 1 July 2021, p.17) and Act 800 s.2 (PERKESO text,
		// "wages") both define wages as all remuneration payable in money "including any payment in
		// respect of leave"; the payment for untaken leave is not the excluded gratuity on discharge
		// ((d)). PERKESO FAQ Q6 lists "annual leave emoluments". So the SOCSO/EIS/SKBBK base is the
		// whole 2,384.62: Act A1788 Third Schedule Part I row 28 ("exceeding RM2,300 but not RM2,400",
		// First Category): employer 11.75 invalidity + 29.40 injury = 41.15; employee 11.75
		// invalidity; employee 17.65 non-employment injury (SKBBK, in force 1 June 2026). Act 800
		// Second Schedule row 28: 4.70 / 4.70.
		const charge = (scheme: string) => {
			const row = slip.statutory.find((entry) => entry.scheme_code === scheme)!;
			return [row.base_amount, row.employee_amount, row.employer_amount];
		};
		assert.deepEqual(charge('SOCSO'), [2384.62, 11.75, 41.15]);
		assert.deepEqual(charge('EIS'), [2384.62, 4.7, 4.7]);
		assert.deepEqual(charge('SKBBK'), [2384.62, 17.65, 0]);
		// Act 612 s.2 "wages" (AGC reprint 2017) "includes any leave pay", and HRD Corp's Levy
		// Calculation Guideline repeats "includes any leave pay and arrears of wages"; the payment for
		// untaken leave is not the (d) gratuity on discharge nor any listed exempt element: the levy
		// base is the whole 2,384.62 (the rate turns on the employer's class, priced above).
		assert.equal(charge('HRDF')[0], 2384.62);
	});

for (const code of ['MY'] as const)
	test(`${code} — approved unpaid leave is s.18A(c) days off the calendar month`, () => {
		// Three unpaid working days (5–7 January 2026) on RM3,100: 3,100 × (31 − 3) ÷ 31 = 2,800.00.
		// EPF "2,780.01 – 2,800.00": 11% / 13% of 2,800 = 308 / 364. Act 4 Third Schedule "exceeding
		// RM2,700 not exceeding RM2,800": employee 13.75, employer 48.15; Act 800 Second Schedule
		// same row 5.50 / 5.50.
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [{ key: 'MY-NPL', wage: 3100, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
			},
			(world) => {
				const unpaid = plantLeaveCatalogue(world, code, '2026-01-05')('UNPAID_LEAVE');
				for (const day of ['05', '06', '07']) {
					const date = `2026-01-${day}`;
					world.leave_entries.push({
						id: `e2100000-0000-4000-8000-0000000000${day}`,
						employment_id: world.employments[0]!.id,
						catalogue_id: unpaid.id,
						leave_code: 'UNPAID_LEAVE',
						reference: `NPL-${day}`,
						from_date: date,
						to_date: date,
						half_day_start: false,
						half_day_end: false,
						days: 1,
						effective_on: date,
						reason: 'Unpaid day',
						allocations: [],
						charges: [
							{
								date,
								days: 1,
								catalogue_id: unpaid.id,
								employment_term_id: world.employment_terms[0]!.id,
								holiday_id: null,
								shift_definition_id: null,
								work_day_id: null
							}
						],
						approval_id: null,
						payslip_id: null
					} as never);
				}
			}
		);
		const slip = slips.get('MY-NPL')!;
		assert.equal(slip.gross, 2800);
		assert.deepEqual(epfOf(slip), [[2800, 308, 364]]);
		const charge = (scheme: string) => {
			const row = slip.statutory.find((entry) => entry.scheme_code === scheme)!;
			return [row.employee_amount, row.employer_amount];
		};
		assert.deepEqual(charge('SOCSO'), [13.75, 48.15]);
		assert.deepEqual(charge('EIS'), [5.5, 5.5]);
	});

test('MY — a mid-month salary change is each rate over its own calendar days (s.18A method)', () => {
	// No Malaysian instrument prescribes a formula for a rate change inside a month; s.18A's
	// "monthly wages × days eligible ÷ days of the wage period" is applied to each rate over the
	// days it was in force: 2,600 × 9 ÷ 31 = 754.84 (1–9 January) + 3,100 × 22 ÷ 31 = 2,200.00.
	// EPF "2,940.01 – 2,960.00": 11% × 2,960 = 325.60 → 326; 13% × 2,960 = 384.80 → 385.
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [{ key: 'MY-RAISE', wage: 2600, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-000000005678',
				base_salary: 3100,
				effective_range: { start: '2026-01-10', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-09' };
		}
	);
	const slip = slips.get('MY-RAISE')!;
	assert.deepEqual(
		slip.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[
			[9, 31, 754.84],
			[22, 31, 2200]
		]
	);
	assert.equal(slip.gross, 2954.84);
	assert.deepEqual(epfOf(slip), [[2954.84, 326, 385]]);
});

for (const code of ['MY'] as const)
	test(`${code} — floors, ceilings and the cent either side of a band seam`, () => {
		const book = assessStatutoryUnvalidated({
			code,
			period: '2026-01',
			people: [
				{ key: 'W-10', wage: 10, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'W-30', wage: 30, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'W-30.01', wage: 30.01, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'W-5000', wage: 5000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'W-6000', wage: 6000, citizenship: 'CITIZEN', registrations: MY_LOCAL },
				{ key: 'W-20000', wage: 20_000, citizenship: 'CITIZEN', registrations: MY_LOCAL }
			]
		});
		// EPF Third Schedule Part A (1 October 2025): "up to RM10" is nil.
		expectStatutory(book, 'W-10', 'EPF', 0, 0);
		// The ceiling-inclusive seam: RM5,000.00 is the "4,980.01 – 5,000.00" row, 11% / 13% of
		// 5,000 = 550 / 650 (the 12% employer rate starts one cent above).
		expectStatutory(book, 'W-5000', 'EPF', 550, 650);
		// RM20,000.00 is still the table's last row "19,900.01 – 20,000.00": 2,200 / 2,400; the exact
		// percentage applies only to wages exceeding RM20,000 (KWSP mandatory-contribution note 2).
		expectStatutory(book, 'W-20000', 'EPF', 2200, 2400);
		// Act 4 Third Schedule first two rows: "wages up to RM30" 0.10 / 0.40; "exceeding RM30 but not
		// exceeding RM50" 0.20 / 0.70. Act 800 Second Schedule: 0.05 / 0.05 and 0.10 / 0.10.
		expectStatutory(book, 'W-30', 'SOCSO', 0.1, 0.4);
		expectStatutory(book, 'W-30', 'EIS', 0.05, 0.05);
		expectStatutory(book, 'W-30.01', 'SOCSO', 0.2, 0.7);
		expectStatutory(book, 'W-30.01', 'EIS', 0.1, 0.1);
		// "exceeding RM4,900 but not exceeding RM5,000": 24.75 / 86.65; EIS 9.90 / 9.90.
		expectStatutory(book, 'W-5000', 'SOCSO', 24.75, 86.65);
		expectStatutory(book, 'W-5000', 'EIS', 9.9, 9.9);
		// RM6,000.00 exactly is the ceiling row (PERKESO, ceiling RM6,000 from 1 October 2024):
		// 29.75 / 104.15; EIS 11.90 / 11.90 — the same as RM6,000.01 above.
		expectStatutory(book, 'W-6000', 'SOCSO', 29.75, 104.15);
		expectStatutory(book, 'W-6000', 'EIS', 11.9, 11.9);
	});

for (const code of ['MY'] as const)
	test(`${code} — a bonus month: resident additional-remuneration difference, non-resident flat 30% on the whole`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const book = assessStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{ key: 'R-BONUS', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{
						key: 'NR-BONUS',
						wage: 5001,
						citizenship: 'FOREIGNER',
						tax_residency: 'NON_RESIDENT',
						registrations: MY_FOREIGN
					}
				]
			},
			(world) => {
				const adj = rowIn(world.adhoc_catalogue!, settingsId, 'ADJ');
				for (const [index, employment] of world.employments.entries())
					world.adhoc_requests!.push({
						id: `d0000000-0000-4000-8000-0000000ad3${index}0`,
						employment_id: employment.id,
						catalogue_id: adj,
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
		// Resident: the derivation of the MY-only bonus golden above — 1,280.25.
		expectStatutory(book, 'R-BONUS', 'PCB', 1280.25, 0);
		// LHDN MTD 2026 D(a): a non-resident's MTD is 30% of the remuneration, bonus included, with no
		// reliefs: 30% × (5,001 + 12,000) = 5,100.30.
		expectStatutory(book, 'NR-BONUS', 'PCB', 5100.3, 0);
		// EPF Part F on the whole month's wages (bonus is EPF wages, KWSP FAQ 8): 2% × 17,001 = 340.02
		// each; total 680.04 → 681 (A1760 Part F para 2): employee 340.02, employer 340.98.
		expectStatutory(book, 'NR-BONUS', 'EPF_NON_CITIZEN', 340.02, 340.98);
	});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Round 2, 28 September 2026: joiner, leaver-month tax, final-pay deadlines, annual bonus.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const code of ['MY'] as const)
	test(`${code} — a joiner on the 11th is s.18A(a) days of the calendar month, every scheme on what was paid`, () => {
		// Employment Act 1955 s.18A(a) (AGC reprint as at 1 August 2023): 3,100 × 21 ÷ 31 = 2,100.00.
		// EPF Third Schedule Part A "2,080.01 – 2,100.00": 11% / 13% of 2,100 = 231 / 273.
		// Act 4 Third Schedule (PERKESO BM reprint as at 1 July 2021) row 25 "exceeding RM2,000 not
		// exceeding RM2,100": employer 35.85, employee 10.25. Act 800 Second Schedule row 25: 4.10 / 4.10.
		const { slips } = buildStatutory({
			code,
			period: '2026-01',
			people: [
				{
					key: 'JOINER',
					wage: 3100,
					hire_date: '2026-01-11',
					citizenship: 'CITIZEN',
					registrations: MY_LOCAL
				}
			]
		});
		const slip = slips.get('JOINER')!;
		assert.deepEqual(
			slip.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
			[[21, 31, 2100]]
		);
		assert.equal(slip.gross, 2100);
		const charge = (scheme: string) => {
			const row = slip.statutory.find((entry) => entry.scheme_code === scheme)!;
			return [row.base_amount, row.employee_amount, row.employer_amount];
		};
		assert.deepEqual(charge('EPF'), [2100, 231, 273]);
		assert.deepEqual(charge('SOCSO'), [2100, 10.25, 35.85]);
		assert.deepEqual(charge('EIS'), [2100, 4.1, 4.1]);
	});

for (const code of ['MY'] as const)
	test(`${code} — the leaver's last month: MTD projects the month's own normal remuneration over the rest of the year`, () => {
		// LHDN Specification for MTD Calculations Using Computerised Calculation for 2026, D(b)(1):
		// Y1 is the current month's gross normal remuneration, Y2 is "estimated remuneration as Y1
		// for the subsequent months", n + 1 the balance of months in the year including the current
		// one. The specification has no leaver branch: the final month is annualised like any other.
		// Resigns effective 15 January 2026 on RM20,000: s.18A(b) 20,000 × 15 ÷ 31 = 9,677.419 →
		// 9,677.42 = Y1 = Y2, n = 11.
		// EPF Part A "9,600.01 – 9,700.00": employee 11% × 9,700 = 1,067 = K1. K2 = the lower of K1
		// and (4,000 − 1,067) ÷ 11 = 266.636 → 266.63 (E(1): two decimals, later figures omitted).
		// No TP1, so no SOCSO/EIS relief (D.2(ii) item k). Personal relief 9,000.
		// P = (9,677.42 − 1,067) + 11 × (9,677.42 − 266.63) − 9,000 = 103,129.11.
		// Table 1 "100,001 – 400,000": (P − 100,000) × 25% + 9,400 = 10,182.2775; ÷ 12 = 848.523
		// → 848.52 (E(1)) → 848.55 (E(2)).
		const { slips } = buildStatutory({
			code,
			period: '2026-01',
			people: [
				{
					key: 'LEAVER-20K',
					wage: 20_000,
					citizenship: 'CITIZEN',
					hire_date: '2015-01-01',
					exit_date: '2026-01-15',
					exit_ground: 'RESIGNATION',
					registrations: MY_LOCAL
				}
			]
		});
		const slip = slips.get('LEAVER-20K')!;
		assert.equal(slip.gross, 9677.42);
		const pcb = slip.statutory.find((row) => row.scheme_code === 'PCB')!;
		assert.equal(pcb.employee_amount, 848.55);
	});

for (const code of ['MY'] as const)
	test(`${code} — final wages are due on the last day, or the third day after a walk-out (EA ss.20, 21(1), 21(2))`, () => {
		// Employment Act 1955 (AGC reprint as at 1 August 2023): s.20 — a contract ending under
		// s.11(1) or by s.12 notice is paid "not later than the day on which such contract of service
		// so terminates"; s.21(1) — the employer terminating without notice under s.13(1) or s.14(1)(a)
		// pays on that day too; s.21(2) — an employee terminating without notice under s.13(1)/(2) or
		// s.14(3) is paid "not later than the third day after". The month's run pays on its last day,
		// 31 January 2026.
		//   NOTICE    resigned with notice, last day 27 Jan → due 27 Jan → 31 Jan is late (s.20).
		//   WALKOUT   left without notice 27 Jan → due 30 Jan → late (s.21(2)).
		//   WALKOUT29 left without notice 29 Jan → due 1 Feb → on time.
		//   DISMISSED dismissed for misconduct after inquiry 27 Jan (s.14(1)(a)) → due 27 Jan → late.
		//   MONTH-END resigned with notice, last day 31 Jan → due 31 Jan → on time.
		const people = [
			{ key: 'NOTICE', exit_date: '2026-01-27', exit_ground: 'RESIGNATION' },
			{ key: 'WALKOUT', exit_date: '2026-01-27', exit_ground: 'RESIGNATION' },
			{ key: 'WALKOUT29', exit_date: '2026-01-29', exit_ground: 'RESIGNATION' },
			{ key: 'DISMISSED', exit_date: '2026-01-27', exit_ground: 'DISMISSAL' },
			{ key: 'MONTH-END', exit_date: '2026-01-31', exit_ground: 'RESIGNATION' }
		].map((row) => ({ ...row, wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }));
		const { warnings } = buildStatutory({ code, period: '2026-01', people }, (world) => {
			for (const row of world.employments) {
				if (row.employee_number === 'WALKOUT' || row.employee_number === 'WALKOUT29')
					row.exit_facts = { ...(row.exit_facts ?? {}), terminated_without_notice: true };
				if (row.employee_number === 'DISMISSED')
					row.exit_facts = { ...(row.exit_facts ?? {}), misconduct_dismissal: true };
			}
		});
		const late = (key: string) =>
			warnings.find((line) => line.startsWith('FINAL_PAY_LATE') && line.includes(`${key} left`));
		assert.match(late('NOTICE') ?? '', /by 2026-01-27.*s\.20/);
		assert.match(late('WALKOUT') ?? '', /by 2026-01-30.*s\.21\(2\)/);
		assert.equal(late('WALKOUT29'), undefined);
		assert.match(late('DISMISSED') ?? '', /by 2026-01-27.*s\.21\(1\)/);
		assert.equal(late('MONTH-END'), undefined);
	});

// Act 4 s.2(24)(e) "bonus tahunan" (PERKESO BM reprint as at 1 July 2021, p.18) and Act 800 s.2
// "wages" (e) "any annual bonus" exclude an annual bonus from the SOCSO, EIS and SKBBK wage; Act 612
// s.2 "wages" (e) excludes "any bonus or commission" (AGC reprint 2017). EPF Act 452 s.2 "wages"
// includes "any bonus" (AGC online text as at 1 July 2022), and the bonus is PCB additional
// remuneration (LHDN MTD Specification 2026 D(b)(2)).
for (const code of ['MY'] as const)
	for (const period of ['2026-01', '2026-07'] as const)
		test(`${code} ${period} — an annual bonus is EPF wages and additional remuneration, but not SOCSO/EIS/SKBBK/HRD wages`, () => {
			const settingsId = settingsIdOn(code, `${period}-15`);
			const book = assessStatutory(
				{
					code,
					period,
					people: [{ key: 'B', wage: 3000, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
				},
				(world) => {
					world.adhoc_requests!.push({
						id: 'd0000000-0000-4000-8000-0000000b0e10',
						employment_id: world.employments[0]!.id,
						catalogue_id: rowIn(world.adhoc_catalogue!, settingsId, 'BONUS'),
						amount: 12_000,
						event_date: `${period}-01`,
						pay_period: null,
						payslip_id: null,
						reason: 'annual bonus',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			);
			// Act 4 Third Schedule row "exceeding RM2,900 but not exceeding RM3,000": employer 51.65,
			// employee 14.75 (1.75% / 0.5% of the 2,950 midpoint); Act 800 Second Schedule same row
			// 5.90 / 5.90 — on the 3,000 wage alone, not the RM6,000 ceiling.
			expectStatutoryBase(book, 'B', 'SOCSO', 3000);
			expectStatutory(book, 'B', 'SOCSO', 14.75, 51.65);
			expectStatutoryBase(book, 'B', 'EIS', 3000);
			expectStatutory(book, 'B', 'EIS', 5.9, 5.9);
			// A1788 (SKBBK from 1 June 2026) reads the same s.2(24) wage.
			if (period === '2026-07') expectStatutoryBase(book, 'B', 'SKBBK', 3000);
			// Act 612 s.2 "wages" (e): HRD levy on the 3,000 wage only.
			expectStatutoryBase(book, 'B', 'HRDF', 3000);
			// EPF Third Schedule Part A "14,900.01 – 15,000.00": employee 11% × 15,000 = 1,650. The
			// note under the RM5,000 row: a bonus lifting a monthly wage of RM5,000 and below above
			// RM5,000 keeps the employer at 13% of the month's wages: 13% × 15,000 = 1,950.
			expectStatutoryBase(book, 'B', 'EPF', 15_000);
			expectStatutory(book, 'B', 'EPF', 1650, 1950);
		});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Round 3, 28 September 2026: EA s.19 wage deadlines, Schedule 6 para 21.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const code of ['MY'] as const)
	test(`${code} — wages by the seventh day after the wage period, overtime by the last day of the next (EA s.19(1)–(2))`, () => {
		// Employment Act 1955 s.19 (AGC reprint as at 1 August 2023): (1) the wages earned during a
		// wage period are paid "not later than the seventh day after the last day" of it; (2) wages for
		// rest-day, s.60D(1)(a)/(b) holiday and s.60A overtime work "not later than the last day of the
		// next wage period"; (3) only the Director General may extend either. The world's monthly
		// company cuts attendance on the 21st. The January run pays on 31 January — inside 7 February —
		// and prices the calendar month's salary; the February run pays on 28 February.
		const company = { pay_frequency: 'MONTHLY', pay_cutoff_day: 21 };
		assert.equal(resolveWindow('2026-01', company).payDate, '2026-01-31');
		assert.equal(resolveWindow('2026-02', company).payDate, '2026-02-28');
		// Two hours of overtime on Monday 19 and Monday 26 January (its price is the profile's own
		// ordinary hour, golden above; only the paying run is asserted here). The 19th is inside January's attendance window: paid 31 January. The
		// 26th is past the cutoff: paid in February's run on 28 February, the last day of the next
		// wage period — on time, the s.19(2) day itself.
		const run = (period: string) =>
			buildStatutory(
				{
					code,
					period,
					people: [{ key: 'OT', wage: 2600, citizenship: 'CITIZEN', registrations: MY_LOCAL }]
				},
				(world) => {
					// Ten hours worked on each Monday, the shift's hour punched as a gap.
					for (const date of ['2026-01-19', '2026-01-26'])
						clocked(world, 'OT', date, [
							['09:00', '12:00'],
							['13:00', '20:00']
						]);
				}
			).slips.get('OT')!;
		const paid = (period: string) =>
			workLines(run(period)).map(([date, label, hours]) => [date, label, hours]);
		assert.deepEqual(paid('2026-01'), [['2026-01-19', 'WORKDAY-OT-1.5X', 2]]);
		assert.deepEqual(paid('2026-02'), [['2026-01-26', 'WORKDAY-OT-1.5X', 2]]);
	});

for (const code of ['MY'] as const)
	test(`${code} — a paragraph 21 election without worked-in-Malaysia days refuses before saving`, () => {
		// Income Tax Act 1967 Schedule 6 para 21 (AGC online text as at 1 January 2026) exempts a
		// non-resident's income from an employment exercised in Malaysia for not more than sixty days.
		// The boolean election does not record how many days the employment was exercised here, and
		// no stay records `employment_exercised`: `employee.employment_days` is 0, so the claim refuses.
		const foreign = (para21: boolean) => ({
			...MY_FOREIGN,
			PCB: { kind: 'REGISTERED', elections: { pcb_sch6_para21: para21 } }
		});
		const person = (para21: boolean) => ({
			key: 'NR',
			wage: 5001,
			citizenship: 'FOREIGNER',
			tax_residency: 'NON_RESIDENT' as const,
			registrations: foreign(para21)
		});
		assert.throws(
			() => buildStatutory({ code, period: '2026-01', people: [person(true)] }),
			/PCB: Schedule 6 paragraph 21 needs dated days employment was exercised in Malaysia/
		);
		expectStatutory(
			assessStatutory({ code, period: '2026-01', people: [person(false)] }),
			'NR',
			'PCB',
			1500.3,
			0
		);
	});

test('Malaysia — a PCB rule tells a 181-day contract from a 182-day one (MTD spec 2026 D(a) note)', () => {
	// LHDN Specification for MTD Calculations Using Computerised Calculation 2026, D(a) note: from
	// August 2017 resident MTD applies to a foreign worker "with an employment contract of or more
	// than 182 days". Counted first day to last inclusive: 1 Jan – 30 Jun 2026 is 31+28+31+30+31+30
	// = 181 days, 1 Jan – 1 Jul 2026 is 182; both are six whole months, so `contract_months` alone
	// cannot draw the line. An open-ended contract states no length: 0, with `open_ended` true.
	const people = [
		{ key: 'C-181', exit_date: '2026-06-30' },
		{ key: 'C-182', exit_date: '2026-07-01' },
		{ key: 'C-OPEN' }
	].map((row) => ({
		...row,
		wage: 5001,
		employment_type: row.exit_date == null ? 'PERMANENT' : 'CONTRACT',
		citizenship: 'FOREIGNER',
		hire_date: '2026-01-01',
		registrations: MY_FOREIGN
	}));
	const book = assessStatutory({ code: 'MY', period: '2026-06', people }, (world) => {
		// A probe rule ahead of the seeded ones: employee share = the contract's days, employer
		// share = whether the note's threshold is met.
		for (const row of world.statutory_contributions.filter((r) => r.code === 'PCB'))
			row.rules = [
				{
					when: 'true',
					employee: 'person.employment.contract_days * 1.0',
					employer:
						'person.employment.contract_days >= 182 && person.employment.contract_months == 6 ? 1.0 : 0.0'
				},
				...row.rules
			];
	});
	expectStatutory(book, 'C-181', 'PCB', 181, 0);
	expectStatutory(book, 'C-182', 'PCB', 182, 1);
	expectStatutory(book, 'C-OPEN', 'PCB', 0, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Round 4, 28 September 2026: the 182-day foreign contract, para 22 recovery, para 25C award.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const code of ['MY'] as const)
	test(`${code} — a foreign worker on a 182-day contract is withheld at resident MTD, on 181 days at 30% (MTD spec 2026 D(a) note)`, () => {
		// LHDN MTD Specification 2026 D(a) note (p.9): "With effect from August 2017, MTD for resident
		// on foreign workers is applicable to employees with an employment contract of or more than 182
		// days". 1 Jan – 30 Jun 2026 is 181 days, 1 Jan – 1 Jul 182 (first day to last inclusive).
		// Owner rule 2026-09-28: an open-ended contract states no length, so the recorded residency
		// governs; a PERMANENT_RESIDENT is not a foreign worker.
		const people = [
			{ key: 'C-181', exit_date: '2026-06-30' },
			{ key: 'C-182', exit_date: '2026-07-01' },
			{ key: 'C-182-NR', exit_date: '2026-07-01', tax_residency: 'NON_RESIDENT' },
			{ key: 'C-OPEN' }
		].map((row) => ({
			// Not known to be resident, unless the row records otherwise.
			tax_residency: null,
			wage: 5001,
			employment_type: row.exit_date == null ? 'PERMANENT' : 'CONTRACT',
			citizenship: 'FOREIGNER',
			hire_date: '2026-01-01',
			registrations: MY_FOREIGN,
			...row
		}));
		const book = assessStatutory({ code, period: '2026-01', people });
		// 181 days, and open-ended: D(a)'s 30% × 5,001 = 1,500.30.
		expectStatutory(book, 'C-181', 'PCB', 1500.3, 0);
		expectStatutory(book, 'C-OPEN', 'PCB', 1500.3, 0);
		// 182 days, whatever the recorded status: D(b)(1) normal remuneration. Y1 = Y2 = 5,001, n = 11.
		// K1 = EPF Part F employee 2% × 5,001 = 100.02 (A1760 Part F para 2 rounds the total; the
		// employee share stays at 2%); K2 = lower of 100.02 and (4,000 − 100.02) ÷ 11 = 354.54 →
		// 100.02. EIS: none for a non-citizen (Act 800 s.2). SOCSO relieves nothing without a TP1
		// claim (MTD spec 2026 D.2(ii) item k). Personal relief 9,000.
		// P = (5,001 − 100.02) × 12 − 9,000 = 49,811.76.
		// Table 1 "35,001 – 50,000": 600 + 14,811.76 × 6% = 1,488.7056; ÷ 12 = 124.0588 → 124.05
		// (E(1)) → 124.05 (E(2)).
		expectStatutory(book, 'C-182', 'PCB', 124.05, 0);
		expectStatutory(book, 'C-182-NR', 'PCB', 124.05, 0);
	});

for (const code of ['MY'] as const)
	test(`${code} — past sixty days the exempt months are recovered at 30% (ITA Schedule 6 para 22)`, () => {
		// Schedule 6 para 22 (AGC online text as at 1 January 2026) removes the para 21 exemption once
		// the employment in Malaysia exceeds sixty days. Owner rule 2026-09-28 (law silent on timing):
		// the declaring month withholds 30% of the year's base less the MTD already charged.
		const people = (elections: Record<string, boolean>) => [
			{
				key: 'NR',
				wage: 5001,
				citizenship: 'FOREIGNER',
				tax_residency: 'NON_RESIDENT',
				registrations: { ...MY_FOREIGN, PCB: { kind: 'REGISTERED', elections } }
			}
		];
		const january = buildStatutory({
			code,
			period: '2026-01',
			people: people({})
		}).slips.get('NR')!;
		// Model a previously paid nil-MTD slip from before the paragraph 21 evidence guard.
		const historicJanuary = {
			...january,
			statutory: january.statutory.map((row) =>
				row.scheme_code === 'PCB' ? { ...row, employee_amount: 0 } : row
			)
		};
		const february = (elections: Record<string, boolean>) =>
			assessStatutory({ code, period: '2026-02', people: people(elections) }, (world) => {
				world.payroll_runs.push({ id: 'paid-january', company_id: COMPANY_ID, period: '2026-01' });
				world.payslips.push({
					...historicJanuary,
					id: 'para21-january-slip',
					payroll_run_id: 'paid-january',
					status: 'PAID',
					paid_at: '2026-01-31'
				});
			});
		// Crossed and declared: 30% × (5,001 + 5,001) = 3,000.60, less the nil January = 3,000.60.
		expectStatutory(february({ pcb_sch6_para22_recover: true }), 'NR', 'PCB', 3000.6, 0);
		// Not declared: February alone, 30% × 5,001 = 1,500.30.
		expectStatutory(february({}), 'NR', 'PCB', 1500.3, 0);
	});

for (const code of ['MY'] as const)
	test(`${code} — a long service award: RM2,000 tax-exempt after ten years, SOCSO/EIS wages, outside EPF and HRD (ITA Sch.6 para 25C)`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const book = assessStatutory(
			{
				code,
				period: '2026-01',
				people: [
					// Eleven years with the same employer: "more than 10 years".
					{
						key: 'LS-11',
						wage: 5001,
						hire_date: '2015-01-01',
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL
					},
					// Exactly ten years at the 31 January period end: not "more than 10 years"
					// (Sch.6 para 25C; LHDN Public Ruling 5/2019 para 7.1.1(c), p.18) — no exemption.
					{
						key: 'LS-10',
						wage: 5001,
						hire_date: '2016-01-31',
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL
					},
					// Nine years: no exemption.
					{
						key: 'LS-9',
						wage: 5001,
						hire_date: '2017-01-01',
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL
					}
				]
			},
			(world) => {
				for (const [index, employment] of world.employments.entries())
					world.adhoc_requests!.push({
						id: `d0000000-0000-4000-8000-0000000a5a${index}0`,
						employment_id: employment.id,
						catalogue_id: rowIn(world.adhoc_catalogue!, settingsId, 'LONG_SERVICE_AWARD'),
						amount: 3000,
						event_date: '2026-01-01',
						pay_period: null,
						payslip_id: null,
						reason: 'long service award',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
			}
		);
		for (const key of ['LS-11', 'LS-10', 'LS-9']) {
			// EPF Act s.2 "wages" (c) "any gratuity" (owner rule 2026-09-28): the 5,001 wage alone.
			// Third Schedule Part A bracket 5,100: 11% = 561, 12% (wage above RM5,000) = 612.
			expectStatutoryBase(book, key, 'EPF', 5001);
			expectStatutory(book, key, 'EPF', 561, 612);
			// Act 4 s.2(24): not a gratuity on discharge/retirement, not an annual bonus — wages.
			// 8,001 is above the RM6,000 ceiling: Third Schedule last row 29.75 / 104.15 (5,001 alone
			// would be the "5,000 – 5,100" row, 25.25 / 88.35); Act 800 Second Schedule 11.90 / 11.90.
			expectStatutoryBase(book, key, 'SOCSO', 8001);
			expectStatutory(book, key, 'SOCSO', 29.75, 104.15);
			expectStatutory(book, key, 'EIS', 11.9, 11.9);
			// Act 612 s.2: not basic salary, fixed allowance, leave pay or arrears.
			expectStatutoryBase(book, key, 'HRDF', 5001);
		}
		// PCB base: para 25C takes RM2,000 out after more than ten years: 5,001 + 3,000 − 2,000.
		expectStatutoryBase(book, 'LS-11', 'PCB', 6001);
		expectStatutoryBase(book, 'LS-10', 'PCB', 8001);
		expectStatutoryBase(book, 'LS-9', 'PCB', 8001);
		// MTD 2026 D(b)(1)–(2). Normal: Y1 = Y2 = 5,001, n = 11; K1 = 561; K2 = lower of 561 and
		// (4,000 − 561) ÷ 11 = 312.636 → 312.63 (E(1)); no SOCSO/EIS relief without TP1 (D.2(ii) k);
		// personal 9,000. P = 4,440 + 11 × 4,688.37 − 9,000 = 47,012.07. Table 1 "35,001 – 50,000":
		// 600 + 12,012.07 × 6% = 1,320.7242; ÷ 12 = 110.06 → 110.10.
		// Additional: Kt = 0 (no EPF on the award). Tax on P + Yt, less 12 × 110.10 = 1,321.20:
		// LS-11: Yt = 1,000 → 600 + 13,012.07 × 6% = 1,380.72 − 1,321.20 = 59.52 → 59.55;
		// 110.10 + 59.55 = 169.65.
		// LS-9: Yt = 3,000 → 50,012.07, Table 1 "50,001 – 70,000": 1,500 + 12.07 × 11% = 1,501.32
		// − 1,321.20 = 180.12 → 180.15; 110.10 + 180.15 = 290.25; LS-10 the same. (Table 1 B at
		// 20,001–35,000 is −250, the s.6A RM400 rebate; a RM3,000 wage would withhold nothing either
		// way, so the probe sits above RM35,000.)
		expectStatutory(book, 'LS-11', 'PCB', 169.65, 0);
		expectStatutory(book, 'LS-10', 'PCB', 290.25, 0);
		expectStatutory(book, 'LS-9', 'PCB', 290.25, 0);
	});

/** An ad hoc payment of `code` in January 2026 for every employment in the world. */
const adhocForAll = (
	world: PayrollWorld,
	settingsId: string,
	pay: Record<string, [string, number][]>
) => {
	let index = 0;
	for (const employment of world.employments)
		for (const [code, amount] of pay[employment.employee_number] ?? [])
			world.adhoc_requests!.push({
				id: `d0000000-0000-4000-8000-0000000b${String(index++).padStart(4, '0')}`,
				employment_id: employment.id,
				catalogue_id: rowIn(world.adhoc_catalogue!, settingsId, code),
				amount,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: code,
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
};

for (const code of ['MY'] as const)
	test(`${code} — a past-achievement, excellence, innovation or productivity award shares the RM2,000 with long service (ITA Sch.6 para 25C)`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const book = assessStatutory(
			{
				code,
				period: '2026-01',
				people: [
					// Nine years: para 25C's ten-year condition binds the long service award alone.
					{
						key: 'EX-9',
						wage: 5001,
						hire_date: '2017-01-01',
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL
					},
					// Eleven years, both awards: one RM2,000 cap for the two (LHDN PR 5/2019 para 7.1.1, Example 11).
					{
						key: 'EX-LS-11',
						wage: 5001,
						hire_date: '2015-01-01',
						citizenship: 'CITIZEN',
						registrations: MY_LOCAL
					}
				]
			},
			(world) =>
				adhocForAll(world, settingsId, {
					'EX-9': [['EXCELLENCE_AWARD', 3000]],
					'EX-LS-11': [
						['EXCELLENCE_AWARD', 3000],
						['LONG_SERVICE_AWARD', 3000]
					]
				})
		);
		// EPF Act s.2 "wages" includes any bonus; KWSP FAQ Q8 lists incentives: the award is EPF wages.
		// 8,001 → Third Schedule Part A bracket 8,100: 11% = 891, 12% = 972. The long service award
		// stays outside (s.2 (c) gratuity, owner rule 2026-09-28), so EX-LS-11's EPF base is 8,001 too.
		for (const key of ['EX-9', 'EX-LS-11']) {
			expectStatutoryBase(book, key, 'EPF', 8001);
			expectStatutory(book, key, 'EPF', 891, 972);
			// Act 612 s.2 (e) "any bonus": outside HRD.
			expectStatutoryBase(book, key, 'HRDF', 5001);
			// Act 4 s.2(24) / Act 800 s.2: wages; above the RM6,000 ceiling — 29.75 / 104.15, EIS 11.90.
			expectStatutory(book, key, 'SOCSO', 29.75, 104.15);
			expectStatutory(book, key, 'EIS', 11.9, 11.9);
		}
		expectStatutoryBase(book, 'EX-9', 'SOCSO', 8001);
		expectStatutoryBase(book, 'EX-LS-11', 'SOCSO', 11001);
		// PCB base: 5,001 + 3,000 − 2,000 = 6,001; 5,001 + 6,000 − 2,000 (one cap) = 9,001.
		expectStatutoryBase(book, 'EX-9', 'PCB', 6001);
		expectStatutoryBase(book, 'EX-LS-11', 'PCB', 9001);
		// MTD 2026 D(b). Normal (both): Y1 = Y2 = 5,001, n = 11, K1 = 561 (EPF on the normal 5,001),
		// K2 = lower of 561 and (4,000 − 561) ÷ 11 = 312.63 (E(1)); no SOCSO/EIS relief without TP1:
		// P = 4,440 + 11 × 4,688.37 − 9,000 = 47,012.07 → 600 + 12,012.07 × 6% = 1,320.7242 ÷ 12 → 110.10.
		// Additional: Kt = 330, K2 = (4,000 − 891) ÷ 11 = 282.63 (the EPF relief stays 3,999.93):
		// EX-9, Yt 1,000: 4,440 + 11 × 4,718.37 + 670 − 9,000 = 48,012.07 → 600 + 13,012.07 × 6% =
		// 1,380.72 − 12 × 110.10 = 59.52 → 59.55; 110.10 + 59.55 = 169.65.
		// EX-LS-11, Yt 4,000: 51,012.07 → Table 1 "50,001 – 70,000" 1,500 + 1,012.07 × 11% =
		// 1,611.32 − 1,321.20 = 290.12 → 290.15; 110.10 + 290.15 = 400.25.
		expectStatutory(book, 'EX-9', 'PCB', 169.65, 0);
		expectStatutory(book, 'EX-LS-11', 'PCB', 400.25, 0);
	});

for (const code of ['MY'] as const)
	test(`${code} — official-duty travel is tax-exempt to RM6,000 and no contribution wage; child care to RM3,000, meal and parking exempt but contribution wages (MTD spec 2026 E(9))`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const book = assessStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{ key: 'TRAVEL-500', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'TRAVEL-7000', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'ALLOW', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL }
				]
			},
			(world) => {
				adhocForAll(world, settingsId, {
					'TRAVEL-500': [['TRAVEL_OFFICIAL', 500]],
					'TRAVEL-7000': [['TRAVEL_OFFICIAL', 7000]]
				});
				const employment = world.employments.find((row) => row.employee_number === 'ALLOW')!;
				const terms = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				terms.allowances = [
					{
						catalogue_id: rowIn(world.allowance_catalogue, settingsId, 'CHILDCARE_ALLOWANCE'),
						amount: 250
					},
					{
						catalogue_id: rowIn(world.allowance_catalogue, settingsId, 'MEAL_ALLOWANCE'),
						amount: 200
					},
					{
						catalogue_id: rowIn(world.allowance_catalogue, settingsId, 'PARKING_ALLOWANCE'),
						amount: 100
					}
				];
			}
		);
		// Travel: EPF s.2 and KWSP FAQ Q11, Act 4 s.2(24)(b), Act 800 s.2 (b), Act 612 s.2 (b) exclude a
		// travelling allowance — every contribution base is the 5,001 wage: EPF 561 / 612 (bracket 5,100),
		// SOCSO 25.25 / 88.35 ("5,000 – 5,100"), EIS 10.10.
		for (const key of ['TRAVEL-500', 'TRAVEL-7000']) {
			for (const scheme of ['EPF', 'SOCSO', 'EIS', 'HRDF'])
				expectStatutoryBase(book, key, scheme, 5001);
			expectStatutory(book, key, 'EPF', 561, 612);
			expectStatutory(book, key, 'SOCSO', 25.25, 88.35);
			expectStatutory(book, key, 'EIS', 10.1, 10.1);
		}
		// PCB: RM6,000 a year exempt (E(9) item i; PR 5/2019 para 7.2.1). 500 → base 5,001; 7,000 → 6,001.
		expectStatutoryBase(book, 'TRAVEL-500', 'PCB', 5001);
		expectStatutoryBase(book, 'TRAVEL-7000', 'PCB', 6001);
		// TRAVEL-500 is the plain 5,001 (no TP1, so no SOCSO/EIS relief): P = 4,440 + 11 × 4,688.37 −
		// 9,000 = 47,012.07 → 600 + 12,012.07 × 6% = 1,320.7242 ÷ 12 = 110.06 → 110.10.
		expectStatutory(book, 'TRAVEL-500', 'PCB', 110.1, 0);
		// TRAVEL-7000: the taxable 1,000 is normal remuneration (a monthly allowance, spec D(1)), so
		// Y1 = Y2 = 6,001, K1 = 561, K2 = 312.63: P = 5,440 + 11 × 5,688.37 − 9,000 = 59,012.07 →
		// Table 1 "50,001 – 70,000" 1,500 + 9,012.07 × 11% = 2,491.3277 ÷ 12 = 207.61 → 207.65.
		expectStatutory(book, 'TRAVEL-7000', 'PCB', 207.65, 0);
		// ALLOW: 5,001 + child care 250 + meal 200 + parking 100 = 5,551. EPF "Allowance" (KWSP FAQ Q8):
		// Part A bracket 5,600 → 616 / 672. Act 4 Third Schedule "exceeding 5,500 not exceeding 5,600"
		// 27.75 / 97.15; Act 800 Second Schedule 11.10. Act 612 s.2 fixed allowances in cash: 5,551.
		for (const scheme of ['EPF', 'SOCSO', 'EIS', 'HRDF'])
			expectStatutoryBase(book, 'ALLOW', scheme, 5551);
		expectStatutory(book, 'ALLOW', 'EPF', 616, 672);
		expectStatutory(book, 'ALLOW', 'SOCSO', 27.75, 97.15);
		expectStatutory(book, 'ALLOW', 'EIS', 11.1, 11.1);
		// PCB: child care inside RM3,000 (item ii), meal (item vii) and parking (item vi) exempt: 5,001.
		// K1 = 616 (E(13)(i): EPF on a tax-exempt allowance is still K1), K2 = (4,000 − 616) ÷ 11 =
		// 307.63, no SOCSO/EIS relief without TP1: P = 4,385 + 11 × 4,693.37 − 9,000 = 47,012.07 →
		// 600 + 12,012.07 × 6% = 1,320.7242 ÷ 12 = 110.06 → 110.10.
		expectStatutoryBase(book, 'ALLOW', 'PCB', 5001);
		expectStatutory(book, 'ALLOW', 'PCB', 110.1, 0);
	});

for (const code of ['MY'] as const)
	test(`${code} — a benefit in kind is Y1 for MTD but never paid, gross or a contribution wage (MTD spec 2026 E(12))`, () => {
		const settingsId = settingsIdOn(code, '2026-01-15');
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{ key: 'PLAIN', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL },
					{ key: 'BIK-1000', wage: 5001, citizenship: 'CITIZEN', registrations: MY_LOCAL }
				]
			},
			(world) => adhocForAll(world, settingsId, { 'BIK-1000': [['BIK_VOLA', 1000]] })
		);
		const plain = slips.get('PLAIN')!;
		const bik = slips.get('BIK-1000')!;
		const charge = (slip: BuiltPayslip, scheme: string) =>
			slip.statutory.find((row) => row.scheme_code === scheme)!;
		// E(12): "shall not appear in the pay slip … as gross salary" — the line prints as information.
		assert.equal(bik.gross, 5001);
		assert.deepEqual(
			bik.adjustments
				.filter((line) => line.component_code === 'BIK_VOLA')
				.map((line) => [line.bucket, line.amount]),
			[['INFORMATION', 1000]]
		);
		// Non-cash: EPF s.2 "remuneration in money", Act 4 s.2(24) / Act 800 s.2 "payable in money",
		// Act 612 s.2 "paid in cash" — every contribution is the plain 5,001's: EPF 561 / 612,
		// SOCSO 25.25 / 88.35, EIS 10.10.
		for (const scheme of ['EPF', 'SOCSO', 'EIS', 'HRDF']) {
			assert.equal(charge(bik, scheme).base_amount, 5001, scheme);
			assert.equal(charge(bik, scheme).employee_amount, charge(plain, scheme).employee_amount);
			assert.equal(charge(bik, scheme).employer_amount, charge(plain, scheme).employer_amount);
		}
		// E(12): BIK/VOLA is part of Y1 (method i, the monthly amount). Y1 = Y2 = 6,001, K1 = 561,
		// K2 = (4,000 − 561) ÷ 11 = 312.63, no SOCSO/EIS relief without TP1: P = 5,440 + 11 × 5,688.37
		// − 9,000 = 59,012.07 → Table 1 "50,001 – 70,000" 1,500 + 9,012.07 × 11% = 2,491.3277 ÷ 12 =
		// 207.61 → 207.65 (the plain 5,001: 110.10).
		assert.equal(charge(plain, 'PCB').base_amount, 5001);
		assert.equal(charge(plain, 'PCB').employee_amount, 110.1);
		assert.equal(charge(bik, 'PCB').base_amount, 6001);
		assert.equal(charge(bik, 'PCB').employee_amount, 207.65);
		// Net: gross less the employee charges — the benefit pays nothing.
		assert.equal(bik.net, Math.round((5001 - 561 - 25.25 - 10.1 - 207.65) * 100) / 100);
	});

test('Malaysia — ITA employer duties cite Act 53 as at 1 January 2026, not the 2006 reprint', () => {
	// AGC "Online version of updated text of reprint", Act 53 as at 1 January 2026: s.82 records
	// seven years; s.83(1) employer's return by 31 March; s.83(1A) statement of remuneration by the
	// last day of February; s.83(2) new employee within thirty days; s.83(3)–(5) cessation and
	// departure notices thirty days ahead, ninety-day withholding; s.83A agent statement by
	// 31 March; s.107 deduction, employer liable for tax it failed to deduct.
	const current =
		'https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3345910_BI/Act%2053%20(Online%202026).pdf';
	const expected = {
		TAX_RECORDS_RETENTION: 's.82 ',
		FORM_E_CP8D: 's.83(1) ',
		EA_FORM: 's.83(1A) ',
		CP22_NEW_EMPLOYEE: 's.83(2) ',
		CP22A_CESSATION_AND_WITHHOLDING: 's.83(3), (5) ',
		CP21_LEAVING_MALAYSIA: 's.83(4)-(5) ',
		CP58_INCENTIVE_STATEMENT: 's.83A ',
		PCB_REMITTANCE: 's.107(1)-(4) '
	};
	for (const code of ['MY'] as const) {
		for (const version of settingsVersions(code)) {
			const obligations = version.obligations as readonly { code: string; authority: string }[];
			for (const [duty, section] of Object.entries(expected)) {
				const authority = obligations.find((row) => row.code === duty)?.authority ?? '';
				assert.ok(
					authority.includes(`Income Tax Act 1967 (Act 53) ${section}(${current})`),
					`${code} ${version.id} ${duty}: ${authority}`
				);
			}
			assert.doesNotMatch(JSON.stringify(version), /LOM\/EN\/Act%2053\.pdf/);
		}
	}
});

test('Malaysia — EPF employer duties cite Act 452 as at 1 July 2022 with Act A1760, not the 2006 reprint', () => {
	// AGC "Online version of updated text of reprint", Act 452 as at 1 July 2022 (the latest
	// updated text on lom.agc.gov.my): s.41(1) register before the end of the first week of the
	// first contribution month, s.41(3) notify cessation; s.42(1)-(2) wage statement, registers
	// open to inspection for not less than six years; s.43 monthly contributions at the Third
	// Schedule rate; s.45 employer pays both shares, s.45(3) dividend on arrears; s.47 employer
	// share irrecoverable; s.49 late payment charges. Act A1760 (Gazette 14 May 2025) touches none
	// of those sections: s.3 substitutes s.70A (noncitizen employees), s.10 deletes Third Schedule
	// Parts B and D and inserts Part F. KWSP's Third Schedule page carries the October 2025 table.
	const act = 'Employees Provident Fund Act 1991 (Act 452) ';
	const current =
		'https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf';
	const a1760 =
		'https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/2844030_BI/Act%20A1760-%20EMPLOYEES%20PROVIDED%20FUND%20(AMENDMENT)%20ACT%202025.pdf';
	const expected: Record<string, readonly string[]> = {
		EPF_REGISTRATION_AND_REMITTANCE: [`${act}s.41(1)-(3) (${current})`],
		EPF_EMPLOYEE_REGISTRATION: [
			`${act}s.43 (${current})`,
			`s.70A as substituted by Act A1760 s.3 (${a1760})`
		],
		EPF_MONTHLY_CONTRIBUTION: [
			`${act}ss.43, 45, 47, 49 (${current})`,
			`Third Schedule as amended by Act A1760 s.10 (${a1760})`,
			'(https://www.kwsp.gov.my/en/epf-act-1991-third-schedule)'
		],
		EPF_RECORDS: [`${act}s.42(1)-(2) (${current})`]
	};
	for (const code of ['MY'] as const) {
		for (const version of settingsVersions(code)) {
			const obligations = version.obligations as readonly { code: string; authority: string }[];
			for (const [duty, parts] of Object.entries(expected)) {
				const authority = obligations.find((row) => row.code === duty)?.authority ?? '';
				for (const part of parts)
					assert.ok(authority.includes(part), `${code} ${version.id} ${duty}: ${authority}`);
			}
			assert.doesNotMatch(JSON.stringify(version), /LOM\/EN\/Act%20452\.pdf/);
		}
	}
});

test('Malaysia — the Employment Act cites the AGC reprint as at 1 August 2023, not a secondary host', () => {
	// The Invest Malaysia copy of Act 265 is byte-identical (1,585,700 B, same SHA-256) to the
	// AGC Commissioner of Law Revision reprint as at 1 August 2023; cite the publisher.
	const jtksmUpdatedText = /jtksm\.mohr\.gov\.my\/sites\/default\/files\/2023-11\/Akta/;
	const reprint =
		'https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf';
	for (const code of ['MY'] as const) {
		for (const version of settingsVersions(code)) {
			const text = JSON.stringify(version);
			assert.ok(text.includes(reprint), `${code} ${version.id}`);
			assert.doesNotMatch(text, /investmalaysia\.gov\.my/);
			// JTKSM's 2023-11 PDF is the AGC updated text as at 1 January 2023, which states on
			// its cover that it is NOT an authentic text (Revision of Laws Act 1968 s.14(1)).
			assert.doesNotMatch(text, jtksmUpdatedText, `${code} ${version.id}`);
		}
		const adhoc = readFileSync(
			new URL(`../seed/jurisdiction/${code}/adhoc_catalogue.json`, import.meta.url),
			'utf8'
		);
		assert.doesNotMatch(adhoc, jtksmUpdatedText, `${code} adhoc_catalogue`);
	}
});

test('Malaysia — PERKESO duties cite the AGC Act 4 text with A1788, and HRD’s 2021 First Schedule its Gazette copy', () => {
	// AGC "Online version of updated text of reprint", Act 4 as at 1 October 2024 (latest amendment
	// Act A1724): s.4 registration of industries; s.6 contributions (amended from 1 June 2026 by
	// Act A1788 s.3); s.14A interest on arrears; Part IV is "Administration, Finance and Audit", so an
	// accident report is the return "required by the regulations" in s.94(e), enforced by s.94A(3).
	// PERKESO's own Act 4 text is as at 1 September 2022 and predates both A1724 and A1788.
	// P.U.(A) 84/2021 is on the AGC federal legislation portal; the HRD Corp copy is a mirror.
	const act4 =
		'https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf';
	const a1788 =
		'https://www.perkeso.gov.my/images/akta/ACT%204/Act_A1788_-_EMPLOYEES_SOCIAL_SECURITY_AMENDMENT_ACT_2026.pdf';
	const expected: Record<string, readonly string[]> = {
		SOCSO_EIS_EMPLOYER_REGISTRATION: ['(Act 4) s.4 (', act4],
		SOCSO_EIS_MONTHLY_CONTRIBUTION: ['(Act 4) ss.6, 14A (', act4, `Act A1788 s.3: ${a1788}`],
		SOCSO_ACCIDENT_REPORT: ['(Act 4) ss.94(e), 94A(3) (', act4]
	};
	const pua84 = 'https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20210226_PUA84.pdf';
	for (const code of ['MY'] as const) {
		let citingPua84 = 0;
		for (const version of settingsVersions(code)) {
			const obligations = version.obligations as readonly { code: string; authority: string }[];
			for (const [duty, parts] of Object.entries(expected)) {
				const authority = obligations.find((row) => row.code === duty)?.authority ?? '';
				for (const part of parts)
					assert.ok(authority.includes(part), `${code} ${version.id} ${duty}: ${authority}`);
				assert.doesNotMatch(authority, /\(Act 4\) Part IV/);
			}
			const text = JSON.stringify(version);
			assert.doesNotMatch(text, /As%20at%201%20September%202022/, `${code} ${version.id}`);
			assert.doesNotMatch(text, /hrdcorp\.gov\.my\/wp-content\/uploads\/2021\/03\/FEDERAL/);
			if (text.includes(pua84)) citingPua84 += 1;
		}
		// Every operative version that listed the HRD Corp mirror now lists the AGC copy.
		assert.equal(citingPua84, settingsVersions(code).length, code);
	}
});

test('Malaysia — a travelling contract allowance is outside the s.60I ordinary rate (EA s.2 “wages” (c))', () => {
	// EA 1955 (AGC reprint as at 1 Aug 2023) s.2 "wages": basic wages and all other payments in cash
	// payable for work done, not including "(c) any travelling allowance or the value of any
	// travelling concession". s.60I(1A): a monthly-rated ordinary rate of pay is the monthly wages
	// ÷ 26. Basic 2,600 + meal allowance 260 (cash, wages) + travelling allowance 520 (not wages):
	// ORP (2,600 + 260) ÷ 26 = 110.00 a day, ÷ 8 normal hours = 13.75 an hour (with the travelling
	// allowance it would read 3,380 ÷ 26 = 130.00). s.60D(3)(a)(i): the holiday's normal day is two
	// days' wages = 220.00. s.60(3)(b)(i): four rest-day hours, half a day = 55.00. s.60A(3)(a):
	// 2 h × 13.75 × 1.5 = 41.25. s.60(3)(b)(ii): the 09:00–16:00 rest-day span less EA s.60A(1)(a)'s
	// thirty minutes after five continuous hours is 6.5 h worked, one day = 110.00.
	const settingsId = settingsIdOn('MY', '2026-01-15');
	const { slips } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'MY-TRAVEL', wage: 2600, citizenship: 'CITIZEN', registrations: REGISTERED_LOCAL }
			]
		},
		(world) => {
			const version = world.jurisdiction_settings.find((row) => row.id === settingsId)!;
			version.work_rules.wage_excluded_allowances = ['TRAVEL_CONTRACT'];
			world.allowance_catalogue.push({
				id: 'a4000000-0000-4000-8000-000000000901',
				settings_id: settingsId,
				code: 'TRAVEL_CONTRACT',
				name: 'Travelling allowance (contract)',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: [],
				approval_id: null
			});
			const employment = world.employments.find((row) => row.employee_number === 'MY-TRAVEL')!;
			world.employment_terms.find((row) => row.employment_id === employment.id)!.allowances = [
				{
					catalogue_id: rowIn(world.allowance_catalogue, settingsId, 'MEAL_ALLOWANCE'),
					amount: 260
				},
				{ catalogue_id: 'a4000000-0000-4000-8000-000000000901', amount: 520 }
			];
			world.jurisdiction_holidays.push(holiday('2026-01-01', 'New Year'));
			// The shift's hour punched as a gap on the two scheduled days: eight hours worked on the
			// holiday, ten on the Monday.
			clocked(world, 'MY-TRAVEL', '2026-01-01', [
				['09:00', '13:00'],
				['14:00', '18:00']
			]);
			punch(world, 'MY-TRAVEL', '2026-01-04', '09:00', '13:00'); // Sunday rest day: four hours
			clocked(world, 'MY-TRAVEL', '2026-01-05', [
				['09:00', '12:00'],
				['13:00', '20:00']
			]);
			punch(world, 'MY-TRAVEL', '2026-01-11', '09:00', '16:00'); // Sunday rest day: seven hours
		}
	);
	// The lineage's company term (Nihon Pigment's contract, owner-approved 2026-09-23) prices each hour at its column on the
	// customer hour 2,600 ÷ 195 = 13.33 — 2.0 on a rest day and a holiday's normal hours, 1.5 on a
	// working day's overrun — and each statutory award above floors it (s.60I(2), s.7). Holiday:
	// 8 × 13.33 × 2 = 213.28 < 220.00, so 220.00. Rest days: 4 × 13.33 × 2 = 106.64 (≥ 55.00),
	// 6.5 × 13.33 × 2 = 173.29 (≥ 110.00). Overtime: the s.60I hour 13.75 is the greater, 41.25.
	assert.deepEqual(workLines(slips.get('MY-TRAVEL')!), [
		['2026-01-01', 'HOLIDAY-2.0X', 8, 220],
		['2026-01-04', 'RESTDAY-2.0X', 4, 106.64],
		['2026-01-05', 'WORKDAY-OT-1.5X', 2, 41.25],
		['2026-01-11', 'RESTDAY-2.0X', 6.5, 173.29]
	]);
	// EPF s.2 and KWSP FAQ Q11: the travelling allowance is no EPF wage either; the meal allowance
	// is. The 220 holiday award within the normal hours is an EPF wage (KWSP Employer FAQ 21), and
	// so is rest-day pay within the normal hours (EA s.60A(3): not overtime; EPF Act s.2 excludes
	// only "overtime payment"): 2,860 + 220 + 106.64 (Sun 4, 4 h) + 173.29 (Sun 11, 6.5 h) =
	// 3,359.93. Mon 5's 41.25 is overtime and stays out.
	const epf = slips.get('MY-TRAVEL')!.statutory.find((row) => row.scheme_code === 'EPF')!;
	assert.equal(epf.base_amount, 3359.93);
});

test('Malaysia — seed-bank data gaps refuse naming the employee and the field, never price silently (F22)', () => {
	for (const code of ['MY'] as const) {
		const run = (
			person: Parameters<typeof assessStatutory>[0]['people'][number],
			drop?: { scheme: string; election: string }
		) =>
			assessStatutory(
				{ code, period: '2026-06', region: 'Malaysia', people: [person] },
				(world) => {
					if (drop == null) return;
					const ids = new Set(
						world.statutory_contributions
							.filter((row) => row.code === drop.scheme)
							.map((row) => row.id)
					);
					for (const fact of world.employment_statutory_facts)
						if (ids.has(fact.statutory_contribution_id))
							delete (fact.status as { elections: Record<string, unknown> }).elections[
								drop.election
							];
				}
			);
		// Golden control, RM1,700 (the Minimum Wages Order 2024 floor): EPF Third Schedule row
		// "1,680.01 – 1,700.00" 187 / 221; EIS Second Schedule row "exceeding RM1,600 but not
		// exceeding RM1,700" 3.30 / 3.30.
		const paid = run({
			key: 'MY-1700',
			wage: 1700,
			citizenship: 'CITIZEN',
			registrations: MY_LOCAL
		});
		expectStatutory(paid, 'MY-1700', 'EPF', 187, 221);
		expectStatutory(paid, 'MY-1700', 'EIS', 3.3, 3.3);
		// Two Nihon staff at RM900: below the RM1,700 floor, a blocker naming the person and the terms.
		assert.throws(
			() => run({ key: 'MY-RM900', wage: 900, citizenship: 'CITIZEN', registrations: MY_LOCAL }),
			/MINIMUM_WAGE_BELOW: MY-RM900 is contracted at 900 a month, below the Malaysia minimum wage of 1700/
		);
		// Nihon terms carry no worksite_state: EA 1955 s.1(2) reaches Peninsular Malaysia and Labuan only.
		assert.throws(
			() =>
				run({
					key: 'MY-NOSTATE',
					wage: 1700,
					citizenship: 'CITIZEN',
					worksite_state: null,
					registrations: MY_LOCAL
				}),
			/MY-NOSTATE: record a supported Peninsular Malaysia or Labuan worksite state on employment terms for \d{4}-\d{2}-\d{2} before payroll\./
		);
		// Foreign NOT_REGISTERED EIS/EPF rows with no election: the exemption rests on the election,
		// so its absence refuses by scheme and label rather than skipping the charge.
		const foreign = {
			key: 'MY-FX',
			wage: 1700,
			citizenship: 'FOREIGNER',
			registrations: MY_FOREIGN
		} as const;
		assert.throws(
			() => run(foreign, { scheme: 'EIS', election: 'mykas_resident' }),
			/MY-FX: EIS: Resident non-citizen holding a reg\.5\(3\)\(c\) identity card is required before calculation\./
		);
		assert.throws(
			() => run(foreign, { scheme: 'EPF', election: 'member_before_1998' }),
			/MY-FX: EPF: EPF member before 1 August 1998 is required before calculation\./
		);
	}
});
