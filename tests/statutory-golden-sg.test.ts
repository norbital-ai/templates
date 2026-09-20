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
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	leaveCatalogue,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

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

test('Singapore — the CPF age band moves the month after the birthday, not in the birthday month', () => {
	// CPF Act First Schedule: the higher rate applies "in the month following" the birthday. The
	// rules read completed months, so a member born 31 January 1971 is in the 55-and-below band for
	// the January 2026 payroll (55 years and 0 months at its end) and in the above-55 band from
	// February (55 years and 1 month). Rates from 1 January 2026: 37% total / 20% employee to 55,
	// 34% / 18% above 55.
	const people = [
		{ key: 'SG-BIRTHDAY', wage: 3000, birth_date: '1971-01-31', citizenship: 'CITIZEN' as const }
	];
	const birthdayMonth = assessStatutory({ code: 'SG', period: '2026-01', people });
	expectStatutory(birthdayMonth, 'SG-BIRTHDAY', 'CPF', 600, 510);

	const monthAfter = assessStatutory({ code: 'SG', period: '2026-02', people });
	expectStatutory(monthAfter, 'SG-BIRTHDAY', 'CPF', 540, 480);
});

test('Singapore — the graduated $500-to-$750 CPF band is a monthly award on the period wage', () => {
	// Total wages over $500 up to $750 is the graduated band: total = ER% × TW + coeff × (TW−500),
	// and the whole graduated part is the employee's. By hand, from Table 1:
	//
	// 55 and below: coefficient 0.6, employer 17%. Employee 0.6 × 250 = 150; total 17% × 750 + 150
	// = 127.50 + 150 = 277.50 → $278; employer 278 − 150 = $128.
	// Above 55 to 60, from 1 January 2026: coefficient 0.54, employer 16%. Employee 0.54 × 250 =
	// 135; total 120 + 135 = 255 → $255; employer 255 − 135 = $120.
	//
	// CPF is a monthly levy, not a withholding tax: the graduated rung sits inside a WAGE ladder
	// whose neighbours are `PERCENT` and `FIXED`, so it is charged on this period's wage and never
	// annualised. The two figures are the whole of the engine's claim here — the employer share is
	// the remainder of the dollar-rounded total, exactly as it is on every other CPF band.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'SG-750-30', wage: 750, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-750-57', wage: 750, age: 57, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'SG-750-30', 'CPF', 150, 128);
	expectStatutory(book, 'SG-750-57', 'CPF', 135, 120);
	// SDL still applies its own $2 minimum below $800 of monthly total wages.
	expectStatutory(book, 'SG-750-30', 'SDL', 0, 2);
});

test('Singapore — the SPR first- and second-year graduated ladders', () => {
	// `employee.residency_months` counts from `employment_terms.residency_since` to the period end,
	// 2026-01-31 here: 7 months, 13 months and 36 months respectively. The second year of SPR
	// status begins on the first day of the month after the first anniversary (CPF Board), so a
	// person whose anniversary fell in January is still in year one this January; thirteen
	// completed months is the first month of year two.
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
				residency_since: '2024-12-15'
			},
			{
				key: 'SPR-Y3',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2023-01-15'
			},
			{
				// A first-year SPR and the employer may jointly elect full rates (CPF Act First
				// Schedule Tables 4/5): the election is a fact of the employment under CPF.
				key: 'SPR-Y1-ELECTED',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-06-15',
				registrations: {
					CPF: {
						kind: 'REGISTERED',
						elections: { spr_full_rate: true, spr_approval_reference: 'CPF-APPROVAL' }
					}
				}
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
	// The elected first-year SPR takes the full Table 1 rates from the start.
	expectStatutory(book, 'SPR-Y1-ELECTED', 'CPF', 600, 510);
});

test('Singapore — SDL and the self-help group funds', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			// $780: over the graduated CPF band's $750 top (that band is priced above), and still
			// under the $800 SDL minimum threshold.
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

test('Singapore — an SHG opt-out turns the fund off for that employment', () => {
	// An employee may opt out of a self-help fund by written application to the fund; the schedule
	// is the default deduction. The election is a fact of the employment under that fund, read as
	// `scheme.elections.shg_opt_out`.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'SG-CHINESE', wage: 1500, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{
				key: 'SG-OPTED-OUT',
				wage: 1500,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				registrations: {
					CDAC: {
						kind: 'REGISTERED',
						elections: { shg_opt_out: true, shg_instruction_reference: 'FUND-NOTICE' }
					}
				}
			}
		]
	});
	// CDAC: $0.50 for wages over $0 up to $2,000.
	expectStatutory(book, 'SG-CHINESE', 'CDAC', 0.5, 0);
	expectStatutorySkipped(book, 'SG-OPTED-OUT', 'CDAC');
});

test('Singapore — a foreigner is outside CPF, and the cent above a ceiling is inside it', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-05',
		people: [
			{ key: 'SG-F-3000', wage: 3000, age: 30, citizenship: 'FOREIGNER' },
			{ key: 'SG-750.01', wage: 750.01, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-8000.01', wage: 8000.01, age: 30, citizenship: 'CITIZEN' }
		]
	});
	// CPF Act: contributions are for Singapore citizens and permanent residents. A work-pass
	// holder draws no CPF row at all; the Skills Development Levy is still due on their wage.
	expectStatutorySkipped(book, 'SG-F-3000', 'CPF');
	expectStatutory(book, 'SG-F-3000', 'SDL', 0, 7.5);
	// "Exceeding $750": the full 37% on $750.01 → total 277.50 → 278; employee 20% → 150, employer 128.
	expectStatutory(book, 'SG-750.01', 'CPF', 150, 128);
	// Above the $8,000 ordinary-wage ceiling the charge is the ceiling's: 1,600 / 1,360.
	expectStatutory(book, 'SG-8000.01', 'CPF', 1600, 1360);
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

