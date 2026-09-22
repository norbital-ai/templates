/**
 * Round 2, letter D — work-rule mechanisms: the work-day person on the version's divisor, the
 * gross rate of pay, holiday-compensation elections, PH double holidays and the attendance test,
 * PH kasambahay wage floors, PH separation causes, part-time leave by contracted hours, and the
 * MY daily limit in worked hours.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   SG EA 1968: https://sso.agc.gov.sg/Act/EmA1968 (s.2 "gross rate of pay", s.35, s.37, s.88)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildStatutory,
	COMPANY_ID,
	leaveCatalogue,
	type BuiltPayslip,
	type Lineage
} from './fixtures/statutory-world.ts';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

const SG_2026 = 'e363af9a-a034-59f7-84bf-5052f57ecae5';

const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	offset = '+08:00'
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [
			{ start: `${date}T${start}:00${offset}`, end: `${date}T${end}:00${offset}` }
		],
		requested_by: null,
		approval_id: null
	});
};

/** A day read and found empty: the calendar's record that nothing was worked. */
const empty = (world: PayrollWorld, key: string, date: string) => {
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

const holiday = (date: string, name: string, kind = 'PUBLIC_HOLIDAY') => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	kind,
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});

const OFF = 'c0000000-0000-4000-8000-0000000000d4';
/** Saturday becomes an unassigned (OFF) day: a day the contract does not require work. */
const saturdayOff = (world: PayrollWorld) => {
	world.shift_definitions.push({
		...world.shift_definitions[1]!,
		id: OFF,
		code: 'OFF',
		name: 'Off',
		variant: { kind: 'OFF' }
	});
	world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: OFF };
};

