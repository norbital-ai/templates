/**
 * Round 5 (V) — Philippines: the overtime/night-shift meal allowance is de minimis to a daily
 * ceiling; the ceiling bounds the exemption, never the pay.
 *
 *   RR 2-98 s.2.78.1(A)(3)(j) as amended by RR 11-2018: "Daily meal allowance for overtime work and
 *     night/graveyard shift not exceeding twenty-five percent (25%) of the basic minimum wage on a
 *     per region basis"; RR 29-2025 s.1 (dated 27 October 2025, received on the BIR website
 *     22 December 2025, in force fifteen days later, s.3 — 6 January 2026): "thirty percent (30%)".
 *     https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf
 *   RR 11-2018 s.2.78.1(A)(3) closing paragraph, restated by RMC 50-2018: "benefits given in excess
 *     of the maximum amount allowed as de minimis benefits shall be included as part of 'other
 *     benefits,' which is subject to the P90,000 ceiling".
 *
 * NCR floor in every 2026-02 version: Wage Order NCR-26, ₱695 a day, seeded as 695 × 313 ÷ 12 =
 * 18,127.92 a month. Daily ceiling from 6 January 2026: 30% × 18,127.92 × 12 ÷ 313 = 30% × 695.00
 * = ₱208.50 (the monthly figure's cent rounding moves it by less than ₱0.0001).
 *
 * Every expected figure is derived by hand here; none was read off an engine run.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const KEY = 'OTM';

type Scenario = {
	readonly period: string;
	readonly semiMonthly?: boolean;
	/** Weekdays punched 08:00–20:00: eleven hours after the hour's meal, three of them overtime. */
	readonly overtimeDates: readonly string[];
	/** Weekdays punched 14:00–23:00 with no overtime approved: an hour inside the 22:00–06:00 window. */
	readonly nightDates?: readonly string[];
	readonly meals: readonly { readonly date: string; readonly amount: number }[];
	/** A ₱90,000 bonus fills the other-benefits pool, so any excess in it is taxed. */
	readonly fullPool?: boolean;
};