test('Singapore — the 1 April 2026 version moves no contribution at all', () => {
	// SG has three sealed versions, and the middle one exists for exactly one change: shared
	// parental leave goes from six weeks to ten for a child born on or after 1 April 2026
	// (bank `SG/README.md` v2: "This is the only change on 1 April 2026: no CPF, SDL, SHG or
	// Part 4 change"). That change is asserted in `leave-entitlement-golden.test.ts`; what belongs
	// here is the other half of the claim — that every contribution figure is January's.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-04',
		people: [
			{ key: 'SG-3000-30', wage: 3000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-57', wage: 3000, age: 57, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-62', wage: 3000, age: 62, citizenship: 'CITIZEN' },
			{ key: 'SG-10000-30', wage: 10_000, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' }
		]
	});

	// Table 1 rates, unchanged from 1 January 2026: 37% total employee 20%; 34% employer 16 /
	// employee 18; 25% split evenly. The $8,000 OW ceiling maxima are still 1,600 / 1,360.
	expectStatutory(book, 'SG-3000-30', 'CPF', 600, 510);
	expectStatutory(book, 'SG-3000-57', 'CPF', 540, 480);
	expectStatutory(book, 'SG-3000-62', 'CPF', 375, 375);
	expectStatutory(book, 'SG-10000-30', 'CPF', 1600, 1360);
	// SDL: 0.25% with the $11.25 maximum above $4,500. SINDA: the "over $7,500 up to $10,000" rung
	// is $12, and a wage of exactly $10,000 is its top, not the bottom of the $18 one.
	expectStatutory(book, 'SG-3000-30', 'SDL', 0, 7.5);
	expectStatutory(book, 'SG-10000-30', 'SDL', 0, 11.25);
	expectStatutory(book, 'SG-10000-30', 'SINDA', 12, 0);
});

test('Singapore — the December 2025 version carries the 2025 CPF tables', () => {
	// CPF Board, CPF Contribution Rate Table from 1 January 2025: above 55 to 60 at 32.5%
	// (15.5% employer, 17% employee), above 60 to 65 at 23.5% (12% / 11.5%), ordinary-wage ceiling
	// $7,400. Everything else is the January 2026 version's.
	const book = assessStatutory({
		code: 'SG',
		period: '2025-12',
		people: [
			{ key: 'SG-3000-30', wage: 3000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-57', wage: 3000, age: 57, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-62', wage: 3000, age: 62, citizenship: 'CITIZEN' },
			{ key: 'SG-10000-30', wage: 10_000, age: 30, citizenship: 'CITIZEN' }
		]
	});
	// 37% of 3,000 = 1,110; employee 20% = 600; employer 510 — unchanged from 2026.
	expectStatutory(book, 'SG-3000-30', 'CPF', 600, 510);
	// 32.5% of 3,000 = 975; employee 17% = 510; employer 465 (34% / 18% from January 2026).
	expectStatutory(book, 'SG-3000-57', 'CPF', 510, 465);
	// 23.5% of 3,000 = 705; employee 11.5% = 345; employer 360 (25% / 12.5% from January 2026).
	expectStatutory(book, 'SG-3000-62', 'CPF', 345, 360);
	// The $7,400 ceiling: 37% of 7,400 = 2,738; employee 1,480; employer 1,258.
	expectStatutory(book, 'SG-10000-30', 'CPF', 1480, 1258);
});

test('Singapore — the SPR year turns on the month after the anniversary, whatever its day', () => {
	// CPF Board: "The second year begins on the first day of the month after the first anniversary
	// of SPR conversion." A 31 March 2025 conversion has its anniversary in March 2026, so April
	// 2026 is the first month of year two — Table 3, 55 and below: employer 9%, employee 15%,
	// 450 / 270 on $3,000. A 30 April 2025 conversion is still in year one for April (Table 2,
	// 150 / 120) and in year two from May. The count is calendar months, so the day of the
	// conversion never holds a person back a month.
	const people = [
		{
			key: 'SPR-MAR-31',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2025-03-31'
		},
		{
			key: 'SPR-APR-30',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2025-04-30'
		}
	];
	const april = assessStatutory({ code: 'SG', period: '2026-04', people });
	expectStatutory(april, 'SPR-MAR-31', 'CPF', 450, 270);
	expectStatutory(april, 'SPR-APR-30', 'CPF', 150, 120);
	const may = assessStatutory({ code: 'SG', period: '2026-05', people });
	expectStatutory(may, 'SPR-APR-30', 'CPF', 450, 270);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Employment Act 1968 Part 4 and Part 3: the pay side of the statute. The world's shift is
// 09:00–18:00 with a sixty-minute break — eight normal hours, Monday to Friday, Saturday and
// Sunday rest days — so every figure below is a hand derivation from the Fourth Schedule (hourly
// basic rate = 12 × monthly ÷ (52 × 44), or 52 × the contract's hours under 44), Third Schedule item 2 (basic rate for one day =
// 12 × monthly ÷ (52 × days required to work in a week)), s.38(4) (1.5× beyond the normal
// hours), s.37(3) (rest day at the employer's request: one day's pay up to half the normal
// hours, two days' up to the normal hours, 1.5× beyond them), s.88(4) (an extra day's salary at
// the basic rate for work on a public holiday, 1.5× beyond the normal hours per MOM) and s.35
// (Part 4 covers a workman at not more than $4,500 basic and a non-workman at not more than
// $2,600). Wages are multiples of 2,288 = 52 × 44, so every rate is exact in cents.
// ─────────────────────────────────────────────────────────────────────────────────────────────

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
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	requestedBy: 'EMPLOYER' | 'EMPLOYEE' | null = null
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: requestedBy,
		approval_id: null
	});
};
/** A day read and found empty: the calendar's own record of a day nobody worked. */
const emptyDay = (world: PayrollWorld, key: string, date: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [],
		requested_by: null,
		approval_id: null
	});
};
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const scheme = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((charge) => charge.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};

