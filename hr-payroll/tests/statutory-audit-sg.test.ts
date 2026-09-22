/**
 * Singapore — an independent audit of the SG lineage against the law, not against the engine.
 *
 * Every expected figure below is derived by hand from the primary instrument named beside it and
 * written out in the comment: the CPF Board contribution rate tables (Tables 1–5) from 1 January
 * 2025, 1 January 2026 and 1 January 2027; the CPF Board SDL and self-help-group pages; the
 * Employment Act 1968 (Singapore Statutes Online: s.2, ss.35–38, s.88, s.89, Fourth Schedule).
 * None was taken from an engine run.
 *
 *   CPF tables: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
 *               (…/CPF_contribution_rates_from_1_Jan_2025.pdf, …/jan2027cpfcontributionrates.pdf)
 *   Rounding (every table's "Steps to compute"): the TOTAL rounds to the nearest dollar (50 cents
 *   and above up), the EMPLOYEE share rounds DOWN to the dollar, the employer pays the difference.
 *   SDL:  https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy
 *   SHG:  https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups
 *   EA:   https://sso.agc.gov.sg/Act/EmA1968
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import {
	assessStatutory,
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	leaveCatalogue,
	settingsVersions,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

const SG_2026 = 'e363af9a-a034-59f7-84bf-5052f57ecae5';

/** "Nil" in the tables: a total wage of $50 or less carries no CPF — a zero row or no row. */
const expectNil = (book: ReturnType<typeof assessStatutory>, key: string) => {
	const row = book.get(key)?.get('CPF');
	if (row == null) return;
	assert.deepEqual(
		{ employee: row.employee, employer: row.employer },
		{ employee: 0, employer: 0 }
	);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CPF — Table 1 (citizens, SPR third year on), 1 January 2026, at every wage band boundary.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG audit — CPF 2026 Table 1: the $50 / $500 / $750 wage bands and the half-dollar rounding', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'TW-50', wage: 50, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-51', wage: 51, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-500', wage: 500, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-600', wage: 600, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-1050', wage: 1050, age: 30, citizenship: 'CITIZEN' },
			{ key: 'TW-600-66', wage: 600, age: 66, citizenship: 'CITIZEN' },
			{ key: 'TW-700-71', wage: 700, age: 71, citizenship: 'CITIZEN' },
			{ key: 'TW-3000-66', wage: 3000, age: 66, citizenship: 'CITIZEN' },
			{ key: 'TW-3000-71', wage: 3000, age: 71, citizenship: 'CITIZEN' },
			{ key: 'TW-9000-62', wage: 9000, age: 62, citizenship: 'CITIZEN' }
		]
	});
	// "$50 or less: Nil".
	expectNil(book, 'TW-50');
	// "> $50 to $500: 17% (TW)", employee Nil. 17% × 51 = 8.67 → total $9; employee 0; employer 9.
	expectStatutory(book, 'TW-51', 'CPF', 0, 9);
	// 17% × 500 = 85.00 → 85; employee 0; employer 85 (the top of the band, not the graduated one).
	expectStatutory(book, 'TW-500', 'CPF', 0, 85);
	// "> $500 to $750: 17% (TW) + 0.6 (TW − 500)", employee 0.6 (TW − 500).
	// 17% × 600 = 102 + 0.6 × 100 = 60 → total 162; employee 60; employer 102.
	expectStatutory(book, 'TW-600', 'CPF', 60, 102);
	// "> $750: 37% (OW)", employee 20%. 37% × 1,050 = 388.50 → 389 (50 cents rounds up);
	// employee 20% × 1,050 = 210; employer 389 − 210 = 179.
	expectStatutory(book, 'TW-1050', 'CPF', 210, 179);
	// Above 65 to 70, graduated: 9% (TW) + 0.225 (TW − 500). 9% × 600 = 54 + 22.50 = 76.50 → 77;
	// employee 0.225 × 100 = 22.50 → 22 (rounded down); employer 77 − 22 = 55.
	expectStatutory(book, 'TW-600-66', 'CPF', 22, 55);
	// Above 70, graduated: 7.5% (TW) + 0.15 (TW − 500). 7.5% × 700 = 52.50 + 30 = 82.50 → 83;
	// employee 0.15 × 200 = 30; employer 53.
	expectStatutory(book, 'TW-700-71', 'CPF', 30, 53);
	// Above 65 to 70, full: 16.5% total, employee 7.5%. 16.5% × 3,000 = 495; 225; employer 270.
	expectStatutory(book, 'TW-3000-66', 'CPF', 225, 270);
	// Above 70, full: 12.5% total, employee 5%. 375; 150; employer 225.
	expectStatutory(book, 'TW-3000-71', 'CPF', 150, 225);
	// Above 60 to 65 at $9,000: OW capped at $8,000. "25% (OW) Max. of $2,000", employee "12.5%
	// Max. of $1,000". Total 2,000; employee 1,000; employer 1,000.
	expectStatutory(book, 'TW-9000-62', 'CPF', 1000, 1000);
});