function run(scenario: Scenario) {
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: scenario.period,
			region: 'NCR',
			payFrequency: scenario.semiMonthly ? 'SEMI_MONTHLY' : 'MONTHLY',
			people: [
				{
					key: KEY,
					wage: 30_000,
					tax_residency: 'RESIDENT',
					pay_frequency: scenario.semiMonthly ? 'SEMI_MONTHLY' : 'MONTHLY'
				}
			]
		},
		(world: PayrollWorld) => {
			const employment = world.employments[0]!;
			const end =
				scenario.meals[0]?.date ?? scenario.overtimeDates[0] ?? `${scenario.period.slice(0, 7)}-10`;
			const version = world.jurisdiction_settings.find(
				(row) =>
					String(row.effective_range.start).slice(0, 10) <= end &&
					String(row.effective_range.end).slice(0, 10) > end
			)!;
			const classId = (code: string) =>
				world.adhoc_catalogue!.find((row) => row.code === code && row.settings_id === version.id)!
					.id;
			for (const date of scenario.overtimeDates)
				world.work_days.push({
					id: `wd-${date}`,
					employment_id: employment.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [{ start: `${date}T08:00:00+08:00`, end: `${date}T20:00:00+08:00` }],
					approved_overtime_hours: 3,
					requested_by: null,
					approval_id: null
				});
			for (const date of scenario.nightDates ?? [])
				world.work_days.push({
					id: `wd-night-${date}`,
					employment_id: employment.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [{ start: `${date}T14:00:00+08:00`, end: `${date}T23:00:00+08:00` }],
					approved_overtime_hours: 0,
					requested_by: null,
					approval_id: null
				});
			const entries = [
				...scenario.meals.map((meal) => ({ ...meal, code: 'OT_MEAL_ALLOWANCE' })),
				...(scenario.fullPool ? [{ date: end, amount: 90_000, code: 'bonus' }] : [])
			];
			for (const [index, entry] of entries.entries())
				world.adhoc_requests!.push({
					id: `a5e00000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: classId(entry.code),
					amount: entry.amount,
					event_date: entry.date,
					pay_period: scenario.period,
					payslip_id: null,
					reason: entry.code,
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	const slip = slips.get(KEY)!;
	return {
		meals: slip.adjustments
			.filter((row) => row.component_code === 'OT_MEAL_ALLOWANCE')
			.reduce((sum, row) => sum + row.amount, 0),
		base: slip.statutory.find((row) => row.scheme_code === 'WTAX')!.base_amount
	};
}

const cents = (value: number) => Math.round(value * 100) / 100;

// 2026-02 (monthly, window 21 January – 20 February): Tue 3, Wed 4, Thu 5 February.
const THREE_DAYS = ['2026-02-03', '2026-02-04', '2026-02-05'];
const meals = (dates: readonly string[], amount: number) => dates.map((date) => ({ date, amount }));

test('PH OT meal 2026-02 NCR: ₱250 keyed on each of three overtime days is paid whole — ₱750', () => {
	// The ceiling bounds the exemption, not the pay: 3 × 250 = 750 reaches the payslip.
	assert.equal(
		run({ period: '2026-02', overtimeDates: THREE_DAYS, meals: meals(THREE_DAYS, 250) }).meals,
		750
	);
});

test('PH OT meal 2026-02 NCR: 3 × ₱208.50 exempt, the ₱124.50 excess taxed once the ₱90,000 pool is full', () => {
	const without = run({ period: '2026-02', overtimeDates: THREE_DAYS, meals: [], fullPool: true });
	const withMeals = run({
		period: '2026-02',
		overtimeDates: THREE_DAYS,
		meals: meals(THREE_DAYS, 250),
		fullPool: true
	});
	// 750 − 3 × 208.50 = 750 − 625.50 = 124.50 enters the pool the bonus already filled.
	assert.equal(cents(withMeals.base - without.base), 124.5);
});

test('PH OT meal 2026-02 NCR: the excess sits inside the ₱90,000 pool while the pool has room', () => {
	const without = run({ period: '2026-02', overtimeDates: THREE_DAYS, meals: [] });
	const withMeals = run({
		period: '2026-02',
		overtimeDates: THREE_DAYS,
		meals: meals(THREE_DAYS, 250)
	});
	// 124.50 of other benefits ≤ 90,000: nothing taxable.
	assert.equal(cents(withMeals.base - without.base), 0);
});

test('PH OT meal 2026-02 NCR: ₱200 a day is under the ₱208.50 ceiling, wholly exempt', () => {
	const without = run({ period: '2026-02', overtimeDates: THREE_DAYS, meals: [], fullPool: true });
	const withMeals = run({
		period: '2026-02',
		overtimeDates: THREE_DAYS,
		meals: meals(THREE_DAYS, 200),
		fullPool: true
	});
	// 600 ≤ 3 × 208.50 = 625.50.
	assert.equal(cents(withMeals.base - without.base), 0);
});

test('PH OT meal 2026-02 NCR: a meal allowance with no overtime or night day has no exemption', () => {
	const without = run({ period: '2026-02', overtimeDates: [], meals: [], fullPool: true });
	const withMeals = run({
		period: '2026-02',
		overtimeDates: [],
		meals: meals(THREE_DAYS, 250),
		fullPool: true
	});
	// 0 qualifying days → 0 exempt; all 750 is an other benefit over the full pool.
	assert.equal(cents(withMeals.base - without.base), 750);
});

test('PH OT meal 2026-02 NCR semi-monthly: each half exempts its own overtime days', () => {
	// First half (Tue 3, Wed 4 February): 2 × 250 = 500 − 2 × 208.50 = 83.00 taxed over the full pool.
	// Second half (Tue 17 February): 250 − 208.50 = 41.50. Together 124.50, the month's figure.
	const FIRST = ['2026-02-03', '2026-02-04'];
	const SECOND = ['2026-02-17'];
	const half = (period: string, dates: readonly string[]) => {
		const without = run({
			period,
			semiMonthly: true,
			overtimeDates: dates,
			meals: [],
			fullPool: true
		});
		const withMeals = run({
			period,
			semiMonthly: true,
			overtimeDates: dates,
			meals: meals(dates, 250),
			fullPool: true
		});
		assert.equal(withMeals.meals, 250 * dates.length);
		return cents(withMeals.base - without.base);
	};
	assert.equal(half('2026-02-1', FIRST), 83);
	assert.equal(half('2026-02-2', SECOND), 41.5);
});

test('PH OT meal 2026-02 NCR: a night-shift day with no overtime is a qualifying day too', () => {
	// (j) covers "overtime work and night/graveyard shift": Mon 9 February worked 14:00–23:00 carries
	// an hour inside the night window. 250 − 208.50 = 41.50 over the full pool.
	const NIGHT = ['2026-02-09'];
	const without = run({
		period: '2026-02',
		overtimeDates: [],
		nightDates: NIGHT,
		meals: [],
		fullPool: true
	});
	const withMeals = run({
		period: '2026-02',
		overtimeDates: [],
		nightDates: NIGHT,
		meals: meals(NIGHT, 250),
		fullPool: true
	});
	assert.equal(cents(withMeals.base - without.base), 41.5);
});