test('Singapore — Part 4 pay: the Fourth Schedule hour, the Third Schedule day, rest days and a holiday', () => {
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				// A workman at $2,860 on a 40-hour week: 12 × 2,860 ÷ (52 × 40) = 16.50 an hour (s.2,
				// a contract of fewer than 44 hours); 12 × 2,860 ÷ (52 × 5) = 132.00 a day. Inside the
				// $4,500 workman ceiling.
				{
					key: 'SG-WORKMAN',
					wage: 2860,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR'
				},
				// A non-workman at $2,288: 13.20 an hour, 105.60 a day. Inside the $2,600 ceiling.
				{ key: 'SG-CLERK', wage: 2288, citizenship: 'CITIZEN' },
				// The same $2,860 as a non-workman is over $2,600: s.35(b) takes Part 4 away.
				{ key: 'SG-CLERK-OVER', wage: 2860, citizenship: 'CITIZEN' },
				// A workman at $4,576 is over $4,500: s.35(a) takes it away too.
				{
					key: 'SG-WORKMAN-OVER',
					wage: 4576,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR'
				}
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-01', "New Year's Day"));
			for (const key of ['SG-WORKMAN', 'SG-CLERK', 'SG-CLERK-OVER', 'SG-WORKMAN-OVER']) {
				punch(world, key, '2026-01-01', '09:00', '20:00'); // Thursday holiday: ten hours
				punch(world, key, '2026-01-05', '09:00', '20:00'); // Monday: two hours past the shift
				punch(world, key, '2026-01-10', '09:00', '13:00'); // Saturday rest day: four hours
				punch(world, key, '2026-01-11', '09:00', '16:00'); // Sunday rest day: seven hours
				punch(world, key, '2026-01-17', '09:00', '20:00'); // Saturday rest day: eleven hours
			}
		}
	);

	// s.88(4): an extra day's salary at the basic rate for the holiday, 132.00, and MOM's 1.5× for
	// the 2 hours beyond the normal day: 2 × 15 × 1.5 = 45.00 (the shift's hour of break comes off
	// a scheduled day's clock, so 09:00–20:00 is ten hours). s.38(4): 2 h × 15.00 × 1.5 = 45.00 on
	// the Monday. s.37(3)(a): four hours does not exceed half of eight, one day's pay = 132.00.
	// s.37(3)(b): seven hours is more than half but not more than eight, two days' = 264.00.
	// s.37(3)(c): eleven hours on a rest day — two days' pay for the first eight (a rest day has no
	// shift, so its whole clock is work), then 3 h × 15.00 × 1.5 = 67.50.
	assert.deepEqual(workLines(slips.get('SG-WORKMAN')!), [
		['2026-01-01', 'OT-1.0X', 8, 132],
		['2026-01-01', 'OT-1.5X', 2, 49.5],
		['2026-01-05', 'OT-1.5X', 2, 49.5],
		['2026-01-10', 'OT-1.0X', 4, 132],
		['2026-01-11', 'OT-2.0X', 7, 264],
		['2026-01-17', 'OT-1.5X', 3, 74.25],
		['2026-01-17', 'OT-2.0X', 8, 264]
	]);
	assert.equal(slips.get('SG-WORKMAN')!.gross, 2860 + 132 + 49.5 + 49.5 + 132 + 264 + 264 + 74.25);
	// CPF Board: overtime is an Ordinary Wage. 3,825.25 × 20% = 765.05 → 765 (cents dropped);
	// × 37% = 1,415.34 → 1,415 (nearest dollar, half up); employer 650. SDL 0.25% × 3,825.25 =
	// 9.56 to the cent; the SDL Act rounds the employer's total remittance, not one employee.
	assert.deepEqual(scheme(slips.get('SG-WORKMAN')!, 'CPF'), [3825.25, 765, 650]);
	assert.deepEqual(scheme(slips.get('SG-WORKMAN')!, 'SDL'), [3825.25, 0, 9.56]);

	// The clerk: the same days at 13.20 an hour and 105.60 a day.
	assert.deepEqual(workLines(slips.get('SG-CLERK')!), [
		['2026-01-01', 'OT-1.0X', 8, 105.6],
		['2026-01-01', 'OT-1.5X', 2, 39.6],
		['2026-01-05', 'OT-1.5X', 2, 39.6],
		['2026-01-10', 'OT-1.0X', 4, 105.6],
		['2026-01-11', 'OT-2.0X', 7, 211.2],
		['2026-01-17', 'OT-1.5X', 3, 59.4],
		['2026-01-17', 'OT-2.0X', 8, 211.2]
	]);
	assert.equal(slips.get('SG-CLERK')!.gross, 3060.2);

	// s.35: outside Part 4 the rest days and the hours beyond normal produce no line, on either
	// ceiling — but s.88 is Part 10 and reaches every employee: the holiday worked still earns
	// its extra day's basic pay (s.88(4)), 12 × 2,860 ÷ (52 × 5) = 132.00 and 12 × 4,576 ÷ 260 =
	// 211.20.
	assert.deepEqual(workLines(slips.get('SG-CLERK-OVER')!), [['2026-01-01', 'OT-1.0X', 8, 132]]);
	assert.equal(slips.get('SG-CLERK-OVER')!.gross, 2992);
	assert.deepEqual(workLines(slips.get('SG-WORKMAN-OVER')!), [['2026-01-01', 'OT-1.0X', 8, 211.2]]);
	assert.equal(slips.get('SG-WORKMAN-OVER')!.gross, 4787.2);
});