test('SG audit — CPF age bands at 60, 65 and 70 move the month after the birthday', () => {
	// Tables 1 (2026): "rates for the new age group apply from the first day of the month after the
	// month of the employee's birthday". Each person turns 60 / 65 / 70 on 31 January 2026.
	const people = [
		{ key: 'TURNS-60', wage: 3000, birth_date: '1966-01-31', citizenship: 'CITIZEN' as const },
		{ key: 'TURNS-65', wage: 3000, birth_date: '1961-01-31', citizenship: 'CITIZEN' as const },
		{ key: 'TURNS-70', wage: 3000, birth_date: '1956-01-31', citizenship: 'CITIZEN' as const }
	];
	const january = assessStatutory({ code: 'SG', period: '2026-01', people });
	// Birthday month, still the lower band.
	// Above 55–60: 34% × 3,000 = 1,020; employee 18% = 540; employer 480.
	expectStatutory(january, 'TURNS-60', 'CPF', 540, 480);
	// Above 60–65: 25% = 750; employee 12.5% = 375; employer 375.
	expectStatutory(january, 'TURNS-65', 'CPF', 375, 375);
	// Above 65–70: 16.5% = 495; employee 7.5% = 225; employer 270.
	expectStatutory(january, 'TURNS-70', 'CPF', 225, 270);
	const february = assessStatutory({ code: 'SG', period: '2026-02', people });
	// The month after: one band up each.
	expectStatutory(february, 'TURNS-60', 'CPF', 375, 375);
	expectStatutory(february, 'TURNS-65', 'CPF', 225, 270);
	// Above 70: 12.5% = 375; employee 5% = 150; employer 225.
	expectStatutory(february, 'TURNS-70', 'CPF', 150, 225);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CPF — SPR graduated tables (2, 3) and the approved full-employer tables (4, 5).
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG audit — SPR Tables 2–5 by age, election and the year-three turn', () => {
	const FG = {
		CPF: {
			kind: 'REGISTERED' as const,
			elections: { spr_full_employer_rate: true, spr_approval_reference: 'CPF-FG' }
		}
	};
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			// residency_since 2025-06-15 → 7 calendar months at January 2026: year one.
			{
				key: 'Y1-GG-62',
				wage: 3000,
				age: 62,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-06-15'
			},
			{
				key: 'Y1-GG-700',
				wage: 700,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-06-15'
			},
			{
				key: 'Y1-FG-30',
				wage: 3000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-06-15',
				registrations: FG
			},
			// residency_since 2024-12-15 → 13 calendar months: year two.
			{
				key: 'Y2-GG-57',
				wage: 3000,
				age: 57,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2024-12-15'
			},
			{
				key: 'Y2-FG-57',
				wage: 3000,
				age: 57,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2024-12-15',
				registrations: FG
			}
		]
	});
	// Table 2 (1st year G/G), above 60–65: 8.5% total, employee 5%. 255; 150; employer 105.
	expectStatutory(book, 'Y1-GG-62', 'CPF', 150, 105);
	// Table 2, 55 & below, > $500 to $750: 4% (TW) + 0.15 (TW − 500). 28 + 30 = 58; employee 30;
	// employer 28.
	expectStatutory(book, 'Y1-GG-700', 'CPF', 30, 28);
	// Table 4 (1st year F/G), 55 & below: 22% total, employee 5%. 660; 150; employer 510.
	expectStatutory(book, 'Y1-FG-30', 'CPF', 150, 510);
	// Table 3 (2nd year G/G), above 55–60: 18.5% total, employee 12.5%. 555; 375; employer 180.
	expectStatutory(book, 'Y2-GG-57', 'CPF', 375, 180);
	// Table 5 (2nd year F/G) from 1 Jan 2026, above 55–60: 28.5% total, employee 12.5%.
	// 855; 375; employer 480.
	expectStatutory(book, 'Y2-FG-57', 'CPF', 375, 480);

	// Year three begins the month after the second anniversary (CPF Board). SPR from 15 January
	// 2024: January 2026 is the anniversary month — still Table 3 (24% / 15%: 720; 450; 270) —
	// and February 2026 is Table 1 (37% / 20%: 1,110; 600; 510).
	const turning = [
		{
			key: 'Y2-TO-Y3',
			wage: 3000,
			age: 30,
			citizenship: 'PERMANENT_RESIDENT' as const,
			residency_since: '2024-01-15'
		}
	];
	expectStatutory(
		assessStatutory({ code: 'SG', period: '2026-01', people: turning }),
		'Y2-TO-Y3',
		'CPF',
		450,
		270
	);
	expectStatutory(
		assessStatutory({ code: 'SG', period: '2026-02', people: turning }),
		'Y2-TO-Y3',
		'CPF',
		600,
		510
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CPF — the other two versions: December 2025 (2025 tables, $7,400 OW ceiling) and 2027.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG audit — December 2025 (2025 tables) and January 2027 (2027 tables) at their own figures', () => {
	const dec = assessStatutory({
		code: 'SG',
		period: '2025-12',
		people: [
			{ key: 'D-700-62', wage: 700, age: 62, citizenship: 'CITIZEN' },
			{ key: 'D-9000-57', wage: 9000, age: 57, citizenship: 'CITIZEN' }
		]
	});
	// 2025 Table 1, above 60–65, graduated: 12% (TW) + 0.345 (TW − 500). 84 + 69 = 153;
	// employee 0.345 × 200 = 69; employer 84.
	expectStatutory(dec, 'D-700-62', 'CPF', 69, 84);
	// 2025 Table 1, above 55–60 at the $7,400 ceiling: "32.5% (OW) Max. of $2,405", employee
	// "17% Max. of $1,258". Employer 2,405 − 1,258 = 1,147.
	expectStatutory(dec, 'D-9000-57', 'CPF', 1258, 1147);

	const jan27 = assessStatutory({
		code: 'SG',
		period: '2027-01',
		people: [
			{ key: 'J-600-57', wage: 600, age: 57, citizenship: 'CITIZEN' },
			{ key: 'J-10000-57', wage: 10_000, age: 57, citizenship: 'CITIZEN' },
			{
				key: 'J-Y2-FG-57',
				wage: 3000,
				age: 57,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2025-12-15',
				registrations: {
					CPF: {
						kind: 'REGISTERED',
						elections: { spr_full_employer_rate: true, spr_approval_reference: 'CPF-FG' }
					}
				}
			}
		]
	});
	// 2027 Table 1, above 55–60, graduated: 16.5% (TW) + 0.57 (TW − 500). 99 + 57 = 156;
	// employee 57; employer 99.
	expectStatutory(jan27, 'J-600-57', 'CPF', 57, 99);
	// 2027 Table 1, above 55–60: "35.5% (OW) Max. of $2,840", employee "19% Max. of $1,520".
	// Employer 1,320.
	expectStatutory(jan27, 'J-10000-57', 'CPF', 1520, 1320);
	// 2027 Table 5 (2nd year F/G), above 55–60: 29% total, employee 12.5%. 870; 375; employer 495.
	// (SPR from 15 Dec 2025 → 13 calendar months at January 2027: year two.)
	expectStatutory(jan27, 'J-Y2-FG-57', 'CPF', 375, 495);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SDL and the self-help groups at their boundaries.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG audit — SDL: the $2 minimum under $800, 0.25% between, the $11.25 maximum over $4,500', () => {
	// CPF Board SDL page: "0.25% of the monthly total wages. The minimum payable is $2 for an
	// employee earning less than $800 a month and the maximum is $11.25 for an employee earning
	// more than $4,500 a month" — for all employees, foreign ones included. Its own worked
	// examples: $609.50 → $2; $2,000 → $5; $4,500 → $11.25; $4,502.03 → $11.25.
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'S-609.50-F', wage: 609.5, age: 30, citizenship: 'FOREIGNER' },
			{ key: 'S-799.99', wage: 799.99, age: 30, citizenship: 'CITIZEN' },
			{ key: 'S-800', wage: 800, age: 30, citizenship: 'CITIZEN' },
			{ key: 'S-2000', wage: 2000, age: 30, citizenship: 'CITIZEN' },
			{ key: 'S-4500', wage: 4500, age: 30, citizenship: 'CITIZEN' },
			{ key: 'S-4502.03', wage: 4502.03, age: 30, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'S-609.50-F', 'SDL', 0, 2);
	// 0.25% × 799.99 = 2.00 (1.999975) — and the $2 minimum applies anyway.
	expectStatutory(book, 'S-799.99', 'SDL', 0, 2);
	// 0.25% × 800 = 2.00.
	expectStatutory(book, 'S-800', 'SDL', 0, 2);
	expectStatutory(book, 'S-2000', 'SDL', 0, 5);
	expectStatutory(book, 'S-4500', 'SDL', 0, 11.25);
	expectStatutory(book, 'S-4502.03', 'SDL', 0, 11.25);
});

