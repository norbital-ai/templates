/**
 * Round 2, letter B: earnings history on the person.
 *
 * - MY / MY-nihon termination benefit on the wages actually paid (Termination and Lay-Off Benefits
 *   Regulations 1980 reg.6(2), EA s.2 wages).
 * - TW 平均工資 from the payslips, the 施行細則 §2 periods left out (勞基法 §2(4); 勞動部
 *   台(83)勞動二字第25564號 for the month).
 * - ID THR of a daily-paid worker on the average wage received (Permenaker 6/2016 art.3(3)–(4)).
 * - ID BPJS wage of a daily-paid worker: the day × 25 (PP 44/2015 art.19(3), PP 46/2015 art.17(3)).
 * - MY s.60E(3B): unpaid leave over thirty days in twelve months is out of the leave ladder's service.
 *
 * Every figure is derived by hand in the comment beside it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutoryUnvalidated,
	buildStatutory,
	chargeOf,
	leaveCatalogue,
	settingsVersions,
	type Lineage
} from './fixtures/statutory-world.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { grantedDays } from '../src/lib/leave/entitlement.ts';

/** The version of a lineage in force on a day. */
const versionOn = (code: Lineage, day: string) =>
	settingsVersions(code).find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= day &&
			(row.effective_range.end == null || String(row.effective_range.end).slice(0, 10) > day)
	)!;

