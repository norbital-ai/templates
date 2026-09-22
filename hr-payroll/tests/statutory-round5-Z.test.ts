/**
 * Round 5 (Z) — Philippines: an earlier payslip's overtime/night-shift meal-allowance excess stays
 * in the ₱90,000 other-benefits pool for the rest of the year.
 *
 *   RR 11-2018 s.2.78.1(A)(3) closing paragraph, restated by RMC 50-2018: "benefits given in excess
 *     of the maximum amount allowed as de minimis benefits shall be included as part of 'other
 *     benefits,' which is subject to the P90,000 ceiling" — a ceiling on the year's total
 *     (NIRC s.32(B)(7)(e)), so every earlier payslip's excess is "earned before".
 *   RR 29-2025 s.1: the daily ceiling is 30% of the regional basic minimum wage from 6 January 2026.
 *
 * NCR (Wage Order NCR-26, ₱695 a day): 30% × 695 = ₱208.50 a qualifying day. ₱250 keyed on each of
 * three overtime days: 750 − 3 × 208.50 = ₱124.50 excess a month.
 *
 * Every expected figure is derived by hand here; none was read off an engine run.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const KEY = 'OTM';

type Month = {
	readonly period: string;
	readonly overtimeDates: readonly string[];
	readonly meal: number;
	readonly bonus?: number;
};

function plant(world: PayrollWorld, month: Month, index: number) {
	const employment = world.employments[0]!;
	const end = month.overtimeDates[0] ?? `${month.period.slice(0, 7)}-10`;
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= end &&
			String(row.effective_range.end).slice(0, 10) > end
	)!;
	const classId = (code: string) =>
		world.adhoc_catalogue!.find((row) => row.code === code && row.settings_id === version.id)!.id;
	for (const date of month.overtimeDates)
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
	const entries = [
		...(month.meal > 0
			? month.overtimeDates.map((date) => ({ date, amount: month.meal, code: 'OT_MEAL_ALLOWANCE' }))
			: []),
		...(month.bonus ? [{ date: end, amount: month.bonus, code: 'bonus' }] : [])
	];
	for (const [position, entry] of entries.entries())
		world.adhoc_requests!.push({
			id: `a5e00000-0000-4000-8${index}00-${String(position).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: classId(entry.code),
			amount: entry.amount,
			event_date: entry.date,
			pay_period: month.period,
			payslip_id: null,
			reason: entry.code,
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
}

/** Each month in turn, every earlier run and its payslips standing in the world as paid; the last's WTAX base. */
function chain(months: readonly Month[], semiMonthly = false): number {
	const settled: { run: object; slips: object[] }[] = [];
	let base = 0;
	for (const [index, month] of months.entries()) {
		const built = buildStatutory(
			{
				code: 'PH',
				period: month.period,
				region: 'NCR',
				payFrequency: semiMonthly ? 'SEMI_MONTHLY' : 'MONTHLY',
				people: [
					{
						key: KEY,
						wage: 30_000,
						tax_residency: 'RESIDENT',
						pay_frequency: semiMonthly ? 'SEMI_MONTHLY' : 'MONTHLY'
					}
				]
			},
			(world: PayrollWorld) => {
				plant(world, month, index);
				for (const { run, slips } of settled) {
					world.payroll_runs.push(run as never);
					world.payslips.push(...(slips as never[]));
				}
			}
		);
		const runId = `run-${month.period}`;
		settled.push({
			run: {
				id: runId,
				company_id: COMPANY_ID,
				period: month.period,
				lifecycle: 'PAID',
				calculation_trace: built.trace
			},
			slips: [...built.slips.values()].map((slip) => ({
				...slip,
				payroll_run_id: runId,
				status: 'PAID',
				paid_at: `${month.period.slice(0, 7)}-28T00:00:00.000Z`
			}))
		});
		base = built.slips.get(KEY)!.statutory.find((row) => row.scheme_code === 'WTAX')!.base_amount;
	}
	return base;
}

const cents = (value: number) => Math.round(value * 100) / 100;

const JANUARY = ['2026-01-13', '2026-01-14', '2026-01-15'];
const FEBRUARY = ['2026-02-03', '2026-02-04', '2026-02-05'];

test("PH WTAX 2026 NCR: January's ₱124.50 meal excess is earned before February's pool", () => {
	// January: bonus 89,800 + excess 124.50 = 89,924.50 of other benefits, all inside 90,000.
	// February: excess 124.50 against 90,000 − 89,924.50 = 75.50 of room → 124.50 − 75.50 = 49.00
	// taxable. (Reading January's bonus alone left 200 of room and taxed nothing.)
	const january: Month = { period: '2026-01', overtimeDates: JANUARY, meal: 250, bonus: 89_800 };
	const withMeals = chain([january, { period: '2026-02', overtimeDates: FEBRUARY, meal: 250 }]);
	const without = chain([january, { period: '2026-02', overtimeDates: FEBRUARY, meal: 0 }]);
	assert.equal(cents(withMeals - without), 49);
});

