/**
 * Vietnam — independent audit (2026-09-23). Every expected figure below is derived by hand from the
 * instrument cited beside it, never from the engine's output.
 *
 * Instruments: Law on Social Insurance 41/2024/QH15 arts.2, 31, 33, 34; Law on Employment 74/2025/QH15
 * arts.2(1), 31, 33, 34 (38/2013/QH13 to 31 December 2025); Decree 161/2026/NĐ-CP (reference level
 * 2,530,000 from 1 July 2026); Decree 74/2024/NĐ-CP and Decree 293/2025/NĐ-CP (regional minimum
 * wages); PIT Law 109/2025/QH15 art.9 (the five-rung monthly table) with Resolution 110/2025/UBTVQH15
 * (15,500,000 / 6,200,000); Decree 253/2026/NĐ-CP arts.26, 50(2), 69; Labour Code 2019 arts.36, 46,
 * 47, 48, 98; Decree 145/2020/NĐ-CP arts.8(3), 57; Quyết định 61/QĐ-TLĐ (union dues 0.5% from
 * 1 July 2025, capped at 10% of the base salary).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	settingsVersions,
	adhocCatalogue
} from './fixtures/statutory-world.ts';
import {
	evaluateBoolean,
	evaluateNumber,
	expressionEngine
} from '../src/lib/expressions/evaluate.ts';

// The third version (16 May 2026, Decree 105/2026) moves the union-fee payment date alone.
const [V_2025_12, V_2026_01, , V_2026_07] = settingsVersions('VN');

// ─── Social and health insurance: the ceiling and the reduced accident rate ────────────────────

test('VN audit — SI and HI stop at 20 × the reference level, one đồng over and exactly on it', () => {
	// Law 41/2024 art.31(1)(đ): ceiling 20 × 2,340,000 = 46,800,000 to 30 June 2026.
	// SI 8% × 46,800,000 = 3,744,000; 17.5% (3% + 14% + 0.5%) = 8,190,000.
	// HI 1.5% × 46,800,000 = 702,000; 3% = 1,404,000.
	const january = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [{ key: 'OVER', wage: 46_800_001, citizenship: 'CITIZEN' }]
	});
	expectStatutory(january, 'OVER', 'SI', 3_744_000, 8_190_000);
	expectStatutory(january, 'OVER', 'HI', 702_000, 1_404_000);
	// Decree 161/2026 from 1 July 2026: 20 × 2,530,000 = 50,600,000. SI 8% = 4,048,000,
	// 17.5% = 8,855,000; HI 1.5% = 759,000, 3% = 1,518,000 — on the ceiling and one đồng over.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{ key: 'ON', wage: 50_600_000, citizenship: 'CITIZEN' },
			{ key: 'OVER', wage: 50_600_001, citizenship: 'CITIZEN' }
		]
	});
	for (const key of ['ON', 'OVER']) {
		expectStatutory(july, key, 'SI', 4_048_000, 8_855_000);
		expectStatutory(july, key, 'HI', 759_000, 1_518_000);
	}
});

test('VN audit — the reduced 0.3% accident rate makes the employer SI share 17.3%, on the ceiling too', () => {
	// Decree 58/2020 art.5: 3% + 14% + 0.3% = 17.3%. 50,600,000 × 17.3% = 8,753,800;
	// 20,000,000 × 17.3% = 3,460,000. The employee's 8% does not move.
	const book = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		companyFacts: { occupational_accident_reduced: true },
		people: [
			{ key: 'CAPPED', wage: 60_000_000, citizenship: 'CITIZEN' },
			{ key: 'MID', wage: 20_000_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'CAPPED', 'SI', 4_048_000, 8_753_800);
	expectStatutory(book, 'MID', 'SI', 1_600_000, 3_460_000);
});

// ─── Unemployment insurance: 20 × the regional minimum wage, citizens only ─────────────────────

test('VN audit — the UI ceiling is 20 × the region’s minimum wage of the version (Law 38/2013 art.58, Law 74/2025 art.34(2))', () => {
	// December 2025, Decree 74/2024: Region IV 3,450,000 × 20 = 69,000,000 → 1% = 690,000 each side;
	// Region I 4,960,000 × 20 = 99,200,000 → 992,000.
	const regionIV = assessStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'IV',
		people: [{ key: 'W', wage: 69_000_001, citizenship: 'CITIZEN' }]
	});
	expectStatutory(regionIV, 'W', 'UI', 690_000, 690_000);
	// July 2026, Decree 293/2025 (unchanged on 1 July): Region I 5,310,000 × 20 = 106,200,000 →
	// 1,062,000 exactly on it and above it.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [
			{ key: 'ON', wage: 106_200_000, citizenship: 'CITIZEN' },
			{ key: 'OVER', wage: 150_000_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(july, 'ON', 'UI', 1_062_000, 1_062_000);
	expectStatutory(july, 'OVER', 'UI', 1_062_000, 1_062_000);
});

test('VN audit — the regional minimum wage tables are the decrees’ own', () => {
	// Decree 74/2024 art.3(1) and Decree 293/2025 art.3(1), monthly column.
	assert.deepEqual(V_2025_12.work_rules.wages.by_region, {
		I: 4_960_000,
		II: 4_410_000,
		III: 3_860_000,
		IV: 3_450_000
	});
	for (const version of [V_2026_01, V_2026_07])
		assert.deepEqual(version.work_rules.wages.by_region, {
			I: 5_310_000,
			II: 4_730_000,
			III: 4_140_000,
			IV: 3_700_000
		});
});

test('VN audit — a domestic worker is outside compulsory SI and UI (Law 41/2024 art.2(7)(b); Law 74/2025 art.31(2))', () => {
	for (const period of ['2025-12', '2026-01', '2026-07']) {
		const book = assessStatutory({
			code: 'VN',
			period,
			region: 'I',
			people: [
				{ key: 'DOMESTIC', wage: 10_000_000, citizenship: 'CITIZEN', employment_type: 'DOMESTIC' }
			]
		});
		expectStatutorySkipped(book, 'DOMESTIC', 'SI');
		expectStatutorySkipped(book, 'DOMESTIC', 'UI');
	}
});

// ─── Union dues: 0.5% of the SI salary, at most 10% of the base salary ────────────────────────

test('VN audit — union dues are 0.5% of the SI salary, capped at 10% of the base salary (QĐ 61/QĐ-TLĐ, from 1 July 2025)', () => {
	const member = (key: string, wage: number) => ({
		key,
		wage,
		citizenship: 'CITIZEN',
		registrations: { UNION_DUES: { kind: 'REGISTERED', elections: { union_member: true } } }
	});
	// January 2026: 20,000,000 × 0.5% = 100,000; 10,000,000 × 0.5% = 50,000; a 60,000,000 wage has
	// the SI salary 46,800,000 × 0.5% = 234,000 = the cap 10% × 2,340,000.
	const january = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [member('D20', 20_000_000), member('D10', 10_000_000), member('D60', 60_000_000)]
	});
	expectStatutory(january, 'D20', 'UNION_DUES', 100_000, 0);
	expectStatutory(january, 'D10', 'UNION_DUES', 50_000, 0);
	expectStatutory(january, 'D60', 'UNION_DUES', 234_000, 0);
	// July 2026: SI salary 50,600,000 × 0.5% = 253,000 = 10% × 2,530,000.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [member('D60', 60_000_000)]
	});
	expectStatutory(july, 'D60', 'UNION_DUES', 253_000, 0);
	// December 2025: a 2,000,000 wage is insured on the 2,340,000 floor: × 0.5% = 11,700.
	const december = assessStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'I',
		people: [member('D2', 2_000_000)]
	});
	expectStatutory(december, 'D2', 'UNION_DUES', 11_700, 0);
});

// ─── PIT: the 2026 monthly table at its rung edges ─────────────────────────────────────────────

test('VN audit — the 2026 monthly PIT table at the 60,000,000 and 100,000,000 rung edges (Law 109/2025 art.9)', () => {
	// A resident foreigner on an open-ended contract is in SI and HI but outside UI (Law 74/2025
	// art.2(1)). Above the ceiling the month's insurance is 3,744,000 + 702,000 = 4,446,000; with the
	// 15,500,000 self-deduction, wage − 19,946,000 is the taxable income.
	// Table (monthly): ≤10M 5%; 10–30M 10%; 30–60M 20%; 60–100M 30%; >100M 35%.
	// Tax at 60,000,000 = 500,000 + 2,000,000 + 6,000,000 = 8,500,000; at 100,000,000 = 8,500,000 +
	// 40,000,000 × 30% = 20,500,000.
	const book = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'T60', wage: 79_946_000, citizenship: 'FOREIGNER' },
			{ key: 'T60+100', wage: 79_946_100, citizenship: 'FOREIGNER' }, // + 100 × 30% = 30
			{ key: 'T100', wage: 119_946_000, citizenship: 'FOREIGNER' },
			{ key: 'T100+100', wage: 119_946_100, citizenship: 'FOREIGNER' }, // + 100 × 35% = 35
			// Two dependants deduct 2 × 6,200,000 = 12,400,000: 92,346,000 − 4,446,000 − 15,500,000 −
			// 12,400,000 = 60,000,000 → 8,500,000.
			{ key: 'T60-D2', wage: 92_346_000, citizenship: 'FOREIGNER', children: 2 },
			// A citizen at 30,000,000: SI 2,400,000 + HI 450,000 + UI 300,000 = 3,150,000;
			// 30,000,000 − 3,150,000 − 15,500,000 = 11,350,000 → 500,000 + 1,350,000 × 10% = 635,000.
			{ key: 'C30', wage: 30_000_000, citizenship: 'CITIZEN' }
		]
	});
	expectStatutory(book, 'T60', 'PIT', 8_500_000, 0);
	expectStatutory(book, 'T60+100', 'PIT', 8_500_030, 0);
	expectStatutory(book, 'T100', 'PIT', 20_500_000, 0);
	expectStatutory(book, 'T100+100', 'PIT', 20_500_035, 0);
	expectStatutory(book, 'T60-D2', 'PIT', 8_500_000, 0);
	expectStatutory(book, 'C30', 'PIT', 635_000, 0);
	// July 2026: the capped insurance is 4,048,000 + 759,000 = 4,807,000, so 80,307,000 −
	// 4,807,000 − 15,500,000 = 60,000,000 → 8,500,000.
	const july = assessStatutory({
		code: 'VN',
		period: '2026-07',
		region: 'I',
		people: [{ key: 'T60', wage: 80_307_000, citizenship: 'FOREIGNER' }]
	});
	expectStatutory(july, 'T60', 'PIT', 8_500_000, 0);
});

test('VN audit — the 10% flat withholding threshold is 2,000,000 in 2025 and 5,000,000 a payment for tax year 2026', () => {
	// Circular 111/2013 art.25(1)(i): 10% on a payment of 2,000,000 or more under a contract of less
	// than three months. Decree 253/2026 art.50(2) raises it to 5,000,000, applied to resident salary
	// income from tax year 2026 (art.69(1)(a)). 10% of the gross payment, no deduction.
	const short = (key: string, wage: number, hire: string, exit: string) => ({
		key,
		wage,
		citizenship: 'CITIZEN',
		hire_date: hire,
		exit_date: exit
	});
	const december = assessStatutory({
		code: 'VN',
		period: '2025-12',
		region: 'I',
		people: [
			short('AT', 2_000_000, '2025-12-01', '2026-01-31'),
			short('UNDER', 1_999_999, '2025-12-01', '2026-01-31')
		]
	});
	expectStatutory(december, 'AT', 'PIT', 200_000, 0);
	expectStatutory(december, 'UNDER', 'PIT', 0, 0);
	const january = assessStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			short('AT', 5_000_000, '2026-01-01', '2026-02-28'),
			short('UNDER', 4_999_999, '2026-01-01', '2026-02-28')
		]
	});
	expectStatutory(january, 'AT', 'PIT', 500_000, 0);
	expectStatutory(january, 'UNDER', 'PIT', 0, 0);
});

// ─── Overtime at night: Decree 145/2020 art.57 ────────────────────────────────────────────────

test('VN audit — a night overtime hour is the day-type rate + 30% + 20% of the day-type rate (Labour Code art.98(3))', () => {
	// Decree 145/2020 art.57(1): night overtime = hour × 150/200/300% + hour × 30% + 20% × the
	// daytime hour of that day (100% or, after daytime overtime, 150% on a working day; 200% on the
	// weekly rest day; 300% on a holiday). On a 100,000 hour, two night hours:
	//   ordinary, no daytime overtime: 2 × (150 + 30 + 20) % = 400,000
	//   ordinary, after daytime overtime: 2 × (150 + 30 + 30) % = 420,000
	//   rest day: 2 × (200 + 30 + 40) % = 540,000
	//   holiday:  2 × (300 + 30 + 60) % = 780,000
	const rules = V_2026_07.work_rules;
	const band = (label: string) =>
		rules.bands.find(
			(row: { label: string; take_hours: string }) =>
				row.label === label && row.take_hours === 'hours_beyond_normal'
		)!;
	const night = { hours: 2, night_hours: 2, ordinary_hour: 100_000 };
	const nightAdd = (day_type: string, overtime_hours: number) =>
		(2 *
			100_000 *
			evaluateNumber(expressionEngine, rules.night_premium.overtime_add, {
				day_type,
				overtime_hours,
				night_hours: 2
			})) /
		100;
	const price = (label: string) =>
		evaluateNumber(expressionEngine, band(label).price_amount, night);
	assert.equal(price('OT-1.5X') + nightAdd('ORDINARY', 2), 400_000);
	assert.equal(price('OT-1.5X') + nightAdd('ORDINARY', 6), 420_000);
	assert.equal(price('OT-2.0X') + nightAdd('REST_DAY', 2), 540_000);
	assert.equal(price('OT-3.0X') + nightAdd('PUBLIC_HOLIDAY', 2), 780_000);
	// Art.98(2): a night hour inside the normal day on a working day adds 30%.
	assert.equal(
		evaluateNumber(expressionEngine, rules.night_premium.ordinary_add, { day_type: 'ORDINARY' }),
		30
	);
});

// ─── Separation: Labour Code arts.46–47, Decree 145/2020 art.8 ─────────────────────────────────

const separation = (code: string, settingsId: string) =>
	adhocCatalogue('VN').find(
		(row: { code: string; settings_id: string }) =>
			row.code === code && row.settings_id === settingsId
	)!;

test('VN audit — severance is half a month per uncovered year, the leftover ≤ 6 months a half year and > 6 a year', () => {
	// Decree 145/2020 art.8(3)(c) (the gazette text): "tháng lẻ ít hơn hoặc bằng 06 tháng được tính
	// bằng 1/2 năm, trên 06 tháng được tính bằng 01 năm". Six-month average salary 20,000,000.
	//   30 months, no UI: 2 y + 6 m → 2.5 y × 0.5 × 20,000,000 = 25,000,000
	//   31 months: 2 y + 7 m → 3 y → 30,000,000
	//   24 months: 2 y → 20,000,000
	//   125 months, 96 of them under UI (art.46(2)): 29 → 2 y + 5 m → 2.5 y → 25,000,000
	// Job loss (art.47): one month per year, at least two.
	//   13 months: 1 y + 1 m → 1.5 y → the two-month floor → 40,000,000
	//   42 months: 3 y + 6 m → 3.5 y → 70,000,000; 43 months: 4 y → 80,000,000
	for (const version of [V_2025_12, V_2026_01, V_2026_07]) {
		const pay = (code: string, service: number, covered: number) =>
			evaluateNumber(expressionEngine, separation(code, version.id).bands[0].amount, {
				person: {
					terms: { monthly_wage_6m_average: 20_000_000 },
					employment: { service_months: service },
					facts: { UI: { since_months: covered } }
				}
			});
		assert.equal(pay('SEVERANCE_ALLOWANCE', 30, 0), 25_000_000);
		assert.equal(pay('SEVERANCE_ALLOWANCE', 31, 0), 30_000_000);
		assert.equal(pay('SEVERANCE_ALLOWANCE', 24, 0), 20_000_000);
		assert.equal(pay('SEVERANCE_ALLOWANCE', 125, 96), 25_000_000);
		assert.equal(pay('JOB_LOSS_ALLOWANCE', 13, 0), 40_000_000);
		assert.equal(pay('JOB_LOSS_ALLOWANCE', 42, 0), 70_000_000);
		assert.equal(pay('JOB_LOSS_ALLOWANCE', 43, 0), 80_000_000);
	}
});

test('VN audit — who is owed severance and job-loss allowance (Labour Code arts.34, 36(1)(e), 46(1), 47(1))', () => {
	const eligible = (
		code: string,
		settingsId: string,
		reason: string,
		service: number,
		covered: number,
		facts: Record<string, boolean> = {}
	) =>
		evaluateBoolean(expressionEngine, separation(code, settingsId).eligibility, {
			employment: {
				service_months: service,
				exit_reason: reason,
				exit_fact_keys: Object.keys(facts),
				exit_facts: facts
			},
			facts: { UI: { since_months: covered } }
		});
	for (const version of [V_2025_12, V_2026_01, V_2026_07]) {
		// Art.46(1): twelve months' regular service, contract ending under art.34(1)–(4), (6), (7),
		// (9), (10); some service outside UI.
		assert.equal(eligible('SEVERANCE_ALLOWANCE', version.id, 'RESIGNATION', 30, 0), true);
		assert.equal(eligible('SEVERANCE_ALLOWANCE', version.id, 'RESIGNATION', 11, 0), false);
		assert.equal(eligible('SEVERANCE_ALLOWANCE', version.id, 'DISMISSAL', 30, 0), false);
		assert.equal(eligible('SEVERANCE_ALLOWANCE', version.id, 'END_OF_CONTRACT', 60, 60), false);
		// Art.46(1) exceptions: pension-eligible; dismissed under art.36(1)(e).
		assert.equal(
			eligible('SEVERANCE_ALLOWANCE', version.id, 'END_OF_CONTRACT', 60, 0, {
				pension_eligible: true
			}),
			false
		);
		assert.equal(
			eligible('SEVERANCE_ALLOWANCE', version.id, 'UNILATERAL', 60, 0, { absent_five_days: true }),
			false
		);
		// Art.47(1): job loss under art.34(11) (arts.42–43), whichever label records it.
		assert.equal(eligible('JOB_LOSS_ALLOWANCE', version.id, 'REDUNDANCY', 13, 0), true);
		assert.equal(eligible('JOB_LOSS_ALLOWANCE', version.id, 'RETRENCHMENT', 13, 0), true);
		assert.equal(eligible('JOB_LOSS_ALLOWANCE', version.id, 'REDUNDANCY', 11, 0), false);
	}
});

test('VN audit — the final settlement is due in 14 working days, 30 days only in the art.48(1)(a)–(d) cases', () => {
	for (const version of [V_2025_12, V_2026_01, V_2026_07]) {
		const rules = version.payroll.final_pay_deadlines;
		const pick = (reason: string, facts: Record<string, boolean> = {}) =>
			rules.find(
				(rule: { when: string }) =>
					rule.when.trim() === '' ||
					evaluateBoolean(expressionEngine, rule.when, {
						employment: {
							exit_reason: reason,
							exit_fact_keys: Object.keys(facts),
							exit_facts: facts
						}
					})
			).days;
		assert.equal(pick('REDUNDANCY'), 30);
		assert.equal(pick('RESIGNATION', { final_settlement_extended: true }), 30);
		// 14 working days never falls before the 14th calendar day.
		assert.equal(pick('RESIGNATION'), 14);
		assert.equal(pick('END_OF_CONTRACT'), 14);
	}
});

// ─── Open gap, left failing: the hourly minimum wage ───────────────────────────────────────────

test('VN audit (open gap) — an hourly worker paid the hourly minimum is not below the minimum wage (Decree 293/2025 art.3(1)(b))', () => {
	// Decree 293/2025: Region I 25,500 an hour is the floor for hourly-paid work. 25,500 is lawful;
	// 25,000 is not. The engine compares every contract with the MONTHLY table only
	// (`minimumWageIssues`, src/lib/payroll/contribution.ts): the version carries no hourly column, so
	// the lawful 25,500 is reported "contracted at 25500 a month, below … 5310000" (observed
	// 2026-09-23). Left failing until the wages order carries its hourly table.
	const { warnings } = buildStatutory({
		code: 'VN',
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'H-LAWFUL', wage: 25_500, citizenship: 'CITIZEN', pay_frequency: 'HOURLY' },
			{ key: 'H-UNDER', wage: 25_000, citizenship: 'CITIZEN', pay_frequency: 'HOURLY' }
		]
	});
	const below = warnings.filter((warning) => warning.startsWith('MINIMUM_WAGE_BELOW'));
	assert.equal(below.filter((warning) => warning.includes('H-LAWFUL')).length, 0);
	assert.equal(below.filter((warning) => warning.includes('H-UNDER')).length, 1);
});