/** One ad hoc request of the class `code` of the version in force on `day`. */
function raise(world: PayrollWorld, code: Lineage, key: string, catalogue: string, day: string) {
	const version = versionOn(code, day);
	const row = world.adhoc_catalogue!.find(
		(entry) => entry.code === catalogue && entry.settings_id === version.id
	)!;
	const employment = world.employments.find((entry) => entry.employee_number === key)!;
	world.adhoc_requests!.push({
		id: `d8000000-0000-4000-8000-${String(world.adhoc_requests!.length).padStart(12, '0')}`,
		employment_id: employment.id,
		catalogue_id: row.id,
		amount: 0,
		event_date: day,
		pay_period: day.slice(0, 7),
		payslip_id: null,
		reason: catalogue,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
}

/** Add lines to the earlier payslip `priorWages` wrote for that month. */
function addLines(
	world: PayrollWorld,
	month: string,
	lines: readonly {
		family: string;
		code: string;
		bucket: string;
		amount: number;
		quantity?: number;
	}[]
) {
	const slip = world.payslips.find((row) => row.payroll_run_id === `prior-wages-${month}`)!;
	for (const [index, line] of lines.entries())
		(slip.adjustments as unknown[]).push({
			family: line.family,
			source_id: `d9000000-0000-4000-8000-${month.replace('-', '')}0000${index}`,
			component_code: line.code,
			label: line.code,
			bucket: line.bucket,
			amount: line.amount,
			quantity: line.quantity ?? null,
			rate: null,
			statutory_rule_key: null
		});
}

const paidLine = (
	slip: { adjustments: readonly { component_code: string; amount: number }[] },
	code: string
) => slip.adjustments.find((row) => row.component_code === code)?.amount;

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — the termination benefit's day is twelve months' wages paid ÷ 365 (reg.6(2))`, () => {
		// Hired 15 May 2023, made redundant 31 January 2026: 993 days ≈ 32.6 months → 33 to the
		// nearest month (reg.6(1)), two years or more → fifteen days a year: 15 × 33/12 = 41.25 days.
		// reg.6(2): "wages" is s.2(1) — basic plus every cash payment for work done, overtime in, an
		// annual bonus out — over the twelve completed months before the relevant date, January to
		// December 2025 here: 12 × 3,000 = 36,000, overtime 4 × 400 = 1,600, a no-pay deduction of 300
		// in July, the December bonus of 3,000 not wages. 36,000 + 1,600 − 300 = 37,300.
		// A day: 37,300 ÷ 365 = 102.191781. Benefit: 41.25 × 102.191781 = 4,215.410959 → 4,215.41.
		// On the contract wage alone (3,000 × 12 ÷ 365 × 41.25) it would have been 4,068.49.
		const run = (prepare: (world: PayrollWorld) => void) =>
			buildStatutory(
				{
					code,
					period: '2026-01',
					people: [
						{
							key: 'LEAVER',
							wage: 3000,
							citizenship: 'CITIZEN',
							registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } },
							hire_date: '2023-05-15',
							exit_date: '2026-01-31',
							exit_reason: 'REDUNDANCY'
						}
					]
				},
				(world) => {
					prepare(world);
					raise(world, code, 'LEAVER', 'TERMINATION_BENEFIT', '2026-01-31');
				}
			).slips.get('LEAVER')!;
		const history = (world: PayrollWorld) => {
			priorWages(world, 'LEAVER', monthsAt('2025-01', '2025-12', 3000));
			for (const month of ['2025-03', '2025-06', '2025-09', '2025-12'])
				addLines(world, month, [
					{ family: 'WORK_DAY', code: 'OVERTIME', bucket: 'EARNING', amount: 400 }
				]);
			addLines(world, '2025-07', [
				{ family: 'LEAVE', code: 'UNPAID_LEAVE', bucket: 'ABSENCE', amount: 300, quantity: 3 }
			]);
			addLines(world, '2025-12', [
				{ family: 'ADHOC', code: 'BONUS', bucket: 'EARNING', amount: 3000 }
			]);
		};
		assert.equal(paidLine(run(history), 'TERMINATION_BENEFIT'), 4215.41);
		// Months paid outside the workspace are stated on the departure: wages_12m 36,500 → a day of
		// 100.00 → 41.25 × 100 = 4,125.00.
		assert.equal(
			paidLine(
				run((world) => {
					const row = world.employments[0] as { exit_facts?: Record<string, unknown> };
					row.exit_facts = { ...row.exit_facts, wages_12m: 36_500 };
				}),
				'TERMINATION_BENEFIT'
			),
			4125
		);
		// Neither: the contract wage is not a stand-in for wages the law reads as paid.
		assert.throws(() => run(() => {}), /Earned monthly average needs the wages paid for 2025-12/);
	});

test('TW — 平均工資 is six months’ wages paid, the 施行細則 §2 sick days left out (勞基法 §2(4))', () => {
	// Hired 1 Feb 2019, laid off 31 Jan 2026 (exit reason REDUNDANCY): 84 months → 勞退條例 §12(1)
	// half a month a year = 0.5 × 7 = 3.5 months.
	// The six months before January 2026: Jul 31, Aug 31, Sep 30, Oct 31, Nov 30, Dec 31 = 184 days.
	// Wages 60,000 a month; overtime 3,000 in August and November; October carries four days of
	// 普通傷病假 at half pay — a 4,000 deduction — which §2(5) leaves out, days and wages both.
	// October's other 27 days at the full-pay rate: (56,000 + 4,000) × 27/31 = 52,258.064516.
	// Jul 60,000 + Aug 63,000 + Sep 60,000 + Nov 63,000 + Dec 60,000 = 306,000 over 153 days.
	// Daily: (306,000 + 52,258.064516) ÷ (153 + 27) = 358,258.064516 ÷ 180 = 1,990.322581.
	// A month (台(83)勞動二字第25564號): the day × the period's average days, 184 ÷ 6 = 30.666667 —
	// 1,990.322581 × 30.666667 = 61,036.559140. Severance: 3.5 × 61,036.559140 = 213,627.957 →
	// 213,628. Read off the contract (60,000) it would have been 210,000.
	const { slips } = buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [
				{
					key: 'TW-LEAVER',
					wage: 60_000,
					citizenship: 'CITIZEN',
					hire_date: '2019-02-01',
					exit_date: '2026-01-31',
					exit_reason: 'REDUNDANCY'
				}
			]
		},
		(world) => {
			priorWages(world, 'TW-LEAVER', monthsAt('2025-07', '2025-12', 60_000));
			for (const month of ['2025-08', '2025-11'])
				addLines(world, month, [
					{ family: 'WORK_DAY', code: 'OVERTIME', bucket: 'EARNING', amount: 3000 }
				]);
			addLines(world, '2025-10', [
				{ family: 'LEAVE', code: 'SICK_LEAVE', bucket: 'ABSENCE', amount: 4000, quantity: 4 }
			]);
			// The leave itself, Monday 13 – Thursday 16 October: §2 leaves out the days it spans.
			const sick = leaveCatalogue('TW').find(
				(row) => row.code === 'SICK_LEAVE' && row.settings_id === settingsVersions('TW')[0]!.id
			)!;
			world.leave_catalogue.push({ ...sick, approval_id: null } as never);
			world.leave_entries.push({
				id: 'd9000000-0000-4000-8000-00000000510c',
				employment_id: world.employments[0]!.id,
				catalogue_id: sick.id,
				leave_code: 'SICK_LEAVE',
				reference: 'SICK-2025-10',
				from_date: '2025-10-13',
				to_date: '2025-10-16',
				half_day_start: false,
				half_day_end: false,
				days: 4,
				encash_days: null,
				as_adjustment_entry: false,
				reversal_of_id: null,
				effective_on: '2025-10-13',
				charges: ['13', '14', '15', '16'].map((day) => ({
					date: `2025-10-${day}`,
					days: 1,
					catalogue_id: sick.id,
					employment_term_id: world.employment_terms[0]!.id,
					holiday_id: null,
					shift_definition_id: null,
					work_day_id: null
				})),
				allocations: [],
				approval_id: null,
				payslip_id: 'settled'
			} as never);
			raise(world, 'TW', 'TW-LEAVER', 'SEVERANCE_PAY', '2026-01-31');
		}
	);
	assert.equal(paidLine(slips.get('TW-LEAVER')!, 'SEVERANCE_PAY'), 213_628);
});

test('ID — a daily-paid worker’s THR is the average monthly wage received (Permenaker 6/2016 art.3(3)–(4))', () => {
	// Hired 10 June 2025 on 200,000 a day; THR for Idulfitri raised 13 March 2026: 9 completed months
	// → 9/12 of one month's wage (art.3(1)(b)). Under twelve months, one month's wage is the average
	// received each month of service (art.3(4)): June 2025 covers 21 of its 30 days (0.7 of a month)
	// and paid 3,000,000; July 2025 – February 2026 paid 4,400,000, 4,200,000, 4,400,000, 4,600,000,
	// 4,000,000, 4,400,000, 4,200,000 and 3,800,000 = 34,000,000.
	// Average: 37,000,000 ÷ 8.7 = 4,252,873.563218. THR: × 0.75 = 3,189,655.172414 → 3,189,655.17.
	const paid = [
		4_400_000, 4_200_000, 4_400_000, 4_600_000, 4_000_000, 4_400_000, 4_200_000, 3_800_000
	];
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-03',
			region: 'DKI Jakarta',
			riskClass: 'II',
			people: [
				{
					key: 'ID-DAILY',
					wage: 200_000,
					pay_frequency: 'DAILY',
					religion: 'ISLAM',
					hire_date: '2025-06-10'
				}
			]
		},
		(world) => {
			const months = Object.keys(monthsAt('2025-07', '2026-02', 0));
			priorWages(world, 'ID-DAILY', {
				'2025-06': 3_000_000,
				...Object.fromEntries(months.map((month, index) => [month, paid[index]!]))
			});
			raise(world, 'ID', 'ID-DAILY', 'THR', '2026-03-13');
		}
	);
	assert.equal(paidLine(slips.get('ID-DAILY')!, 'THR'), 3_189_655.17);
});

test('ID — BPJS reads a daily wage as the day × 25 whatever days were paid (PP 44/2015 art.19(3), PP 46/2015 art.17(3))', () => {
	// 200,000 a day × 25 = 5,000,000. JHT (PP 46/2015 art.16): 2% = 100,000, 3.7% = 185,000.
	// JKM (PP 44/2015 art.18(1)): 0.30% = 15,000. JKK group II (art.16(1)(b)): 0.54% = 27,000.
	// JP (PP 45/2015 art.29(1)) has no daily rule: the month's wage as paid, which is not 5,000,000.
	const book = assessStatutoryUnvalidated({
		code: 'ID',
		period: '2026-04',
		region: 'DKI Jakarta',
		riskClass: 'II',
		people: [{ key: 'ID-DAILY', wage: 200_000, pay_frequency: 'DAILY', age: 40 }]
	});
	const jht = chargeOf(book, 'ID-DAILY', 'JHT');
	assert.deepEqual([jht.base, jht.employee, jht.employer], [5_000_000, 100_000, 185_000]);
	assert.equal(chargeOf(book, 'ID-DAILY', 'JKM').employer, 15_000);
	assert.equal(chargeOf(book, 'ID-DAILY', 'JKK').employer, 27_000);
	assert.notEqual(chargeOf(book, 'ID-DAILY', 'JP').base, 5_000_000);
});

for (const code of ['MY', 'MY-nihon'] as const)
	test(`${code} — unpaid leave over thirty days in twelve months is out of the annual-leave service (s.60E(3B))`, () => {
		const rule = leaveCatalogue(code).find(
			(row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === versionOn(code, '2026-01-15').id
		)!.entitlement;
		const person = (spans: { code: string; from: string; to: string }[]) =>
			personContext({
				employee: null,
				employment: { service_start: '2021-01-01' },
				terms: null,
				leaveSpans: spans,
				asOf: '2026-01-15'
			});
		const unpaid = (from: string, to: string) => ({ code: 'UNPAID_LEAVE', from, to });
		// 1 Jan 2021 – 15 Jan 2026: 60 completed months → five years or more, 16 days (s.60E(1)(c)).
		assert.equal(grantedDays(rule, person([])), 16);
		// 1 Mar – 15 Apr 2023 = 31 + 15 = 46 days in the service year 1 Jan – 31 Dec 2023, over thirty
		// → all 46 disregarded: the start moves to 16 Feb 2021; 16 Feb 2021 – 15 Jan 2026 = 58
		// completed months → two years or more, under five: 12 days (s.60E(1)(b)).
		assert.equal(grantedDays(rule, person([unpaid('2023-03-01', '2023-04-15')])), 12);
		// Exactly thirty days (1 – 30 Mar 2023) does not exceed thirty: nothing disregarded, 16 days.
		assert.equal(grantedDays(rule, person([unpaid('2023-03-01', '2023-03-30')])), 16);
		// 20 days at the end of service year 2022 and 20 at the start of 2023: neither twelve months
		// exceeds thirty, 16 days.
		assert.equal(
			grantedDays(
				rule,
				person([unpaid('2022-12-12', '2022-12-31'), unpaid('2023-01-01', '2023-01-20')])
			),
			16
		);
		// Unauthorised absence is not leave granted: 46 days of ABSENCE leave the service whole.
		assert.equal(
			grantedDays(rule, person([{ code: 'ABSENCE', from: '2023-03-01', to: '2023-04-15' }])),
			16
		);
	});