test('SG audit — self-help group bands at their edges, and who each fund reaches', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{ key: 'CDAC-2000', wage: 2000, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{ key: 'CDAC-2000.01', wage: 2000.01, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{ key: 'CDAC-7500.01', wage: 7500.01, age: 30, citizenship: 'CITIZEN', race: 'CHINESE' },
			{ key: 'CDAC-FOREIGN', wage: 3000, age: 30, citizenship: 'FOREIGNER', race: 'CHINESE' },
			{
				key: 'ECF-PR-1000',
				wage: 1000,
				age: 30,
				citizenship: 'PERMANENT_RESIDENT',
				residency_since: '2020-01-01',
				race: 'EURASIAN'
			},
			{ key: 'ECF-10000.01', wage: 10_000.01, age: 30, citizenship: 'CITIZEN', race: 'EURASIAN' },
			{ key: 'ECF-FOREIGN', wage: 3000, age: 30, citizenship: 'FOREIGNER', race: 'EURASIAN' },
			{
				key: 'MBMF-FOREIGN-4000',
				wage: 4000,
				age: 30,
				citizenship: 'FOREIGNER',
				religion: 'ISLAM',
				pass_type: 'WORK_PERMIT'
			},
			{ key: 'MBMF-4000.01', wage: 4000.01, age: 30, citizenship: 'CITIZEN', religion: 'ISLAM' },
			{ key: 'MBMF-10000.01', wage: 10_000.01, age: 30, citizenship: 'CITIZEN', religion: 'ISLAM' },
			{ key: 'SINDA-15000', wage: 15_000, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' },
			{ key: 'SINDA-15000.01', wage: 15_000.01, age: 30, citizenship: 'CITIZEN', race: 'INDIAN' },
			{
				key: 'SINDA-SPASS',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'INDIAN',
				pass_type: 'S_PASS'
			},
			{
				key: 'CDAC-NOTIFIED',
				wage: 3000,
				age: 30,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				registrations: {
					CDAC: {
						kind: 'REGISTERED',
						elections: { shg_monthly_amount: 5, shg_instruction_reference: 'CDAC-LETTER' }
					}
				}
			}
		]
	});
	// CDAC: "$2,000 or less $0.50; > $2,000 to $3,500 $1; … > $7,500 $3". SC and SPR only.
	expectStatutory(book, 'CDAC-2000', 'CDAC', 0.5, 0);
	expectStatutory(book, 'CDAC-2000.01', 'CDAC', 1, 0);
	expectStatutory(book, 'CDAC-7500.01', 'CDAC', 3, 0);
	expectStatutorySkipped(book, 'CDAC-FOREIGN', 'CDAC');
	// ECF: "$1,000 or less $2 … > $10,000 $20". SC and SPR only.
	expectStatutory(book, 'ECF-PR-1000', 'ECF', 2, 0);
	expectStatutory(book, 'ECF-10000.01', 'ECF', 20, 0);
	expectStatutorySkipped(book, 'ECF-FOREIGN', 'ECF');
	// MBMF: SC, SPR "or Foreign employees". "> $3,000 to $4,000 $15; > $4,000 to $6,000 $19.50;
	// > $10,000 $26".
	expectStatutory(book, 'MBMF-FOREIGN-4000', 'MBMF', 15, 0);
	expectStatutory(book, 'MBMF-4000.01', 'MBMF', 19.5, 0);
	expectStatutory(book, 'MBMF-10000.01', 'MBMF', 26, 0);
	// SINDA: SC, SPR "or Employment Pass holders". "> $10,000 to $15,000 $18; > $15,000 $30".
	expectStatutory(book, 'SINDA-15000', 'SINDA', 18, 0);
	expectStatutory(book, 'SINDA-15000.01', 'SINDA', 30, 0);
	expectStatutorySkipped(book, 'SINDA-SPASS', 'SINDA');
	// "Employees who … wish to contribute a different amount can contact the respective SHGs": a
	// notified $5 replaces the $1 band amount at $3,000.
	expectStatutory(book, 'CDAC-NOTIFIED', 'CDAC', 5, 0);
});