test('Singapore — s.38(1) caps the normal week at 44 hours, and a rest-day hour is paid whole or part (s.37(3)(c)(ii))', () => {
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			// A non-workman at $2,288: 12.00 an hour (Fourth Schedule), and on a six-day week
			// 12 × 2,288 ÷ (52 × 6) = 88.00 a day (Third Schedule).
			people: [{ key: 'SG-SIX-DAY', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => {
			// Six 8-hour days a week: the contract's normal week is 48 hours, four beyond s.38(1).
			const pattern = world.shift_patterns[0]!;
			const [monday, , , , , , sunday] = pattern.pattern.days;
			pattern.pattern = { days: [monday!, monday!, monday!, monday!, monday!, monday!, sunday!] };
			for (const day of ['05', '06', '07', '08', '09', '10'])
				punch(world, 'SG-SIX-DAY', `2026-01-${day}`, '09:00', '18:00'); // eight hours net
			punch(world, 'SG-SIX-DAY', '2026-01-11', '09:00', '18:15'); // Sunday rest day: 9h15
		}
	);
	// Monday to Saturday are each a normal 8-hour day; the 45th to 48th hour of the week fall on
	// Saturday and are overtime of that day at s.38(4)'s 1.5×: 4 × 12.00 × 1.5 = 72.00. The rest
	// day: 9h15 with no shift is all work, two days' pay for the first eight (176.00), and the
	// 1h15 beyond the normal day is "each hour or part thereof" — two hours × 12.00 × 1.5 = 36.00.
	assert.deepEqual(workLines(slips.get('SG-SIX-DAY')!), [
		['2026-01-10', 'OT-1.5X', 4, 72],
		['2026-01-11', 'OT-1.5X', 1.25, 36],
		['2026-01-11', 'OT-2.0X', 8, 176]
	]);
	assert.equal(slips.get('SG-SIX-DAY')!.gross, 2288 + 72 + 36 + 176);
});

test('Singapore — rest-day work at the employee’s request pays half (s.37(2)), and a holiday on a non-working day pays a day (s.88)', () => {
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			// $2,288: 12.00 an hour, 105.60 a day on a five-day week.
			people: [{ key: 'SG-REQ', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => {
			// Saturday is the five-day week's OFF day (neither a working day nor the rest day).
			const OFF = 'c0000000-0000-4000-8000-0000000000d4';
			world.shift_definitions.push({
				...world.shift_definitions[1]!,
				id: OFF,
				code: 'OFF',
				name: 'Off',
				variant: { kind: 'OFF' }
			});
			world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: OFF };
			world.jurisdiction_holidays.push(holiday('2026-01-10', 'A Saturday holiday'));
			punch(world, 'SG-REQ', '2026-01-04', '09:00', '16:00'); // Sunday, the employer's
			punch(world, 'SG-REQ', '2026-01-11', '09:00', '13:00', 'EMPLOYEE'); // Sunday, four hours
			punch(world, 'SG-REQ', '2026-01-18', '09:00', '16:00', 'EMPLOYEE'); // Sunday, seven hours
			// Saturday the 10th is the OFF day and a public holiday: the day is read and found empty,
			// and the calendar raises the extra day's salary.
			emptyDay(world, 'SG-REQ', '2026-01-10');
		}
	);
	// s.37(2)(a): up to half the normal hours at the employee's request, half a day's pay = 52.80;
	// (b) more than half, one day's = 105.60. s.37(3)(b) at the employer's: two days' = 211.20.
	// s.88: the Saturday holiday on a non-working day is an extra day's salary, 105.60.
	assert.deepEqual(workLines(slips.get('SG-REQ')!), [
		['2026-01-04', 'OT-2.0X', 7, 211.2],
		['2026-01-10', 'PH-NON-WORKING-DAY', 0, 105.6],
		['2026-01-11', 'OT-0.5X', 4, 52.8],
		['2026-01-18', 'OT-1.0X', 7, 105.6]
	]);
});

test('Singapore — the normal day is nine hours on a five-day week (s.38(1)), a longer shift is a normal day plus overtime', () => {
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'SG-LONG', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => {
			// A ten-hour shift, 09:00–20:00 with an hour's break, on the five-day week: the normal
			// day is s.38(1)'s nine, so the tenth hour of every day is overtime.
			world.shift_definitions[0]!.variant = {
				kind: 'WORK',
				start_time: '09:00',
				end_time: '20:00',
				break_minutes: 60
			};
			punch(world, 'SG-LONG', '2026-01-05', '09:00', '20:00');
		}
	);
	// The rostered week is fifty hours, over s.38(1)(b)'s 44: 12 × 2,288 ÷ (52 × 44) = 12.00 an
	// hour (s.2); one hour beyond nine at 1.5× = 18.00.
	assert.deepEqual(workLines(slips.get('SG-LONG')!), [['2026-01-05', 'OT-1.5X', 1, 18]]);
});

test('Singapore — a bonus is an Additional Wage under the 102,000 ceiling, and an Employment Pass holder is inside SINDA', () => {
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'SG-BONUS', wage: 6000, citizenship: 'CITIZEN' },
				{
					key: 'SG-EP',
					wage: 4000,
					citizenship: 'FOREIGNER',
					race: 'INDIAN',
					pass_type: 'EMPLOYMENT_PASS'
				},
				{
					key: 'SG-WP',
					wage: 4000,
					citizenship: 'FOREIGNER',
					race: 'INDIAN',
					pass_type: 'WORK_PERMIT'
				}
			]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_VERSION
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'SG-BONUS')!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000000b0',
				employment_id: employment.id,
				catalogue_id: bonus.id,
				amount: 120_000,
				event_date: '2026-01-01',
				pay_period: null,
				payslip_id: null,
				reason: 'annual bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	// Ordinary Wages 6,000 under the 8,000 ceiling; the 120,000 bonus is an Additional Wage
	// capped by the Board's AW ceiling — 102,000 less the year's Ordinary Wages subject to CPF.
	// Paid in January, the year's OW is not yet known and the Board's method estimates it from
	// this month's OW over the twelve payslips of the year: 72,000, so the ceiling is 30,000. The
	// CPF base is 36,000; 20% = 7,200; 37% = 13,320; employer 6,120. The charge records its
	// ordinary part, 6,000, for the year; December re-computes on the actual OW.
	assert.deepEqual(scheme(slips.get('SG-BONUS')!, 'CPF'), [36_000, 7_200, 6_120]);
	assert.equal(
		slips.get('SG-BONUS')!.statutory.find((row) => row.scheme_code === 'CPF')!.ordinary_amount,
		6000
	);
	// SINDA reaches an Employment Pass holder of Indian descent ($4,000: the "over $2,500 up to
	// $4,500" rung, $7) and not a Work Permit holder.
	assert.deepEqual(scheme(slips.get('SG-EP')!, 'SINDA'), [4000, 7, 0]);
	assert.equal(
		slips.get('SG-WP')!.statutory.find((row) => row.scheme_code === 'SINDA'),
		undefined
	);
});

