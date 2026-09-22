/**
 * Round 3, letter J — pay for 休息日 hours beyond the §32(2) month is taxable salary.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   所得稅法 §14(1)三(2) proviso: overtime pay within the prescribed standard is outside 薪資所得.
 *   財政部 74.05.29 台財稅第16713號 (https://law-out.mof.gov.tw/LawContent.aspx?id=GL005371):
 *     item 2 — overtime paid within 勞基法 §24 rates and the §32 monthly total is exempt;
 *     item 3 — 國定假日/例假日/特別休假日 work pay within the standard is exempt and its hours are NOT
 *     counted in the monthly total. 臺北國稅局 FAQ (https://www.ntbt.gov.tw/singlehtml/
 *     0baa381b53034993a08862dfde2243b9?cntId=58f23c9380ef4d4e8f54a9ec4b5e7755): 49 weekday hours
 *     → 46 exempt, the 3 beyond taxed.
 *   財政部臺北國稅局 109.01.22 財北國稅審二字第1090002888號: 休息日 hours count toward the monthly
 *     total under 勞基法 §36(3); their pay is exempt only within the §24/§32 limits.
 *   勞基法 §36(3) (https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=36).
 *
 * Neither instrument orders the hours within a month; the funnel fills the month in the order the
 * hours were worked, so the hours past the 46th are the last ones worked.
 *
 * Fixture: 45,000 a month → 45,000 ÷ 30 ÷ 8 = 187.5 an hour; §24 4/3 = 250, 5/3 = 312.5. The normal day
 * is 09:00–18:00 less a one-hour break; Saturday is the 休息日. January 2026 opens on a Thursday.
 * The 5% withholding election (薪資所得扣繳辦法 §6–7) withholds 5% of taxable salary, whole dollars,
 * once it reaches NT$2,000 — so the salary is above 40,000.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const KEY = 'TW-45000';

const punch = (world: PayrollWorld, date: string, intervals: readonly [string, string][]) => {
	const employment = world.employments.find((row) => row.employee_number === KEY)!;
	world.work_days.push({
		id: `wd-${KEY}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: intervals.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${date}T${end}:00+08:00`
		})),
		requested_by: null,
		emergency_cause: null,
		time_off_in_lieu: null,
		approval_id: null
	});
};

const WEEKDAYS = ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16'];

const run = (saturday: string, consent = false) => {
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			companyFacts: consent ? { overtime_consent: true } : {},
			people: [
				{
					key: KEY,
					wage: 45_000,
					citizenship: 'CITIZEN',
					registrations: {
						INCOME_TAX: { kind: 'REGISTERED', elections: { five_percent_withholding: true } }
					}
				}
			]
		},
		(world) => {
			// Ten weekdays 09:00–22:00 less the one-hour break: 12 worked, 4 extended — 40 in all.
			for (const day of WEEKDAYS) punch(world, `2026-01-${day}`, [['09:00', '22:00']]);
			// A 休息日 of 10 hours in three runs under four hours (no §35 break owed): 3.5 + 3.5 + 3.
			punch(world, `2026-01-${saturday}`, [
				['08:00', '11:30'],
				['12:00', '15:30'],
				['16:00', '19:00']
			]);
		}
	);
	const slip = slips.get(KEY)!;
	const tax = slip.statutory.find((row) => row.scheme_code === 'INCOME_TAX')!;
	const incentive = slip.adjustments.filter(
		(row) =>
			row.family === 'WORK_DAY' && String(row.statutory_rule_key ?? '').startsWith('INCENTIVE:')
	);
	return { slip, tax: [tax.base_amount, tax.employee_amount] as const, incentive };
};

test('Taiwan round 3 J — 40 weekday hours then 10 休息日 hours: the 休息日’s last 4 hours are taxable', () => {
	const { tax, incentive } = run('17');
	// 40 + 10 = 50 against 46: the 47th–50th hours are the 休息日’s 7th–10th, all past its second
	// hour, so at 5/3: 4 × 312.5 = 1,250 taxable.
	assert.deepEqual(
		incentive.map((row) => [row.source_id.slice(-10), row.quantity, row.amount]),
		[['2026-01-17', 4, 1250]]
	);
	// (45,000 + 1,250) × 5% = 2,312.5 → 2,312.
	assert.deepEqual(tax, [46_250, 2312]);
});

test('Taiwan round 3 J — a 休息日 early in the month fills the 46 first; the last weekday’s hours go over', () => {
	const { tax, incentive } = run('10');
	// In order worked: 5th–9th 20, the 10th 10 → 30, 12th–15th 16 → 46; the 16th’s 4 extended hours
	// are beyond: 2 × 250 + 2 × 312.5 = 1,125 taxable.
	assert.deepEqual(
		incentive.map((row) => [row.source_id.slice(-10), row.quantity, row.amount]),
		[
			['2026-01-16', 2, 500],
			['2026-01-16', 2, 625]
		]
	);
	// (45,000 + 1,125) × 5% = 2,306.25 → 2,306.
	assert.deepEqual(tax, [46_125, 2306]);
});

test('Taiwan round 3 J — with §32(2) consent the same 50 hours sit inside 54 and stay exempt', () => {
	const { tax, incentive } = run('17', true);
	assert.deepEqual(incentive, []);
	// 45,000 × 5% = 2,250.
	assert.deepEqual(tax, [45_000, 2250]);
});