test('SG audit — a bonus is inside the SDL and SHG total wages and is an Additional Wage for CPF', () => {
	// January 2026, OW 3,000 + a 2,000 bonus. Total wages 5,000.
	// SDL: over $4,500 → $11.25. CDAC: "> $3,500 to $5,000" → $1.50.
	// CPF: AW ceiling estimate 102,000 − 3,000 × 12 = 66,000 ≥ 2,000, so the whole bonus is subject.
	// 37% × 5,000 = 1,850; employee 20% = 1,000; employer 850.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'B', wage: 3000, citizenship: 'CITIZEN', race: 'CHINESE' }]
		},
		(world) => {
			const bonus = world.adhoc_catalogue!.find(
				(row) => row.code === 'bonus' && row.settings_id === SG_2026
			)!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-00000000a0d1',
				employment_id: world.employments[0]!.id,
				catalogue_id: bonus.id,
				amount: 2000,
				event_date: '2026-01-15',
				pay_period: null,
				payslip_id: null,
				reason: 'bonus',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('B')!;
	assert.deepEqual(scheme(slip, 'SDL'), [5000, 0, 11.25]);
	assert.deepEqual(scheme(slip, 'CDAC'), [5000, 1.5, 0]);
	assert.deepEqual(scheme(slip, 'CPF'), [5000, 1000, 850]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Employment Act Part 4 and s.88.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const scheme = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((charge) => charge.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		approval_id: null
	});
};
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

test('SG audit — s.35(b): Part 4 reaches a non-workman at $2,600 a month and not at $2,600.01', () => {
	// s.35(b): Part 4 applies to a non-workman "who receives a salary not exceeding $2,600 a month".
	// A 09:00–20:00 Monday on the 09:00–18:00 (one-hour break) shift: two hours past the shift.
	// Inside Part 4 they are s.38(4) overtime; outside it, no line at all. (The rate is asserted
	// separately below; here only coverage.)
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'NW-2600', wage: 2600, citizenship: 'CITIZEN' },
				{ key: 'NW-2600.01', wage: 2600.01, citizenship: 'CITIZEN' },
				{
					key: 'WM-4500',
					wage: 4500,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR'
				},
				{
					key: 'WM-4500.01',
					wage: 4500.01,
					citizenship: 'CITIZEN',
					statutory_work_category: 'MANUAL_LABOUR'
				}
			]
		},
		(world) => {
			for (const key of ['NW-2600', 'NW-2600.01', 'WM-4500', 'WM-4500.01'])
				punch(world, key, '2026-01-05', '09:00', '20:00');
		}
	);
	const hours = (key: string) => workLines(slips.get(key)!).map((line) => [line[1], line[2]]);
	assert.deepEqual(hours('NW-2600'), [['OT-1.5X', 2]]);
	assert.deepEqual(hours('NW-2600.01'), []);
	// s.35(a): a workman at not more than $4,500.
	assert.deepEqual(hours('WM-4500'), [['OT-1.5X', 2]]);
	assert.deepEqual(hours('WM-4500.01'), []);
});