test('Singapore — the AW ceiling is a running annual figure: OW to date, this month included, and AW already subject', () => {
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	// January stood: OW 6,000, AW 96,000 subject (the golden above). A 10,000 bonus in February:
	// the room is 102,000 − (6,000 + 6,000) − 96,000 = −6,000 → nothing more is subject, and the
	// base is February's OW alone.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-02',
			people: [{ key: 'SG-BONUS', wage: 6000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_VERSION
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'SG-BONUS')!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000000b1',
				employment_id: employment.id,
				catalogue_id: bonus.id,
				amount: 10_000,
				event_date: '2026-02-01',
				pay_period: null,
				payslip_id: null,
				reason: 'second bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
			world.payroll_runs.push({
				id: 'sg-january',
				company_id: COMPANY_ID,
				period: '2026-01',
				lifecycle: 'DRAFT'
			} as never);
			world.payslips.push({
				id: 'sg-january-slip',
				payroll_run_id: 'sg-january',
				employment_id: employment.id,
				base: [],
				adjustments: [],
				paid_at: null,
				statutory: [
					{
						scheme_code: 'CPF',
						base_amount: 102_000,
						ordinary_amount: 6000,
						employee_amount: 20_400,
						employer_amount: 17_340
					}
				]
			} as never);
		}
	);
	assert.deepEqual(scheme(slips.get('SG-BONUS')!, 'CPF'), [6000, 1200, 1020]);
});

test('Singapore — s.20A prices an incomplete month and an unpaid day on the month’s working days', () => {
	// February 2026 opens on a Sunday and holds no public holiday: twenty working days.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-02',
			people: [
				// Joined on Monday the 16th: ten of the twenty working days.
				{ key: 'SG-JOINER', wage: 3300, hire_date: '2026-02-16', citizenship: 'CITIZEN' },
				// A rostered Tuesday with no attendance and no leave: one day of absence without pay.
				{ key: 'SG-ABSENT', wage: 3300, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			const absent = world.employments.find((row) => row.employee_number === 'SG-ABSENT')!;
			world.work_days.push({
				id: 'wd-SG-ABSENT-2026-02-03',
				employment_id: absent.id,
				work_date: '2026-02-03',
				shift_definition_id: null,
				worked_intervals: [],
				approval_id: null
			});
		}
	);

	// s.20A(1)(a): monthly gross rate × days actually worked ÷ days required to work in the month
	// = 3,300 × 10 ÷ 20 = 1,650.00. CPF on 1,650: 330 / 37% = 610.50 → 611, employer 281.
	const joiner = slips.get('SG-JOINER')!;
	assert.deepEqual(
		joiner.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[10, 20, 1650]]
	);
	assert.equal(joiner.gross, 1650);
	assert.deepEqual(scheme(joiner, 'CPF'), [1650, 330, 281]);

	// s.20A(1)(c): a day of leave of absence without pay is 3,300 ÷ 20 = 165.00 off the month
	// (MOM: monthly gross ÷ working days in the month × days of no-pay leave). CPF sees 3,135:
	// 627 / 37% = 1,159.95 → 1,160, employer 533.
	const absent = slips.get('SG-ABSENT')!;
	assert.deepEqual(
		absent.adjustments.map((row) => [row.component_code, row.quantity, row.amount]),
		[['ABSENCE', 1, 165]]
	);
	assert.equal(absent.gross, 3135);
	assert.deepEqual(scheme(absent, 'CPF'), [3135, 627, 533]);
});

test('Singapore — s.20A(2): a day of five contracted hours or fewer counts as half a working day', () => {
	// February 2026: twenty rostered days. With Fridays a four-hour shift the month has 16 whole
	// days and 4 half days = 18 working days; a joiner on Monday the 16th works 8 whole + 2 half
	// = 9 of them. 3,300 × 9 ÷ 18 = 1,650.
	const SHORT = 'c0000000-0000-4000-8000-0000000000d9';
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-02',
			people: [{ key: 'SG-JOINER', wage: 3300, hire_date: '2026-02-16', citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.shift_definitions.push({
				...world.shift_definitions[0]!,
				id: SHORT,
				code: 'SHORT',
				name: 'Short Friday',
				variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 }
			});
			world.shift_patterns[0]!.pattern.days[4] = { roster_code_id: SHORT };
		}
	);
	const joiner = slips.get('SG-JOINER')!;
	assert.deepEqual(
		joiner.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[9, 18, 1650]]
	);
});

test('Singapore — the 72-hour month is also counted with rest-day and holiday work beyond the normal day', () => {
	// MOM on s.38(5): work on a rest day or public holiday beyond the normal daily hours is inside
	// the 72 hours. Seventy ordinary overtime hours plus four rest-day hours beyond the normal
	// day: the regulated count (70) stays under the funnel's ceiling, the wider count (74) warns.
	const { warnings } = buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [{ key: 'SG-OT', wage: 2000, citizenship: 'CITIZEN', workman: true }]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'SG-OT')!;
			const at = (date: string, time: string) => `${date}T${time}:00.000+08:00`;
			// The shift is 09:00–18:00 with an hour's break: eight normal hours. Fourteen weekdays
			// worked to 22:00 (four over each): 56 h; two to 23:00 (five over): 10 h; two to 20:00
			// (two over): 4 h → 70 regulated hours.
			const weekdays = [
				'02',
				'03',
				'04',
				'05',
				'06',
				'09',
				'10',
				'11',
				'12',
				'13',
				'16',
				'17',
				'18',
				'19',
				'20',
				'23',
				'24',
				'25'
			];
			const overs = [...Array(14).fill('22:00'), '23:00', '23:00', '20:00', '20:00'];
			weekdays.forEach((day, index) => {
				const end = overs[index]!;
				world.work_days.push({
					id: `wd-SG-OT-2026-03-${day}`,
					employment_id: employment.id,
					work_date: `2026-03-${day}`,
					shift_definition_id: null,
					worked_intervals: [
						{
							start: at(`2026-03-${day}`, '09:00'),
							end:
								end === '00:00'
									? at(`2026-03-${String(Number(day) + 1).padStart(2, '0')}`, '00:00')
									: at(`2026-03-${day}`, end)
						}
					],
					approval_id: null
				});
			});
			// A rest-day Sunday worked twelve hours: eight normal, four beyond the normal day.
			world.work_days.push({
				id: 'wd-SG-OT-2026-03-08',
				employment_id: employment.id,
				work_date: '2026-03-08',
				shift_definition_id: null,
				worked_intervals: [{ start: at('2026-03-08', '08:00'), end: at('2026-03-08', '20:00') }],
				approval_id: null
			});
		}
	);
	const limitLines = warnings.filter((line) => line.startsWith('OVERTIME_LIMIT_EXCEEDED'));
	assert.equal(limitLines.length, 1, warnings.join('\n'));
	assert.match(limitLines[0]!, /74 .*hours in 2026-03, against a 72-hour/);
});

