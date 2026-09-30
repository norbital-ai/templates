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
import { readFileSync } from 'node:fs';
import {
	assessStatutory,
	buildStatutory,
	COMPANY_ID,
	createStatutoryWorld,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	leaveCatalogue,
	settingsVersions,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import { payrollWorld, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';
import { grantedDays, type LeaveEntitlement } from '../src/lib/leave/entitlement.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { weeklyInstalments } from '../src/lib/payroll/run/period.ts';

const sgSettingsId = (date: string) =>
	settingsVersions('SG').find(
		(row) =>
			row.effective_range.start.slice(0, 10) <= date &&
			(row.effective_range.end == null || date < row.effective_range.end.slice(0, 10))
	)!.id;

test('Singapore — an unrelated employer does not consume this employer’s CPF AW ceiling, while an approved related transfer does', () => {
	const versions = {
		'2025-12': sgSettingsId('2025-12-15'),
		'2026-12': sgSettingsId('2026-12-15')
	};
	type Opening = {
		readonly year: string;
		readonly base: number;
		readonly ordinary?: number;
		readonly employee: number;
		readonly employer: number;
		readonly reference: string;
		readonly origin?: 'CURRENT_EMPLOYER' | 'OTHER_EMPLOYER' | 'APPROVED_RELATED_EMPLOYER';
		readonly board_approval_reference?: string;
		readonly employers_related?: boolean;
		readonly employee_informed?: boolean;
		readonly terms_unchanged?: boolean;
		readonly transferred_employee?: boolean;
	};
	const charge = (period: '2025-12' | '2026-12', opening?: readonly Opening[]) => {
		const wage = period === '2025-12' ? 7400 : 8000;
		const { slips } = buildStatutory(
			{
				code: 'SG',
				period,
				people: [
					{
						key: 'CPF-AW-TRANSFER',
						wage,
						age: 30,
						citizenship: 'CITIZEN',
						hire_date: `${period.slice(0, 4)}-01-01`,
						...(opening == null ? {} : { registrations: { CPF: { kind: 'REGISTERED', opening } } })
					}
				]
			},
			(world) => {
				const bonus = world.adhoc_catalogue!.find(
					(row) => row.code === 'bonus' && row.settings_id === versions[period]
				)!;
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-0000000000d1',
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: 20_000,
					event_date: `${period}-15`,
					pay_period: null,
					payslip_id: null,
					reason: 'December bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const cpf = slips.get('CPF-AW-TRANSFER')!.statutory.find((row) => row.scheme_code === 'CPF')!;
		return [cpf.base_amount, cpf.employee_amount, cpf.employer_amount];
	};
	for (const [period, full] of [
		['2025-12', [27_400, 5480, 4658]],
		['2026-12', [28_000, 5600, 4760]]
	] as const) {
		const prior: Opening = {
			year: period.slice(0, 4),
			base: 90_000,
			ordinary: 90_000,
			employee: 18_000,
			employer: 15_300,
			reference: 'Employer CPF statement'
		};
		assert.deepEqual(charge(period), full);
		assert.deepEqual(
			charge(period, [
				{ ...prior, base: 0, ordinary: 0, employee: 0, employer: 0, origin: 'CURRENT_EMPLOYER' }
			]),
			full
		);
		assert.deepEqual(charge(period, [{ ...prior, origin: 'OTHER_EMPLOYER' }]), full);
		assert.deepEqual(
			charge(period, [{ ...prior, origin: 'CURRENT_EMPLOYER' }]),
			[12_000, 2400, 2040]
		);
		assert.deepEqual(
			charge(period, [
				{ ...prior, base: 45_000, ordinary: 45_000, origin: 'CURRENT_EMPLOYER' },
				{ ...prior, base: 45_000, ordinary: 45_000, origin: 'CURRENT_EMPLOYER' }
			]),
			[12_000, 2400, 2040]
		);
		assert.deepEqual(
			charge(period, [
				{
					...prior,
					origin: 'APPROVED_RELATED_EMPLOYER',
					board_approval_reference: 'CPF-BOARD-APPROVAL',
					employers_related: true,
					employee_informed: true,
					terms_unchanged: true,
					transferred_employee: true
				}
			]),
			[12_000, 2400, 2040]
		);
		assert.throws(() => charge(period, [prior]), /classify each opening/);
		const { ordinary: _ordinary, ...withoutOrdinary } = prior;
		assert.throws(
			() => charge(period, [{ ...withoutOrdinary, origin: 'CURRENT_EMPLOYER' }]),
			/requires the ordinary wage/
		);
		assert.throws(
			() => charge(period, [{ ...prior, origin: 'APPROVED_RELATED_EMPLOYER' }]),
			/Board approval and transfer conditions/
		);
	}
});

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
	requestedBy: 'EMPLOYER' | 'EMPLOYEE' | null = null,
	comparableHours: number | null = null
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		comparable_full_time_daily_hours: comparableHours,
		requested_by: requestedBy,
		approval_id: null
	});
};
/**
 * A punch whose shift's granted hour was taken 13:00–14:00, the window EA s.38(1)(a) names.
 * A break owed and not taken is worked time, so a scheduled hour only comes off the clock where
 * the punches show it went.
 */
const punchWithBreak = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	requestedBy: 'EMPLOYER' | 'EMPLOYEE' | null = null
) => {
	punch(world, key, date, start, end, requestedBy);
	world.work_days.at(-1)!.worked_intervals = [
		{ start: `${date}T${start}:00+08:00`, end: `${date}T13:00:00+08:00` },
		{ start: `${date}T14:00:00+08:00`, end: `${date}T${end}:00+08:00` }
	];
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
				// A workman at $2,860 on a 40-hour week: 12 × 2,860 ÷ (52 × 44) = 34,320 ÷ 2,288 =
				// 15.00 an hour (Fourth Schedule: 44 whatever the contract's week); 12 × 2,860 ÷ (52 × 5)
				// = 132.00 a day. Inside the $4,500 workman ceiling.
				{
					key: 'SG-WORKMAN',
					wage: 2860,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR'
				},
				// A non-workman at $2,288: 12 × 2,288 ÷ 2,288 = 12.00 an hour, 105.60 a day. Inside the
				// $2,600 ceiling.
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
				// The shift's hour is taken, so the Thursday holiday and the Monday are ten hours.
				punchWithBreak(world, key, '2026-01-01', '09:00', '20:00');
				punchWithBreak(world, key, '2026-01-05', '09:00', '20:00');
				punch(world, key, '2026-01-10', '09:00', '13:00'); // Saturday rest day: four hours
				punch(world, key, '2026-01-11', '09:00', '16:00'); // Sunday rest day: seven hours
				punch(world, key, '2026-01-17', '09:00', '20:00'); // Saturday rest day: eleven hours
			}
		}
	);

	// s.88(4): an extra day's salary at the basic rate for the holiday, 132.00, and MOM's 1.5× for
	// the 2 hours beyond the normal day: 2 × 15 × 1.5 = 45.00 (the shift's granted hour is taken
	// 13:00–14:00, so 09:00–20:00 is ten worked hours). s.38(4): 2 h × 15.00 × 1.5 = 45.00 on
	// the Monday. s.37(3)(a): four hours does not exceed half of eight, one day's pay = 132.00.
	// s.37(3)(b): seven hours is more than half but not more than eight, two days' = 264.00.
	// s.37(3)(c): eleven hours on a rest day — two days' pay for the first eight (a rest day has no
	// shift, so its whole clock is work), then 3 h × 15.00 × 1.5 = 67.50.
	assert.deepEqual(workLines(slips.get('SG-WORKMAN')!), [
		['2026-01-01', 'OT-1.0X', 8, 132],
		['2026-01-01', 'OT-1.5X', 2, 45],
		['2026-01-05', 'OT-1.5X', 2, 45],
		['2026-01-10', 'OT-1.0X', 4, 132],
		['2026-01-11', 'OT-2.0X', 7, 264],
		['2026-01-17', 'OT-1.5X', 3, 67.5],
		['2026-01-17', 'OT-2.0X', 8, 264]
	]);
	assert.equal(slips.get('SG-WORKMAN')!.gross, 2860 + 132 + 45 + 45 + 132 + 264 + 264 + 67.5);
	// CPF Board: overtime is an Ordinary Wage. 3,809.50 × 20% = 761.90 → 761 (cents dropped);
	// × 37% = 1,409.515 → 1,410 (nearest dollar, half up); employer 649. SDL 0.25% × 3,809.50 =
	// 9.52 to the cent; the SDL Act rounds the employer's total remittance, not one employee.
	assert.deepEqual(scheme(slips.get('SG-WORKMAN')!, 'CPF'), [3809.5, 761, 649]);
	assert.deepEqual(scheme(slips.get('SG-WORKMAN')!, 'SDL'), [3809.5, 0, 9.52]);

	// The clerk: the same days at 12.00 an hour (2 × 12 × 1.5 = 36.00; 3 × 12 × 1.5 = 54.00) and
	// 105.60 a day: 2,288 + 105.60 + 36 + 36 + 105.60 + 211.20 + 54 + 211.20 = 3,047.60.
	assert.deepEqual(workLines(slips.get('SG-CLERK')!), [
		['2026-01-01', 'OT-1.0X', 8, 105.6],
		['2026-01-01', 'OT-1.5X', 2, 36],
		['2026-01-05', 'OT-1.5X', 2, 36],
		['2026-01-10', 'OT-1.0X', 4, 105.6],
		['2026-01-11', 'OT-2.0X', 7, 211.2],
		['2026-01-17', 'OT-1.5X', 3, 54],
		['2026-01-17', 'OT-2.0X', 8, 211.2]
	]);
	assert.equal(slips.get('SG-CLERK')!.gross, 3047.6);

	// s.35: outside Part 4 the rest days and the hours beyond normal produce no line, on either
	// ceiling — but s.88 is Part 10 and reaches every employee: the holiday worked still earns
	// its extra day's basic pay (s.88(4)), 12 × 2,860 ÷ (52 × 5) = 132.00 and 12 × 4,576 ÷ 260 =
	// 211.20.
	assert.deepEqual(workLines(slips.get('SG-CLERK-OVER')!), [['2026-01-01', 'OT-1.0X', 8, 132]]);
	assert.equal(slips.get('SG-CLERK-OVER')!.gross, 2992);
	assert.deepEqual(workLines(slips.get('SG-WORKMAN-OVER')!), [['2026-01-01', 'OT-1.0X', 8, 211.2]]);
	assert.equal(slips.get('SG-WORKMAN-OVER')!.gross, 4787.2);
});

test('Singapore — s.38(1)’s 44-hour week pays nothing from the clock, and a rest-day hour is paid whole or part (s.37(3)(c)(ii))', () => {
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
				// The shift's granted hour is taken, so 09:00–18:00 is the eight net hours.
				punchWithBreak(world, 'SG-SIX-DAY', `2026-01-${day}`, '09:00', '18:00');
			punch(world, 'SG-SIX-DAY', '2026-01-11', '09:00', '18:15'); // Sunday rest day: 9h15
		}
	);
	// Monday to Saturday are each a normal 8-hour day. The 45th to 48th hour of the week pay only
	// where they are planned as overtime (owner's rule, 2026-09-23): the weekly limit derives no
	// pay from the clock, so Saturday earns no line. The rest day, planned as its 9h15 worked: two
	// days' pay for the first eight (176.00), and the 1h15 beyond the normal day is "each hour or
	// part thereof" — two hours × 12.00 × 1.5 = 36.00.
	assert.deepEqual(workLines(slips.get('SG-SIX-DAY')!), [
		['2026-01-11', 'OT-1.5X', 1.25, 36],
		['2026-01-11', 'OT-2.0X', 8, 176]
	]);
	assert.equal(slips.get('SG-SIX-DAY')!.gross, 2288 + 36 + 176);
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
			punchWithBreak(world, 'SG-LONG', '2026-01-05', '09:00', '20:00');
		}
	);
	// The rostered week is fifty hours, over s.38(1)(b)'s 44: 12 × 2,288 ÷ (52 × 44) = 12.00 an
	// hour (s.2); one hour beyond nine at 1.5× = 18.00.
	assert.deepEqual(workLines(slips.get('SG-LONG')!), [['2026-01-05', 'OT-1.5X', 1, 18]]);
});

test('Singapore — a bonus is an Additional Wage under the 102,000 ceiling, and Employment Pass and Work Permit holders are inside SINDA', () => {
	const SG_VERSION = sgSettingsId('2026-01-15');
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
	// $4,500" rung, $7), and a Work Permit holder too: CPF Act s.76(3) reads "an employee who
	// belongs to that community", s.2 "employee" is any person employed in Singapore, and SINDA
	// Rules r.2 sets no residency condition (register SG-SHG04).
	assert.deepEqual(scheme(slips.get('SG-EP')!, 'SINDA'), [4000, 7, 0]);
	assert.deepEqual(scheme(slips.get('SG-WP')!, 'SINDA'), [4000, 7, 0]);
});