test('SG audit — s.35: a daily-rated employee is measured on the month the daily rate makes', () => {
	// s.35 measures "a salary not exceeding $2,600 a month". A daily rate is a month through EA
	// Third Schedule item 2 turned around: monthly = daily × 52 × days a week ÷ 12.
	// $150 a day on a five-day week: 150 × 260 ÷ 12 = 3,250 a month > 2,600 → outside Part 4.
	// $100 a day: 100 × 260 ÷ 12 = 2,166.67 ≤ 2,600 → inside Part 4.
	// Before this audit the band compared the raw daily figure (150 ≤ 2,600) and put every daily-
	// or hourly-rated employee inside Part 4 whatever they earned.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'DAILY-150', wage: 150, pay_frequency: 'DAILY', citizenship: 'CITIZEN' },
				{ key: 'DAILY-100', wage: 100, pay_frequency: 'DAILY', citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			punch(world, 'DAILY-150', '2026-01-05', '09:00', '20:00');
			punch(world, 'DAILY-100', '2026-01-05', '09:00', '20:00');
		}
	);
	const labels = (key: string) => workLines(slips.get(key)!).map((line) => [line[1], line[2]]);
	assert.deepEqual(labels('DAILY-150'), []);
	assert.deepEqual(labels('DAILY-100'), [['OT-1.5X', 2]]);
});