test('PH WTAX 2026 NCR: an earlier month under its daily ceiling adds nothing to the pool', () => {
	// January: ₱200 × 3 = 600 ≤ 3 × 208.50 = 625.50, no excess; bonus 89,800 leaves 200 of room.
	// February: excess 124.50 ≤ 200 → nothing taxable.
	const january: Month = { period: '2026-01', overtimeDates: JANUARY, meal: 200, bonus: 89_800 };
	const withMeals = chain([january, { period: '2026-02', overtimeDates: FEBRUARY, meal: 250 }]);
	const without = chain([january, { period: '2026-02', overtimeDates: FEBRUARY, meal: 0 }]);
	assert.equal(cents(withMeals - without), 0);
});

test("PH WTAX 2026 NCR semi-monthly: both January halves' excesses are earned before February's first half", () => {
	// January first half (Tue 13, Wed 14): 2 × 250 − 2 × 208.50 = 83.00, beside a bonus of 89,800.
	// January second half (Tue 20): 250 − 208.50 = 41.50. The year so far: 89,800 + 83 + 41.50 =
	// 89,924.50. February first half (Tue 3, Wed 4): excess 83.00 against 75.50 of room → 7.50.
	const januaryHalves: Month[] = [
		{ period: '2026-01-1', overtimeDates: ['2026-01-13', '2026-01-14'], meal: 250, bonus: 89_800 },
		{ period: '2026-01-2', overtimeDates: ['2026-01-20'], meal: 250 }
	];
	const FEB_FIRST = ['2026-02-03', '2026-02-04'];
	const withMeals = chain(
		[...januaryHalves, { period: '2026-02-1', overtimeDates: FEB_FIRST, meal: 250 }],
		true
	);
	const without = chain(
		[...januaryHalves, { period: '2026-02-1', overtimeDates: FEB_FIRST, meal: 0 }],
		true
	);
	assert.equal(cents(withMeals - without), 7.5);
});

test("PH WTAX 2026 NCR: September's excess keeps September's floor after NCR-28's ₱755", () => {
	// Wage Order NCR-28 raises the NCR floor from ₱695 to ₱755 on 26 September 2026; the versions
	// seed 695 × 313 ÷ 12 = 18,127.92 and 755 × 313 ÷ 12 = 19,692.92 a month.
	// September's salary window (1–30 September) has 25 days under NCR-26 and 5 under NCR-28, so its
	// floor — the one its own payslip's ceiling was computed at — is day-weighted:
	//   (25 × 18,127.92 + 5 × 19,692.92) ÷ 30 = (453,198.00 + 98,464.60) ÷ 30 = 18,388.7533;
	//   daily ceiling 30% × 18,388.7533 × 12 ÷ 313 = 30% × 705.00 = ₱211.50.
	// ₱250 on Tue 8, Wed 9, Thu 10 → excess 750 − 3 × 211.50 = 750 − 634.50 = 115.50, beside a bonus
	// of 89,800: 89,915.50 of other benefits, all exempt.
	// October (wholly NCR-28): a ₱200 bonus against 90,000 − 89,915.50 = 84.50 of room → 115.50
	// taxable. Re-measured at October's 30% × 755 = 226.50 a day, September's excess would read
	// 750 − 679.50 = 70.50, leaving 129.50 of room and taxing only 70.50 — the under-withholding
	// this closes.
	const september: Month = {
		period: '2026-09',
		overtimeDates: ['2026-09-08', '2026-09-09', '2026-09-10'],
		meal: 250,
		bonus: 89_800
	};
	const withBonus = chain([
		september,
		{ period: '2026-10', overtimeDates: [], meal: 0, bonus: 200 }
	]);
	const without = chain([september, { period: '2026-10', overtimeDates: [], meal: 0 }]);
	assert.equal(cents(withBonus - without), 115.5);
});

test("PH WTAX 2026 NCR: August's excess keeps NCR-26's ₱208.50 a day in October", () => {
	// August (1–31 August, wholly NCR-26): 30% × 695 = 208.50 a day → 750 − 625.50 = 124.50 excess,
	// beside a bonus of 89,800 → 89,924.50. October: a ₱200 bonus against 75.50 of room → 124.50.
	const august: Month = {
		period: '2026-08',
		overtimeDates: ['2026-08-04', '2026-08-05', '2026-08-06'],
		meal: 250,
		bonus: 89_800
	};
	const withBonus = chain([august, { period: '2026-10', overtimeDates: [], meal: 0, bonus: 200 }]);
	const without = chain([august, { period: '2026-10', overtimeDates: [], meal: 0 }]);
	assert.equal(cents(withBonus - without), 124.5);
});