const allowance = (world: PayrollWorld, settingsId: string, code: string, index: number) => {
	const id = `a4000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
	world.allowance_catalogue.push({
		id,
		settings_id: settingsId,
		code,
		name: code,
		eligibility: '',
		evidence: 'NONE',
		destination: 'PAY',
		direction: 'ADD',
		bands: [{ when: '', amount: 'entry.amount', limit: null }],
		counts_toward: [],
		approval_id: null
	});
	return id;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SG G2 — the work day's `person.terms.monthly_basic` and `ordinary_day` are on the divisor.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG round 2 — a daily rate reads as its month for Part 4 and as its own day for rest-day pay', () => {
	// s.35(b): Part 4 reaches a non-workman on "a salary not exceeding $2,600 a month". A daily
	// rate's month on SG's divisor 52 × 5 ÷ 12 = 21.6667 days: 110 × 21.6667 = 2,383.33 (inside);
	// 130 × 21.6667 = 2,816.67 (outside). s.37(3)(b): a whole rest day worked at the employer's
	// request (8 hours, more than half the 8-hour shift) pays two days' salary at the basic rate;
	// the Third Schedule day of a daily-rated employee is the daily rate: 2 × 110 = 220.00.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'DAY-110', wage: 110, pay_frequency: 'DAILY', citizenship: 'CITIZEN' },
				{ key: 'DAY-130', wage: 130, pay_frequency: 'DAILY', citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			// Sunday 11 January 2026 is the fixture's rest day; 09:00–17:00 with no shift break is 8 hours.
			punch(world, 'DAY-110', '2026-01-11', '09:00', '17:00');
			punch(world, 'DAY-130', '2026-01-11', '09:00', '17:00');
		}
	);
	assert.deepEqual(workLines(slips.get('DAY-110')!), [['2026-01-11', 'OT-2.0X', 8, 220]]);
	assert.deepEqual(workLines(slips.get('DAY-130')!), []);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SG G4 — the gross rate of pay leaves out travelling, food and housing allowances.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG round 2 — s.88(1)(c): the gross rate of pay excludes a food allowance the version names', () => {
	// s.2 "gross rate of pay": money including allowances, but not (e) "travelling, food or
	// housing allowances". Monthly $2,288 basic, $260 shift allowance, $300 food allowance, five-day
	// week: 12 × (2,288 + 260) ÷ (52 × 5) = 30,576 ÷ 260 = 117.60 (the food allowance would make
	// it 12 × 2,848 ÷ 260 = 131.45). Daily $100 with the same allowances: the day plus the shift
	// allowance's day, 100 + 12 × 260 ÷ 260 = 112.00.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'GROSS-M', wage: 2288, citizenship: 'CITIZEN' },
				{ key: 'GROSS-D', wage: 100, pay_frequency: 'DAILY', citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			saturdayOff(world);
			world.jurisdiction_holidays.push(holiday('2026-01-10', 'A Saturday holiday'));
			const version = world.jurisdiction_settings.find((row) => row.id === SG_2026)!;
			version.work_rules.gross_excluded_allowances = ['FOOD'];
			const shift = allowance(world, SG_2026, 'SHIFT', 1);
			const food = allowance(world, SG_2026, 'FOOD', 2);
			for (const employment of world.employments) {
				assignAllowance(world, {
					employment_id: employment.id,
					catalogue_id: shift,
					amount: 260,
					effective_from: '2015-01-01'
				});
				assignAllowance(world, {
					employment_id: employment.id,
					catalogue_id: food,
					amount: 300,
					effective_from: '2015-01-01'
				});
				empty(world, employment.employee_number, '2026-01-10');
			}
		}
	);
	assert.deepEqual(workLines(slips.get('GROSS-M')!), [
		['2026-01-10', 'PH-NON-WORKING-DAY', 0, 117.6]
	]);
	assert.deepEqual(workLines(slips.get('GROSS-D')!), [
		['2026-01-10', 'PH-NON-WORKING-DAY', 0, 112]
	]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SG G3 — s.88(1)(c) and s.88(4A): the employer's election of time off instead of pay.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('SG round 2 — s.88(1)(c)/(4A): an employer that gives time off pays no holiday day, except to Part 4', () => {
	// s.88(1)(c): a holiday on a non-working day is paid at the gross rate "or" a day off is given
	// in substitution. s.88(4A): an employee outside Part 4 by s.35(b) and not a workman, required
	// to work on a public holiday, "may be given" time off in lieu of the extra day's salary.
	// With the entity's election at TIME_OFF:
	//   - OFF-DAY ($2,288, Saturday holiday not worked): no pay line (the day off is owed instead).
	//   - MGR ($5,200 manager, worked 1 January): no extra day (time off in lieu instead).
	//   - PART4 ($2,288 non-workman, inside Part 4 by s.35(b), worked 1 January): (4A) does not
	//     reach them, so s.88(4) still pays the extra day: 12 × 2,288 ÷ (52 × 5) = 105.60.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			companyFacts: { public_holiday_compensation: 'TIME_OFF' },
			people: [
				{ key: 'OFF-DAY', wage: 2288, citizenship: 'CITIZEN' },
				{ key: 'MGR', wage: 5200, citizenship: 'CITIZEN', work_classification: 'MANAGERIAL' },
				{ key: 'PART4', wage: 2288, citizenship: 'CITIZEN' }
			]
		},
		(world) => {
			saturdayOff(world);
			world.jurisdiction_holidays.push(holiday('2026-01-01', "New Year's Day"));
			world.jurisdiction_holidays.push(holiday('2026-01-10', 'A Saturday holiday'));
			empty(world, 'OFF-DAY', '2026-01-10');
			punch(world, 'MGR', '2026-01-01', '09:00', '18:00');
			punch(world, 'PART4', '2026-01-01', '09:00', '18:00');
		}
	);
	assert.deepEqual(workLines(slips.get('OFF-DAY')!), []);
	assert.deepEqual(workLines(slips.get('MGR')!), []);
	assert.deepEqual(workLines(slips.get('PART4')!), [['2026-01-01', 'OT-1.0X', 8, 105.6]]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MY / MY-nihon — the s.60A(7) daily limit counts worked hours (s.60A(9)).
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('MY round 2 — s.60A(7): twelve hours of work a day are twelve worked hours, breaks excluded', () => {
	// s.60A(7): no employee is required to work more than twelve hours in any one day; s.60A(9):
	// "hours of work" is the time the employee is at the employer's disposal, exclusive of rest
	// intervals. On the 09:00–18:00 shift with its one-hour break:
	//   09:00–21:30 is 12.5 clock hours less 1 hour = 11.5 worked → no breach (a clock reading
	//   of 12 less the break, 11, reported it);
	//   09:00–22:30 is 13.5 − 1 = 12.5 worked → breach.
	for (const code of ['MY', 'MY-nihon'] as const) {
		const { warnings } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{
						key: 'UNDER',
						wage: 2600,
						citizenship: 'CITIZEN',
						registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
					},
					{
						key: 'OVER',
						wage: 2600,
						citizenship: 'CITIZEN',
						registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
					}
				]
			},
			(world) => {
				punch(world, 'UNDER', '2026-01-05', '09:00', '21:30');
				punch(world, 'OVER', '2026-01-05', '09:00', '22:30');
			}
		);
		const daily = warnings.filter((line) => line.startsWith('DAILY_WORK_LIMIT_EXCEEDED'));
		assert.equal(daily.length, 1, `${code}: ${daily.join('\n')}`);
		assert.match(daily[0]!, /OVER worked 12\.50 hours .* above the 12-hour daily limit/);
	}
});

test('MY-nihon round 2 — the incentive boundary stays at eleven hours worked, its own policy', () => {
	// Nihon's company term: hours past eleven worked in a day are the INCENTIVE line at the same
	// s.60A(3)(a) 1.5×. 09:00–22:30 less the one-hour break is 12.5 h worked: 4.5 h past the normal
	// eight, of which 3 h reach eleven and 1.5 h lie beyond. Hourly rate 2,600 ÷ 26 ÷ 8 = 12.50;
	// 3 × 12.50 × 1.5 = 56.25 and 1.5 × 12.50 × 1.5 = 28.125 → 28.13.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [
				{
					key: 'N',
					wage: 2600,
					citizenship: 'CITIZEN',
					registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
				}
			]
		},
		(world) => punch(world, 'N', '2026-01-05', '09:00', '22:30')
	);
	assert.deepEqual(
		slips.get('N')!.adjustments.map((row) => [row.statutory_rule_key, row.quantity, row.amount]),
		[
			['OVERTIME:WORKDAY-OT-1.5X', 3, 56.25],
			['INCENTIVE:WORKDAY-OT-1.5X', 1.5, 28.13]
		]
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PH — double holidays, the workday-before test, domestic-worker floors, separation causes.
//   DOLE Handbook on Workers' Statutory Monetary Benefits (2022): ch.2 §C (double holiday),
//   §D–E (absences, successive holidays), ch.4 §D (guide computations).
//   Wage Order No. NCR-DW-06: https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf
//   Labor Code arts.298–299 (separation pay by authorised cause).
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PH_2026 = 'bb5137fd-d7fd-4a26-8eae-77211521f892';
// The version governing 31 January 2026 since RR 29-2025 split January on the 6th: a separation
// row must come from the catalogue in force on the final service day.
const PH_2026_JAN6 = 'b585862c-5438-5a97-a36d-44e55ceb5498';

test('PH round 2 — a double holiday is 200% unworked and 300% worked; the second day needs the workday before', () => {
	// ₱21,750 a month on the 261 factor is ₱1,000 a day (21,750 × 12 ÷ 261) and ₱125 an hour;
	// the salary already pays the day once (Handbook ch.1 §E.2(c)). Monday 5 January is a double
	// holiday (two regular holidays, Handbook ch.2 §C: 200% unworked, 300% worked).
	//   DBL-W worked 09:00–18:00 (8 h): the 300% adds 200%: 8 × 125 × 2.0 = 2,000 → 23,750.
	//   DBL-OT worked 09:00–20:00: + two hours at 3 × 1.3 = 390% (ch.4 §D): 2 × 125 × 3.9 = 975
	//     → 21,750 + 2,000 + 975 = 24,725.
	//   DBL-U did not work it (a day read empty) and was present on Friday 2 January, the workday
	//     before (Saturday and Sunday are rest days, §D.3): the second 100%, 1,000 → 22,750.
	//   DBL-ABS was also absent without leave on Friday 2 January: that day comes off the salary
	//     (21,750 ÷ 21.75 = 1,000) and the second holiday is not paid (§D.1) → 20,750.
	//   DBL-D, ₱600 a day, worked it 8 h: January has 22 weekdays, all earned (600 × 22 = 13,200),
	//     and the 300% adds 200% of the day: 8 × 75 × 2.0 = 1,200 → 14,400.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'DBL-W', wage: 21_750 },
				{ key: 'DBL-OT', wage: 21_750 },
				{ key: 'DBL-U', wage: 21_750 },
				{ key: 'DBL-ABS', wage: 21_750 },
				{ key: 'DBL-D', wage: 600, pay_frequency: 'DAILY' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(
				holiday('2026-01-05', 'Two regular holidays', 'DOUBLE_HOLIDAY')
			);
			punch(world, 'DBL-W', '2026-01-05', '09:00', '18:00');
			punch(world, 'DBL-OT', '2026-01-05', '09:00', '20:00');
			empty(world, 'DBL-U', '2026-01-05');
			empty(world, 'DBL-ABS', '2026-01-02');
			empty(world, 'DBL-ABS', '2026-01-05');
			punch(world, 'DBL-D', '2026-01-05', '09:00', '18:00');
		}
	);
	assert.deepEqual(
		['DBL-W', 'DBL-OT', 'DBL-U', 'DBL-ABS', 'DBL-D'].map((key) => slips.get(key)!.gross),
		[23_750, 24_725, 22_750, 20_750, 14_400]
	);
});

test('PH round 2 — Handbook ch.2 §D: the daily-paid are paid an unworked regular holiday only if present the workday before', () => {
	// ₱600 a day, Monday–Friday. Monday 5 January a regular holiday, not worked by either.
	// D-PRESENT: 21 ordinary weekdays + the holiday at 100% = 22 × 600 = 13,200.
	// D-ABSENT was absent without leave on Friday 2 January, the workday before (the weekend is
	// the rest days between): 20 ordinary weekdays, 20 × 600 = 12,000, and no holiday pay.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'D-PRESENT', wage: 600, pay_frequency: 'DAILY' },
				{ key: 'D-ABSENT', wage: 600, pay_frequency: 'DAILY' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-05', 'A regular holiday'));
			empty(world, 'D-ABSENT', '2026-01-02');
		}
	);
	assert.deepEqual(
		['D-PRESENT', 'D-ABSENT'].map((key) => slips.get(key)!.gross),
		[13_200, 12_000]
	);
});

test('PH round 2 — RA 10361 s.24: a kasambahay in NCR is held to NCR-DW-06, ₱7,800 a month, not the establishment order', () => {
	// NCR-DW-06 s.1: ₱7,800 a month from 7 February 2026 (the 1 April 2026 version carries it).
	// DW-7500 is below it; DW-7800 meets it — and would be far below the establishment floor
	// (NCR-26, ₱695 × 313 ÷ 12 = 18,127.92) if that held a domestic worker.
	const { warnings } = buildStatutory({
		code: 'PH',
		period: '2026-04',
		region: 'NCR',
		people: [
			{ key: 'DW-7500', wage: 7_500, employment_type: 'DOMESTIC' },
			{ key: 'DW-7800', wage: 7_800, employment_type: 'DOMESTIC' }
		]
	});
	const below = warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW'));
	assert.equal(below.length, 1, below.join('\n'));
	assert.match(
		below[0]!,
		/DW-7500 is contracted at 7500 a month, below the NCR minimum wage of 7800/
	);
});

test('PH round 2 — Labor Code arts.298–299: the authorised cause chooses one month, half a month, or nothing', () => {
	// ₱30,000 a month, 1 August 2020 – 31 January 2026: 5 years 6 months, the six months a
	// whole year → 6 years.
	//   Labour-saving devices (art.298): one month a year, 6 × 30,000 = 180,000.
	//   Closure not due to serious losses (art.298) and disease (art.299): half a month a year or
	//   one month, whichever is higher: max(6 × 15,000, 30,000) = 90,000.
	//   Closure due to serious business losses: art.298 grants the half month only to a closure
	//   "not due to serious business losses", so nothing.
	const causes = {
		LSD: 'LABOR_SAVING_DEVICES',
		CLOSURE: 'CLOSURE_NOT_DUE_TO_SERIOUS_LOSSES',
		DISEASE: 'DISEASE',
		LOSSES: 'CLOSURE_DUE_TO_SERIOUS_LOSSES'
	} as const;
	const keys = Object.keys(causes) as (keyof typeof causes)[];
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: keys.map((key) => ({
				key,
				wage: 30_000,
				hire_date: '2020-08-01',
				exit_date: '2026-01-31',
				exit_reason: key === 'LSD' ? 'REDUNDANCY' : 'RETRENCHMENT'
			}))
		},
		(world) => {
			const row = world.adhoc_catalogue!.find(
				(item) => item.code === 'SEPARATION_PAY' && item.settings_id === PH_2026_JAN6
			)!;
			for (const [index, key] of keys.entries()) {
				const employment = world.employments.find((item) => item.employee_number === key)!;
				employment.exit_facts = { termination_cause: causes[key] };
				world.adhoc_requests!.push({
					id: `d4000000-0000-4000-8000-00000000000${index}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'separation pay',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const paid = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'SEPARATION_PAY')?.amount;
	assert.deepEqual(keys.map(paid), [180_000, 90_000, 90_000, undefined]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Part-time leave: SG and TW by contracted hours; MY on its own part-time ladder.
//   SG: https://www.mom.gov.sg/employment-practices/part-time-employment/leave
//   TW: 僱用部分時間工作勞工應行注意事項 三(三)–(四) (MOL, 2022-03-14)
//   MY: Employment (Part-Time Employees) Regulations 2010, regs.7–8
// ─────────────────────────────────────────────────────────────────────────────────────────────

const entitlement = (
	code: Lineage,
	settingsId: string,
	leave: string,
	type: string,
	week: { hours: number; days: number },
	hire: string,
	asOf: string
) => {
	const row = leaveCatalogue(code).find(
		(candidate) => candidate.settings_id === settingsId && candidate.code === leave
	)!;
	assert.ok(row, `${code} has no ${leave} on ${settingsId}`);
	return computedEntitlement({
		rule: row.entitlement,
		window: leaveWindowOf(asOf, row.entitlement),
		asOf,
		hireDate: hire,
		exitDate: null,
		servedOn: () => true,
		eligibleOn: () => true,
		personOn: (date) =>
			personContext({
				employee: null,
				employment: { service_start: hire },
				terms: { employment_type: type, work_classification: 'EA_COVERED' },
				week: { ordinary_hours_per_week: week.hours, working_days_per_week: week.days },
				asOf: date
			})
	}).entitlement;
};

test('SG round 2 — a part-timer holds sick and annual leave in proportion to their hours', () => {
	// MOM: (part-timer's hours a year ÷ full-timer's) × full-timer's days × full-timer's hours a
	// day, the full-timer at 44 hours and 8 a day. 20 hours over five days (4 a day), hired
	// 1 January 2018 (full-time grants: sick 14, annual 14 in the ninth year).
	//   Sick: 20 ÷ 44 × 14 × 8 = 50.91 hours ÷ 4 a day = 12.73 of their days → 13 (up to the half day).
	//   Annual: the same 12.73 → 13.
	// A full-timer on the same rows keeps 14 and 14.
	const pt = { hours: 20, days: 5 };
	assert.equal(
		entitlement('SG', SG_2026, 'SICK_LEAVE', 'PART_TIME', pt, '2018-01-01', '2026-07-01'),
		13
	);
	assert.equal(
		entitlement('SG', SG_2026, 'ANNUAL_LEAVE', 'PART_TIME', pt, '2018-01-01', '2026-07-01'),
		13
	);
	const ft = { hours: 44, days: 5.5 };
	assert.equal(
		entitlement('SG', SG_2026, 'SICK_LEAVE', 'PERMANENT', ft, '2018-01-01', '2026-07-01'),
		14
	);
	// 24 hours over three days (8 a day), sick: 24 ÷ 44 × 14 × 8 = 61.09 hours ÷ 8 = 7.64 → 8.
	const three = { hours: 24, days: 3 };
	assert.equal(
		entitlement('SG', SG_2026, 'SICK_LEAVE', 'PART_TIME', three, '2018-01-01', '2026-07-01'),
		8
	);
});

test('TW round 2 — a part-timer holds 特別休假 and sick leave by hours; the full-timer’s five days keep the §38 days', () => {
	// 三(三): part-timer's normal hours a year ÷ full-timer's × the §38 days; 三(四): weekly hours
	// ÷ 40 × days × 8 hours. Hired 1 January 2021: five years' service on 1 July 2026 → §38 15 days.
	//   20 hours over 2.5 days (8 a day): 20 ÷ 40 × 15 × 8 = 60 hours ÷ 8 = 7.5 days;
	//   sick: 20 ÷ 40 × 30 × 8 = 120 hours ÷ 8 = 15 days.
	//   20 hours over five days (4 a day) — the full-timer's days on shorter hours — keeps 15
	//   (the guideline's proviso): 20 ÷ 40 × 15 × 8 = 60 hours ÷ 4 = 15.
	const TW_2026 = '1fcfa66f-40da-5792-b925-7c2fcaa8f92c';
	const half = { hours: 20, days: 2.5 };
	const five = { hours: 20, days: 5 };
	assert.equal(
		entitlement('TW', TW_2026, 'ANNUAL_LEAVE', 'PART_TIME', half, '2021-01-01', '2026-07-01'),
		7.5
	);
	assert.equal(
		entitlement('TW', TW_2026, 'SICK_LEAVE', 'PART_TIME', half, '2021-01-01', '2026-07-01'),
		15
	);
	assert.equal(
		entitlement('TW', TW_2026, 'ANNUAL_LEAVE', 'PART_TIME', five, '2021-01-01', '2026-07-01'),
		15
	);
});

test('MY round 2 — a part-timer’s annual and sick leave are reg.7–8’s own ladders', () => {
	// reg.7(1): 6 days under two years, 8 from two to under five, 11 from five; reg.8(1): 10,
	// 13, 15. The windows are calendar years; a 1 January hire has whole years.
	const MY_2026 = 'b6d75df0-74b0-5e56-84c0-8be5ff398c0d';
	const week = { hours: 20, days: 5 };
	for (const [code, id] of [
		['MY', MY_2026],
		['MY-nihon', 'f65bb7cb-b8eb-563e-9ee3-fda47351ed31']
	] as const) {
		const at = (leave: string, hire: string) =>
			entitlement(code, id, leave, 'PART_TIME', week, hire, '2026-12-31');
		assert.deepEqual(
			[
				at('ANNUAL_LEAVE', '2025-01-01'),
				at('ANNUAL_LEAVE', '2023-01-01'),
				at('ANNUAL_LEAVE', '2020-01-01')
			],
			[6, 8, 11],
			code
		);
		assert.deepEqual(
			[
				at('MEDICAL_LEAVE', '2025-01-01'),
				at('MEDICAL_LEAVE', '2023-01-01'),
				at('MEDICAL_LEAVE', '2020-01-01')
			],
			[10, 13, 15],
			code
		);
	}
});