test('SG audit — s.88: a public holiday worked earns the extra day for a manager, not for an employee outside the Act', () => {
	// s.88 (Part 10) reaches every employee under the Act, managers included since 1 April 2019;
	// s.88(4): "an extra day's salary at the basic rate of pay for one day's work". Third Schedule:
	// 12 × 5,200 ÷ (52 × 5) = 240.00. An employee outside the Employment Act (NON_EA: seafarers,
	// domestic workers, civil servants — EA s.2 "employee") has no s.88 day at all.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'MGR', wage: 5200, citizenship: 'CITIZEN', work_classification: 'MANAGERIAL' },
				{ key: 'OUTSIDE-EA', wage: 5200, citizenship: 'CITIZEN', work_classification: 'NON_EA' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-01', "New Year's Day"));
			punch(world, 'MGR', '2026-01-01', '09:00', '18:00');
			punch(world, 'OUTSIDE-EA', '2026-01-01', '09:00', '18:00');
		}
	);
	assert.deepEqual(workLines(slips.get('MGR')!), [['2026-01-01', 'OT-1.0X', 8, 240]]);
	assert.deepEqual(workLines(slips.get('OUTSIDE-EA')!), []);
});

test('SG audit — s.88(1)(c): a holiday on a non-working day is paid at the gross rate, allowances included', () => {
	// s.88(1)(c): where a public holiday falls on a day the employee is not required to work, the
	// employer pays "for that holiday at his or her gross rate of pay" (or gives a day off). EA s.2
	// "gross rate of pay" includes allowances (other than travelling, food or housing). A $2,288
	// basic with a $260 shift allowance, five-day week: 12 × (2,288 + 260) ÷ (52 × 5) = 117.60.
	// (At the basic rate alone it would be 105.60 — the figure the band paid before this audit.)
	const OFF = 'c0000000-0000-4000-8000-0000000000d4';
	const SHIFT = 'a3000000-0000-4000-8000-000000000001';
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'PH-OFF', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.shift_definitions.push({
				...world.shift_definitions[1]!,
				id: OFF,
				code: 'OFF',
				name: 'Off',
				variant: { kind: 'OFF' }
			});
			world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: OFF };
			world.jurisdiction_holidays.push(holiday('2026-01-10', 'A Saturday holiday'));
			world.allowance_catalogue.push({
				id: SHIFT,
				settings_id: SG_2026,
				code: 'SHIFT',
				name: 'Shift allowance',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['CPF.ORDINARY', 'SDL'],
				approval_id: null
			});
			assignAllowance(world, {
				employment_id: world.employments[0]!.id,
				catalogue_id: SHIFT,
				amount: 260,
				effective_from: '2015-01-01'
			});
			const employment = world.employments[0]!;
			world.work_days.push({
				id: 'wd-PH-OFF-2026-01-10',
				employment_id: employment.id,
				work_date: '2026-01-10',
				shift_definition_id: null,
				worked_intervals: [],
				requested_by: null,
				approval_id: null
			});
		}
	);
	assert.deepEqual(workLines(slips.get('PH-OFF')!), [
		['2026-01-10', 'PH-NON-WORKING-DAY', 0, 117.6]
	]);
});