test('Singapore — s.20A counts a public holiday on a working day as a working day, worked or not', () => {
	// MOM, "Salary for an incomplete month of work": the working days in the month "exclude rest
	// days and non-working days, but include public holidays", and the days actually worked
	// "include public holidays". January 2026 has 22 such days, New Year's Day (Thursday) among
	// them. A joiner on Friday the 16th is required to work 11 of them; a leaver on Thursday the
	// 15th worked 10 and is owed the holiday: 3,300 × 11 ÷ 22 = 1,650.00 for both. A holiday on a
	// rest day is neither: a Saturday holiday leaves the count at 22.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'SG-JAN-JOINER', wage: 3300, hire_date: '2026-01-16', citizenship: 'CITIZEN' },
				{ key: 'SG-JAN-LEAVER', wage: 3300, exit_date: '2026-01-15', citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(
				holiday('2026-01-01', "New Year's Day"),
				holiday('2026-01-24', 'A Saturday holiday')
			);
		}
	);
	for (const key of ['SG-JAN-JOINER', 'SG-JAN-LEAVER']) {
		const slip = slips.get(key)!;
		assert.deepEqual(
			slip.proration
				.filter((row) => row.component_code === 'BASIC')
				.map((row) => [row.days, row.denominator, row.prorated_amount]),
			[[11, 22, 1650]],
			key
		);
		assert.equal(slip.gross, 1650, key);
	}
});

test('Singapore — a standing allowance is wages: prorated like the salary, and inside every statutory base', () => {
	// CPF Act 1953 s.2: "wages" is all remuneration in money, allowances included; the SDL Order
	// and the self-help-group schedules read total wages. March 2026 has 22 working days; a $440
	// transport allowance is $20 a working day on the same WORKING_DAYS basis as the salary.
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	const TRANSPORT = 'c1c1c1c1-0000-4000-8000-000000000011';
	const { slips, allowances } = buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [
				{ key: 'SG-ALW-WHOLE', wage: 3000, citizenship: 'CITIZEN', race: 'CHINESE' },
				{ key: 'SG-ALW-JOINER', wage: 3000, citizenship: 'CITIZEN', hire_date: '2026-03-16' }
			]
		},
		(world) => {
			world.allowance_catalogue.push({
				id: TRANSPORT,
				settings_id: SG_VERSION,
				code: 'TRANSPORT',
				name: 'Transport',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				// Ordinary wages for CPF; total wages for the levy and the self-help funds.
				counts_toward: ['CPF.ORDINARY', 'SDL', 'CDAC', 'ECF', 'MBMF', 'SINDA'],
				approval_id: null
			});
			for (const [index, employment] of world.employments.entries())
				assignAllowance(world, {
					id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: TRANSPORT,
					amount: 440,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	const facts = (key: string) => {
		const [segment] = allowances.get(key)!;
		return [
			segment!.contract_amount,
			segment!.prorated_amount,
			segment!.days,
			segment!.denominator,
			segment!.unpaid_days
		];
	};
	// The whole month: total wages 3,440. CPF 20% = 688; 37% = 1,272.80 → 1,273; employer 585.
	// SDL 0.25% × 3,440 = 8.60. CDAC: 3,440 is inside the "over $2,000 up to $3,500" rung, $1.
	assert.deepEqual(facts('SG-ALW-WHOLE'), [440, 440, 22, 22, 0]);
	assert.equal(slips.get('SG-ALW-WHOLE')!.gross, 3440);
	assert.deepEqual(scheme(slips.get('SG-ALW-WHOLE')!, 'CPF'), [3440, 688, 585]);
	assert.deepEqual(scheme(slips.get('SG-ALW-WHOLE')!, 'SDL'), [3440, 0, 8.6]);
	assert.deepEqual(scheme(slips.get('SG-ALW-WHOLE')!, 'CDAC'), [3440, 1, 0]);
	// The joiner: 12 of 22 working days on both lines — 3,000 × 12/22 = 1,636.36 and 440 × 12/22
	// = 240.00 — so the base is 1,876.36: CPF 375 (375.27 floored) / 37% = 694.25 → 694, employer 319.
	assert.deepEqual(facts('SG-ALW-JOINER'), [440, 240, 12, 22, 0]);
	assert.deepEqual(
		slips
			.get('SG-ALW-JOINER')!
			.proration.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[12, 22, 1636.36]]
	);
	assert.equal(slips.get('SG-ALW-JOINER')!.gross, 1876.36);
	assert.deepEqual(scheme(slips.get('SG-ALW-JOINER')!, 'CPF'), [1876.36, 375, 319]);
	assert.deepEqual(scheme(slips.get('SG-ALW-JOINER')!, 'SDL'), [1876.36, 0, 4.69]);
});

test('Singapore — the lineage carries a no-pay leave row, and a day of it comes off the month’s working days', () => {
	// EA s.20A(1)(c): leave of absence without pay is priced at the monthly gross rate over the
	// working days in the month. February 2026 has 20; one day of $3,300 is $165.00 off, and CPF
	// reads the reduced wage (3,135: 627 / 1,159.95 → 1,160 / 533). The row is the bank's own
	// `UNPAID_LEAVE`, one per sealed version, so no operator has to invent it.
	const version = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	const rows = leaveCatalogue('SG').filter((row) => row.settings_id === version);
	const npl = rows.find((row) => row.code === 'UNPAID_LEAVE')!;
	assert.ok(npl, 'the SG lineage carries an UNPAID_LEAVE row');
	assert.equal(npl.is_npl, true);
	assert.equal(npl.can_encash, false);
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-02',
			people: [{ key: 'SG-NPL', wage: 3300, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.leave_catalogue.push(...rows.map((row) => ({ ...row, approval_id: null })));
			const employment = world.employments.find((row) => row.employee_number === 'SG-NPL')!;
			const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-00000000np01',
				employment_id: employment.id,
				catalogue_id: npl.id,
				leave_code: 'UNPAID_LEAVE',
				reference: 'NPL-SG',
				from_date: '2026-02-03',
				to_date: '2026-02-03',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-02-03',
				reason: 'Unpaid',
				allocations: [],
				charges: [
					{
						date: '2026-02-03',
						days: 1,
						catalogue_id: npl.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				],
				approval_id: null
			});
		}
	);
	const slip = slips.get('SG-NPL')!;
	assert.deepEqual(
		slip.adjustments.map((row) => [row.family, row.quantity, row.amount, row.bucket]),
		[['LEAVE', 1, 165, 'ABSENCE']]
	);
	assert.equal(slip.gross, 3135);
	assert.deepEqual(scheme(slip, 'CPF'), [3135, 627, 533]);
});

