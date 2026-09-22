/**
 * Lead's cross-checks after the independent jurisdiction audit: cases whose expected figure is
 * derived by hand from the law, for mechanisms fixed outside the per-lineage audit files.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	adhocCatalogue,
	assessStatutory,
	buildStatutory,
	expectStatutory,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { evaluateBoolean, expressionEngine } from '../src/lib/expressions/evaluate.ts';

test('VN — severance is priced on the average contractual salary of the six months before the contract ends (Decree 145/2020 art.8(5))', () => {
	// Hired 1 June 2023, resigns 30 June 2026, no unemployment-insurance cover: 37 months → 3 y 1 m
	// → 3.5 years (art.8(3): a leftover of up to six months is half a year). Contract salary
	// 10,000,000 to 31 March 2026, 16,000,000 from 1 April: the six months January–June average
	// (3 × 10,000,000 + 3 × 16,000,000) ÷ 6 = 13,000,000. Art.46: 0.5 × 3.5 × 13,000,000 = 22,750,000
	// — not 28,000,000 on the closing salary.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-06',
			region: 'I',
			people: [
				{
					key: 'VN-LEAVER',
					wage: 10_000_000,
					citizenship: 'CITIZEN',
					hire_date: '2023-06-01',
					exit_date: '2026-06-30',
					exit_reason: 'RESIGNATION',
					registrations: { UI: { kind: 'NOT_REGISTERED' } }
				}
			]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'VN-LEAVER')!;
			const first = world.employment_terms.find((row) => row.employment_id === employment.id)!;
			world.employment_terms.push({
				...first,
				id: 'e0000000-0000-4000-8000-0000000000a1',
				base_salary: { value: 16_000_000, currency: 'VND' },
				effective_range: { start: '2026-04-01', end: first.effective_range.end }
			});
			first.effective_range = { start: first.effective_range.start, end: '2026-03-31' };
			// Labour Code art.46(1): the leaver does not qualify for a pension (a declared input).
			employment.exit_facts = { pension_eligible: false };
			// The row must come from the version governing the final service day, 30 June 2026:
			// the 16 May 2026 version (Decree 105/2026).
			const version = settingsVersions('VN').find((row) =>
				String(row.effective_range.start).startsWith('2026-05-16')
			)!;
			const severance = world.adhoc_catalogue!.find(
				(row) => row.code === 'SEVERANCE_ALLOWANCE' && row.settings_id === version.id
			)!;
			world.adhoc_requests!.push({
				id: 'd0000000-0000-4000-8000-0000000000a2',
				employment_id: employment.id,
				catalogue_id: severance.id,
				amount: 0,
				event_date: '2026-06-30',
				pay_period: '2026-06',
				payslip_id: null,
				reason: 'severance',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	const slip = slips.get('VN-LEAVER')!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'SEVERANCE_ALLOWANCE')?.amount,
		22_750_000
	);
});

test('MY — no notice or pay in lieu is owed on a misconduct dismissal after due inquiry (EA 1955 s.14(1)(a))', () => {
	// s.14(1)(a): an employer may, on the grounds of misconduct and after due inquiry, dismiss
	// without notice; s.13 notice (and so pay in lieu) is owed on any other dismissal.
	for (const code of ['MY', 'MY-nihon'])
		for (const row of adhocCatalogue(code).filter(
			(row: { code: string }) => row.code === 'NOTICE_IN_LIEU'
		)) {
			const owed = (misconduct: boolean) =>
				evaluateBoolean(expressionEngine, row.eligibility, {
					employment: {
						exit_reason: 'DISMISSAL',
						exit_fact_keys: ['misconduct_dismissal'],
						exit_facts: { misconduct_dismissal: misconduct }
					}
				});
			assert.equal(owed(true), false, code);
			assert.equal(owed(false), true, code);
		}
});

test("TW — the government pays 100/50/25% of a disabled worker's own LI and EI share (身心障礙者權益保障法 §73)", () => {
	// 60,000 insures at the LI ceiling grade 45,800 and the EI grade 45,800. The worker's own share
	// (20%) without subsidy: LI 45,800 × 11.5% × 20% = 1,053.40 → 1,053; EI 45,800 × 1% × 20% =
	// 91.60 → 92 (goldens above). BLI rounds the subsidy on its own, on the unrounded share, and
	// withholds the rounded share less the rounded subsidy (勞保局 納保組, 台灣勞工季刊 第44期 p.72–73:
	// 28,800 × 9% × 20% − 28,800 × 9% × 20% × 25% = 518 − 130 = 388): 25% → 1,053.40 × 25% =
	// 263.35 → 263, 1,053 − 263 = 790, and 91.60 × 25% = 22.90 → 23, 92 − 23 = 69; 50% → 526.70 →
	// 527, 1,053 − 527 = 526, and 91.60 × 50% = 45.80 → 46, 92 − 46 = 46; 100% → 1,053.40 → 1,053,
	// 1,053 − 1,053 = 0, and 91.60 → 92, 92 − 92 = 0. (Before round 4 the rounded share was halved:
	// 1,053 × 50% = 526.50 → 527 withheld.) The employer's 70% is untouched: 45,800 × 11.5% × 70% =
	// 3,687.10 → 3,687 and 45,800 × 1% × 70% = 320.60 → 321.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [0, 25, 50, 100].map((share) => ({
			key: `TW-DIS-${share}`,
			wage: 60_000,
			citizenship: 'CITIZEN',
			registrations: {
				LI: { kind: 'REGISTERED', elections: { disability_subsidy: share } },
				EI: { kind: 'REGISTERED', elections: { disability_subsidy: share } }
			}
		}))
	});
	expectStatutory(book, 'TW-DIS-0', 'LI', 1053, 3687);
	expectStatutory(book, 'TW-DIS-0', 'EI', 92, 321);
	expectStatutory(book, 'TW-DIS-25', 'LI', 790, 3687);
	expectStatutory(book, 'TW-DIS-25', 'EI', 69, 321);
	expectStatutory(book, 'TW-DIS-50', 'LI', 526, 3687);
	expectStatutory(book, 'TW-DIS-50', 'EI', 46, 321);
	expectStatutory(book, 'TW-DIS-100', 'LI', 0, 3687);
	expectStatutory(book, 'TW-DIS-100', 'EI', 0, 321);
});

test('VN — overtime past the 40-hour month, rest-day and holiday hours counted, is funnelled to the taxable line (LC art.107; Decree 253/2026 art.26(3))', () => {
	// 17,600,000 ÷ 22 working days (January 2026) ÷ 8 = 100,000 an hour. In the order worked:
	// 1 Jan holiday 8 h → 8; 2 Jan 3 → 11; 5–9 Jan 3 × 5 → 26; Saturday 10 Jan 8.5 → 34.5;
	// 12 Jan 3 → 37.5; 13 Jan 3 → 40.5 (0.5 h past 40); 14 Jan 3 → all past. Beyond the limit:
	// 0.5 h on the 13th and 3 h on the 14th, weekday overtime at 150%: 75,000 and 450,000. Only
	// overtime within art.107 is exempt, so these hours leave the exempt overtime line.
	const key = 'VN-FUNNEL';
	const punches: [string, string, string][] = [
		['2026-01-01', '09:00', '18:00'],
		['2026-01-10', '09:00', '18:00'],
		...[2, 5, 6, 7, 8, 9, 12, 13, 14].map(
			(day) =>
				[`2026-01-${String(day).padStart(2, '0')}`, '09:00', '21:00'] as [string, string, string]
		)
	];
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key, wage: 17_600_000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === key)!;
			world.jurisdiction_holidays.push({
				id: 'holiday-2026-01-01',
				company_id: world.companies[0]!.id,
				date: '2026-01-01',
				name: 'Tết Dương lịch',
				kind: 'PUBLIC_HOLIDAY',
				replaces: null,
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			} as never);
			for (const [date, start, end] of punches)
				world.work_days.push({
					id: `wd-${date}`,
					employment_id: employment.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [
						{ start: `${date}T${start}:00+07:00`, end: `${date}T${end}:00+07:00` }
					],
					requested_by: null,
					emergency_cause: null,
					time_off_in_lieu: null,
					approval_id: null
				} as never);
		}
	);
	const incentive = slips
		.get(key)!
		.adjustments.filter(
			(row) =>
				row.family === 'WORK_DAY' && String(row.statutory_rule_key ?? '').startsWith('INCENTIVE:')
		)
		.map((row) => [row.source_id.slice(-10), row.quantity, row.amount]);
	assert.deepEqual(incentive, [
		['2026-01-13', 0.5, 75_000],
		['2026-01-14', 3, 450_000]
	]);
});
