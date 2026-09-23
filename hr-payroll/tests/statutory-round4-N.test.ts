/**
 * Round 4, letter N — the PH 365 factor is a contract fact, and RA 9504's exemption follows the
 * days on which the employee is a minimum-wage earner.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   DOLE Handbook on Workers' Statutory Monetary Benefits (2023) ch.2 §D: "Monthly-paid employees
 *     are those who are paid every day of the month, including unworked rest days, special days,
 *     and regular holidays. Factor 365 …"; daily-paid are paid for days worked and unworked regular
 *     holidays (313 on a six-day week, 261 on five). `employment_terms.paid_rest_days` states it.
 *   RR 11-2018 s.2.78.1(B)(13) / RR 10-2008: the MWE's statutory minimum wage, holiday, overtime and
 *     night-shift pay are exempt; the SMW is "the rate fixed by the RTWPB", from the wage order's
 *     effective date — Wage Order NCR-26 ₱695 a day, NCR-28 ₱755 from 26 September 2026.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { assessStatutory, settingsVersions } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { ordinaryDivisorDays } from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { priceWorkDay } from '../src/lib/payroll/work-bands.ts';

const person = (paid_rest_days: boolean, payroll_group: string | null = null) =>
	personContext({
		employee: null,
		employment: { service_start: '2020-01-01' },
		terms: { base_salary: { value: 30_000, currency: 'PHP' }, paid_rest_days, payroll_group },
		week: { ordinary_hours_per_week: 40, working_days_per_week: 5 },
		asOf: '2026-06-30'
	});

test('PH — the 365 factor is the contract’s paid_rest_days, never the payroll group’s label', () => {
	for (const version of settingsVersions('PH')) {
		const divisor = (paid: boolean, group: string | null) =>
			ordinaryDivisorDays({
				expression: version.work_rules.ordinary_divisor_days,
				person: person(paid, group)
			});
		// Paid every day of the month: 365 ÷ 12 = 30.4167 days a month.
		assert.equal(divisor(true, null), 365 / 12);
		// A group called MONTHLY on a five-day daily-paid contract is still 261 ÷ 12 = 21.75.
		assert.equal(divisor(false, 'MONTHLY'), 261 / 12);
		// Rest day, first eight hours, on an hourly rate of 100: the 365-factor salary already pays
		// the day at 100%, so the row adds 30% → 8 × 100 × 0.3 = 240; everyone else is paid nothing
		// for the rest day and the row carries the whole 130% → 8 × 100 × 1.3 = 1,040.
		const rest = (paid: boolean) =>
			priceWorkDay({
				work: version.work_rules,
				person: person(paid, 'MONTHLY'),
				day: {
					workDayId: 'd',
					date: '2026-06-14',
					dayType: 'REST_DAY',
					workedHours: 8,
					normalHours: 8,
					overtimeHours: 8,
					breakMinutes: 60,
					holidayKind: '',
					holidayName: '',
					consecutiveHours: 4,
					continuousAttendance: false
				},
				rates: { ordinaryHour: 100, ordinaryDay: 800, dayWage: 800 }
			}).map((row) => Math.round(row.amount * 100) / 100);
		assert.deepEqual(rest(true), [240]);
		assert.deepEqual(rest(false), [1040]);
	}
});

// A payroll group is an employer's own label, so no statute is read from it. The one reading
// allowed is MY-nihon's `ordinary_divisor_days`: company terms, not law — the customer's hourly
// rate is basic × 12 ÷ (52 × 45) for payroll group 6D and ÷ (52 × 42.5) for 5D (owner-approved
// customer pricing, 2026-09-23; the lineage's authority). Anywhere else in any lineage it fails.
test('no lineage reads payroll_group for statutory meaning', () => {
	const root = fileURLToPath(new URL('../seed/jurisdiction/', import.meta.url));
	const offenders: string[] = [];
	for (const lineage of readdirSync(root))
		for (const file of readdirSync(`${root}${lineage}`)) {
			const path = `${root}${lineage}/${file}`;
			if (!file.endsWith('.json') && !file.endsWith('.json.gz')) continue;
			const text = file.endsWith('.gz')
				? gunzipSync(readFileSync(path)).toString('utf8')
				: readFileSync(path, 'utf8');
			const read =
				lineage === 'MY-nihon' && file === 'jurisdiction_settings.json'
					? JSON.stringify(
							JSON.parse(text).map((version: { work_rules: Record<string, unknown> }) => ({
								...version,
								work_rules: { ...version.work_rules, ordinary_divisor_days: null }
							}))
						)
					: text;
			if (read.includes('payroll_group')) offenders.push(`${lineage}/${file}`);
		}
	assert.deepEqual(offenders, []);
});

/** A punch from `start` to `end` on `date`, in Manila's +08:00 frame. */
const punch = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		// `assessStatutory` keys no clock overrun: the employer's approval is stated here.
		approved_overtime_hours: 3,
		requested_by: null,
		approval_id: null
	});
};

test('PH — September 2026 NCR: a ₱720 daily rate is taxed 1–25 September and exempt 26–30, overtime by its own date', () => {
	// Fixture: NCR, Mon–Fri, full attendance, paid per day. September 2026 opens on a Tuesday:
	// weekdays 1–25 are 4 + 5 + 5 + 5 = 19, 28–30 are 3. ₱720 × 21.75 = 15,660 a month is above
	// NCR-26's 695 × 21.75 = 15,116.25 (taxed, 1–25) and at or below NCR-28's 755 × 21.75 = 16,421.25
	// (exempt, 26–30). Basic taxed: 19 × 720 = 13,680.
	//
	// Overtime: 08:00–20:00 less the hour's meal is eleven hours, three beyond eight, at
	// 720 ÷ 8 = 90 × 1.25 (art.87) = 3 × 112.50 = 337.50. On Tuesday 15 September — a taxed day — it
	// is taxed: 13,680 + 337.50 = 14,017.50. On Monday 28 September — an MWE day — it is exempt.
	const wtaxBase = (date: string) =>
		assessStatutory(
			{
				code: 'PH',
				period: '2026-09',
				region: 'NCR',
				people: [{ key: 'NCR-720', wage: 720, pay_frequency: 'DAILY' }]
			},
			(world) => punch(world, 'NCR-720', date, '08:00', '20:00')
		)
			.get('NCR-720')!
			.get('WTAX')?.base;
	assert.equal(wtaxBase('2026-09-15'), 14_017.5);
	assert.equal(wtaxBase('2026-09-28'), 13_680);
});

test('PH — a monthly salary splits by paid days: ₱16,000 in September 2026 is taxed on 19 of 22', () => {
	// ₱16,000 a month on the 261 factor is above NCR-26's 15,116.25 and at or below NCR-28's
	// 16,421.25. The salary accrues over the 22 scheduled working days: 3 of them (28–30) are MWE
	// days → exempt 16,000 × 3 ÷ 22 = 2,181.82; taxed 16,000 × 19 ÷ 22 = 13,818.18.
	const book = assessStatutory({
		code: 'PH',
		period: '2026-09',
		region: 'NCR',
		people: [{ key: 'PH-16000', wage: 16_000 }]
	});
	assert.equal(book.get('PH-16000')!.get('WTAX')?.base, 13_818.18);
});
