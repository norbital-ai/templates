/**
 * Singapore: expected payslips against the law itself, on both CPF versions.
 *
 * CPF Act; CPF contribution rates from 1 January 2026 (Tables 1, 2 and 3) and from
 * 1 January 2027 (senior-worker increase); Skills Development Levy Act; the four self-help
 * group schedules.
 *
 * The lineage seals three settings versions, but only two move a contribution figure: v1
 * (2026-01-01) carries the 2026 CPF rates and v3 (2027-01-01) the senior-worker increase. v2
 * (2026-04-01) changes Shared Parental Leave only — "no CPF, SDL, SHG or Part 4 figure moves on
 * that date" — so the 2026-01 run below and the 2027-01 run at the end cover both versions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

test('Singapore — CPF across the age ladder and the ordinary-wage ceiling', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'SG-3000-30', wage: 3000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-57', wage: 3000, age: 57, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-62', wage: 3000, age: 62, citizenship: 'CITIZEN' },
			{ key: 'SG-10000-30', wage: 10_000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-1234-30', wage: 1234.5, age: 30, citizenship: 'CITIZEN' }
		]
	});

	// The rounding rule, applied to every CPF figure below: the TOTAL is rounded to the nearest
	// dollar, the employee's share is rounded DOWN, and the employer takes the remainder.
	//
	// Over $750 the full rates apply to the ordinary wage, capped at the $8,000 OW ceiling.
	// 55 and below: 37% total, employee 20%. 20% × 3,000 = 600; total 1,110; employer 510.
	expectStatutory(book, 'SG-3000-30', 'CPF', 600, 510);
	// Above 55 to 60: 34% total from 1 Jan 2026 (employer 16, employee 18). 540 / 480.
	expectStatutory(book, 'SG-3000-57', 'CPF', 540, 480);
	// Above 60 to 65: 25% total from 1 Jan 2026 (12.5 / 12.5). 375 / 375.
	expectStatutory(book, 'SG-3000-62', 'CPF', 375, 375);
	// The OW ceiling: a $10,000 wage is charged as $8,000 — the stated maxima, 1,600 / 1,360.
	expectStatutory(book, 'SG-10000-30', 'CPF', 1600, 1360);
	// A wage that does not divide evenly is where the rounding rule bites: 20% × 1,234.50 = 246.90
	// and 17% × 1,234.50 = 209.865, total 456.765 → $457. Employee rounds DOWN to $246; the
	// employer takes 457 − 246 = $211 — a dollar more than an independently rounded 209.87.
	expectStatutory(book, 'SG-1234-30', 'CPF', 246, 211);
});

test('Singapore — the graduated $500-to-$750 CPF band is not priceable by the engine', () => {
	// Total wages over $500 up to $750 is the graduated band: total = ER% × TW + coeff × (TW−500),
	// and the whole graduated part is the employee's. By hand, from Table 1:
	//
	// 55 and below: coefficient 0.6, employer 17%. Employee 0.6 × 250 = 150; total 17% × 750 + 150
	// = 127.50 + 150 = 277.50 → $278; employer 278 − 150 = $128.
	// Above 55 to 60, from 1 January 2026: coefficient 0.54, employer 16%. Employee 0.54 × 250 =
	// 135; total 120 + 135 = 255 → $255; employer 255 − 135 = $120.
	//
	// None of that runs: a `PROGRESSIVE` award routes through the annualising withholding path
	// (`progressiveWithholding`: annual = 750 × 12 = 9,000), and scaling that through the CPF
	// ladder lands on the $8,000.01+ `FIXED` ceiling band, which refuses with "not a progressive
	// award". The engine has no monthly-progressive-contribution path — CPF is a monthly levy, not
	// a withholding tax — so the whole $500-to-$750 band throws. This pins that refusal; when the
	// engine learns the path, replace the throw with the two figures derived above.
	assert.throws(
		() =>
			assessStatutory({
				code: 'SG',
				period: '2026-01',
				people: [
					{ key: 'SG-750-30', wage: 750, age: 30, citizenship: 'CITIZEN' },
					{ key: 'SG-750-57', wage: 750, age: 57, citizenship: 'CITIZEN' }
				]
			}),
		/not a progressive award/
	);
});

test('Singapore — the SPR first- and second-year graduated ladders', () => {
	// `employee.residency_months` counts from `employment_terms.residency_since` to the period end,
	// 2026-01-31 here: 7 months, 12 months and 36 months respectively.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{
				key: 'SPR-Y1',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-06-15'
			},
			{
				key: 'SPR-Y2',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-01-15'
			},
			{
				key: 'SPR-Y3',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2023-01-15'
			}
		]
	});

	// Table 2, first year, graduated/graduated, 55 and below, wage over $750: employer 4%,
	// employee 5%. 150 / 120, total 270 — no rounding to do.
	expectStatutory(book, 'SPR-Y1', 'CPF', 150, 120);
	// Table 3, second year: employer 9%, employee 15%. 450 / 270, total 720.
	expectStatutory(book, 'SPR-Y2', 'CPF', 450, 270);
	// Third year onward the full Table 1 rates apply: 600 / 510.
	expectStatutory(book, 'SPR-Y3', 'CPF', 600, 510);
});

test('Singapore — SDL and the self-help group funds', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			// $780, not $750: a wage in the graduated CPF band cannot be priced at all (see above),
			// and $780 is still under the $800 SDL minimum threshold.
			{ key: 'SG-780-30', wage: 780, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{
				key: 'SG-3000-30',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'MALAY',
				religion: 'ISLAM'
			},
			{ key: 'SG-10000-30', wage: 10_000, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' }
		]
	});

	// SDL: 0.25% of monthly total wages, employer-borne, a $2 minimum below $800 a month and an
	// $11.25 maximum above $4,500. 0.25% × 800 = 2.00 exactly, so the ladder is continuous.
	expectStatutory(book, 'SG-780-30', 'SDL', 0, 2); // 0.25% × 780 = 1.95, below the $2 minimum
	expectStatutory(book, 'SG-3000-30', 'SDL', 0, 7.5);
	expectStatutory(book, 'SG-10000-30', 'SDL', 0, 11.25);

	// The self-help groups are employee-borne and selected by race, or by religion for MBMF.
	// CDAC: $0.50 at $2,000 and below. MBMF: $6.50 for wages over $2,000 up to $3,000.
	// SINDA: $10,000 sits at the top of the $7,501–$10,000 row → $12; the $18 row starts above
	// $10,000 (SINDA 30 Aug 2014 schedule; the seed carries it exactly).
	expectStatutory(book, 'SG-780-30', 'CDAC', 0.5, 0);
	expectStatutory(book, 'SG-3000-30', 'MBMF', 6.5, 0);
	expectStatutory(book, 'SG-10000-30', 'SINDA', 12, 0);
	// A fund the person's race or religion does not reach charges nothing at all.
	expectStatutorySkipped(book, 'SG-780-30', 'SINDA');
	expectStatutorySkipped(book, 'SG-3000-30', 'CDAC');
});

test('Singapore — the 1 January 2027 senior-worker CPF increase (second version)', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2027-01',
		people: [
			{ key: 'SG-3000-57', wage: 3000, age: 57, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-62', wage: 3000, age: 62, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-30', wage: 3000, age: 30, citizenship: 'CITIZEN' }
		]
	});

	// Above 55 to 60 rises to a 35.5% total (employer 16.5%, employee 19%): 19% × 3,000 = 570;
	// total 1,065; employer 495. Above 60 to 65 rises to 26% (13% / 13%): 390 / 390.
	// 55 and below is untouched: 600 / 510, as in 2026.
	expectStatutory(book, 'SG-3000-57', 'CPF', 570, 495);
	expectStatutory(book, 'SG-3000-62', 'CPF', 390, 390);
	expectStatutory(book, 'SG-3000-30', 'CPF', 600, 510);
	// SDL does not move on that seam: 0.25% × 3,000 = 7.50, all three.
	expectStatutory(book, 'SG-3000-57', 'SDL', 0, 7.5);
	expectStatutory(book, 'SG-3000-62', 'SDL', 0, 7.5);
});
