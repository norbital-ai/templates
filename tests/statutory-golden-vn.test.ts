/**
 * Vietnam: expected payslips against the law itself.
 *
 * Law on Social Insurance 41/2024/QH15 arts.31, 33 and 34; Law on Health Insurance as amended by
 * Law 51/2024/QH15; Law on Employment 74/2025/QH15 (38/2013/QH13 to 31 December 2025); Trade Union
 * Law 50/2024/QH15 art.29; PIT Law 04/2007/QH12 art.22 with Resolution 954/2020/UBTVQH14, PIT Law
 * 109/2025/QH15 art.9 and art.29(2) with Resolution 110/2025/UBTVQH15; Circular 111/2013/TT-BTC
 * art.7 and art.25(1)(b); Decree 74/2024/NĐ-CP and Decree 293/2025/NĐ-CP (regional minimum wages);
 * Decree 161/2026/NĐ-CP (the 2,530,000 reference level from 1 July 2026).
 *
 * Every figure here is the statute's own monthly figure. Personal income tax is withheld month by
 * month on the MONTHLY progressive table (Circular 111/2013 art.25(1)(b)) over the month's income
 * net of the month's own SI, HI and UI (art.7) and the monthly family deduction — so a January run,
 * a run with year-to-date on file and a standalone July run all land on the same table figure. The
 * year-end finalisation (Gap #38) is a separate reckoning the seed does not carry.
 *
 * Every contribution and withholding is a whole đồng: the currency has no minor unit, VSS bills and
 * the tax return (Circular 80/2021/TT-BTC) carry whole đồng, so each rule rounds with `round_unit`.
 * The engine's own money — the prorated base, an overtime line, gross and net — is still kept to
 * two decimals (`cents()` in `rounding.ts` is currency-blind); the goldens below pin that too.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COMPANY,
	assessStatutory,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	settingsVersions,
	COMPANY_ID,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const VN_PEOPLE = [
	{ key: 'VN-20M', wage: 20_000_000, age: 25, citizenship: 'CITIZEN' },
	{ key: 'VN-46.8M', wage: 46_800_000, citizenship: 'CITIZEN' },
	{ key: 'VN-60M', wage: 60_000_000, age: 55, citizenship: 'CITIZEN' },
	{ key: 'VN-FOREIGN', wage: 20_000_000, citizenship: 'FOREIGNER' }
];

test('Vietnam — SI, HI, UI and the union fee under the 1 January 2026 version', () => {
	// Region I: `companies.region` picks the minimum wage the UI cap is a multiple of.
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Social insurance: employee 8%, employer 17.5% (3% sickness-maternity + 0.5% occupational +
	// 14% retirement and survivorship), capped at 20 × the reference level 2,340,000 = 46,800,000.
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-46.8M', 'SI', 3_744_000, 8_190_000); // exactly on the ceiling
	expectStatutory(book, 'VN-60M', 'SI', 3_744_000, 8_190_000); // capped

	// Health insurance: 4.5% total, employee 1.5% / employer 3%, on the same ceiling.
	expectStatutory(book, 'VN-20M', 'HI', 300_000, 600_000);
	expectStatutory(book, 'VN-46.8M', 'HI', 702_000, 1_404_000);
	expectStatutory(book, 'VN-60M', 'HI', 702_000, 1_404_000);

	// Unemployment insurance: 1% each side, capped at 20 × the REGIONAL minimum wage — Region I
	// from 1 January 2026 is 5,310,000, so the cap is 106,200,000 and never binds here.
	expectStatutory(book, 'VN-20M', 'UI', 200_000, 200_000);
	expectStatutory(book, 'VN-46.8M', 'UI', 468_000, 468_000);
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);
	// Law 74/2025 covers Vietnamese citizens: a foreign employee is outside the scheme entirely.
	expectStatutorySkipped(book, 'VN-FOREIGN', 'UI');
	// Social and health insurance reach a foreign employee like anyone else (Law 41/2024 art.2(2)).
	expectStatutory(book, 'VN-FOREIGN', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-FOREIGN', 'HI', 300_000, 600_000);

	// Union budget contribution: 2% of the social-insurance salary fund, employer only, same cap.
	// Law on Trade Unions 2024 art.29(1)(b): the employer's 2% is on the establishment's SI salary
	// fund — one company line, not a charge on any payslip: 20,000,000 + 46,800,000 + 46,800,000
	// (capped) + 20,000,000 = 133,600,000 × 2% = 2,672,000.
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 2_672_000);
	assert.equal(book.get('VN-20M')!.get('UNION_FEE'), undefined);
});

test('Vietnam — the contribution floor is the reference level (Law 41/2024 art.31(1)(đ))', () => {
	// A wage under 2,340,000 contributes on 2,340,000 for SI, HI, the union fee and, since Law
	// 41/2024 art.31(1)(đ) makes the UI base the SI base, UI too. 2,340,000 × 8% = 187,200, × 17.5%
	// = 409,500, × 1.5% = 35,100, × 3% = 70,200, × 2% = 46,800, × 1% = 23,400.
	const january = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [{ key: 'VN-2M', wage: 2_000_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(january, 'VN-2M', 'SI', 187_200, 409_500);
	expectStatutory(january, 'VN-2M', 'HI', 35_100, 70_200);
	expectStatutory(january, COMPANY, 'UNION_FEE', 0, 46_800);
	expectStatutory(january, 'VN-2M', 'UI', 23_400, 23_400);
	expectStatutory(january, 'VN-2M', 'PIT', 0, 0);
	// From 1 July 2026 the floor is 2,530,000: × 8% = 202,400, × 17.5% = 442,750, × 1.5% = 37,950,
	// × 3% = 75,900, × 2% = 50,600.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'VN-2M', wage: 2_000_000, citizenship: 'CITIZEN' }]
	});
	expectStatutory(july, 'VN-2M', 'SI', 202_400, 442_750);
	expectStatutory(july, 'VN-2M', 'HI', 37_950, 75_900);
	expectStatutory(july, COMPANY, 'UNION_FEE', 0, 50_600);
});

test('Vietnam — the unemployment ceiling follows the company region (Decree 293/2025)', () => {
	// Twenty times the regional minimum wage: Region II 4,730,000 → 94,600,000, Region III
	// 4,140,000 → 82,800,000, Region IV 3,700,000 → 74,000,000. A 120,000,000 wage is over all of them.
	const person = { key: 'VN-120M', wage: 120_000_000, citizenship: 'CITIZEN' };
	for (const [region, cap] of [
		['II', 946_000],
		['III', 828_000],
		['IV', 740_000]
	] as const) {
		const book = assessStatutory({ code: 'VN', period: '2026-01', region, people: [person] });
		expectStatutory(book, 'VN-120M', 'UI', cap, cap);
		// The SI ceiling does not read the region.
		expectStatutory(book, 'VN-120M', 'SI', 3_744_000, 8_190_000);
	}
	// The wages orders exclude a vocational trainee (Labour Code art.61); everyone else is covered.
	for (const version of settingsVersions('VN'))
		assert.equal(version.work_rules.wages.applies_when, 'employment.type != "INTERN"');
});

test('Vietnam — monthly PIT withholding on the 1 January 2026 scale', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-01', people: VN_PEOPLE, region: 'I' });

	// Circular 111/2013 art.25(1)(b) withholds on the monthly table; the scale is the five-bracket
	// table of Law 109/2025 art.9 (≤10M at 5%, >10–30M at 10%, >30–60M at 20%, >60–100M at 30%,
	// >100M at 35%), applied from the 2026 tax period by art.29(2), over the month's income net of
	// the month's own SI, HI and UI and the 15,500,000 monthly personal deduction (Resolution
	// 110/2025).
	//
	// VN-20M: 20,000,000 − 2,100,000 (1,600,000 + 300,000 + 200,000) − 15,500,000 = 2,400,000 at
	// 5% = 120,000.
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
	// VN-46.8M: 46,800,000 − 4,914,000 − 15,500,000 = 26,386,000: 500,000 + 16,386,000 × 10% =
	// 2,138,600.
	expectStatutory(book, 'VN-46.8M', 'PIT', 2_138_600, 0);
	// VN-60M: 60,000,000 − 5,046,000 − 15,500,000 = 39,454,000: 500,000 + 2,000,000 + 9,454,000 ×
	// 20% = 4,390,800.
	expectStatutory(book, 'VN-60M', 'PIT', 4_390_800, 0);
	// A resident foreign employee runs the same scale minus the UI they are outside:
	// 20,000,000 − 1,900,000 − 15,500,000 = 2,600,000 at 5% = 130,000.
	expectStatutory(book, 'VN-FOREIGN', 'PIT', 130_000, 0);
});

test('Vietnam — a dependant deducts 6,200,000 a month, and a non-resident is withheld at 20%', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'VN-46.8M-D1', wage: 46_800_000, citizenship: 'CITIZEN', children: 1 },
			{ key: 'VN-20M-D1', wage: 20_000_000, citizenship: 'CITIZEN', children: 1 },
			// Law 04/2007 art.26 (carried by Law 109/2025): a non-resident's salary is taxed at a
			// flat 20% with no deductions; the registration's rate override carries the election.
			{
				key: 'VN-NR-20M',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				registrations: { PIT: { kind: 'REGISTERED', rate_override: 20 } }
			}
		]
	});
	// Resolution 110/2025: 6,200,000 a month per dependant. 46,800,000 − 4,914,000 − 15,500,000 −
	// 6,200,000 = 20,186,000: 500,000 + 10,186,000 × 10% = 1,518,600.
	expectStatutory(book, 'VN-46.8M-D1', 'PIT', 1_518_600, 0);
	// 20,000,000 − 2,100,000 − 21,700,000 is negative: nothing is withheld.
	expectStatutory(book, 'VN-20M-D1', 'PIT', 0, 0);
	expectStatutory(book, 'VN-NR-20M', 'PIT', 4_000_000, 0);
});

test('Vietnam — February relieves February’s insurance, not the year’s (Circular 111/2013 art.7)', () => {
	// The monthly table is applied to the month's income net of the insurance deducted from that
	// month's pay. With January on file the relief must still be one month's 2,100,000, and the
	// withholding the same 120,000 as January's.
	const book = assessStatutory(
		{ code: 'VN', period: '2026-02', region: 'I', people: [VN_PEOPLE[0]!] },
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'VN-20M');
			assert.ok(employment);
			world.payroll_runs.push({ id: 'prior-2026-01', company_id: COMPANY_ID, period: '2026-01' });
			world.payslips.push({
				id: 'payslip-2026-01',
				payroll_run_id: 'prior-2026-01',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2026-01-28T00:00:00.000Z',
				currency: 'VND',
				base: [],
				adjustments: [],
				statutory: [
					['PIT', 120_000, 0],
					['SI', 1_600_000, 3_500_000],
					['HI', 300_000, 600_000],
					['UI', 200_000, 200_000],
					['UNION_FEE', 0, 400_000]
				].map(([scheme_code, employee_amount, employer_amount]) => ({
					scheme_code,
					employee_amount,
					employer_amount,
					base_amount: 20_000_000,
					rule_when: null,
					authority: null
				}))
			});
		}
	);
	expectStatutory(book, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
});

test('Vietnam — the 1 July 2026 version raises the ceiling and exempts the overtime wage', () => {
	const book = assessStatutory({ code: 'VN', period: '2026-07', people: VN_PEOPLE, region: 'I' });

	// Decree 161/2026 raises the reference level to 2,530,000, so the SI/HI ceiling becomes 20 ×
	// 2,530,000 = 50,600,000: 8% = 4,048,000 and 17.5% = 8,855,000; 1.5% = 759,000 and 3% = 1,518,000.
	expectStatutory(book, 'VN-60M', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-60M', 'HI', 759_000, 1_518_000);
	// The fund: 20,000,000 + 46,800,000 + 50,600,000 (capped) + 20,000,000 = 137,400,000 × 2%.
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 2_748_000);
	// The regional minimum did not move on 1 July, so UI is unchanged.
	expectStatutory(book, 'VN-60M', 'UI', 600_000, 600_000);

	// The same monthly table, over the month's own insurance. A standalone July run has no
	// year-to-date and needs none: VN-20M and VN-46.8M are unchanged at 120,000 and 2,138,600; VN-60M
	// relieves the higher capped insurance, 60,000,000 − 5,407,000 (4,048,000 + 759,000 + 600,000) −
	// 15,500,000 = 39,093,000: 2,500,000 + 9,093,000 × 20% = 4,318,600.
	expectStatutory(book, 'VN-20M', 'PIT', 120_000, 0);
	expectStatutory(book, 'VN-46.8M', 'PIT', 2_138_600, 0);
	expectStatutory(book, 'VN-60M', 'PIT', 4_318_600, 0);
});

test('Vietnam — the December 2025 version, and the regional cap that moves off it', () => {
	// The first sealed version: Decree 74/2024 regional minimum wages, the 2,340,000 reference
	// level, and the Resolution 954/2020 family deductions of 11,000,000 / 4,400,000 a month.
	// A wage of 120,000,000 is the only way to see the unemployment ceiling, which is the one
	// figure the 1 January 2026 version actually moves.
	const people = [
		{ key: 'VN-20M', wage: 20_000_000, citizenship: 'CITIZEN' },
		{ key: 'VN-120M', wage: 120_000_000, citizenship: 'CITIZEN' },
		{ key: 'VN-200M', wage: 200_000_000, citizenship: 'CITIZEN' }
	];
	// December closes the tax year: the last payslip charges the annual scale on the year's income
	// less what the year withheld (Law 04/2007 art.22 with Circular 111/2013 art.25), so the
	// eleven earlier months stand on file at the monthly figures the table gives.
	const december = assessStatutory(
		{ code: 'VN', period: '2025-12', people, region: 'I' },
		(world) => {
			for (const [index, key] of ['VN-20M', 'VN-120M', 'VN-200M'].entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				const wage = people[index]!.wage;
				const monthly = {
					'VN-20M': [2_100_000, 440_000],
					'VN-120M': [5_438_000, 26_396_700],
					'VN-200M': [5_438_000, 54_396_700]
				}[key]!;
				for (let month = 1; month <= 11; month += 1) {
					const period = `2025-${String(month).padStart(2, '0')}`;
					if (index === 0)
						world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
					world.payslips.push({
						id: `payslip-${key}-${period}`,
						payroll_run_id: `prior-${period}`,
						employment_id: employment.id,
						status: 'PAID',
						paid_at: `${period}-28T00:00:00.000Z`,
						currency: 'VND',
						base: [],
						adjustments: [],
						statutory: [
							// The year's compulsory insurance is read from the slips, not multiplied from
							// December's, so the earlier months carry their own (all under SI here).
							{
								scheme_code: 'SI',
								employee_amount: monthly[0],
								employer_amount: 0,
								base_amount: wage,
								rule_when: null,
								authority: null
							},
							{
								scheme_code: 'PIT',
								employee_amount: monthly[1],
								employer_amount: 0,
								base_amount: wage,
								rule_when: null,
								authority: null
							}
						]
					});
				}
			}
		}
	);
	const january = assessStatutory({ code: 'VN', period: '2026-01', people, region: 'I' });

	// Social and health insurance did not move: 8% / 17.5% and 1.5% / 3% on the same twenty times
	// the 2,340,000 reference level = 46,800,000 ceiling.
	expectStatutory(december, 'VN-20M', 'SI', 1_600_000, 3_500_000);
	expectStatutory(december, 'VN-120M', 'SI', 3_744_000, 8_190_000);
	expectStatutory(december, 'VN-120M', 'HI', 702_000, 1_404_000);
	// The fund over the three people: 20,000,000 + 46,800,000 + 46,800,000 (both capped) = 113,600,000 × 2%.
	expectStatutory(december, COMPANY, 'UNION_FEE', 0, 2_272_000);

	// Unemployment insurance is 1% each side, capped at twenty times the REGIONAL minimum wage.
	// Region I is 4,960,000 to 31 December 2025 (Decree 74/2024) → cap 99,200,000 → 992,000, and
	// 5,310,000 from 1 January 2026 (Decree 293/2025, +7.2%) → cap 106,200,000 → 1,062,000.
	expectStatutory(december, 'VN-120M', 'UI', 992_000, 992_000);
	expectStatutory(january, 'VN-120M', 'UI', 1_062_000, 1_062_000);

	// PIT on the seven-rung table of Law 04/2007 art.22 (≤5M 5%, >5–10M 10%, >10–18M 15%,
	// >18–32M 20%, >32–52M 25%, >52–80M 30%, >80M 35%) with the 11,000,000 monthly deduction.
	// The year: VN-20M earned 240,000,000, less 25,200,000 insurance and 132,000,000 deductions =
	// 82,800,000 on the annual scale (≤60M 5%, then 10%): 3,000,000 + 2,280,000 = 5,280,000; the
	// eleven months withheld 4,840,000, so December charges 440,000 — the monthly figure, because
	// a steady year annualises to itself.
	expectStatutory(december, 'VN-20M', 'PIT', 440_000, 0);
	// VN-120M: 1,440,000,000 − 65,256,000 − 132,000,000 = 1,242,744,000: 217,800,000 + 282,744,000
	// × 35% = 316,760,400, less 11 × 26,396,700 = 26,396,700.
	expectStatutory(december, 'VN-120M', 'PIT', 26_396_700, 0);
	// VN-200M: 2,400,000,000 − 65,256,000 − 132,000,000 = 2,202,744,000: 217,800,000 +
	// 1,242,744,000 × 35% = 652,760,400, less 11 × 54,396,700 = 54,396,700.
	expectStatutory(december, 'VN-200M', 'PIT', 54_396_700, 0);
});

test('Vietnam — the đồng above the ceiling is charged on the ceiling', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'VN-50600000.01', wage: 50_600_000.01 }]
	});
	// 20 × 2,530,000 = 50,600,000: SI 8% / 17.5%, HI 1.5% / 3%, union 2% employer, all on the cap.
	expectStatutory(book, 'VN-50600000.01', 'SI', 4_048_000, 8_855_000);
	expectStatutory(book, 'VN-50600000.01', 'HI', 759_000, 1_518_000);
	expectStatutory(book, COMPANY, 'UNION_FEE', 0, 1_012_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Labour Code 2019: the pay side. The world's shift is 09:00–18:00 with a sixty-minute break —
// eight normal hours, Monday to Friday, Saturday and Sunday rest days — and the version's ordinary
// divisor is `period.working_days` (Decree 145/2020 art.54(1)(a): the month's salary over the
// month's normal working days, then over eight hours). A public holiday on a scheduled working
// day is a working day — a paid one (art.112) — so it stays in the count. Wages are chosen so the
// hourly rate is a round 100,000: 22 working days × 8 h × 100,000 = 17,600,000 for January 2026.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const VN_2026_JAN = 'b7a3c3cd-1a69-5671-8dc4-2dfb30d30ce8';
const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
/** A punch from `start` to `end` on `date`, in Hồ Chí Minh City's +07:00 frame. */
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+07:00`, end: `${date}T${end}:00+07:00` }],
		approval_id: null
	});
};
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
/** The same five days, on a Monday, a Saturday, a holiday and a Monday into the night. */
const week = (
	world: PayrollWorld,
	key: string,
	month: string,
	days: readonly [string, string, string, string]
) => {
	const [monday, saturday, holidayDate, nightMonday] = days;
	world.jurisdiction_holidays.push(holiday(`${month}-${holidayDate}`, 'Holiday'));
	punch(world, key, `${month}-${monday}`, '09:00', '21:00'); // 11 worked: 3 h beyond the normal day
	punch(world, key, `${month}-${saturday}`, '09:00', '18:00'); // rest day: 9 h clock, 8.5 h worked
	punch(world, key, `${month}-${holidayDate}`, '09:00', '18:00'); // holiday: the normal day
	punch(world, key, `${month}-${nightMonday}`, '09:00', '24:00'); // 14 worked: 6 h beyond, 2 of them at night
};

test('Vietnam — art.98 prices 150% / 200% / 300%, the night premium and the art.109 break', () => {
	const { slips, warnings, companyCharges } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'VN-17.6M', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			week(world, 'VN-17.6M', '2026-01', ['05', '10', '01', '12']);
			punch(world, 'VN-17.6M', '2026-01-17', '09:00', '17:00'); // rest day: 8 h clock, no break
		}
	);
	const slip = slips.get('VN-17.6M')!;
	assert.deepEqual(workLines(slip), [
		// Art.98(1)(c): every hour worked on a holiday at 300% of the hourly wage, on top of the
		// holiday's own paid day inside the month; the shift's sixty-minute break leaves eight.
		['2026-01-01', 'OT-3.0X', 8, 2_400_000],
		// Art.98(1)(a): the three hours beyond the normal day at 150%.
		['2026-01-05', 'OT-1.5X', 3, 450_000],
		// Art.98(1)(b): a rest day at 200% from its first hour. Art.109(1) owes a thirty-minute break
		// on a day of six hours or more and, outside continuous-shift work, it is not working time —
		// so a nine-hour clock span is eight and a half paid hours, in the seed's two rows (the normal
		// day, then the half hour beyond it, both at 200%).
		['2026-01-10', 'OT-2.0X', 8, 1_600_000],
		['2026-01-10', 'OT-2.0X', 0.5, 100_000],
		// Six hours beyond the normal day at 150%, and art.98(2)–(3) for the two of them after 22:00:
		// 30% of the hourly wage for night work plus 20% of the day-time unit price — which, the
		// night overtime following four daytime overtime hours, is the 150% hour (Decree 145
		// art.57(1)(b)): 60,000 an hour.
		['2026-01-12', 'NIGHT_PREMIUM', 2, 120_000],
		// Art.107(2)(b): four hours of overtime a day; Decree 253/2026 art.26(3) taxes the part
		// beyond, so the fifth and sixth hours are their own line at the same 150%.
		['2026-01-12', 'OT-1.5X', 4, 600_000],
		['2026-01-12', 'OT-1.5X', 2, 300_000],
		// An eight-hour rest-day clock with no break: the art.109(1) half hour is not working time,
		// so the day priced from its start is seven and a half hours at 200%, never the raw clock.
		['2026-01-17', 'OT-2.0X', 7.5, 1_500_000]
	]);
	// Art.107(2)(b): overtime may not exceed 50% of the normal day — four hours. The sixth is paid
	// at the same rate and reported.
	assert.deepEqual(
		warnings.map((warning) => warning.split('.')[0]),
		['DAILY_OVERTIME_LIMIT_EXCEEDED: VN-17']
	);
	assert.equal(slip.gross, 17_600_000 + 6_950_000 + 120_000);
	// Social, health and unemployment insurance and the union fee read the salary alone (Labour Code
	// art.168, Circular 06/2021 art.30: the contractual wage, never overtime).
	assert.deepEqual(charge(slip, 'SI'), [17_600_000, 1_408_000, 3_080_000]);
	assert.deepEqual(charge(slip, 'HI'), [17_600_000, 264_000, 528_000]);
	assert.deepEqual(charge(slip, 'UI'), [17_600_000, 176_000, 176_000]);
	assert.deepEqual(companyCharges.get('UNION_FEE'), [17_600_000, 352_000]);
	// Law 109/2025 art.4(8), in force for salary income "từ kỳ tính thuế năm 2026" (art.29(2)):
	// overtime and night pay are exempt whole — except, under Decree 253/2026 art.26(3), the part
	// beyond the art.107 limits: the two hours past the four-hour day, 300,000, on their own line
	// (`INCENTIVE`). Base 17,600,000 + 300,000 = 17,900,000; tax (17,900,000 − 1,848,000 −
	// 15,500,000) × 5% = 27,600. (Law 04/2007 art.4(9) exempted only the part above the ordinary
	// rate; that is the December 2025 version.)
	assert.deepEqual(charge(slip, 'PIT'), [17_900_000, 27_600, 0]);
	assert.equal(slip.total_deductions, 1_875_600); // 1,408,000 + 264,000 + 176,000 + 27,600
	assert.equal(slip.net, 22_794_400); // 24,670,000 − 1,875,600
	// The union fund is the establishment’s line, not the payslip’s employer cost.
	assert.equal(slip.employer_cost, 3_080_000 + 528_000 + 176_000);
});

test('Vietnam — on the July 2026 version too, the overtime and night wage are outside PIT (Law 109/2025 art.4(8))', () => {
	// July 2026 has 23 weekdays, the holiday on Wednesday the 1st among them: 23 × 8 × 100,000.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-07',
			region: 'I',
			people: [{ key: 'VN-18.4M', wage: 18_400_000, citizenship: 'CITIZEN' }]
		},
		(world) => week(world, 'VN-18.4M', '2026-07', ['06', '11', '01', '13'])
	);
	const slip = slips.get('VN-18.4M')!;
	assert.deepEqual(
		workLines(slip).map((row) => [row[1], row[2], row[3]]),
		[
			['OT-3.0X', 8, 2_400_000],
			['OT-1.5X', 3, 450_000],
			['OT-2.0X', 8, 1_600_000],
			['OT-2.0X', 0.5, 100_000],
			['NIGHT_PREMIUM', 2, 120_000],
			['OT-1.5X', 4, 600_000],
			['OT-1.5X', 2, 300_000]
		]
	);
	// The third version's PIT base is BASE + the overrun beyond art.107 − ABSENCE − NO_PAY_LEAVE:
	// 18,400,000 + 300,000 − 1,932,000 (1,472,000 + 276,000 + 184,000) − 15,500,000 = 1,268,000
	// × 5% = 63,400; the four lawful hours stay outside.
	assert.deepEqual(charge(slip, 'SI'), [18_400_000, 1_472_000, 3_220_000]);
	assert.deepEqual(charge(slip, 'PIT'), [18_700_000, 63_400, 0]);
	assert.equal(slip.gross, 18_400_000 + 5_450_000 + 120_000);
});

test('Vietnam — a part month prorates on working days, an allowance with it, and unpaid leave leaves the allowance whole', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	const LUNCH = 'c1c1c1c1-0000-4000-8000-00000000000b';
	// January 2026 with no holiday planted: 22 working days on the Monday-to-Friday pattern.
	const { slips, entries } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{ key: 'VN-WHOLE', wage: 22_000_000, citizenship: 'CITIZEN' },
				{ key: 'VN-NPL', wage: 22_000_000, citizenship: 'CITIZEN' },
				{ key: 'VN-JOINER', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
				{ key: 'VN-LEAVER', wage: 22_000_000, citizenship: 'CITIZEN', exit_date: '2026-01-15' },
				// A base that does not divide: 20,000,000 × 10 ÷ 22 = 9,090,909.09.
				{ key: 'VN-JOINER-20M', wage: 20_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' }
			]
		},
		(world) => {
			world.allowance_catalogue.push({
				id: LUNCH,
				settings_id: VN_2026_JAN,
				code: 'LUNCH',
				name: 'Tiền ăn giữa ca',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				// Circular 06/2021 art.30(3): a mid-shift meal is outside the insurance salary.
				fixed: false,
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				approval_id: null
			});
			// Circular 111/2013 art.2(2)(g.5): the meal is taxable above 730,000 a month. The bank's
			// PIT row taxes every allowance a version carries; a version that adds a meal row states
			// the cap beside it, as this world does.
			for (const scheme of world.statutory_contributions)
				if (scheme.code === 'PIT' && scheme.settings_id === VN_2026_JAN)
					scheme.assessed_on = `${scheme.assessed_on} - (code('LUNCH') > 730000.0 ? 730000.0 : code('LUNCH'))`;
			for (const [index, employment] of world.employments.entries())
				world.allowances.push({
					id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: LUNCH,
					amount: 2_200_000,
					effective_from: '2025-01-01',
					effective_to: null,
					reason: '',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			world.leave_catalogue.push({
				id: NPL,
				settings_id: VN_2026_JAN,
				code: 'BEREAVEMENT_LEAVE_UNPAID',
				name: 'Nghỉ không hưởng lương',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: true,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			const employment = world.employments.find((row) => row.employee_number === 'VN-NPL')!;
			const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: NPL,
				leave_code: 'BEREAVEMENT_LEAVE_UNPAID',
				reference: 'NPL-1',
				from_date: '2026-01-14',
				to_date: '2026-01-14',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-14',
				reason: 'art.115(2)',
				allocations: [],
				charges: [
					{
						date: '2026-01-14',
						days: 1,
						catalogue_id: NPL,
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
	const facts = (key: string) => {
		const entry = entries.get(key)![0]!;
		const line = slips.get(key)!.adjustments.find((row) => row.family === 'ALLOWANCE')!;
		assert.equal(line.amount, entry.values.amount, `${key}: the line is the entry`);
		return [
			entry.values.days,
			entry.values.denominator,
			entry.values.unpaid_days,
			entry.values.amount
		];
	};
	const prorated = (key: string) =>
		slips.get(key)!.proration.map((row) => [row.days, row.denominator, row.prorated_amount]);
	// `work_rules.proration` is WORKING_DAYS: a joiner on Monday the 19th takes 10 of January's 22,
	// a leaver on the 15th the 11 before it, on the salary and the allowance alike — one entry each.
	assert.deepEqual(prorated('VN-JOINER'), [[10, 22, 10_000_000]]);
	assert.deepEqual(facts('VN-JOINER'), [10, 22, 0, 1_000_000]);
	assert.deepEqual(prorated('VN-LEAVER'), [[11, 22, 11_000_000]]);
	assert.deepEqual(facts('VN-LEAVER'), [11, 22, 0, 1_100_000]);
	assert.deepEqual(facts('VN-WHOLE'), [22, 22, 0, 2_200_000]);
	// Art.115(2): the day is unpaid — one working day, 22,000,000 ÷ 22 = 1,000,000, off the salary.
	// `payroll.allowance_npl_prorates` is false, so the allowance stays whole.
	assert.deepEqual(facts('VN-NPL'), [22, 22, 0, 2_200_000]);
	const absence = slips.get('VN-NPL')!.adjustments.find((row) => row.bucket === 'ABSENCE')!;
	assert.deepEqual([absence.quantity, absence.amount], [1, 1_000_000]);
	// The mid-shift meal is `fixed: false`, so it is outside the insurance salary (Circular 06/2021
	// art.30(3)) — `terms.fixed_allowances` does not carry it. Law 41/2024 art.33(5): one unpaid
	// working day is under the fourteen the cliff names, so the month insures on the whole
	// contractual salary, 22,000,000 × 8% = 1,760,000 / 17.5% = 3,850,000.
	assert.deepEqual(charge(slips.get('VN-NPL')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	// PIT: the meal is salary income above 730,000 (art.2(2)(g.5)): 22,000,000 + 2,200,000 −
	// 730,000 = 23,470,000; − 2,310,000 − 15,500,000 = 5,660,000 × 5% = 283,000.
	assert.deepEqual(charge(slips.get('VN-WHOLE')!, 'PIT'), [23_470_000, 283_000, 0]);
	// The đồng has no minor unit: a prorated base is a whole đồng, 20,000,000 × 10 ÷ 22 =
	// 9,090,909.09 → 9,090,909, on the segment as on the line.
	assert.deepEqual(prorated('VN-JOINER-20M'), [[10, 22, 9_090_909]]);
	assert.equal(slips.get('VN-JOINER-20M')!.gross, 9_090_909 + 1_000_000);
	// The part month. Law 41/2024 art.33(5): a month with fourteen or more unpaid working days
	// contributes nothing; fewer contributes on the whole contractual salary. The joiner has twelve
	// (2–16 January) and the leaver twelve (16–30), so both insure the whole 22,000,000 × 8% =
	// 1,760,000 / 17.5% = 3,850,000 (the scheme reads `person.period.working_days` less
	// `period.days_employed`), and the 20,000,000 joiner 1,600,000 / 3,500,000, 300,000 / 600,000
	// health.
	assert.deepEqual(charge(slips.get('VN-JOINER')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	assert.deepEqual(charge(slips.get('VN-LEAVER')!, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	assert.deepEqual(charge(slips.get('VN-JOINER-20M')!, 'SI'), [20_000_000, 1_600_000, 3_500_000]);
	assert.deepEqual(charge(slips.get('VN-JOINER-20M')!, 'HI'), [20_000_000, 300_000, 600_000]);
});

test('Vietnam — fourteen unpaid working days in the month is a month outside insurance (Law 41/2024 art.33(5))', () => {
	// January 2026 holds 22 working days; a leaver on Friday the 9th worked seven of them and is
	// unpaid for the fifteen after, so the month contributes nothing to social, health or
	// unemployment insurance, and the union fee that rides the same fund is nothing too. The wage
	// itself is still paid on the working days: 22,000,000 × 7 ÷ 22.
	const { slips } = buildStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [{ key: 'VN-EARLY', wage: 22_000_000, citizenship: 'CITIZEN', exit_date: '2026-01-09' }]
	});
	const slip = slips.get('VN-EARLY')!;
	assert.deepEqual(
		slip.proration.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[7, 22, 7_000_000]]
	);
	for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
		assert.equal(
			slip.statutory.find((entry) => entry.scheme_code === code),
			undefined,
			`${code} charges nothing and carries no row`
		);
});

test('Vietnam — fourteen days of no-pay leave inside an employed month is the same month outside insurance', () => {
	const NPL = 'c1c1c1c1-0000-4000-8000-00000000000a';
	// The whole of January is employed, so `period.days_employed` is the month's 22 working days;
	// the fourteen the person did not receive wages for are the no-pay leave charged, which the
	// scheme reads as `person.period.unpaid_days`. Thirteen such days still insure the whole
	// contractual salary; the fourteenth takes the month out (Law 41/2024 art.33(5)).
	const build = (days: number) =>
		buildStatutory(
			{
				code: 'VN',
				period: '2026-01',
				region: 'I',
				people: [{ key: 'VN-NPL', wage: 22_000_000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.leave_catalogue.push({
					id: NPL,
					settings_id: VN_2026_JAN,
					code: 'UNPAID_LEAVE',
					name: 'Nghỉ không hưởng lương',
					eligibility: '',
					evidence: 'NONE',
					evidence_after_days: null,
					entitlement: {
						availability: 'UNLIMITED',
						year_start_month: 1,
						proration: 'NONE',
						bands: []
					},
					is_npl: true,
					can_encash: false,
					bands: [],
					approval_id: null
				});
				const employment = world.employments.find((row) => row.employee_number === 'VN-NPL')!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				// Weekdays from Thursday 1 January, one charge a day, inside the run's attendance
				// window (the 21st to the 20th): fourteen of them end on Tuesday the 20th.
				const dates: string[] = [];
				for (let day = 1; dates.length < days; day += 1) {
					const date = `2026-01-${String(day).padStart(2, '0')}`;
					const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
					if (weekday !== 0 && weekday !== 6) dates.push(date);
				}
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-000000000002',
					employment_id: employment.id,
					catalogue_id: NPL,
					leave_code: 'UNPAID_LEAVE',
					reference: 'NPL-14',
					from_date: dates[0]!,
					to_date: dates.at(-1)!,
					half_day_start: false,
					half_day_end: false,
					days,
					effective_on: dates[0]!,
					reason: 'art.115(3)',
					allocations: [],
					charges: dates.map((date) => ({
						date,
						days: 1,
						catalogue_id: NPL,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				});
			}
		).slips.get('VN-NPL')!;
	const thirteen = build(13);
	assert.deepEqual(charge(thirteen, 'SI'), [22_000_000, 1_760_000, 3_850_000]);
	const fourteen = build(14);
	assert.equal(
		fourteen.adjustments
			.filter((row) => row.bucket === 'ABSENCE')
			.reduce((total, row) => total + row.amount, 0),
		14_000_000,
		'the fourteen days come off the salary at 1,000,000 a working day'
	);
	for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
		assert.equal(
			fourteen.statutory.find((entry) => entry.scheme_code === code),
			undefined,
			`${code} charges nothing and carries no row`
		);
});

test('every sealed version of `VN` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('VN');
});

test('Vietnam — a night hour of rest-day work adds 20% of the rest-day wage (art.98(3)), a night shift owes 45 minutes (art.109(1)), and the statutory holiday on the rest day is 300% (art.98(1)(c))', () => {
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'VN-NIGHT', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			// Sunday the 4th is the rest day and Tết Dương lịch's substitute stands elsewhere; a
			// holiday row on the rest day itself makes the day the statutory day under SUBSTITUTE.
			world.jurisdiction_holidays.push(holiday('2026-01-11', 'A holiday on the rest day'));
			const employment = world.employments.find((row) => row.employee_number === 'VN-NIGHT')!;
			world.work_days.push({
				id: 'wd-VN-NIGHT-2026-01-10',
				employment_id: employment.id,
				work_date: '2026-01-10',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-01-10T18:00:00+07:00', end: '2026-01-11T02:00:00+07:00' }
				],
				approval_id: null
			}); // Saturday rest day into the night
			punch(world, 'VN-NIGHT', '2026-01-11', '09:00', '13:00'); // the holiday on the rest day
		}
	);
	const lines = workLines(slips.get('VN-NIGHT')!);
	// 17,600,000 ÷ 22 ÷ 8 = 100,000 an hour. Saturday: eight hours on a rest day at 200%; four of
	// them after 22:00 (the interval runs to 02:00 the next morning, inside the 22:00–06:00
	// window) add 20% of the rest-day wage on the band, beside the 30% night premium's own line.
	// Art.109(1): six hours or more with night work owes forty-five minutes; none were taken, so
	// the rest-day clock is priced net of them — 7.25 hours — and the band pays 7.25 × 200,000 +
	// 4 × 20,000 = 1,530,000.
	const saturday = lines.filter((line) => line[0] === '2026-01-10' && line[1].startsWith('OT'));
	assert.equal(
		saturday.reduce((sum, line) => sum + line[2], 0),
		7.25,
		'the 45-minute night break comes off'
	);
	assert.equal(
		saturday.reduce((sum, line) => sum + line[3], 0),
		7.25 * 200_000 + 4 * 20_000
	);
	// Sunday: the statutory holiday falls on the rest day, and work on it is 300%: 4 × 300,000.
	assert.deepEqual(
		lines.filter((line) => line[0] === '2026-01-11'),
		[['2026-01-11', 'OT-3.0X-STATUTORY-DAY', 4, 1_200_000]]
	);
});

test('Vietnam — the 300-hour sector limit, the reduced accident rate and union dues turn on entity facts and elections', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		companyFacts: { occupational_accident_reduced: true, overtime_300h_sector: true },
		people: [
			{
				key: 'VN-MEMBER',
				wage: 17_600_000,
				citizenship: 'CITIZEN',
				registrations: { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } }
			},
			{ key: 'VN-NONMEMBER', wage: 17_600_000, citizenship: 'CITIZEN' }
		]
	});
	// Decree 58/2020 art.5: the employer's SI share is 17.3% where the reduced 0.3% accident rate
	// is granted: 17,600,000 × 17.3% = 3,044,800.
	expectStatutory(book, 'VN-MEMBER', 'SI', 1_408_000, 3_044_800);
	// Decision 1908/QĐ-TLĐ: a union member pays dues of 1% of the SI salary, capped at 10% of the
	// reference level (234,000); a non-member pays none.
	expectStatutory(book, 'VN-MEMBER', 'UNION_DUES', 176_000, 0);
	assert.equal(book.get('VN-NONMEMBER')!.get('UNION_DUES'), undefined);
});

test('Vietnam — a holiday on the rest day is the holiday, its substitute Monday the rest day (Decree 145/2020 art.55(3))', () => {
	// Giỗ Tổ Hùng Vương 2026 is Sunday 26 April, with Monday the 27th its substitute — the
	// calendar's shape for a holiday on a rest day (the bank seeds both rows). Eight hours on the
	// Sunday: the holiday coincides with the weekly rest day, so it is paid as holiday overtime —
	// 300%; eight hours on the substitute: rest-day overtime — 200%. The company cuts off on the
	// 21st, so both days are in the May run; each is priced at the hour of the month it was worked
	// (art.55(1)(a)): April's 22 working days, 17,600,000 ÷ 22 ÷ 8 = 100,000, not May's 21.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-05',
			region: 'I',
			people: [{ key: 'VN-HUNG', wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-04-26', 'Giỗ Tổ Hùng Vương'), {
				...holiday('2026-04-27', 'Giỗ Tổ Hùng Vương — observed'),
				kind: 'SUBSTITUTE',
				replaces: '2026-04-26'
			});
			punch(world, 'VN-HUNG', '2026-04-26', '09:00', '17:30'); // eight hours net of the art.109 break
			punch(world, 'VN-HUNG', '2026-04-27', '09:00', '18:00'); // eight on the substitute
		}
	);
	assert.deepEqual(workLines(slips.get('VN-HUNG')!), [
		['2026-04-26', 'OT-3.0X-STATUTORY-DAY', 8, 2_400_000],
		['2026-04-27', 'OT-2.0X-SUBSTITUTE', 8, 1_600_000]
	]);
});

test('Vietnam — a part-timer under the floor and a trainee are outside compulsory insurance (Law 41/2024 art.2(1)(a), (l))', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'VN-PT-2M', wage: 2_000_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{ key: 'VN-PT-FLOOR', wage: 2_340_000, citizenship: 'CITIZEN', employment_type: 'PART_TIME' },
			{ key: 'VN-INTERN', wage: 5_000_000, citizenship: 'CITIZEN', employment_type: 'INTERN' }
		]
	});
	// Art.2(1)(l): a part-timer is a member only from a month's wage at or above the lowest
	// contribution salary; exactly the reference level is in.
	for (const scheme of ['SI', 'HI', 'UI']) {
		expectStatutorySkipped(book, 'VN-PT-2M', scheme);
		expectStatutorySkipped(book, 'VN-INTERN', scheme);
	}
	expectStatutory(book, 'VN-PT-FLOOR', 'SI', 187_200, 409_500);
	expectStatutory(book, 'VN-PT-FLOOR', 'UI', 23_400, 23_400);
});

test('Vietnam — union dues below the floor are 1% of the SI salary (Decision 1908/QĐ-TLĐ art.23(3))', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{
				key: 'VN-DUES-2M',
				wage: 2_000_000,
				citizenship: 'CITIZEN',
				registrations: { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } }
			}
		]
	});
	// The SI salary is the floored 2,340,000, so the dues are 23,400 — not 20,000 on the raw wage.
	expectStatutory(book, 'VN-DUES-2M', 'UNION_DUES', 23_400, 0);
});

test('Vietnam — the year-end finalisation deducts the taxpayer’s twelve months whatever the months employed (Decree 253/2026 art.48(1)(b))', () => {
	// A joiner on 1 July 2026 at 60,000,000 with no other income of the year: the employer's
	// finalisation in December reads the year's income, 6 × 60,000,000 = 360,000,000, less the
	// year's insurance (6 × 4,807,000 on the 50,600,000 cap: SI 4,048,000 + HI 759,000; UI on the
	// regional cap 20 × 5,310,000 = 106,200,000 → 600,000 — 5,407,000 a month, 32,442,000) and the
	// twelve-month self-deduction, 186,000,000 (six months' worth, 93,000,000, would have left
	// 234,558,000): 141,558,000 → 5% × 120,000,000 + 10% × 21,558,000 = 8,155,800, less the five
	// months withheld on file — the year's tax is below what the monthly table took, and the
	// finalisation refunds the difference through the payslip.
	const people = [
		{ key: 'VN-JULY', wage: 60_000_000, citizenship: 'CITIZEN', hire_date: '2026-07-01' }
	];
	// The monthly table on 60,000,000 − 5,407,000 − 15,500,000 = 39,093,000: 500,000 + 2,000,000 +
	// 20% × 9,093,000 = 4,318,600.
	const withheld = 4_318_600;
	const december = assessStatutory(
		{ code: 'VN', period: '2026-12', people, region: 'I' },
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'VN-JULY')!;
			for (let month = 7; month <= 11; month += 1) {
				const period = `2026-${String(month).padStart(2, '0')}`;
				world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `payslip-VN-JULY-${period}`,
					payroll_run_id: `prior-${period}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${period}-28T00:00:00.000Z`,
					currency: 'VND',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'SI',
							employee_amount: 4_048_000,
							employer_amount: 0,
							base_amount: 50_600_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'HI',
							employee_amount: 759_000,
							employer_amount: 0,
							base_amount: 50_600_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'UI',
							employee_amount: 600_000,
							employer_amount: 0,
							base_amount: 60_000_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'PIT',
							employee_amount: withheld,
							employer_amount: 0,
							base_amount: 60_000_000,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		}
	);
	expectStatutory(december, 'VN-JULY', 'PIT', 8_155_800 - 5 * withheld, 0);
});

test('Vietnam — a contract under three months is withheld 10% flat from 5,000,000 a payment, unless the commitment is on file (Decree 253/2026 art.50(2))', () => {
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			// Two months, 8,000,000: 10% = 800,000 — no deduction, no table.
			{
				key: 'VN-2M-CONTRACT',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28'
			},
			// The same on 4,000,000: under 5,000,000 a payment, nothing withheld.
			{
				key: 'VN-2M-SMALL',
				wage: 4_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28'
			},
			// The commitment (mẫu 08/CK-TNCN) suspends the 10%: the table, which on 8,000,000 less
			// the 15,500,000 deduction is nothing.
			{
				key: 'VN-2M-COMMITTED',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-02-28',
				registrations: { PIT: { kind: 'REGISTERED', elections: { commitment_form: true } } }
			},
			// Three months is the progressive table: 8,000,000 − insurance − 15,500,000 < 0 → 0.
			{
				key: 'VN-3M-CONTRACT',
				wage: 8_000_000,
				citizenship: 'CITIZEN',
				hire_date: '2026-01-01',
				exit_date: '2026-03-31'
			}
		]
	});
	expectStatutory(book, 'VN-2M-CONTRACT', 'PIT', 800_000, 0);
	expectStatutory(book, 'VN-2M-SMALL', 'PIT', 0, 0);
	expectStatutory(book, 'VN-2M-COMMITTED', 'PIT', 0, 0);
	expectStatutory(book, 'VN-3M-CONTRACT', 'PIT', 0, 0);
});

test('Vietnam — a foreigner is insured on a contract of twelve months or more (Law 41/2024 art.2(2)); those outside are owed the employer’s rate as wages (Labour Code art.168(3))', () => {
	const version = settingsVersions('VN').find((v) =>
		String(v.effective_range.start).startsWith('2026-01')
	)!;
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{
					key: 'VN-F-6M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					hire_date: '2026-01-01',
					exit_date: '2026-06-30'
				},
				{
					key: 'VN-F-12M',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					hire_date: '2026-01-01',
					exit_date: '2026-12-31'
				},
				// A working pensioner, recorded outside SI: nothing to the fund, 20.5% + 1% to them.
				{
					key: 'VN-PENSIONER',
					wage: 20_000_000,
					citizenship: 'CITIZEN',
					registrations: {
						SI: { kind: 'NOT_REGISTERED' },
						HI: { kind: 'NOT_REGISTERED' },
						UI: { kind: 'NOT_REGISTERED' }
					}
				}
			]
		},
		(world) => {
			const row = world.allowance_catalogue.find(
				(item) => item.code === 'INSURANCE_EQUIVALENT' && item.settings_id === version.id
			)!;
			for (const [index, key] of ['VN-F-6M', 'VN-PENSIONER'].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				world.allowances.push({
					id: `d0000000-0000-4000-8000-0000000000e${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: 'art.168(3)',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	// The payslip lists a scheme the person is outside as a zero row; the charge is what counts.
	const charge = (key: string, code: string) => {
		const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	const equivalent = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')
			?.amount;
	// Six months: outside SI and HI; the employer's 17.5% + 3% of the 20,000,000 it would have
	// insured — 4,100,000 — is paid with the wage; a foreigner is outside UI, so no 1%.
	assert.deepEqual(charge('VN-F-6M', 'SI'), [0, 0]);
	assert.deepEqual(charge('VN-F-6M', 'HI'), [0, 0]);
	assert.equal(equivalent('VN-F-6M'), 4_100_000);
	// Twelve months: insured, 8% / 17.5% and 1.5% / 3%.
	assert.deepEqual(charge('VN-F-12M', 'SI'), [1_600_000, 3_500_000]);
	assert.deepEqual(charge('VN-F-12M', 'HI'), [300_000, 600_000]);
	// The pensioner: 20.5% of 20,000,000 plus UI's 1% = 4,300,000.
	assert.deepEqual(charge('VN-PENSIONER', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-PENSIONER'), 4_300_000);
});

test('Vietnam — a pensioner, a transferee and a foreigner hired at retirement age are outside insurance and owed the employer’s rate (Law 41/2024 art.2(2), 2(7); Labour Code art.168(3))', () => {
	// 2026 retirement age (Decree 135/2020 art.4): 61 years 6 months for a man, 57 for a woman.
	const version = settingsVersions('VN').find((v) =>
		String(v.effective_range.start).startsWith('2026-01')
	)!;
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{ key: 'VN-PENSION', wage: 20_000_000, citizenship: 'CITIZEN', receiving_pension: true },
				{
					key: 'VN-TRANSFEREE',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					pass_type: 'INTRA_COMPANY_TRANSFER'
				},
				// A man born 1 May 1964 hired on 1 January 2026 is 61 years 8 months — past 61 years 6.
				{
					key: 'VN-F-RETIRED',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					gender: 'MALE',
					birth_date: '1964-05-01',
					hire_date: '2026-01-01'
				},
				// Born 1 September 1964: 61 years 4 months — under it, insured.
				{
					key: 'VN-F-NOT-YET',
					wage: 20_000_000,
					citizenship: 'FOREIGNER',
					gender: 'MALE',
					birth_date: '1964-09-01',
					hire_date: '2026-01-01'
				}
			]
		},
		(world) => {
			const row = world.allowance_catalogue.find(
				(item) => item.code === 'INSURANCE_EQUIVALENT' && item.settings_id === version.id
			)!;
			for (const [index, key] of [
				'VN-PENSION',
				'VN-TRANSFEREE',
				'VN-F-RETIRED',
				'VN-F-NOT-YET'
			].entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				world.allowances.push({
					id: `d0000000-0000-4000-8000-0000000000d${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					effective_from: '2026-01-01',
					effective_to: null,
					reason: 'art.168(3)',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const charge = (key: string, code: string) => {
		const row = slips.get(key)!.statutory.find((item) => item.scheme_code === code);
		return [row?.employee_amount ?? 0, row?.employer_amount ?? 0];
	};
	const equivalent = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'INSURANCE_EQUIVALENT')
			?.amount;
	// The pensioner: no SI, HI or UI; 20.5% + 1% of 20,000,000 = 4,300,000 with the wage.
	assert.deepEqual(charge('VN-PENSION', 'SI'), [0, 0]);
	assert.deepEqual(charge('VN-PENSION', 'UI'), [0, 0]);
	assert.equal(equivalent('VN-PENSION'), 4_300_000);
	// The transferee and the retirement-age hire: no SI or HI; 20.5% = 4,100,000 (no UI for a foreigner).
	assert.deepEqual(charge('VN-TRANSFEREE', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-TRANSFEREE'), 4_100_000);
	assert.deepEqual(charge('VN-F-RETIRED', 'SI'), [0, 0]);
	assert.equal(equivalent('VN-F-RETIRED'), 4_100_000);
	// Under the age at hire: insured; the row the catalogue declines to price pays nothing.
	assert.deepEqual(charge('VN-F-NOT-YET', 'SI'), [1_600_000, 3_500_000]);
	assert.equal(equivalent('VN-F-NOT-YET'), undefined);
});