test('every sealed version of `SG` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('SG');
});

test('Singapore — December trues the AW ceiling up on the year’s actual OW (CPF Board, AW ceiling examples, Step 2)', () => {
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	// January: OW 8,000 (the ceiling) and a 150,000 bonus. The Step 1 estimate took the year's OW
	// as 8,000 × 12 = 96,000, so 6,000 of the bonus was subject. The OW then fell to 6,000, and by
	// November the year's OW stood at 8,000 + 6,000 × 10 = 68,000 with 6,000 of AW subject
	// (base 74,000). December's OW is 6,000: the year's OW is 74,000, the ceiling 102,000 −
	// 74,000 = 28,000, the AW subject for the year min(150,000, 28,000) = 28,000 — so December
	// charges the 22,000 shortfall beside its own OW: base 28,000, employee 20% = 5,600, employer
	// 37% − 20% = 4,760.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-12',
			people: [{ key: 'SG-TRUEUP', wage: 6000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_VERSION
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'SG-TRUEUP')!;
			world.payroll_runs.push({
				id: 'sg-to-november',
				company_id: COMPANY_ID,
				period: '2026-11',
				lifecycle: 'PAID'
			} as never);
			world.payslips.push({
				id: 'sg-to-november-slip',
				payroll_run_id: 'sg-to-november',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-11-28T00:00:00.000Z',
				base: [],
				adjustments: [
					{ component_code: bonus.code, bucket: 'EARNING', amount: 150_000, catalogue_id: bonus.id }
				],
				statutory: [
					{
						scheme_code: 'CPF',
						base_amount: 74_000,
						ordinary_amount: 68_000,
						employee_amount: 14_800,
						employer_amount: 12_580
					}
				]
			} as never);
		}
	);
	assert.deepEqual(scheme(slips.get('SG-TRUEUP')!, 'CPF'), [28_000, 5600, 4760]);
});

test('Singapore — a five-hour contracted day is half a day (s.20A(2)), but a public holiday on it is a full day (s.88(7))', () => {
	// Fridays are a 09:00–14:00 shift (five hours, no break). April 2026: twenty-two weekdays, four
	// of them Fridays, Good Friday the 3rd among them. The month's required days: eighteen full
	// weekdays, three short Fridays at a half, and the holiday Friday at one — 20.5. A joiner on
	// Monday the 13th works fourteen weekdays, two of them short Fridays: 13. 4,100 × 13 ÷ 20.5 =
	// 2,600 (without s.88(7) the holiday would weigh a half: 20 required, 2,665).
	const SHORT_ID = 'c0000000-0000-4000-8000-0000000000e5';
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-04',
			people: [{ key: 'SG-SHORT', wage: 4100, hire_date: '2026-04-13', citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.shift_definitions.push({
				...world.shift_definitions[0]!,
				id: SHORT_ID,
				code: 'SHORT',
				name: 'Short Friday',
				variant: { kind: 'WORK', start_time: '09:00', end_time: '14:00', break_minutes: 0 }
			});
			world.shift_patterns[0]!.pattern.days[4] = { roster_code_id: SHORT_ID };
			world.jurisdiction_holidays.push(holiday('2026-04-03', 'Good Friday'));
		}
	);
	const slip = slips.get('SG-SHORT')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[13, 20.5, 2600]]
	);
	assert.equal(slip.gross, 2600);
});

test('Singapore — the AW estimate takes the monthly OW for the payslips remaining, not a joiner’s prorated month (CPF Board, Step 1)', () => {
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	// A joiner on Monday 16 February at 8,000 works ten of the month's twenty days: OW 4,000. A
	// 100,000 sign-on bonus is an Additional Wage; the Board estimates the year's OW as the
	// monthly OW (8,000, at the ceiling) over the eleven payslips left in the year — 88,000, so
	// 14,000 of the bonus is subject (an estimate on the prorated 4,000 would have let 58,000
	// through). Base 18,000: 20% = 3,600; 37% = 6,660; employer 3,060.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-02',
			people: [{ key: 'SG-SIGNON', wage: 8000, hire_date: '2026-02-16', citizenship: 'CITIZEN' }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_VERSION
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'SG-SIGNON')!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000000b7',
				employment_id: employment.id,
				catalogue_id: bonus.id,
				amount: 100_000,
				event_date: '2026-02-16',
				pay_period: null,
				payslip_id: null,
				reason: 'sign-on bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	assert.deepEqual(scheme(slips.get('SG-SIGNON')!, 'CPF'), [18_000, 3_600, 3_060]);
});