test('Singapore — the AW ceiling is a running annual figure: OW to date, this month included, and AW already subject', () => {
	const SG_VERSION = sgSettingsId('2026-02-15');
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

test('Singapore — s.20A(1)(c) on many absent days: the month’s share, not a sum of rounded days (SG-D1)', () => {
	// September 2026 holds 22 working days and no public holiday. EA 1968 s.20A(1)(c) (SSO, current
	// as at 28 Sep 2026): 3,000 × days worked ÷ 22. Eleven absent days leave 3,000 × 11 ÷ 22 =
	// 1,500.00 (not 3,000 − 11 × 136.36 = 1,500.04): CPF 37% × 1,500 = 555, employee 20% = 300,
	// employer 255; SDL 0.25% = 3.75; CDAC 0.50. All 22 absent leave 3,000 × 0 ÷ 22 = 0.00 (not
	// 0.08), so no CPF, no fund deduction and, no service rendered in the month, no SDL (s.2).
	const weekdays = Array.from(
		{ length: 30 },
		(_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`
	).filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
	assert.equal(weekdays.length, 22);
	const { slips, warnings } = buildStatutory(
		{
			code: 'SG',
			period: '2026-09',
			people: [
				{ key: 'SG-HALF', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
				{ key: 'SG-NONE', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			for (const date of weekdays.slice(0, 11)) emptyDay(world, 'SG-HALF', date);
			for (const date of weekdays) emptyDay(world, 'SG-NONE', date);
		}
	);
	const half = slips.get('SG-HALF')!;
	assert.equal(half.gross, 1500);
	assert.deepEqual(scheme(half, 'CPF'), [1500, 300, 255]);
	assert.deepEqual(scheme(half, 'SDL'), [1500, 0, 3.75]);
	assert.deepEqual(scheme(half, 'CDAC'), [1500, 0.5, 0]);
	const none = slips.get('SG-NONE')!;
	assert.equal(none.gross, 0);
	assert.deepEqual(none.statutory, []);
	assert.deepEqual(warnings, []);
});

test('Singapore — s.88(3): an absence on the working day before or after a public holiday forfeits its pay (SG-D2)', () => {
	// EA 1968 s.88(3) (SSO, current as at 28 Sep 2026): an employee absent without prior consent or
	// reasonable excuse on the working day immediately preceding or succeeding a public holiday is
	// not entitled to holiday pay for it. August 2026 holds 21 working days (Mon–Fri), National Day
	// observed on Monday 10 Aug among them (s.20A counts it). 2,400 ÷ 21 = 114.2857 a day.
	// - Absent Fri 7 Aug (the working day before): 7 Aug and 10 Aug come off, 114.29 + 114.28 by
	//   the running total, gross 2,400 × 19 ÷ 21 = 2,171.43. CPF 37% × 2,171.43 = 803.43 → 803,
	//   employee 20% = 434.28 → 434, employer 369.
	// - Absent Tue 11 Aug (the working day after): the same 2,171.43.
	// - Absent on both: the holiday is forfeited once, 2,400 × 18 ÷ 21 = 2,057.14.
	// - Absent Thu 6 Aug (not adjacent): one day, 2,400 × 20 ÷ 21 = 2,285.71.
	const { slips, warnings } = buildStatutory(
		{
			code: 'SG',
			period: '2026-08',
			people: ['SG-PH-BEFORE', 'SG-PH-AFTER', 'SG-PH-BOTH', 'SG-PH-APART'].map((key) => ({
				key,
				wage: 2400,
				age: 30,
				citizenship: 'CITIZEN' as const
			}))
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			world.jurisdiction_holidays.push(holiday('2026-08-10', 'National Day (observed)'));
			emptyDay(world, 'SG-PH-BEFORE', '2026-08-07');
			emptyDay(world, 'SG-PH-AFTER', '2026-08-11');
			emptyDay(world, 'SG-PH-BOTH', '2026-08-07');
			emptyDay(world, 'SG-PH-BOTH', '2026-08-11');
			emptyDay(world, 'SG-PH-APART', '2026-08-06');
		}
	);
	const absences = (key: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.bucket === 'ABSENCE')
			.map((row) => [row.quantity, row.amount]);
	assert.deepEqual(absences('SG-PH-BEFORE'), [
		[1, 114.29],
		[1, 114.28]
	]);
	assert.equal(slips.get('SG-PH-BEFORE')!.gross, 2171.43);
	assert.deepEqual(scheme(slips.get('SG-PH-BEFORE')!, 'CPF'), [2171.43, 434, 369]);
	assert.equal(slips.get('SG-PH-AFTER')!.gross, 2171.43);
	assert.equal(slips.get('SG-PH-BOTH')!.gross, 2057.14);
	assert.deepEqual(absences('SG-PH-APART'), [[1, 114.29]]);
	assert.equal(slips.get('SG-PH-APART')!.gross, 2285.71);
	assert.deepEqual(warnings, []);
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
			// The shift is 09:00–18:00 with an hour's break, taken 13:00–14:00: eight normal hours.
			// Fourteen weekdays worked to 22:00 (four over each): 56 h; two to 23:00 (five over):
			// 10 h; two to 20:00 (two over): 4 h → 70 regulated hours.
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
					// The shift's granted hour is taken at 13:00, so each span is the hours its
					// comment counts: 09:00–22:00 is 12, 09:00–23:00 is 13, 09:00–20:00 is 10.
					worked_intervals: [
						{ start: at(`2026-03-${day}`, '09:00'), end: at(`2026-03-${day}`, '13:00') },
						{
							start: at(`2026-03-${day}`, '14:00'),
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
	const SG_VERSION = sgSettingsId('2026-03-15');
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
	const version = sgSettingsId('2026-02-15');
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
				no_pay_origin: 'EMPLOYEE_REQUESTED',
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

test('Singapore — the 1 July 2026 version (retirement age 64) moves no CPF figure', () => {
	// The Retirement and Re-employment Act ages step to 64 and 69 on 1 July 2026 (MOM retirement
	// and re-employment pages); the CPF First Schedule does not move until 1 January 2027. So July
	// 2026 charges the 2026 table: 55 and below 37% (employee 20%): 600 / 510 on 3,000; above 60
	// to 65 — a 64-year-old, now below the retirement age — 25% (12.5 / 12.5): 375 / 375.
	const july = assessStatutory({
		code: 'SG',
		period: '2026-07',
		people: [
			{ key: 'SG-3000-30', wage: 3000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'SG-3000-64', wage: 3000, age: 64, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(july, 'SG-3000-30', 'CPF', 600, 510);
	expectStatutory(july, 'SG-3000-64', 'CPF', 375, 375);
});

test('every sealed version of `SG` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('SG');
});

test('Singapore — December trues the AW ceiling up on the year’s actual OW (CPF Board, AW ceiling examples, Step 2)', () => {
	const SG_VERSION = sgSettingsId('2026-12-15');
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
	const SG_VERSION = sgSettingsId('2026-02-15');
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
	const SG_VERSION = sgSettingsId('2026-12-15');
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

test('Singapore — part-time overtime uses the dated comparable day and absent fallback', () => {
	// MOM's regulation 5 example: hours 5–8 at the basic hourly rate and hour 9 at 1.5×.
	const SHORT_ID = 'c0000000-0000-4000-8000-0000000000f2';
	const run = (
		comparable: number | null,
		end = '18:00',
		presence: 'PRESENT' | 'ABSENT' | null = 'PRESENT',
		dayComparable: number | null = null
	) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [
					{
						key: 'SG-PT-8',
						wage: 1040,
						citizenship: 'CITIZEN',
						employment_type: 'PART_TIME',
						comparable_full_time_daily_hours: comparable,
						comparable_full_time_presence: presence
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
				punch(world, 'SG-PT-8', '2026-01-05', '09:00', end, null, dayComparable);
			}
		);
	assert.deepEqual(workLines(run(8).slips.get('SG-PT-8')!), [
		['2026-01-05', 'PT-1.0X', 4, 48],
		['2026-01-05', 'PT-1.5X', 1, 18]
	]);
	assert.deepEqual(workLines(run(9, '18:00', 'PRESENT', 8).slips.get('SG-PT-8')!), [
		['2026-01-05', 'PT-1.0X', 4, 48],
		['2026-01-05', 'PT-1.5X', 1, 18]
	]);
	assert.deepEqual(workLines(run(null, '18:00', 'PRESENT', 8).slips.get('SG-PT-8')!), [
		['2026-01-05', 'PT-1.0X', 4, 48],
		['2026-01-05', 'PT-1.5X', 1, 18]
	]);
	assert.deepEqual(workLines(run(8, '19:00').slips.get('SG-PT-8')!), [
		['2026-01-05', 'PT-1.0X', 4, 48],
		['2026-01-05', 'PT-1.5X', 2, 36]
	]);
	assert.deepEqual(workLines(run(null, '18:00', 'ABSENT').slips.get('SG-PT-8')!), [
		['2026-01-05', 'PT-1.0X', 4, 48],
		['2026-01-05', 'PT-1.5X', 1, 18]
	]);
	assert.throws(() => run(null), /comparable full-time employee’s normal daily hours are required/);
	assert.throws(
		() => run(8, '18:00', null),
		/comparable full-time employee’s normal daily hours are required/
	);
	assert.throws(
		() => run(8, '18:00', 'ABSENT'),
		/declared absence of a comparable full-time employee conflicts/
	);
	assert.throws(
		() => run(null, '18:00', 'ABSENT', 8),
		/declared absence of a comparable full-time employee conflicts/
	);
});

test('Singapore — a PART_TIME label on a 40-hour contract refuses before pricing the hourly rate', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: 'SG',
				period: '2026-01',
				people: [
					{ key: 'SG-MISLABEL', wage: 1040, citizenship: 'CITIZEN', employment_type: 'PART_TIME' }
				]
			}),
		/part-time status conflicts with contracted weekly hours/
	);
});

test('Singapore — the sealed part-time boundary is below 35 contracted hours', () => {
	const run = (type: 'PART_TIME' | 'PERMANENT', hours: number) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [{ key: 'SG-BOUNDARY', wage: 1040, citizenship: 'CITIZEN', employment_type: type }]
			},
			(world) => {
				world.employment_terms[0]!.ordinary_hours_per_week = hours;
			}
		);
	assert.doesNotThrow(() => run('PART_TIME', 34.5));
	assert.doesNotThrow(() => run('PERMANENT', 35));
	assert.throws(
		() => run('PERMANENT', 20),
		/part-time status conflicts with contracted weekly hours/
	);
	assert.throws(
		() => run('PART_TIME', 35),
		/part-time status conflicts with contracted weekly hours/
	);
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
			punchWithBreak(world, 'BASES', '2026-01-05', '09:00', '20:00');
		}
	);
	const slip = slips.get('BASES')!;
	// Basic hourly (Fourth Schedule): 2,288 × 12 / (52 × 44) = 12.00; 2 × 12 × 1.5 = 36.00. All
	// allowances are excluded.
	assert.deepEqual(workLines(slip), [['2026-01-05', 'OT-1.5X', 2, 36]]);
	// Gross daily: (2,288 + 250) × 12 / (52 × 5); 1.5 days rounds once to 175.71.
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
		175.71
	);
	// CPF/SDL include every cash wage allowance, including travel/food/housing/productivity.
	// Official expense reimbursement adds 100 to net without entering either statutory base.
	// Gross: 2,288 + 250 + 200 + 300 + 400 + 500 + 175.71 + 36 = 4,149.71. CPF: 20% = 829.94 → 829
	// (cents dropped); 37% = 1,535.39 → 1,535; employer 706. SDL 0.25% = 10.37. Net: 4,149.71 −
	// 829 + 100 = 3,420.71.
	assert.equal(slip.gross, 4149.71);
	assert.deepEqual(scheme(slip, 'CPF'), [4149.71, 829, 706]);
	assert.deepEqual(scheme(slip, 'SDL'), [4149.71, 0, 10.37]);
	assert.equal(slip.net, 3420.71);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Verification pass, 28 September 2026. Every expected figure below is computed from the CPF
// Board's published rate booklets and the self-help-group tables, not read off the seed:
//   2025: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf
//   2026: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
//   2027: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
// Tables 1–5 (citizen / SPR 3rd year+, SPR 1st and 2nd year G/G, SPR 1st and 2nd year F/G). Each
// booklet's "Steps to compute CPF contribution": the total is rounded to the nearest dollar (50
// cents up), the employee's share down to the dollar, the employer pays the difference.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `[ER % of TW for $50–$750, graduated employee coefficient, total % over $750, employee % over $750]`, in basis points. */
type CpfCell = readonly [number, number, number, number];
/** Age keys are completed years at the period end: 30 (55 & below), 56, 61, 66, 71 (above 70). */
const CPF_BOOKLETS: Record<
	string,
	{ ceiling: number; tables: Record<string, Record<number, CpfCell>> }
> = (() => {
	// SPR graduated tables have not moved since 1 January 2016 (every booklet's own note).
	const T2 = {
		30: [400, 1500, 900, 500],
		56: [400, 1500, 900, 500],
		61: [350, 1500, 850, 500],
		66: [350, 1500, 850, 500],
		71: [350, 1500, 850, 500]
	} as const;
	const T3 = {
		30: [900, 4500, 2400, 1500],
		56: [600, 3750, 1850, 1250],
		61: [350, 2250, 1100, 750],
		66: [350, 1500, 850, 500],
		71: [350, 1500, 850, 500]
	} as const;
	// Tables 1, 4 and 5 differ only in the employer rate of the two senior bands.
	const year = (
		er56: number,
		co56: number,
		ee56: number,
		er61: number,
		co61: number,
		ee61: number
	) => ({
		T1: {
			30: [1700, 6000, 3700, 2000],
			56: [er56, co56, er56 + ee56, ee56],
			61: [er61, co61, er61 + ee61, ee61],
			66: [900, 2250, 1650, 750],
			71: [750, 1500, 1250, 500]
		},
		T2,
		T3,
		T4: {
			30: [1700, 1500, 2200, 500],
			56: [er56, 1500, er56 + 500, 500],
			61: [er61, 1500, er61 + 500, 500],
			66: [900, 1500, 1400, 500],
			71: [750, 1500, 1250, 500]
		},
		T5: {
			30: [1700, 4500, 3200, 1500],
			56: [er56, 3750, er56 + 1250, 1250],
			61: [er61, 2250, er61 + 750, 750],
			66: [900, 1500, 1400, 500],
			71: [750, 1500, 1250, 500]
		}
	});
	return {
		'2025-12': { ceiling: 7400, tables: year(1550, 5100, 1700, 1200, 3450, 1150) },
		'2026-01': { ceiling: 8000, tables: year(1600, 5400, 1800, 1250, 3750, 1250) },
		'2026-04': { ceiling: 8000, tables: year(1600, 5400, 1800, 1250, 3750, 1250) },
		'2026-07': { ceiling: 8000, tables: year(1600, 5400, 1800, 1250, 3750, 1250) },
		'2027-01': { ceiling: 8000, tables: year(1650, 5700, 1900, 1300, 3900, 1300) }
	} as never;
})();
/** The booklet's figure for an OW-only month: `[employee, employer]`, in dollars. */
const cpfByHand = (cell: CpfCell, ceiling: number, wage: number): readonly [number, number] => {
	const cents = Math.round(wage * 100);
	if (cents <= 5000) return [0, 0]; // "$50 or less: Nil"
	const [er, coefficient, total, employee] = cell;
	// Units of cent × basis point: 1,000,000 of them is a dollar.
	const [totalUnits, employeeUnits] =
		cents <= 50_000
			? [cents * er, 0]
			: cents <= 75_000
				? [cents * er + (cents - 50_000) * coefficient, (cents - 50_000) * coefficient]
				: [Math.min(cents, ceiling * 100) * total, Math.min(cents, ceiling * 100) * employee];
	const rounded = Math.floor((totalUnits + 500_000) / 1_000_000);
	const share = Math.floor(employeeUnits / 1_000_000);
	return [share, rounded - share];
};

test('Singapore — every CPF table cell, band seam and ceiling edge in every sealed version (Tables 1–5)', () => {
	// Seams: $50 (Nil ↔ employer-only), $500 (↔ graduated), $750 (↔ full rates), the OW ceiling
	// ($7,400 in 2025, $8,000 from 2026) and the cent either side of each. Ages sit one band each
	// side of 55/60/65/70. SPR year one is six months after conversion, year two eighteen.
	const wages = [
		50, 50.01, 123.45, 500, 500.01, 612.34, 749.99, 750, 750.01, 1234.5, 3000, 4567.89, 7400,
		7400.01, 8000, 8000.01, 12_000
	];
	const conversion = (period: string, months: number) => {
		const [y, m] = period.split('-').map(Number);
		return new Date(Date.UTC(y!, m! - 1 - months, 15)).toISOString().slice(0, 10);
	};
	const mismatches: string[] = [];
	for (const [period, { ceiling, tables }] of Object.entries(CPF_BOOKLETS))
		for (const [table, cells] of Object.entries(tables)) {
			const spr = table !== 'T1';
			const fullEmployer = table === 'T4' || table === 'T5';
			const people = Object.keys(cells).flatMap((age) =>
				wages.map((wage) => ({
					key: `${table}-${age}-${wage}`,
					wage,
					age: Number(age),
					citizenship: spr ? 'PERMANENT_RESIDENT' : 'CITIZEN',
					...(spr
						? { residency_since: conversion(period, table === 'T2' || table === 'T4' ? 6 : 18) }
						: {}),
					...(fullEmployer
						? {
								registrations: {
									CPF: {
										kind: 'REGISTERED',
										elections: {
											spr_full_employer_rate: true,
											spr_approval_reference: 'CPF-APPROVAL'
										}
									}
								}
							}
						: {})
				}))
			);
			const book = assessStatutory({ code: 'SG', period, people });
			for (const [age, cell] of Object.entries(cells))
				for (const wage of wages) {
					const row = book.get(`${table}-${age}-${wage}`)?.get('CPF');
					const got = row == null ? [0, 0] : [row.employee, row.employer];
					const want = cpfByHand(cell, ceiling, wage);
					if (got[0] !== want[0] || got[1] !== want[1])
						mismatches.push(
							`${period} ${table} age ${age} $${wage}: engine ${got}, booklet ${want}`
						);
				}
		}
	assert.deepEqual(mismatches, []);
});

test('Singapore — every self-help-group rung and every SDL seam, in every sealed version', () => {
	// CPF Board, "Contributions to Self-Help Groups" (the four monthly tables on total wages):
	// https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups
	// SDL: $2 below $800, 0.25% from $800 to $4,500, $11.25 above (SDL Act Second Schedule).
	const ladders: Record<string, readonly (readonly [number, number])[]> = {
		CDAC: [
			[2000, 0.5],
			[3500, 1],
			[5000, 1.5],
			[7500, 2],
			[Infinity, 3]
		],
		ECF: [
			[1000, 2],
			[1500, 4],
			[2500, 6],
			[4000, 9],
			[7000, 12],
			[10_000, 16],
			[Infinity, 20]
		],
		MBMF: [
			[1000, 3],
			[2000, 4.5],
			[3000, 6.5],
			[4000, 15],
			[6000, 19.5],
			[8000, 22],
			[10_000, 24],
			[Infinity, 26]
		],
		SINDA: [
			[1000, 1],
			[1500, 3],
			[2500, 5],
			[4500, 7],
			[7500, 9],
			[10_000, 12],
			[15_000, 18],
			[Infinity, 30]
		]
	};
	const member: Record<string, { race: string; religion?: string }> = {
		CDAC: { race: 'CHINESE' },
		ECF: { race: 'EURASIAN' },
		MBMF: { race: 'MALAY', religion: 'ISLAM' },
		SINDA: { race: 'INDIAN' }
	};
	const sdl = (wage: number) =>
		wage < 800 ? 2 : wage > 4500 ? 11.25 : Math.round(wage * 0.25) / 100;
	const mismatches: string[] = [];
	for (const period of Object.keys(CPF_BOOKLETS))
		for (const [code, ladder] of Object.entries(ladders)) {
			const tops = ladder.flatMap(([top]) => (top === Infinity ? [] : [top, top + 0.01]));
			const wages = [100, 799.99, 800, 800.01, 4500, 4500.01, ...tops];
			const book = assessStatutory({
				code: 'SG',
				period,
				people: wages.map((wage) => ({
					key: `${code}-${wage}`,
					wage,
					age: 30,
					citizenship: 'CITIZEN',
					...member[code]
				}))
			});
			for (const wage of wages) {
				const rows = book.get(`${code}-${wage}`)!;
				const fund = rows.get(code);
				const want = ladder.find(([top]) => wage <= top)![1];
				if (fund?.employee !== want || fund.employer !== 0)
					mismatches.push(`${period} ${code} $${wage}: engine ${fund?.employee}, table ${want}`);
				if (rows.get('SDL')?.employer !== sdl(wage))
					mismatches.push(
						`${period} SDL $${wage}: engine ${rows.get('SDL')?.employer}, Act ${sdl(wage)}`
					);
				for (const other of Object.keys(ladders))
					if (other !== code && rows.has(other))
						mismatches.push(`${period} ${code} $${wage} also charged ${other}`);
			}
		}
	assert.deepEqual(mismatches, []);
});

test('Singapore — a whole month, end to end: gross, CPF, SDL, CDAC and net', () => {
	// March 2026, a Chinese citizen aged 30 on $5,000, nothing else paid. CPF Table 1 (2026): 37%
	// × 5,000 = 1,850; employee 20% = 1,000; employer 850. SDL: above $4,500 → $11.25. CDAC:
	// "> $3,500 to $5,000" → $1.50. Singapore has no employer PAYE on employment income (register
	// SG-IRAS21), so net = 5,000 − 1,000 − 1.50 = 3,998.50.
	const { slips } = buildStatutory({
		code: 'SG',
		period: '2026-03',
		people: [{ key: 'SG-WHOLE', wage: 5000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }]
	});
	const slip = slips.get('SG-WHOLE')!;
	assert.equal(slip.gross, 5000);
	assert.deepEqual(scheme(slip, 'CPF'), [5000, 1000, 850]);
	assert.deepEqual(scheme(slip, 'SDL'), [5000, 0, 11.25]);
	assert.deepEqual(scheme(slip, 'CDAC'), [5000, 1.5, 0]);
	assert.deepEqual(slip.statutory.map((row) => row.scheme_code).toSorted(), ['CDAC', 'CPF', 'SDL']);
	assert.equal(slip.net, 3998.5);
});

test('Singapore — a mid-month leaver: s.20A final month, unused leave paid at the gross rate, and that leave pay is an Additional Wage', () => {
	// Last day Friday 13 March 2026. March has 22 working days (no public holiday planted); the
	// leaver worked 10: EA s.20A(1)(b), 3,300 × 10 ÷ 22 = 1,500.00. Four days of unused annual
	// leave are paid out (EA s.43 / MOM "Annual leave: payment for unused leave on termination")
	// at the gross rate of pay for one day, 12 × 3,300 ÷ (52 × 5) = 152.3077; × 4 = 609.23.
	// CPF: "payment in lieu of leave" is CPF-payable (CPF Board, "Which allowances and payments
	// attract CPF contributions", updated 5 January 2026), and not being for employment in the
	// month it is an Additional Wage (CPF Board, "What constitutes wages": OW must be "given to an
	// employee for their employment in that month"). TW 2,109.23, far below the AW ceiling:
	// 37% = 780.4151 → 780; employee 20% = 421.846 → 421; employer 359. SDL 0.25% = 5.27. CDAC
	// "> $2,000 to $3,500" → $1. Net 2,109.23 − 421 − 1 = 1,687.23.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [
				{
					key: 'SG-LEAVER',
					wage: 3300,
					age: 30,
					citizenship: 'CITIZEN',
					race: 'CHINESE',
					exit_date: '2026-03-13',
					exit_reason: 'RESIGNATION'
				}
			]
		},
		(world) => {
			const version = sgSettingsId('2026-03-15');
			world.leave_catalogue.push(
				...leaveCatalogue('SG').map((row) => ({ ...row, approval_id: null }))
			);
			const annual = world.leave_catalogue.find(
				(row) => row.settings_id === version && row.code === 'ANNUAL_LEAVE'
			)!;
			world.leave_entries.push({
				id: 'a3000000-0000-4000-8000-000000000001',
				employment_id: world.employments[0]!.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: `exit:${world.employments[0]!.id}:ANNUAL_LEAVE`,
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				days: 4,
				encash_days: 4,
				effective_on: '2026-03-13',
				due_on: '2026-03-13',
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
		}
	);
	const slip = slips.get('SG-LEAVER')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[10, 22, 1500]]
	);
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
		609.23
	);
	assert.equal(slip.gross, 2109.23);
	assert.deepEqual(scheme(slip, 'CPF'), [2109.23, 421, 359]);
	const cpf = slip.statutory.find((row) => row.scheme_code === 'CPF')!;
	assert.equal(cpf.ordinary_amount, 1500);
	assert.deepEqual(scheme(slip, 'SDL'), [2109.23, 0, 5.27]);
	assert.deepEqual(scheme(slip, 'CDAC'), [2109.23, 1, 0]);
	assert.equal(slip.net, 1687.23);
});

test('Singapore — a mid-month pay rise prices each salary on its own working days', () => {
	// $3,300 to Friday 13 March 2026, $4,400 from Saturday the 14th. The Act has no separate rule
	// for a rate change inside a month; s.20A(1)'s working-day measure applied to each rate is
	// the MOM incomplete-month method: 3,300 × 10 ÷ 22 + 4,400 × 12 ÷ 22 = 1,500 + 2,400 = 3,900.
	// CPF on 3,900: 37% = 1,443; employee 780; employer 663.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [{ key: 'SG-RAISE', wage: 3300, age: 30, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 4400,
				effective_range: { start: '2026-03-14', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-03-13' };
		}
	);
	const slip = slips.get('SG-RAISE')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[
			[10, 22, 1500],
			[12, 22, 2400]
		]
	);
	assert.equal(slip.gross, 3900);
	assert.deepEqual(scheme(slip, 'CPF'), [3900, 780, 663]);
});

/** A paid January–November record: the year's OW already subject, with no AW, for a December golden. */
const paidToNovember = (world: PayrollWorld, ordinary: number) => {
	world.payroll_runs.push({
		id: 'sg-13th-to-nov',
		company_id: COMPANY_ID,
		period: '2026-11',
		lifecycle: 'PAID'
	} as never);
	world.payslips.push({
		id: 'sg-13th-to-nov-slip',
		payroll_run_id: 'sg-13th-to-nov',
		employment_id: world.employments[0]!.id,
		status: 'PAID',
		paid_at: '2026-11-28T00:00:00.000Z',
		base: [],
		adjustments: [],
		statutory: [
			{
				scheme_code: 'CPF',
				base_amount: ordinary,
				ordinary_amount: ordinary,
				employee_amount: ordinary * 0.2,
				employer_amount: ordinary * 0.17
			}
		]
	} as never);
};
const thirteenth = (world: PayrollWorld, amount: number) => {
	const bonus = world.adhoc_catalogue!.find(
		(row) => row.code === 'bonus' && row.settings_id === sgSettingsId('2026-12-15')
	)!;
	world.adhoc_requests!.push({
		id: 'd0000000-0000-4000-8000-0000000013a1',
		employment_id: world.employments[0]!.id,
		catalogue_id: bonus.id,
		amount,
		event_date: '2026-12-15',
		pay_period: null,
		payslip_id: null,
		reason: '13th-month payment',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
};

test('Singapore — a 13th-month payment in December is an Additional Wage inside every total-wage base', () => {
	// CPF Board: an "annual wage supplement / bonus" is CPF-payable, and the AW ceiling is
	// $102,000 less the year's OW subject to CPF. $5,000 a month all year: OW 60,000, ceiling
	// 42,000, the $5,000 13th month is wholly subject. Base 10,000: 37% = 3,700; employee 2,000;
	// employer 1,700. SDL on total wages: above $4,500 → $11.25. CDAC on total wages $10,000:
	// "> $7,500" → $3. Net 10,000 − 2,000 − 3 = 7,997.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-12',
			people: [{ key: 'SG-13TH', wage: 5000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }]
		},
		(world) => {
			paidToNovember(world, 55_000);
			thirteenth(world, 5000);
		}
	);
	const slip = slips.get('SG-13TH')!;
	assert.equal(slip.gross, 10_000);
	assert.deepEqual(scheme(slip, 'CPF'), [10_000, 2000, 1700]);
	assert.deepEqual(scheme(slip, 'SDL'), [10_000, 0, 11.25]);
	assert.deepEqual(scheme(slip, 'CDAC'), [10_000, 3, 0]);
	assert.equal(slip.net, 7997);
});

test('Singapore — a 13th month above the OW ceiling meets the AW ceiling in December', () => {
	// $9,000 a month: OW subject is the $8,000 ceiling each month, 96,000 for the year, so the AW
	// ceiling is 102,000 − 96,000 = 6,000 and only 6,000 of the $9,000 13th month is subject.
	// Base 8,000 + 6,000 = 14,000: 37% = 5,180; employee 2,800; employer 2,380.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-12',
			people: [{ key: 'SG-13TH-CAP', wage: 9000, age: 30, citizenship: 'CITIZEN' }]
		},
		(world) => {
			paidToNovember(world, 88_000);
			thirteenth(world, 9000);
		}
	);
	assert.deepEqual(scheme(slips.get('SG-13TH-CAP')!, 'CPF'), [14_000, 2800, 2380]);
});

test('Singapore — the graduated bands read total wages, so an Additional Wage moves a low earner up a band', () => {
	// Table 1 bands are on "Employee's total wages for the calendar month" (TW = OW + AW). OW $400
	// alone is the employer-only band: 17% × 400 = 68 → 0 / 68. With a $200 bonus TW is 600, the
	// graduated band: 17% × 600 + 0.6 × 100 = 162; employee 0.6 × 100 = 60; employer 102.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [
				{ key: 'SG-LOW', wage: 400, age: 30, citizenship: 'CITIZEN' },
				{ key: 'SG-LOW-AW', wage: 400, age: 30, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === sgSettingsId('2026-03-15')
			)!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000013b1',
				employment_id: world.employments.find((row) => row.employee_number === 'SG-LOW-AW')!.id,
				catalogue_id: bonus.id,
				amount: 200,
				event_date: '2026-03-10',
				pay_period: null,
				payslip_id: null,
				reason: 'small bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	assert.deepEqual(scheme(slips.get('SG-LOW')!, 'CPF'), [400, 0, 68]);
	assert.deepEqual(scheme(slips.get('SG-LOW-AW')!, 'CPF'), [600, 60, 102]);
});

test('Singapore — no income tax is withheld from pay, resident or not, bonus month or not', () => {
	// Singapore assesses employees directly; the employer's income-tax duties are IR8A/AIS
	// reporting and the IR21 hold on a departing foreign employee (Income Tax Act 1947 s.68; SSO
	// anchor unverified, 403 on 2026-09-28; register SG-IRAS21). No monthly withholding row may
	// appear on a citizen's, an SPR's or a non-resident Employment Pass holder's payslip, bonus
	// or not. The only charges are CPF, SDL and the self-help funds.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'SG-TAX-CIT', wage: 12_000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
				{
					key: 'SG-TAX-EP',
					wage: 12_000,
					age: 30,
					citizenship: 'FOREIGNER',
					race: 'INDIAN',
					pass_type: 'EMPLOYMENT_PASS',
					tax_residency: 'NON_RESIDENT'
				}
			]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === sgSettingsId('2026-01-15')
			)!;
			for (const [index, employment] of world.employments.entries())
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000013c${index}`,
					employment_id: employment.id,
					catalogue_id: bonus.id,
					amount: 24_000,
					event_date: '2026-01-10',
					pay_period: null,
					payslip_id: null,
					reason: 'bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	const codes = (key: string) =>
		slips
			.get(key)!
			.statutory.map((row) => row.scheme_code)
			.toSorted();
	assert.deepEqual(codes('SG-TAX-CIT'), ['CDAC', 'CPF', 'SDL']);
	// SINDA reaches an Employment Pass holder of Indian descent; TW 36,000 → "> $15,000" $30.
	assert.deepEqual(codes('SG-TAX-EP'), ['SDL', 'SINDA']);
	assert.deepEqual(scheme(slips.get('SG-TAX-EP')!, 'SINDA'), [36_000, 30, 0]);
	// Net is gross less the employee's CPF and fund only. Citizen, January: OW capped at 8,000;
	// the Board's Step 1 estimate of the year's OW is 8,000 × 12 = 96,000, so the AW ceiling is
	// 6,000 of the 24,000 bonus. Base 14,000: employee 20% = 2,800. CDAC "> $7,500" $3. Net
	// 36,000 − 2,800 − 3 = 33,197.
	assert.equal(slips.get('SG-TAX-CIT')!.net, 33_197);
	assert.equal(slips.get('SG-TAX-EP')!.net, 36_000 - 30);
});

test('Singapore — every age seam (55, 60, 65, 70) moves the month after the birthday', () => {
	// Each Table 1 band header is "above N"; the booklets' notes and the CPF Board apply the new
	// rate from the first day of the month after the birthday. Born 31 January: January 2026 is
	// still the lower band, February the higher. $3,000 under the 2026 Table 1:
	// 55 & below 600 / 510; above 55–60 540 / 480; above 60–65 375 / 375; above 65–70
	// 7.5% = 225, 16.5% = 495 → 225 / 270; above 70 5% = 150, 12.5% = 375 → 150 / 225.
	const people = [
		{ key: 'SG-TURN-60', wage: 3000, birth_date: '1966-01-31', citizenship: 'CITIZEN' as const },
		{ key: 'SG-TURN-65', wage: 3000, birth_date: '1961-01-31', citizenship: 'CITIZEN' as const },
		{ key: 'SG-TURN-70', wage: 3000, birth_date: '1956-01-31', citizenship: 'CITIZEN' as const }
	];
	const january = assessStatutory({ code: 'SG', period: '2026-01', people });
	expectStatutory(january, 'SG-TURN-60', 'CPF', 540, 480);
	expectStatutory(january, 'SG-TURN-65', 'CPF', 375, 375);
	expectStatutory(january, 'SG-TURN-70', 'CPF', 225, 270);
	const february = assessStatutory({ code: 'SG', period: '2026-02', people });
	expectStatutory(february, 'SG-TURN-60', 'CPF', 375, 375);
	expectStatutory(february, 'SG-TURN-65', 'CPF', 225, 270);
	expectStatutory(february, 'SG-TURN-70', 'CPF', 150, 225);
});

test('Singapore — a leaver’s AW ceiling is reckoned on the actual OW to cessation, not a projected year', () => {
	// CPF Board, AW ceiling: before year end the year's OW is estimated, but on cessation the
	// actual OW is known. OW $8,000 in each of January to March, last day 31 March, and a $100,000
	// bonus in March: the year's OW is 24,000, the ceiling 102,000 − 24,000 = 78,000, so the base
	// is 8,000 + 78,000 = 86,000: 37% = 31,820; employee 20% = 17,200; employer 14,620. The same
	// person staying on is estimated at 16,000 + 8,000 × 10 = 96,000 — ceiling 6,000, base 14,000.
	const run = (exit: string | null) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-03',
				people: [
					{
						key: 'SG-CEASE',
						wage: 8000,
						age: 30,
						citizenship: 'CITIZEN',
						...(exit == null ? {} : { exit_date: exit, exit_reason: 'RESIGNATION' })
					}
				]
			},
			(world) => {
				world.payroll_runs.push({
					id: 'sg-cease-feb',
					company_id: COMPANY_ID,
					period: '2026-02',
					lifecycle: 'PAID'
				} as never);
				world.payslips.push({
					id: 'sg-cease-feb-slip',
					payroll_run_id: 'sg-cease-feb',
					employment_id: world.employments[0]!.id,
					status: 'PAID',
					paid_at: '2026-02-27T00:00:00.000Z',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'CPF',
							base_amount: 16_000,
							ordinary_amount: 16_000,
							employee_amount: 3200,
							employer_amount: 2720
						}
					]
				} as never);
				const bonus = world.adhoc_catalogue!.find(
					(row) => row.code === 'bonus' && row.settings_id === sgSettingsId('2026-03-15')
				)!;
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-0000000019a1',
					employment_id: world.employments[0]!.id,
					catalogue_id: bonus.id,
					amount: 100_000,
					event_date: '2026-03-10',
					pay_period: null,
					payslip_id: null,
					reason: 'bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		).slips.get('SG-CEASE')!;
	assert.deepEqual(scheme(run('2026-03-31'), 'CPF'), [86_000, 17_200, 14_620]);
	assert.deepEqual(scheme(run(null), 'CPF'), [14_000, 2800, 2380]);
});

test('Singapore — a one-day final month falls to the employer-only CPF band; a leaver before any working day is paid nothing and charged nothing', () => {
	// Last day Monday 2 March 2026: one of 22 working days, 3,000 ÷ 22 = 136.36 (s.20A). TW
	// > $50 to $500 is employer-only (Table 1): 17% × 136.36 = 23.18 → 23; employee nil. SDL's
	// $2 minimum applies below $800; CDAC $0.50. Last day Sunday 1 March: no working day, no
	// wages, so no CPF (nil at $50 or less), no levy on nil remuneration and no fund deduction.
	const { slips } = buildStatutory({
		code: 'SG',
		period: '2026-03',
		people: [
			{
				key: 'SG-ONE-DAY',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				exit_date: '2026-03-02',
				exit_reason: 'RESIGNATION'
			},
			{
				key: 'SG-NO-DAY',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				exit_date: '2026-03-01',
				exit_reason: 'RESIGNATION'
			}
		]
	});
	const one = slips.get('SG-ONE-DAY')!;
	assert.equal(one.gross, 136.36);
	assert.deepEqual(scheme(one, 'CPF'), [136.36, 0, 23]);
	assert.deepEqual(scheme(one, 'SDL'), [136.36, 0, 2]);
	assert.deepEqual(scheme(one, 'CDAC'), [136.36, 0.5, 0]);
	assert.equal(slips.get('SG-NO-DAY')!.gross, 0);
	assert.deepEqual(slips.get('SG-NO-DAY')!.statutory, []);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2026-09-28 closure round. Primary sources read on SSO (current version as at 28 Sep 2026):
//   CPF Act 1953 First Schedule para 1(1A)/(1B) and para 1(db), (e), (ec) definitions
//     https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=Sc1-
//   CPF Act 1953 s.9; CPF Regulations 1987 regs.2(1), 3 https://sso.agc.gov.sg/SL/CPFA1953-RG15
//   Employment Act 1968 ss.20A, 23, 27, 38, 45, 88A https://sso.agc.gov.sg/Act/EmA1968
//   Employment of Foreign Manpower Act 1990 ss.11, 25(4), 25(6)(e)
//     https://sso.agc.gov.sg/Act/EFMA1990
//   Income Tax Act 1947 s.68(2), (5)–(7) https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr68-
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Singapore — the SPR third year starts the month after the second anniversary month, across a version seam', () => {
	// CPF Act First Schedule para 1B: the graduated second-year table runs "from the first day of
	// the calendar month following the first anniversary month and ending on the last day of the
	// second anniversary month"; para 1(ec): the second anniversary month is the calendar month in
	// which the second anniversary falls. After it, para 1's full rates apply.
	//   SPR since 31 Mar 2024: second anniversary 31 Mar 2026 → March 2026 is still year two
	//   (Table 3, 55 and below, > $750: employer 9%, employee 15%: 270 / 450 on $3,000); April
	//   2026 is year three (Table 1: employer 17%, employee 20%: 510 / 600).
	//   SPR since 1 Apr 2024: April 2026 is its second anniversary month → still 450 / 270; May
	//   2026 is year three → 600 / 510.
	// March runs on the 2026-01-01 version, April and May on the 2026-04-01 version.
	const people = [
		{
			key: 'SPR-Y2-MAR-31',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2024-03-31'
		},
		{
			key: 'SPR-Y2-APR-01',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2024-04-01'
		}
	];
	const march = assessStatutory({ code: 'SG', period: '2026-03', people });
	expectStatutory(march, 'SPR-Y2-MAR-31', 'CPF', 450, 270);
	expectStatutory(march, 'SPR-Y2-APR-01', 'CPF', 450, 270);
	const april = assessStatutory({ code: 'SG', period: '2026-04', people });
	expectStatutory(april, 'SPR-Y2-MAR-31', 'CPF', 600, 510);
	expectStatutory(april, 'SPR-Y2-APR-01', 'CPF', 450, 270);
	const may = assessStatutory({ code: 'SG', period: '2026-05', people });
	expectStatutory(may, 'SPR-Y2-APR-01', 'CPF', 600, 510);
});

test('Singapore — every sealed version: a joiner and a resigning leaver with an unpaid day, overtime, a bonus and leave pay', () => {
	// One Chinese citizen aged 30 on $2,288 (a Part 4 non-workman, s.35(b)): hourly basic rate
	// 12 × 2,288 ÷ (52 × 44) = 12.00 (Fourth Schedule); gross rate for a day 12 × 2,288 ÷ (52 × 5)
	// = 105.60 (s.88A leave pay on termination, MOM "payment for unused leave").
	//   s.20A(1)(b): the final month pays 2,288 × days worked ÷ working days in the month; the
	//     unpaid day (s.20A(1)(c)) is not worked. Rounded to the cent once.
	//   s.38(4): Monday 09:00–20:00 on the 09:00–18:00 shift with its hour's break is two hours
	//     beyond the normal day: 2 × 12.00 × 1.5 = 36.00, an Ordinary Wage.
	//   Four days of unused annual leave: 4 × 105.60 = 422.40. A bonus B. Both are Additional
	//     Wages: First Schedule para 1(e) OW is only remuneration "due or granted wholly or
	//     exclusively in respect of employment during that month"; CPF Board PDF (5 Jan 2026) lists
	//     "payment in lieu of leave" as CPF-payable. B makes gross a multiple of $4 so SDL's 0.25%
	//     is exact in cents (the SDL Act rounds only the employer's total).
	//   CPF Table 1, 55 and below, TW > $750, every version (2025, 2026 and 2027 books): total 37%
	//     to the nearest dollar, employee 20% with cents dropped, employer the rest. Far below
	//     both ceilings. SDL 0.25% (min $2, max $11.25). CDAC band on TW. No income tax is
	//     withheld (register SG-IRAS21). No retrenchment/severance line: a resignation, and EA s.45
	//     sets no quantum in any case.
	//   s.23(2): a resignation without the s.10 notice is paid within 7 days of the last day; the
	//     month-end run warns naming that date.
	// The joiner, hired on a Monday, is paid 2,288 × working days from hire ÷ working days.
	// No holiday is planted, so a month's working days are its weekdays.
	type Case = {
		readonly period: string;
		readonly workingDays: number;
		readonly exit: string;
		readonly npl: string;
		readonly overtime: string;
		readonly worked: number;
		readonly bonus: number;
		readonly salary: number;
		readonly gross: number;
		readonly cpf: readonly [number, number, number];
		readonly sdl: number;
		readonly deadline: string;
		readonly hire: string;
		readonly joinerDays: number;
		readonly joiner: number;
		readonly joinerCpf: readonly [number, number, number];
		readonly joinerSdl: number;
	};
	const cases: readonly Case[] = [
		// Dec 2025: 23 weekdays; 1–12 Dec is 10, less the unpaid 2 Dec = 9: 2,288 × 9 ÷ 23 =
		// 895.304 → 895.30. Gross 895.30 + 36 + 1,002.30 + 422.40 = 2,356. 37% = 871.72 → 872;
		// 20% = 471.20 → 471; employer 401. SDL 5.89. CDAC "> $2,000 to $3,500" $1. Joiner from
		// Mon 15 Dec: 13 weekdays, 2,288 × 13 ÷ 23 = 1,293.217 → 1,293.22; 37% = 478.49 → 478;
		// 20% = 258.64 → 258; 220. SDL 3.23. CDAC "≤ $2,000" $0.50.
		{
			period: '2025-12',
			workingDays: 23,
			exit: '2025-12-12',
			npl: '2025-12-02',
			overtime: '2025-12-08',
			worked: 9,
			bonus: 1002.3,
			salary: 895.3,
			gross: 2356,
			cpf: [2356, 471, 401],
			sdl: 5.89,
			deadline: '2025-12-19',
			hire: '2025-12-15',
			joinerDays: 13,
			joiner: 1293.22,
			joinerCpf: [1293.22, 258, 220],
			joinerSdl: 3.23
		},
		// Mar 2026: 22 weekdays; 2–13 Mar is 10, less 3 Mar = 9: 936.00. Gross 936 + 36 +
		// 1,001.60 + 422.40 = 2,396. 37% = 886.52 → 887; 20% = 479.20 → 479; 408. SDL 5.99.
		// Joiner from Mon 16 Mar: 12 → 1,248; 461.76 → 462; 249.60 → 249; 213. SDL 3.12.
		{
			period: '2026-03',
			workingDays: 22,
			exit: '2026-03-13',
			npl: '2026-03-03',
			overtime: '2026-03-09',
			worked: 9,
			bonus: 1001.6,
			salary: 936,
			gross: 2396,
			cpf: [2396, 479, 408],
			sdl: 5.99,
			deadline: '2026-03-20',
			hire: '2026-03-16',
			joinerDays: 12,
			joiner: 1248,
			joinerCpf: [1248, 249, 213],
			joinerSdl: 3.12
		},
		// Apr 2026: 22 weekdays; 1–17 Apr is 13, less 7 Apr = 12: 1,248. Gross 1,248 + 36 +
		// 1,001.60 + 422.40 = 2,708. 37% = 1,001.96 → 1,002; 20% = 541.60 → 541; 461. SDL 6.77.
		// Joiner from Mon 20 Apr: 9 → 936; 346.32 → 346; 187.20 → 187; 159. SDL 2.34.
		{
			period: '2026-04',
			workingDays: 22,
			exit: '2026-04-17',
			npl: '2026-04-07',
			overtime: '2026-04-13',
			worked: 12,
			bonus: 1001.6,
			salary: 1248,
			gross: 2708,
			cpf: [2708, 541, 461],
			sdl: 6.77,
			deadline: '2026-04-24',
			hire: '2026-04-20',
			joinerDays: 9,
			joiner: 936,
			joinerCpf: [936, 187, 159],
			joinerSdl: 2.34
		},
		// Sep 2026: 22 weekdays; 1–11 Sep is 9, less 2 Sep = 8: 832. Gross 832 + 36 + 1,001.60 +
		// 422.40 = 2,292. 37% = 848.04 → 848; 20% = 458.40 → 458; 390. SDL 5.73. Joiner from Mon
		// 14 Sep: 13 → 1,352; 500.24 → 500; 270.40 → 270; 230. SDL 3.38.
		{
			period: '2026-09',
			workingDays: 22,
			exit: '2026-09-11',
			npl: '2026-09-02',
			overtime: '2026-09-07',
			worked: 8,
			bonus: 1001.6,
			salary: 832,
			gross: 2292,
			cpf: [2292, 458, 390],
			sdl: 5.73,
			deadline: '2026-09-18',
			hire: '2026-09-14',
			joinerDays: 13,
			joiner: 1352,
			joinerCpf: [1352, 270, 230],
			joinerSdl: 3.38
		},
		// Apr 2027 (2027 book; age 30 is unchanged at 37%): 22 weekdays; 1–16 Apr is 12, less 6
		// Apr = 11: 1,144. Gross 1,144 + 36 + 1,001.60 + 422.40 = 2,604. 37% = 963.48 → 963; 20%
		// = 520.80 → 520; 443. SDL 6.51. Joiner from Mon 19 Apr: 10 → 1,040; 384.80 → 385; 208;
		// 177. SDL 2.60.
		{
			period: '2027-04',
			workingDays: 22,
			exit: '2027-04-16',
			npl: '2027-04-06',
			overtime: '2027-04-12',
			worked: 11,
			bonus: 1001.6,
			salary: 1144,
			gross: 2604,
			cpf: [2604, 520, 443],
			sdl: 6.51,
			deadline: '2027-04-23',
			hire: '2027-04-19',
			joinerDays: 10,
			joiner: 1040,
			joinerCpf: [1040, 208, 177],
			joinerSdl: 2.6
		}
	];
	const covered = new Set<string>();
	for (const [index, c] of cases.entries()) {
		const version = sgSettingsId(`${c.period}-15`);
		covered.add(version);
		const { slips, warnings } = buildStatutory(
			{
				code: 'SG',
				period: c.period,
				people: [
					{
						key: 'SG-LEAVER',
						wage: 2288,
						age: 30,
						citizenship: 'CITIZEN',
						race: 'CHINESE',
						hire_date: '2020-01-01',
						exit_date: c.exit,
						exit_reason: 'RESIGNATION'
					},
					{
						key: 'SG-JOINER',
						wage: 2288,
						age: 30,
						citizenship: 'CITIZEN',
						race: 'CHINESE',
						hire_date: c.hire
					}
				]
			},
			(world) => {
				world.leave_catalogue.push(
					...leaveCatalogue('SG').map((row) => ({ ...row, approval_id: null }))
				);
				const row = (code: string) =>
					world.leave_catalogue.find(
						(entry) => entry.settings_id === version && entry.code === code
					)!;
				const employment = world.employments.find(
					(entry) => entry.employee_number === 'SG-LEAVER'
				)!;
				const term = world.employment_terms.find((entry) => entry.employment_id === employment.id)!;
				world.leave_entries.push({
					id: `e1000000-0000-4000-8000-0000000c${index}n01`,
					employment_id: employment.id,
					catalogue_id: row('UNPAID_LEAVE').id,
					leave_code: 'UNPAID_LEAVE',
					reference: `NPL-SG-${c.period}`,
					no_pay_origin: 'EMPLOYEE_REQUESTED',
					from_date: c.npl,
					to_date: c.npl,
					half_day_start: false,
					half_day_end: false,
					days: 1,
					effective_on: c.npl,
					reason: 'Unpaid',
					allocations: [],
					charges: [
						{
							date: c.npl,
							days: 1,
							catalogue_id: row('UNPAID_LEAVE').id,
							employment_term_id: term.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						}
					],
					approval_id: null
				} as never);
				world.leave_entries.push({
					id: `a3000000-0000-4000-8000-0000000c${index}e01`,
					employment_id: employment.id,
					catalogue_id: row('ANNUAL_LEAVE').id,
					leave_code: 'ANNUAL_LEAVE',
					reference: `exit:${employment.id}:ANNUAL_LEAVE`,
					from_date: `${c.period.slice(0, 4)}-01-01`,
					to_date: `${c.period.slice(0, 4)}-12-31`,
					days: 4,
					encash_days: 4,
					effective_on: c.exit,
					due_on: c.exit,
					charges: [],
					allocations: [],
					approval_id: null,
					payslip_id: null,
					as_adjustment_entry: false
				} as never);
				punchWithBreak(world, 'SG-LEAVER', c.overtime, '09:00', '20:00');
				const bonus = world.adhoc_catalogue!.find(
					(entry) => entry.code === 'bonus' && entry.settings_id === version
				)!;
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000c${index}b01`,
					employment_id: employment.id,
					catalogue_id: bonus.id,
					amount: c.bonus,
					event_date: c.exit,
					pay_period: null,
					payslip_id: null,
					reason: 'Bonus paid with the final salary',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const slip = slips.get('SG-LEAVER')!;
		const label = `${c.period} (${version})`;
		assert.deepEqual(workLines(slip), [[c.overtime, 'OT-1.5X', 2, 36]], label);
		assert.equal(
			slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount,
			422.4,
			label
		);
		assert.equal(slip.gross, c.gross, label);
		assert.equal(
			Math.round((slip.gross - 36 - 422.4 - c.bonus) * 100) / 100,
			c.salary,
			`${label}: s.20A salary`
		);
		assert.deepEqual(scheme(slip, 'CPF'), c.cpf, label);
		const cpf = slip.statutory.find((row) => row.scheme_code === 'CPF')!;
		assert.equal(cpf.ordinary_amount, c.salary + 36, `${label}: OW is salary plus overtime`);
		assert.deepEqual(scheme(slip, 'SDL'), [c.gross, 0, c.sdl], label);
		assert.deepEqual(scheme(slip, 'CDAC'), [c.gross, 1, 0], label);
		assert.deepEqual(
			slip.statutory.map((row) => row.scheme_code).toSorted(),
			['CDAC', 'CPF', 'SDL'],
			`${label}: no withholding tax, no severance charge`
		);
		assert.equal(slip.net, Math.round((c.gross - c.cpf[1] - 1) * 100) / 100, label);
		const late = warnings.find((warning) => warning.includes('FINAL_PAY_LATE'));
		assert.ok(late, `${label}: expected a final-pay warning, got ${JSON.stringify(warnings)}`);
		assert.match(late, /s\.23\(2\)/);
		assert.ok(late.includes(c.deadline), `${label}: ${late}`);

		const joiner = slips.get('SG-JOINER')!;
		assert.equal(joiner.gross, c.joiner, `${label}: joiner s.20A(1)(a)`);
		assert.deepEqual(scheme(joiner, 'CPF'), c.joinerCpf, label);
		assert.deepEqual(scheme(joiner, 'SDL'), [c.joiner, 0, c.joinerSdl], label);
		assert.deepEqual(scheme(joiner, 'CDAC'), [c.joiner, 0.5, 0], label);
		assert.equal(joiner.net, Math.round((c.joiner - c.joinerCpf[1] - 0.5) * 100) / 100, label);
	}
	assert.deepEqual(
		[...covered].toSorted(),
		settingsVersions('SG')
			.map((row) => row.id)
			.toSorted(),
		'one case per sealed version'
	);
});

test('Singapore — a retrenched employee is paid no statutory retrenchment benefit, and the final salary is due on the last day', () => {
	// EA 1968 s.45: "No employee who has been in continuous service with an employer for less than
	// 2 years is entitled to any retrenchment benefit"; no section of the Act or its subsidiary
	// legislation fixes a quantum for longer service. The Tripartite Advisory norm (two weeks to
	// one month per year) is a guideline, and CPF Board lists "retrenchment pay" as not wages
	// (PDF, 5 Jan 2026). So the payroll computes none, even at 5+ years' service.
	// September 2026: 22 weekdays; 1–15 Sep is 11: 4,000 × 11 ÷ 22 = 2,000 (s.20A). CPF 37% = 740;
	// employee 20% = 400; employer 340. SDL 0.25% = 5.00. CDAC "≤ $2,000" $0.50. Net 1,599.50.
	// s.22 / MOM: employer termination is paid on the last day (15 Sep) absent the evidenced
	// impossibility, so the month-end run warns "by 2026-09-15".
	const { slips, warnings } = buildStatutory({
		code: 'SG',
		period: '2026-09',
		people: [
			{
				key: 'SG-RETRENCHED',
				wage: 4000,
				age: 45,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				hire_date: '2019-01-01',
				exit_date: '2026-09-15',
				exit_reason: 'RETRENCHMENT'
			}
		]
	});
	const slip = slips.get('SG-RETRENCHED')!;
	assert.deepEqual(slip.adjustments, []);
	assert.equal(slip.gross, 2000);
	assert.deepEqual(scheme(slip, 'CPF'), [2000, 400, 340]);
	assert.deepEqual(scheme(slip, 'SDL'), [2000, 0, 5]);
	assert.deepEqual(scheme(slip, 'CDAC'), [2000, 0.5, 0]);
	assert.deepEqual(slip.statutory.map((row) => row.scheme_code).toSorted(), ['CDAC', 'CPF', 'SDL']);
	assert.equal(slip.net, 1599.5);
	const late = warnings.find((warning) => warning.includes('FINAL_PAY_LATE'));
	assert.ok(late, JSON.stringify(warnings));
	assert.match(late, /by 2026-09-15/);
	// No catalogue in any sealed version offers a statutory severance or retrenchment component.
	for (const version of settingsVersions('SG'))
		assert.equal(
			[...(version.obligations ?? [])].find(
				(row: { code: string }) => row.code === 'RETRENCHMENT_NOTIFICATION_AND_BENEFIT'
			)?.status,
			'EXTERNAL'
		);
});

test('Singapore — the foreign worker levy is billed to the employer by MOM, never deducted on the payslip', () => {
	// EFMA 1990 s.11(1), (3): the levy is imposed on employers by Levy Order and recovered "in such
	// manner and through such channels as may be specified in the order" (a MOM bill, GIRO on the
	// 17th: MOM "Paying the levy", updated 8 Jul 2026); s.25(6)(e): the employer bears it; s.25(4)(a)
	// penalises an employer who deducts it from the foreign employee's salary. So no payslip line
	// and no employee deduction for an S Pass or Work Permit holder; CPF does not reach a foreigner
	// and CDAC reaches only citizens and PRs (CDAC Rules r.2). SDL is still due: 0.25% × 3,000 =
	// 7.50; × 1,500 = 3.75.
	const { slips } = buildStatutory({
		code: 'SG',
		period: '2026-09',
		people: [
			{
				key: 'SG-S-PASS',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'CHINESE',
				religion: 'BUDDHISM',
				pass_type: 'S_PASS'
			},
			{
				key: 'SG-WORK-PERMIT',
				wage: 1500,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'CHINESE',
				religion: 'BUDDHISM',
				pass_type: 'WORK_PERMIT'
			}
		]
	});
	for (const [key, wage, sdl] of [
		['SG-S-PASS', 3000, 7.5],
		['SG-WORK-PERMIT', 1500, 3.75]
	] as const) {
		const slip = slips.get(key)!;
		assert.deepEqual(slip.adjustments, [], key);
		assert.deepEqual(
			slip.statutory.map((row) => row.scheme_code),
			['SDL'],
			key
		);
		assert.deepEqual(scheme(slip, 'SDL'), [wage, 0, sdl], key);
		assert.equal(slip.net, wage, key);
	}
	for (const version of settingsVersions('SG'))
		assert.equal(
			[...(version.obligations ?? [])].find(
				(row: { code: string }) => row.code === 'FOREIGN_WORKER_LEVY'
			)?.status,
			'EXTERNAL'
		);
});

test('Singapore — IR8A, IR21 and CPF late interest are dated external obligations in every sealed version', () => {
	// ITA 1947 s.68(2): the employer's annual return by Gazette notice (IRAS: by 1 March, AIS).
	// s.68(5): notice of a non-citizen's cessation not later than one month before; s.68(6): of a
	// departure over 3 months; s.68(7): no payment of moneys until 30 days after the Comptroller
	// receives the notice. CPF Act s.9(1) and CPF Regulations 1987 reg.3: late interest is 1.5% a
	// month or $5, whichever is higher, from the first day of the following month, payable within
	// 14 days of the Board's demand — the Board computes and bills it, the payroll does not.
	for (const version of settingsVersions('SG')) {
		const obligation = (code: string) =>
			(
				version.obligations as { code: string; timing: string; authority: string; status: string }[]
			).find((row) => row.code === code)!;
		assert.match(obligation('ANNUAL_EMPLOYMENT_INCOME_RETURN').timing, /By 1 March/);
		assert.match(obligation('ANNUAL_EMPLOYMENT_INCOME_RETURN').authority, /s\.68\(2\)/);
		assert.match(obligation('TAX_CLEARANCE_AND_WITHHOLDING').timing, /one month before/);
		assert.match(obligation('TAX_CLEARANCE_AND_WITHHOLDING').authority, /s\.68\(5\)–\(7\)/);
		assert.equal(version.payroll.tax_clearance.max_withhold_days, 30);
		// s.68(7) releases on the Comptroller's directive or 30 days after notice; an amended IR21
		// reopens the clearance (IRAS step-by-step guide).
		assert.deepEqual(version.payroll.tax_clearance.release, {
			bases: ['RELEASE_NOTICE', 'PAY_TAX_DIRECTIVE', 'NOTICE_EXPIRY'],
			evidence_required: true,
			amended_notice_resets: true
		});
		const cpf = obligation('CPF_MONTHLY_SUBMISSION_AND_PAYMENT');
		assert.match(cpf.timing, /1\.5% a month/);
		assert.match(cpf.timing, /first day of the following month/);
		assert.match(cpf.timing, /\$5/);
		assert.match(cpf.authority, /reg/);
	}
});

test('Singapore — the full-time Local Qualifying Salary is $1,600 before 1 July 2026 and $1,800 from it', () => {
	// MOM, Factsheet on lower-wage workers (3 March 2026) para 10: "From 1 July 2026, the
	// Government will raise the LQS from $1,600 to $1,800"; part-time stays $10.50 an hour.
	// MOM LQS page (archived 22 Jan 2026): "The LQS is $1,600 today", ≥ $10.50/hr part-time.
	for (const version of settingsVersions('SG')) {
		const lqs = (version.obligations as { code: string; description: string }[]).find(
			(row) => row.code === 'WORK_PASS_AND_LOCAL_QUALIFYING_SALARY'
		)!.description;
		const monthly = version.effective_range.start.slice(0, 10) < '2026-07-01' ? '$1,600' : '$1,800';
		assert.ok(
			lqs.includes(`(${monthly} a month full-time; $10.50 an hour part-time`),
			`${version.name}: ${lqs}`
		);
	}
	assert.match(
		settingsVersions('SG').find((v) => v.id === sgSettingsId('2026-07-15'))!.change_summary,
		/\$1,600 to \$1,800/
	);
});

test('Singapore — a fund instruction for a different monthly amount replaces the schedule rung (CDAC and SINDA Rules r.8)', () => {
	// SSO (current as at 28 Sep 2026): CDAC Rules 1992 r.8 and SINDA Rules 1992 r.8(1) — an
	// employee may give written notice to contribute in excess of the Schedule rate, and the
	// employer must deduct it; SINDA r.8(2) — one unable to pay the Schedule rate notifies a lesser
	// amount on SINDA's form, and the employer deducts that. At $3,000 the Schedule (Part 2, wages
	// from 1 Jan 2015) gives CDAC "more than $2,000 but not more than $3,500" $1 and SINDA "more
	// than $2,500 but not more than $4,500" $7. With instructions for $5 (CDAC) and $2 (SINDA) the
	// deductions are exactly those amounts; the untouched colleagues keep $1 and $7.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-09',
		people: [
			{
				key: 'CDAC-MORE',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				registrations: {
					CDAC: {
						kind: 'REGISTERED',
						elections: { shg_monthly_amount: 5, shg_instruction_reference: 'CDAC-R8-NOTICE' }
					}
				}
			},
			{
				key: 'SINDA-LESS',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'INDIAN',
				registrations: {
					SINDA: {
						kind: 'REGISTERED',
						elections: { shg_monthly_amount: 2, shg_instruction_reference: 'SINDA-R8-FORM' }
					}
				}
			},
			{ key: 'CDAC-RUNG', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{ key: 'SINDA-RUNG', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' }
		]
	});
	expectStatutory(book, 'CDAC-MORE', 'CDAC', 5, 0);
	expectStatutory(book, 'SINDA-LESS', 'SINDA', 2, 0);
	expectStatutory(book, 'CDAC-RUNG', 'CDAC', 1, 0);
	expectStatutory(book, 'SINDA-RUNG', 'SINDA', 7, 0);
});

test('Singapore — SINDA reaches the whole Indian community of Rules r.2, not only an INDIAN race, in every sealed version', () => {
	// CPF (Contributions to Community Fund — SINDA) Rules 1992 r.2 (SSO, current version as at
	// 28 Sep 2026): "Indian community" means "every person of Indian descent and includes
	// Bangladeshis, Bengalis, Gujaratis, Parsees, Sikhs, Sinhalese, Telegus, Pakistanis, Sri
	// Lankans, Goanese, Malayalees, Punjabis, Sindhis and Tamils". The CPF Board's SHG page repeats
	// the list. The race is the NRIC race, recorded in any case. Schedule Part 2 (wages from 1 Jan
	// 2015): "more than $2,500 but not more than $4,500" → $7, employee-borne. A Malay citizen is
	// outside SINDA (and inside MBMF only by religion, which is not recorded here).
	const people = [
		{ key: 'SIKH-SC', wage: 3000, age: 30, citizenship: 'CITIZEN' as const, race: 'Sikh' },
		{
			key: 'SRI-LANKAN-PR',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2015-01-15',
			race: 'Sri Lankan'
		},
		{
			key: 'TAMIL-EP',
			wage: 3000,
			age: 30,
			citizenship: 'FOREIGNER' as const,
			pass_type: 'EMPLOYMENT_PASS',
			race: 'TAMIL'
		},
		{ key: 'MALAY-SC', wage: 3000, age: 30, citizenship: 'CITIZEN' as const, race: 'MALAY' }
	];
	for (const period of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01']) {
		const book = assessStatutory({ code: 'SG', period, people });
		expectStatutory(book, 'SIKH-SC', 'SINDA', 7, 0);
		expectStatutory(book, 'SRI-LANKAN-PR', 'SINDA', 7, 0);
		expectStatutory(book, 'TAMIL-EP', 'SINDA', 7, 0);
		expectStatutorySkipped(book, 'MALAY-SC', 'SINDA');
		// None of them is Chinese, so CDAC stays silent.
		expectStatutorySkipped(book, 'SIKH-SC', 'CDAC');
	}
});

test('Singapore — the month a foreigner becomes an SPR, and an SPR a citizen, splits the OW at the status date (CPF Board)', () => {
	// CPF Board FAQ "Do I need to pay CPF contributions for my foreign employee who has
	// recently obtained Singapore Permanent Residence status?" (read 2026-09-28): the first-year
	// rate "applies from the day your employee obtains his SPR status"; "For Ordinary Wages (OW),
	// you will need to pay CPF contributions on the pro-rated OW" — SPR on 15 March 2026 →
	// "CPF contribution is required on the pro-rated wages from 15 to 31 March 2026"; AW payable
	// before that day attracts none. CPF Board FAQ "My Singapore Permanent Resident employee
	// obtained his Singapore Citizenship in the middle of the month…" (last updated 22 Apr 2026):
	// the SPR rate on the pro-rated wages before the citizenship day, the citizen rate after.
	// CPF Act First Schedule para 1A: the first-year table begins "on the date the employee
	// becomes a permanent resident".
	//
	// The pro-rated OW is the payslip's own split of the month at the terms change: $3,300 a
	// month, 22 working days in March 2026, 10 of them to Friday 13 March and 12 from Monday 16
	// (s.20A(1), as the pay-rise golden above): 1,500 before, 1,800 from the 15th. The Board names
	// no pro-ration basis; both portions exceed $750 and neither reaches the OW ceiling, so no
	// band or ceiling question arises (the Board asks employers to contact it only then).
	//
	// Foreigner → SPR on Sun 15 Mar 2026: CPF only on 1,800, first year (Table 2, 55 and below,
	// > $750: employer 4%, employee 5%): total 9% = 162, employee 90, employer 72.
	// SPR (since 10 Jan 2025, second year from Feb 2026, Table 3: employer 9%, employee 15%) →
	// citizen on 15 Mar 2026: 1,500 × 24% = 360, employee 225, employer 135; 1,800 at Table 1
	// (17% / 20%): 666, employee 360, employer 306. Month: employee 585, employer 441, base 3,300.
	// SDL reads the whole month's wages either way: 0.25% × 3,300 = 8.25.
	const convert = (from: string, to: string, since: string | undefined, wage = 3300) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-03',
				people: [
					{
						key: 'SG-CONVERT',
						wage,
						age: 30,
						citizenship: from,
						residency_since: since,
						pass_type: from === 'FOREIGNER' ? 'EMPLOYMENT_PASS' : null
					}
				]
			},
			(world) => {
				const old = world.employment_terms[0]!;
				world.employment_terms.push({
					...old,
					id: 'b0000000-0000-4000-8000-00000000a0c1',
					residency_status: to,
					residency_since: to === 'PERMANENT_RESIDENT' ? '2026-03-15' : old.residency_since,
					pass_type: null,
					effective_range: { start: '2026-03-15', end: null }
				});
				old.effective_range = { start: '2015-01-01', end: '2026-03-14' };
			}
		).slips.get('SG-CONVERT')!;

	const pr = convert('FOREIGNER', 'PERMANENT_RESIDENT', undefined);
	assert.equal(pr.gross, 3300);
	assert.deepEqual(scheme(pr, 'CPF'), [1800, 90, 72]);
	assert.deepEqual(scheme(pr, 'SDL'), [3300, 0, 8.25]);

	const citizen = convert('PERMANENT_RESIDENT', 'CITIZEN', '2025-01-10');
	assert.deepEqual(scheme(citizen, 'CPF'), [3300, 585, 441]);
	// The month's total and the employee share round once, on the portions' sum (First Schedule:
	// total to the nearest dollar, the employee share's cents dropped). $1,034: 470 before and 564
	// from the 15th, both statuses on the > $750 row of the month's $1,034. Employee 15% × 470 +
	// 20% × 564 = 70.50 + 112.80 = 183.30 → 183; total 24% × 470 + 37% × 564 = 112.80 + 208.68 =
	// 321.48 → 321; employer 138. Rounding each portion would give 70 + 112 = 182 and 113 + 209 = 322.
	assert.deepEqual(
		scheme(convert('PERMANENT_RESIDENT', 'CITIZEN', '2025-01-10', 1034), 'CPF'),
		[1034, 183, 138]
	);
	assert.deepEqual(scheme(citizen, 'SDL'), [3300, 0, 8.25]);
});

const SG_PERIODS = ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01'] as const;

test('Singapore — a contractual retrenchment benefit is outside CPF and the SHG funds, inside SDL, in every sealed version', () => {
	// EA 1968 s.45 sets no quantum, so HR raises the agreed amount (RETRENCHMENT_BENEFIT). CPF Board
	// ("Are CPF contributions payable on redundancy payment?"): not payable on "termination
	// benefits given for retrenchment or loss of employment"; the SHG funds follow the CPF base;
	// Muis Table 2: retrenchment pay not accounted for MBMF. SDL Act s.2 "wages" (remuneration in
	// money "in respect of the person's employment", excluding only Gazette-notified payments, of
	// which S 375/2023 names medical reimbursement alone): counted — Owner rule 2026-09-28
	// (register SG-EA24-R02), read as salary in lieu of notice is.
	// $2,000 salary, $1,500 benefit, Chinese citizen aged 30: CPF on 2,000 only (Table 1, 37%) =
	// 740; employee 20% = 400; employer 340. CDAC on 2,000: "≤ $2,000" $0.50. SDL 0.25% × 3,500 =
	// 8.75 (without the benefit it would be 5.00). Gross 3,500; net 3,500 − 400 − 0.50 = 3,099.50.
	for (const period of SG_PERIODS) {
		const version = sgSettingsId(`${period}-15`);
		const { slips } = buildStatutory(
			{
				code: 'SG',
				period,
				people: [{ key: 'SG-RB', wage: 2000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }]
			},
			(world) => {
				const row = world.adhoc_catalogue!.find(
					(entry) => entry.code === 'RETRENCHMENT_BENEFIT' && entry.settings_id === version
				)!;
				assert.deepEqual(row.counts_toward, ['SDL'], period);
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-0000000004b1',
					employment_id: world.employments[0]!.id,
					catalogue_id: row.id,
					amount: 1500,
					event_date: `${period}-15`,
					pay_period: period,
					payslip_id: null,
					reason: 'retrenchment benefit (collective agreement)',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const slip = slips.get('SG-RB')!;
		assert.equal(slip.gross, 3500, period);
		assert.deepEqual(scheme(slip, 'CPF'), [2000, 400, 340], period);
		assert.deepEqual(scheme(slip, 'CDAC'), [2000, 0.5, 0], period);
		assert.deepEqual(scheme(slip, 'SDL'), [3500, 0, 8.75], period);
		assert.equal(slip.net, 3099.5, period);
	}
});

test('Singapore — SDL is each employee’s 0.25% to the cent before the employer total is floored (SDL Act s.3(1); Owner rule SG-SDL13)', () => {
	// SDL Act s.3(1): "in respect of each of the employer's employees" the greater of 0.25% of the
	// month's wages (to $4,500, s.3(2)) and $2. No instrument states a rounding; the CPF Board's
	// FAQ: "After computing SDL for each employee, add up the amounts and round the total down".
	// Owner rule 2026-09-28: each employee's levy is a money amount to the cent (half up), then R31
	// floors the employer-month total. 3,999.99 × 0.25% = 9.999975 → 10.00; 1,234.56 × 0.25% =
	// 3.0864 → 3.09.
	for (const period of SG_PERIODS) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [
				{
					key: 'SDL-A',
					wage: 3999.99,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'S_PASS',
					race: 'CHINESE'
				},
				{
					key: 'SDL-B',
					wage: 1234.56,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'S_PASS',
					race: 'CHINESE'
				}
			]
		});
		expectStatutory(book, 'SDL-A', 'SDL', 0, 10);
		expectStatutory(book, 'SDL-B', 'SDL', 0, 3.09);
	}
});

test('Singapore — SINDA reaches S Pass and Work Permit holders of the Indian community; CDAC stays with citizens and PRs (CPF Act s.76(3); SINDA and CDAC Rules r.2)', () => {
	// CPF Act 1953 s.76(3) (SSO, current as at 28 Sep 2026): an employer "must deduct from the
	// monthly wages of an employee who belongs to that community … unless an employee notifies"
	// otherwise; s.2 "employee" is any person "employed in Singapore by an employer". SINDA Rules
	// r.2: "every person of Indian descent" — no residency term; CDAC Rules r.2: "every person who
	// is a permanent resident or citizen of Singapore of Chinese descent". The CPF Board's SINDA
	// list (citizens, SPRs, EP holders) is narrower than the Rules; the law is followed.
	// Schedule Part 2: $3,000 → "more than $2,500 but not more than $4,500" $7; $1,500 → "more
	// than $1,000 but not more than $1,500" $3. A r.4 opt-out stops it.
	for (const period of SG_PERIODS) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [
				{
					key: 'TAMIL-SP',
					wage: 3000,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'S_PASS',
					race: 'TAMIL'
				},
				{
					key: 'SIKH-WP',
					wage: 1500,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'WORK_PERMIT',
					race: 'SIKH'
				},
				{
					key: 'INDIAN-WP-OUT',
					wage: 1500,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'WORK_PERMIT',
					race: 'INDIAN',
					registrations: {
						SINDA: {
							kind: 'REGISTERED',
							elections: { shg_opt_out: true, shg_instruction_reference: 'SINDA-R4-FORM' }
						}
					}
				},
				{
					key: 'CHINESE-SP',
					wage: 3000,
					age: 30,
					citizenship: 'FOREIGNER',
					pass_type: 'S_PASS',
					race: 'CHINESE'
				}
			]
		});
		expectStatutory(book, 'TAMIL-SP', 'SINDA', 7, 0);
		expectStatutory(book, 'SIKH-WP', 'SINDA', 3, 0);
		expectStatutorySkipped(book, 'INDIAN-WP-OUT', 'SINDA');
		expectStatutorySkipped(book, 'CHINESE-SP', 'CDAC');
	}
});

test('Singapore — a dual-race employee: the first NRIC race selects the fund, and a documented election adds the second, either way round', () => {
	// SINDA Rules r.2 (Indian descent) and CDAC Rules r.2 (Chinese descent, citizen or PR): a mixed
	// person belongs to both communities. CPF Board: "the first race listed determines the
	// applicable SHG"; an Indian-Chinese employee "may also choose to contribute both to SINDA and"
	// CDAC. Owner rule 2026-09-28 (register SG-SHG04(c)): the first race is the default fund, the
	// second is by the employee's recorded election, for any Indian-community first race (a Sikh-
	// Chinese as much as an Indian-Chinese) and symmetrically for a Chinese-Indian. At $3,000:
	// CDAC "more than $2,000 but not more than $3,500" $1; SINDA $7.
	for (const period of SG_PERIODS) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [
				{
					key: 'SIKH-CHINESE',
					wage: 3000,
					age: 30,
					citizenship: 'CITIZEN',
					race: 'SIKH',
					registrations: {
						CDAC: {
							kind: 'REGISTERED',
							elections: {
								shg_dual_cdac: true,
								shg_secondary_race: 'CHINESE',
								shg_instruction_reference: 'CDAC-DUAL'
							}
						}
					}
				},
				{
					key: 'CHINESE-TAMIL',
					wage: 3000,
					age: 30,
					citizenship: 'CITIZEN',
					race: 'CHINESE',
					registrations: {
						SINDA: {
							kind: 'REGISTERED',
							elections: {
								shg_dual_sinda: true,
								shg_secondary_race: 'TAMIL',
								shg_instruction_reference: 'SINDA-DUAL'
							}
						}
					}
				},
				{ key: 'CHINESE-ONLY', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }
			]
		});
		expectStatutory(book, 'SIKH-CHINESE', 'SINDA', 7, 0);
		expectStatutory(book, 'SIKH-CHINESE', 'CDAC', 1, 0);
		expectStatutory(book, 'CHINESE-TAMIL', 'CDAC', 1, 0);
		expectStatutory(book, 'CHINESE-TAMIL', 'SINDA', 7, 0);
		expectStatutory(book, 'CHINESE-ONLY', 'CDAC', 1, 0);
		expectStatutorySkipped(book, 'CHINESE-ONLY', 'SINDA');
	}
	// A dual SINDA election on a first race that already selects SINDA is refused.
	assert.throws(
		() =>
			assessStatutory({
				code: 'SG',
				period: '2026-01',
				people: [
					{
						key: 'TAMIL-DUAL',
						wage: 3000,
						age: 30,
						citizenship: 'CITIZEN',
						race: 'TAMIL',
						registrations: {
							SINDA: {
								kind: 'REGISTERED',
								elections: {
									shg_dual_sinda: true,
									shg_secondary_race: 'SIKH',
									shg_instruction_reference: 'SINDA-DUAL'
								}
							}
						}
					}
				]
			}),
		/dual SINDA election/
	);
});

// SPR (since 10 Jan 2020, so Table 1 rates in 2026 — the same as a citizen's) → citizen on
// Sun 15 Mar 2026; March 2026 has 22 working days, 10 before and 12 from the 15th (s.20A).
const sprToCitizen = (wage: number) =>
	buildStatutory(
		{
			code: 'SG',
			period: '2026-03',
			people: [
				{
					key: 'SG-SPR-SC',
					wage,
					age: 30,
					citizenship: 'PERMANENT_RESIDENT',
					residency_since: '2020-01-10'
				}
			]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a0c2',
				residency_status: 'CITIZEN',
				pass_type: null,
				effective_range: { start: '2026-03-15', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-03-14' };
		}
	).slips.get('SG-SPR-SC')!;

test('Singapore — a conversion month keeps one OW ceiling for the month (CPF Act First Schedule; Owner rule SG-CPF34)', () => {
	// The OW ceiling ($8,000 a month in 2026) is monthly: a $20,000 month split at a status change
	// still carries CPF on $8,000 of OW, 37% = 2,960, not a ceiling per portion. Owner rule
	// 2026-09-28: the portions are the payslip's s.20A working-day segments.
	const slip = sprToCitizen(20_000);
	const [base, employee, employer] = scheme(slip, 'CPF');
	assert.equal(base, 8000);
	assert.equal(employee + employer, 2960);
	// The employee share rounds once on the month: 20% × 8,000 = 1,600, employer 1,360.
	assert.deepEqual([employee, employer], [1600, 1360]);
});

test('Singapore — a conversion month selects the wage band on the month’s total wages, not on each portion (CPF Act First Schedule; Owner rule SG-CPF34)', () => {
	// First Schedule rates are keyed on the employee's total wages for the calendar month. $1,200
	// > $750, so Table 1's full 37% applies to the month whichever status each day carries (both
	// statuses here have the same Table 1 rates): 444, employee 20% = 240, employer 204. Pricing
	// each portion (545.45 and 654.55) on its own band puts both in the $500–$750 graduated row.
	assert.deepEqual(scheme(sprToCitizen(1200), 'CPF'), [1200, 240, 204]);
});

test('Singapore — every settings version cites the live Part-Time Employees Regulations anchors (SSO as at 28 Sep 2026; SG-SRC02)', () => {
	// Read in the browser on 2026-09-28: SL/EmA1968-RG8?ProvIds=pr5- is Page Not Found (regs.4–5
	// are anchored pr4-XX-pr4- / pr5-XX-pr5-); ?ProvIds=pr5-XX-pr5- opens reg.5 "Overtime pay" and
	// ?ProvIds=pr2- opens reg.2 "Definitions". 45 raw rows (voided snapshots included) carry the
	// part-time citations, 5 of them in the operative timeline.
	const raw: { sources: { urls: string[] } }[] = JSON.parse(
		readFileSync(
			new URL('../seed/jurisdiction/SG/jurisdiction_settings.json', import.meta.url),
			'utf8'
		)
	);
	const citing = raw.filter((row) => row.sources.urls.some((url) => url.includes('-RG8')));
	assert.equal(citing.length, 45);
	assert.equal(
		settingsVersions('SG').filter((row) =>
			row.sources.urls.some((url: string) => url.includes('-RG8'))
		).length,
		5
	);
	for (const row of citing) {
		const rg8 = row.sources.urls.filter((url) => url.includes('-RG8'));
		assert.deepEqual(rg8, [
			'https://sso.agc.gov.sg/SL/EmA1968-RG8?ProvIds=pr5-XX-pr5-',
			'https://sso.agc.gov.sg/SL/EmA1968-RG8?ProvIds=pr2-'
		]);
	}
});

test('Singapore — the SDL authority names SWDA from SSO s.2 and the NOA FAQ as SSG’s; the levy does not move on the 1 July 2026 Agency change (SG-S3)', () => {
	// SSO SDLA1979 s.2 (current version as at 28 Sep 2026): "“Agency” means the Skills and Workforce
	// Development Agency …" [Act 17 of 2026 wef 01/07/2026]. The NOA FAQ PDF's header is
	// "SkillsFuture Singapore Agency" (Oct 2023). 25 raw SDL rows (voided snapshots included) cite it.
	const raw: { code: string; authority: string }[] = JSON.parse(
		readFileSync(
			new URL('../seed/jurisdiction/SG/statutory_contributions.json', import.meta.url),
			'utf8'
		)
	);
	const citing = raw.filter(
		(row) => row.code === 'SDL' && row.authority.includes('sdl-noa2023faqs.pdf')
	);
	assert.equal(citing.length, 25);
	for (const row of citing) {
		assert.ok(!row.authority.includes('SWDA SDL FAQ'));
		assert.ok(
			row.authority.includes(
				'SkillsFuture Singapore FAQs on the October 2023 SDL Notice of Assessment, F.7'
			)
		);
		assert.ok(row.authority.includes('https://sso.agc.gov.sg/Act/SDLA1979?ProvIds=pr2-,pr3-'));
		assert.ok(row.authority.includes('Skills and Workforce Development Agency (SWDA)'));
	}
	// s.3(1): 0.25% of the month's wages. S Pass 2,345.67 × 0.25% = 5.864175 → 5.86 in June and in
	// July 2026 alike; the Agency renaming moves no figure.
	for (const period of ['2026-06', '2026-07']) {
		const book = assessStatutory({
			code: 'SG',
			period,
			people: [{ key: 'SG-SP', wage: 2345.67, age: 30, citizenship: 'FOREIGNER' }]
		});
		expectStatutory(book, 'SG-SP', 'SDL', 0, 5.86);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Reconstructed 2026-09-29 from `docs/inventory/singapore.md`'s Round 6 closure table: the four
// goldens that lived here were lost with an uncommitted working tree, and these are rebuilt from
// the register's own source, facts and expected results rather than from the original text.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Singapore — the Fourth Schedule hour is read unrounded; only the overtime amount rounds to the cent (SG-EA46-R01)', () => {
	// EA 1968 s.35(b): Part 4 reaches a non-workman on "a salary not exceeding $2,600 a month" —
	// $2,600 is inside, $2,600.01 outside (ceiling-inclusive). Fourth Schedule: hourly basic rate
	// = 12 × monthly basic ÷ (52 × 44), with no rounding stated; s.38(4) pays 1.5× that rate.
	// 12 × 2,600 ÷ 2,288 = 13.636363…; 2 h × 1.5 × 13.636363… = 40.909… → 40.91. MOM's
	// hours-of-work page quotes "$13.60" and 2 × 1.5 × $13.60 = $40.80 — an illustration the
	// Schedule does not state. Owner rule 2026-09-28: law states the formula, silent on rounding;
	// default the formula unrounded and the payable amount half-up to the cent; lawful because it
	// pays at least the Schedule's rate (a rate truncated to $13.60 would underpay s.38(4)).
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'SG-2600', wage: 2600, citizenship: 'CITIZEN' },
				{ key: 'SG-2600.01', wage: 2600.01, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			// The shift's hour is taken 13:00–14:00, so 09:00–20:00 is ten worked hours: the normal
			// day plus two.
			for (const key of ['SG-2600', 'SG-2600.01'])
				punchWithBreak(world, key, '2026-01-05', '09:00', '20:00');
		}
	);
	assert.deepEqual(workLines(slips.get('SG-2600')!), [['2026-01-05', 'OT-1.5X', 2, 40.91]]);
	assert.equal(slips.get('SG-2600')!.gross, 2640.91);
	// One cent above the ceiling takes Part 4 away: no overtime line, the month is the basic wage.
	assert.deepEqual(workLines(slips.get('SG-2600.01')!), []);
	assert.equal(slips.get('SG-2600.01')!.gross, 2600.01);
});

test('Singapore — the self-help funds read NRIC races in the ICA RaceCode spellings (SG-SHG04(a))', () => {
	// ICA-sourced RaceCode list (Singpass Myinfo data catalogue → Myinfo API code tables, sheet
	// RaceCode, source ICA/MOM). SINDA Rules 1992 r.2 reaches "every person of Indian descent and
	// includes Bangladeshis, Bengalis, Gujaratis, Parsees, Sikhs, Sinhalese, Telegus, Pakistanis,
	// Sri Lankans, Goanese, Malayalees, Punjabis, Sindhis and Tamils" — ICA spells the Rules'
	// "Telegus" TELUGU and "Goanese" GOAN. CDAC Rules 1992 r.2 reaches the Chinese community (a
	// SINO INDIAN's first-named descent is Chinese); ECF Rules 1995 r.2 the Eurasian one (the
	// ANGLO codes' first name). NEPALESE is not a code of a people r.2 names.
	// Schedule bands at $3,000: CDAC "more than $2,000 but not more than $3,500" $1; ECF "more than
	// $2,500 but not more than $4,000" $9; SINDA "more than $2,500 but not more than $4,500" $7.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'SG-TELUGU', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'TELUGU' },
			{ key: 'SG-GOAN', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'GOAN' },
			{ key: 'SG-MALABARI', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'MALABARI' },
			{
				key: 'SG-OTHER-INDIAN',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'OTHER INDIAN'
			},
			{
				key: 'SG-CEYLONESE-PR',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2020-01-15',
				race: 'CEYLONESE'
			},
			{
				key: 'SG-SINO-INDIAN',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2020-01-15',
				race: 'SINO INDIAN'
			},
			{
				key: 'SG-SINO-INDIAN-DUAL',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2020-01-15',
				race: 'SINO INDIAN',
				registrations: {
					SINDA: {
						kind: 'REGISTERED',
						elections: {
							shg_dual_sinda: true,
							shg_secondary_race: 'TAMIL',
							shg_instruction_reference: 'SINDA-DUAL'
						}
					}
				}
			},
			{ key: 'SG-ANGLO-INDIAN', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'ANGLO INDIAN' },
			{
				key: 'SG-ANGLO-CHINESE',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'ANGLO CHINESE'
			},
			{
				key: 'SG-OTHER-EURASIAN',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'OTHER EURASIAN'
			},
			{ key: 'SG-NEPALESE', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'NEPALESE' }
		]
	});
	// The Rules' Indian community, in the code table's spelling.
	for (const key of ['SG-TELUGU', 'SG-GOAN', 'SG-MALABARI', 'SG-OTHER-INDIAN', 'SG-CEYLONESE-PR'])
		expectStatutory(book, key, 'SINDA', 7, 0);
	// A mixed-descent code goes to the fund of its first-named descent; a dual election adds SINDA.
	expectStatutory(book, 'SG-SINO-INDIAN', 'CDAC', 1, 0);
	expectStatutorySkipped(book, 'SG-SINO-INDIAN', 'SINDA');
	expectStatutory(book, 'SG-SINO-INDIAN-DUAL', 'CDAC', 1, 0);
	expectStatutory(book, 'SG-SINO-INDIAN-DUAL', 'SINDA', 7, 0);
	for (const key of ['SG-ANGLO-INDIAN', 'SG-ANGLO-CHINESE', 'SG-OTHER-EURASIAN'])
		expectStatutory(book, key, 'ECF', 9, 0);
	// A code of wider or unstated origin reaches no fund at all.
	for (const code of ['SINDA', 'CDAC', 'ECF']) expectStatutorySkipped(book, 'SG-NEPALESE', code);
});

test('Singapore — an unrecorded race refuses under SINDA for a foreign pass holder too (SG-SHG04(a))', () => {
	// The round-4 seed dropped `citizenship != FOREIGNER` from the blank-race term of SINDA only;
	// the other funds still exclude a foreigner before the race test, so a foreign pass holder with
	// no race recorded used to be skipped in silence. SINDA Rules r.2 names no residency condition,
	// so the wage deduction turns on the race alone and an unstated race cannot be priced: the run
	// refuses rather than charging nothing.
	assert.throws(
		() =>
			assessStatutory({
				code: 'SG',
				period: '2026-01',
				people: [
					{
						key: 'SG-NO-RACE',
						wage: 3000,
						age: 30,
						citizenship: 'FOREIGNER',
						pass_type: 'S_PASS',
						race: ''
					}
				]
			}),
		/Record the employee’s NRIC race before calculating SINDA/
	);
});

test('Singapore — shared parental leave selects the 6- or 10-unit pool on the certified dates (SG-SPL-M01)', () => {
	// CDCA 2001 s.2 "April 2025 Scheme child", s.12DA(2) and Second Schedule para 5: M = 6 only
	// where the birth AND the estimated delivery date fall before 1 Apr 2026 (or the adoption
	// eligibility date is 1 Apr 2025–31 Mar 2026); otherwise M = 10. para 6: the default split is
	// half each, so a parent with no recorded sharing takes M ÷ 2 weeks. Owner rule 2026-09-28: law
	// silent on an unrecorded date — an unrecorded EDD reads as the birth date and an unrecorded
	// eligibility date as the event date, which is the pre-fix behaviour. The bands are read through
	// the engine's own `grantedDays` over the seeded row, on the event the payroll builds.
	const rule = leaveCatalogue('SG').find((row) => row.code === 'SHARED_PARENTAL_LEAVE')!;
	// The certified dates are facts of the named child (`children`), which `personContext` reads by
	// the entry's `event.child_index`; the entry event carries the kind and the event date.
	const granted = (
		kind: 'BIRTH' | 'ADOPTION',
		date: string,
		child: { estimated_delivery_date?: string; adoption_eligibility_date?: string }
	) =>
		grantedDays(
			{ bands: rule.entitlement.bands } as Pick<LeaveEntitlement, 'bands'>,
			personContext({
				employee: null,
				employment: { service_start: '' },
				terms: null,
				company: null,
				asOf: date,
				children: [{ child_birthdate: date, ...child }],
				event: { kind, date, child_index: 1 }
			} as never)
		);
	// Both the birth and the EDD before 1 April 2026: the 6-week pool, half of it = 21 days.
	assert.equal(granted('BIRTH', '2026-03-20', { estimated_delivery_date: '2026-03-25' }), 21);
	// A pre-April birth with an April EDD is an April 2025 Scheme child: the 10-week pool = 35.
	assert.equal(granted('BIRTH', '2026-03-20', { estimated_delivery_date: '2026-04-05' }), 35);
	// An unrecorded EDD reads as the birth date, so the same birth without one stays at 21.
	assert.equal(granted('BIRTH', '2026-03-20', {}), 21);
	// An adoption with its eligibility date inside 1 Apr 2025-31 Mar 2026 takes the 6-week pool.
	assert.equal(granted('ADOPTION', '2026-03-20', { adoption_eligibility_date: '2026-03-01' }), 21);
	// An eligibility date on or after 1 April 2026 takes the 10-week pool = 35.
	assert.equal(granted('ADOPTION', '2026-04-10', { adoption_eligibility_date: '2026-04-01' }), 35);
});

test('Singapore — childcare leave cites the in-force SSO s.12B (SG-SRC02)', () => {
	// The row cited a Wayback copy of CDCA s.12B; the in-force SSO text is word-for-word the quoted
	// text, so every sealed version cites `?ProvIds=pr12B-` instead (read 2026-09-28, current as at
	// that date, last amended by Act 19 of 2021).
	for (const row of leaveCatalogue('SG').filter(
		(candidate) => candidate.code === 'CHILDCARE_LEAVE'
	))
		assert.match(
			row.authority ?? '',
			/sso\.agc\.gov\.sg\/Act\/CDCSA2001\?ProvIds=pr12B-/,
			`version ${row.settings_id} cites the in-force s.12B`
		);
});

test('Singapore — at a sub-monthly cadence the employee CPF share is taken in proportion or at the last payment, and the month is trued up (CPF Act s.7(7); SG-CPF35)', () => {
	// CPF Act 1953 s.7(7) (SSO, current version as at 29 Sep 2026): where wages are paid at
	// intervals of less than a month, the employer "(a) may deduct … at the time of each payment in
	// the month the appropriate proportion of such sum as would be recoverable … if paid at the same
	// rate throughout the month; and (b) must make such adjustment as may be necessary on the
	// occasion of the last payment in that month". A Chinese citizen aged 30 on $3,000 a month, CPF
	// Table 1 (every sealed version; $3,000 is under both the $7,400 and the $8,000 OW ceiling):
	// total round(37% × 3,000) = 1,110; employee floor(20% × 3,000) = 600; employer 510.
	// SPLIT: the first half takes ½ of the month's share at the half's own rate — its wage (the
	// month's working days split at the 15th) × 2, Table 1 rounding: total to the dollar, employee
	// cents dropped — and the last half trues the month up to 600/510. LAST: nothing until the last payment, which takes the
	// month whole (s.7(7)(a) is permissive). A weekly company is always LAST.
	// FIRST (the company default) takes the whole month's 600 from the first half, above
	// s.7(7)(a)'s proportion; that is a shared-engine defect reported under SG-CPF35, not asserted here.
	const person = {
		key: 'SG-SUBMONTHLY',
		wage: 3000,
		age: 30,
		citizenship: 'CITIZEN',
		race: 'CHINESE'
	} as const;
	const cpf = (
		slips: readonly {
			statutory: readonly {
				scheme_code: string;
				employee_amount: number;
				employer_amount: number;
			}[];
		}[]
	) =>
		slips
			.flatMap((slip) => slip.statutory)
			.filter((row) => row.scheme_code === 'CPF')
			.reduce(
				([employee, employer], row) => [
					employee + row.employee_amount,
					employer + row.employer_amount
				],
				[0, 0]
			);
	const settle = (world: PayrollWorld, period: string) => {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const built = buildPayrollRun(prepared);
		world.payroll_runs.push({
			id: period,
			company_id: COMPANY_ID,
			period,
			company_charges: built.company_charges
		});
		for (const slip of built.payslip_payroll_run)
			world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
		return cpf(built.payslip_payroll_run);
	};
	const halfGross = (world: PayrollWorld) => world.payslips.at(-1)!.gross as number;
	/** ½ of the month's CPF at the half's own rate: s.7(7)(a) "the appropriate proportion". */
	const proportion = (gross: number) => {
		const total = Math.round(0.37 * gross * 2);
		const employee = Math.floor(0.2 * gross * 2);
		return [employee / 2, (total - employee) / 2];
	};
	for (const month of ['2025-12', '2026-01', '2026-04', '2026-07', '2027-01'])
		for (const cutoff of ['SPLIT', 'LAST'] as const) {
			const world = createStatutoryWorld({
				code: 'SG',
				period: `${month}-1`,
				payFrequency: 'SEMI_MONTHLY',
				people: [{ ...person, pay_frequency: 'SEMI_MONTHLY' as const }]
			});
			world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
			const first = settle(world, `${month}-1`);
			const want = cutoff === 'SPLIT' ? proportion(halfGross(world)) : [0, 0];
			assert.deepEqual(first, want, `${month} ${cutoff} first half`);
			const last = settle(world, `${month}-2`);
			assert.deepEqual(
				[first[0] + last[0], first[1] + last[1]],
				[600, 510],
				`${month} ${cutoff} the month trued up`
			);
		}
	// Weekly: $3,000 over the month's weeks, nothing charged before the last week, 600/510 in it.
	const weeks = weeklyInstalments('2026-03');
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-03-1',
		payFrequency: 'WEEKLY',
		people: [{ ...person, wage: 3000 / weeks.length, pay_frequency: 'WEEKLY' as const }]
	});
	const charged = weeks.map((week) => settle(world, `2026-03-${week.sequence}`));
	assert.ok(charged.slice(0, -1).every(([employee, employer]) => employee === 0 && employer === 0));
	assert.deepEqual(charged.at(-1), [600, 510]);
});

test('Singapore — a missing SDL election refuses naming the employee and the election, never pricing SDL at zero (F22)', () => {
	// The bank's OPS SG employments carry no SDL elections. SDL Act s.5 levies 0.25% of every
	// employee's monthly total wages (Second Schedule, $2 minimum, $11.25 maximum): the service-scope
	// election decides whether the month is levied at all, so its absence refuses rather than prices.
	const run = (drop: boolean) =>
		assessStatutory(
			{
				code: 'SG',
				period: '2026-06',
				people: [{ key: 'SG-NOSDL', wage: 3000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' }]
			},
			(world) => {
				if (!drop) return;
				const sdl = new Set(
					world.statutory_contributions.filter((row) => row.code === 'SDL').map((row) => row.id)
				);
				for (const fact of world.employment_statutory_facts)
					if (sdl.has(fact.statutory_contribution_id))
						delete (fact.status as { elections: Record<string, unknown> }).elections
							.sdl_service_scope;
			}
		);
	// Golden: 0.25% × 3,000 = 7.50, inside the $800–$4,500 band.
	expectStatutory(run(false), 'SG-NOSDL', 'SDL', 0, 7.5);
	assert.throws(
		() => run(true),
		/SG-NOSDL: SDL: Singapore SDL service scope for the calendar month is required before calculation\./
	);
});