test('SG audit — Fourth Schedule: the hourly basic rate is 12 × monthly ÷ (52 × 44), whatever the contract’s week [LAW; engine differs]', () => {
	// EA s.38(6) with the Fourth Schedule, items 1 and 2 (monthly-rated workman and non-workman):
	// hourly basic rate = 12 × monthly basic rate of pay ÷ (52 × 44). The schedule has no variant
	// for a contract of fewer than 44 hours, and MOM caps a non-workman's rate at "the salary level
	// of $2,600, or an hourly rate of $13.60" (hours-of-work-overtime-and-rest-days) — a figure a
	// 52 × 40 divisor would exceed (12 × 2,600 ÷ 2,080 = 15.00).
	// $2,288 on the fixture's 40-hour, five-day week: 12 × 2,288 ÷ 2,288 = 12.00 an hour; two
	// hours past the shift at s.38(4)'s 1.5×: 2 × 12.00 × 1.5 = 36.00.
	// The engine builds the hour on the contract's 40 hours (13.20 → 39.60): more than the statute
	// requires, so never an underpayment, but not the Fourth Schedule's figure. Left failing on
	// purpose (goldens hold the law); see the audit report for the engine change.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'FORTY', wage: 2288, citizenship: 'CITIZEN' }]
		},
		(world) => punch(world, 'FORTY', '2026-01-05', '09:00', '20:00')
	);
	assert.deepEqual(workLines(slips.get('FORTY')!), [['2026-01-05', 'OT-1.5X', 2, 36]]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Leave — EA s.89 sick-leave ladder at its four- and five-month rungs, s.88A annual leave.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const entitlementOf = (code: string, hire: string, asOf: string, version = SG_2026) => {
	const row = leaveCatalogue('SG').find(
		(candidate) => candidate.settings_id === version && candidate.code === code
	)!;
	assert.ok(row, `SG has no ${code} row on ${version}`);
	const personOn = (date: string) =>
		personContext({
			employee: {
				gender: null,
				date_of_birth: '1986-01-01',
				marital_status: null,
				solo_parent: null,
				disabled: null
			},
			employment: { service_start: hire },
			terms: {
				residency_status: 'CITIZEN',
				work_classification: 'EA_COVERED',
				employment_type: 'PERMANENT',
				statutory_work_category: null
			},
			children: [],
			event: null,
			facts: [],
			asOf: date
		});
	return computedEntitlement({
		rule: row.entitlement,
		window: leaveWindowOf(asOf, row.entitlement),
		asOf,
		hireDate: hire,
		exitDate: null,
		servedOn: () => true,
		eligibleOn: () => true,
		personOn
	}).entitlement;
};

test('SG audit — s.89(2): outpatient and hospitalisation leave at four and five months of service', () => {
	// s.89(2)(b): at least 4 but less than 5 months — 8 outpatient days, 30 hospitalisation.
	// s.89(2)(c): at least 5 but less than 6 months — 11 and 45. Hired 1 January 2026.
	assert.equal(entitlementOf('SICK_LEAVE', '2026-01-01', '2026-05-01'), 8);
	assert.equal(entitlementOf('HOSPITALIZATION_LEAVE', '2026-01-01', '2026-05-01'), 30);
	assert.equal(entitlementOf('SICK_LEAVE', '2026-01-01', '2026-06-01'), 11);
	assert.equal(entitlementOf('HOSPITALIZATION_LEAVE', '2026-01-01', '2026-06-01'), 45);
	// s.89(1): six months and above — 14 and 60.
	assert.equal(entitlementOf('SICK_LEAVE', '2026-01-01', '2026-07-01'), 14);
	assert.equal(entitlementOf('HOSPITALIZATION_LEAVE', '2026-01-01', '2026-07-01'), 60);
});

test('SG audit — s.88A(1): the annual-leave ladder reaches 14 days in the eighth year and stops', () => {
	// 7 days for the first 12 months, one more for every further 12 months, to a maximum of 14:
	// the eighth year of service (84+ completed months) is 14, and the fifteenth still 14.
	// Hired 1 January so the calendar-year window is whole (no s.88A(2) proration).
	assert.equal(entitlementOf('ANNUAL_LEAVE', '2018-01-01', '2026-07-01'), 14); // 102 months
	assert.equal(entitlementOf('ANNUAL_LEAVE', '2011-01-01', '2026-07-01'), 14); // 186 months
	// 83 completed months (seventh year): 13.
	assert.equal(entitlementOf('ANNUAL_LEAVE', '2019-08-01', '2026-07-01'), 13);
});

test('SG audit — every sealed SG version carries the same Part 4 coverage predicate on monthly basic', () => {
	// Not a figure — a transcription check: s.35 stood unchanged across every version, so each
	// version's Part 4 bands must read the month (the rate turned into a month by its pay frequency), never the raw daily or hourly figure.
	for (const version of settingsVersions('SG')) {
		for (const band of version.work_rules.bands) {
			assert.equal(
				band.when.includes('person.terms.basic_salary <='),
				false,
				`${version.name} ${band.label}`
			);
		}
	}
});