test('Singapore — a December true-up never goes below zero: an over-contribution is the Board’s refund, not a payslip credit', () => {
	const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
	// January: OW 6,000 and a 100,000 bonus, estimated on 6,000 × 12 = 72,000 — 30,000 subject.
	// The OW then rose to 8,000: by November the year's OW is 6,000 + 8,000 × 10 = 86,000 (base
	// 116,000). December's OW is 8,000: the year's OW 94,000 leaves 8,000 of ceiling, so only
	// 8,000 of the bonus should have been subject — 22,000 less than was charged. That excess is
	// refunded on application to the Board (its refund of contributions paid in excess of the AW ceiling):
	// December charges the OW alone. Base 8,000: 1,600 and 1,360.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-12',
			people: [{ key: 'SG-OVERPAID', wage: 8000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_VERSION
			)!;
			const employment = world.employments.find((row) => row.employee_number === 'SG-OVERPAID')!;
			world.payroll_runs.push({
				id: 'sg-over-to-november',
				company_id: COMPANY_ID,
				period: '2026-11',
				lifecycle: 'PAID'
			} as never);
			world.payslips.push({
				id: 'sg-over-to-november-slip',
				payroll_run_id: 'sg-over-to-november',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-11-28T00:00:00.000Z',
				base: [],
				adjustments: [
					{ component_code: bonus.code, bucket: 'EARNING', amount: 100_000, catalogue_id: bonus.id }
				],
				statutory: [
					{
						scheme_code: 'CPF',
						base_amount: 116_000,
						ordinary_amount: 86_000,
						employee_amount: 23_200,
						employer_amount: 19_720
					}
				]
			} as never);
		}
	);
	assert.deepEqual(scheme(slips.get('SG-OVERPAID')!, 'CPF'), [8_000, 1_600, 1_360]);
});

test('Singapore — a part-timer’s hours beyond their own day up to a full-timer’s are the basic hourly rate (Part-Time Employees Regulations reg. 5)', () => {
	// A part-timer contracted 09:00–13:00, five days (twenty hours a week) at 1,040 a month:
	// 12 × 1,040 ÷ (52 × 20) = 12.00 an hour. A ten-hour Monday, 09:00–19:00 with no break: the
	// four contracted hours are the normal day, the five up to the full-timer's nine-hour day
	// (s.38(1)) are 1.0×, and the tenth is s.38(4)'s 1.5×: 60.00 and 18.00.
	const SHORT_ID = 'c0000000-0000-4000-8000-0000000000f1';
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'SG-PT', wage: 1040, citizenship: 'CITIZEN', employment_type: 'PART_TIME' }]
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
			punch(world, 'SG-PT', '2026-01-05', '09:00', '19:00');
		}
	);
	assert.deepEqual(workLines(slips.get('SG-PT')!), [
		['2026-01-05', 'PT-1.0X', 5, 60],
		['2026-01-05', 'PT-1.5X', 1, 18]
	]);
});

test('Singapore — cash allowances, expense refunds, overtime and leave conversion use their distinct wage bases', () => {
	// MOM gross/basic salary definitions; CPF Board payments and reimbursements guidance.
	// https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary
	// https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-reimbursements
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'BASES', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const version = world.jurisdiction_settings.find(
				(row) => String(row.effective_range.start).slice(0, 10) === '2026-01-01'
			)!;
			version.work_rules.encashment!.include_allowances = ['SHIFT'];
			version.work_rules.encashment!.exclude_allowances = [
				'TRAVEL',
				'FOOD',
				'HOUSING',
				'PRODUCTIVITY',
				'REFUND'
			];
			const payments = [
				{ code: 'SHIFT', amount: 250 },
				{ code: 'TRAVEL', amount: 200 },
				{ code: 'FOOD', amount: 300 },
				{ code: 'HOUSING', amount: 400 },
				{ code: 'PRODUCTIVITY', amount: 500 },
				{ code: 'REFUND', amount: 100 }
			];
			for (const [index, payment] of payments.entries()) {
				const id = `a2000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
				world.allowance_catalogue.push({
					id,
					settings_id: version.id,
					code: payment.code,
					name: payment.code,
					eligibility: '',
					destination: payment.code === 'REFUND' ? 'NET' : 'PAY',
					direction: 'ADD',
					bands: [{ when: '', amount: 'entry.amount', limit: null }],
					counts_toward: payment.code === 'REFUND' ? [] : ['CPF.ORDINARY', 'SDL'],
					approval_id: null
				});
				assignAllowance(world, {
					employment_id: world.employments[0]!.id,
					catalogue_id: id,
					amount: payment.amount,
					effective_from: '2015-01-01'
				});
			}
			world.leave_catalogue.push(
				...leaveCatalogue('SG').map((row) => ({ ...row, approval_id: null }))
			);
			const annual = world.leave_catalogue.find(
				(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
			)!;
			world.leave_entries.push({
				id: 'a2000000-0000-4000-8000-000000000020',
				employment_id: world.employments[0]!.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: 'SG-BASES',
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				days: 1.5,
				encash_days: 1.5,
				effective_on: '2026-01-31',
				due_on: '2026-01-31',
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
			punch(world, 'BASES', '2026-01-05', '09:00', '20:00');
		}
	);
	const slip = slips.get('BASES')!;
	// Basic hourly: 2,288 × 12 / (52 × 40) = 13.20. All allowances are excluded.
	assert.deepEqual(workLines(slip), [['2026-01-05', 'OT-1.5X', 2, 39.6]]);
	// Gross daily: (2,288 + 250) × 12 / (52 × 5); 1.5 days rounds once to 175.71.
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
		175.71
	);
	// CPF/SDL include every cash wage allowance, including travel/food/housing/productivity.
	// Official expense reimbursement adds 100 to net without entering either statutory base.
	assert.equal(slip.gross, 4153.31);
	assert.deepEqual(scheme(slip, 'CPF'), [4153.31, 830, 707]);
	assert.deepEqual(scheme(slip, 'SDL'), [4153.31, 0, 10.38]);
	assert.equal(slip.net, 3423.31);
});
