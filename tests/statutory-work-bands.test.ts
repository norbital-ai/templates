// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The seeded work regimes priced by `priceWorkDay`, against the statute's own day arithmetic.
 *
 * `work-bands.test.ts` proves the engine on hand-made rules; this file prices the sealed
 * `work_rules` each lineage actually ships, on the days where a band table is easiest to get
 * wrong: a rest day worked for exactly half the normal hours, a tiered ladder whose second tier
 * must price only its own hours, and a night overtime hour that stacks two premiums.
 *
 * Figures are on a NT$/RM/Rp-agnostic hourly rate of 100 and a day wage of 800, so a row's amount
 * reads as hours × multiple.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { priceWorkDay } from '../src/lib/payroll/work-bands.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { settingsVersions, contributionSchemes } from './fixtures/statutory-world.ts';

const person = personContext({
	employee: null,
	employment: { service_start: '2020-01-01' },
	terms: null,
	asOf: '2026-06-30'
});
const rates = { ordinaryHour: 100, ordinaryDay: 800, dayWage: 800 };

/** A day priced on the lineage's latest sealed version. */
function price(code, day) {
	const version = settingsVersions(code).at(-1);
	const rows = priceWorkDay({
		work: version.work_rules,
		person,
		day: {
			workDayId: 'd',
			date: '2026-06-15',
			breakMinutes: 60,
			rosterCode: 'AM',
			holidayKind: '',
			holidayName: '',
			monthOvertimeHours: 0,
			continuousAttendance: false,
			consecutiveHours: 4,
			normalHours: 8,
			...day
		},
		rates
	});
	return rows.map((row) => [row.label, row.hours, Math.round(row.amount * 100) / 100]);
}

const ordinary = (worked) => ({
	dayType: 'ORDINARY',
	workedHours: worked,
	overtimeHours: worked - 8
});
/** Every hour on a rest day or holiday is overtime; the context measures it against the normal day. */
const restDay = (worked, normalHours = 8) => ({
	dayType: 'REST_DAY',
	workedHours: worked,
	overtimeHours: worked,
	normalHours
});
const holiday = (worked, normalHours = 8) => ({
	dayType: 'PUBLIC_HOLIDAY',
	workedHours: worked,
	overtimeHours: worked,
	normalHours
});

test('Malaysia and Singapore — a rest day worked for exactly half the normal hours is the half-day limb', () => {
	for (const code of ['MY', 'MY-nihon']) {
		// EA 1955 s.60(3)(b): "does not exceed half" → half a day's wages; over half → one day.
		assert.deepEqual(price(code, restDay(4)), [['OT-0.5X', 4, 400]]);
		assert.deepEqual(price(code, restDay(4.5)), [['OT-1.0X', 4, 800]]);
		// Beyond the normal hours: two times the hourly rate, s.60(3)(c).
		assert.deepEqual(price(code, restDay(10)), [
			['OT-1.0X', 4, 800],
			['OT-2.0X', 2, 400]
		]);
	}
	// Singapore EA s.37(3): one day's basic pay up to half, two days' over half, 1.5× beyond.
	assert.deepEqual(price('SG', restDay(4)), [['OT-1.0X', 4, 800]]);
	assert.deepEqual(price('SG', restDay(4.5)), [['OT-2.0X', 4, 1600]]);
	assert.deepEqual(price('SG', restDay(10)), [
		['OT-2.0X', 4, 1600],
		['OT-1.5X', 2, 300]
	]);
});

test('Taiwan — 勞基法第24條 prices the first two extended hours at 4/3 and the rest at 5/3', () => {
	const third = 'OT-1.3333333333333333X';
	const twoThirds = 'OT-1.6666666666666667X';
	// 第24條第1項: 8 + 3 → 2 h × 4/3 + 1 h × 5/3 = 433.33, not 3 h at both.
	assert.deepEqual(price('TW', ordinary(11)), [
		[third, 2, 266.67],
		[twoThirds, 1, 166.67]
	]);
	assert.deepEqual(price('TW', ordinary(9)), [[third, 1, 133.33]]);
	// 第24條第2項: a rest day is priced from its first hour, 2 h at 4/3 then 5/3.
	assert.deepEqual(price('TW', restDay(10)), [
		[third, 2, 266.67],
		[twoThirds, 8, 1333.33]
	]);
	assert.deepEqual(price('TW', restDay(8)), [
		[third, 2, 266.67],
		[twoThirds, 6, 1000]
	]);
	// 第39條 with 第24條第1項: the holiday earns a further day's wage, then 4/3 and 5/3 beyond.
	assert.deepEqual(price('TW', holiday(11)), [
		['OT-1.0X', 8, 800],
		[third, 2, 266.67],
		[twoThirds, 1, 166.67]
	]);
});

test('Indonesia — PP 35/2021 Pasal 31 prices the first overtime hour at 1.5× and the rest at 2×', () => {
	// Pasal 31(1): 8 + 3 → 1 h × 1.5 + 2 h × 2 = 550.
	assert.deepEqual(price('ID', ordinary(11)), [
		['OT-1.5X', 1, 150],
		['OT-2.0X', 2, 400]
	]);
	assert.deepEqual(price('ID', ordinary(9)), [['OT-1.5X', 1, 150]]);
	// Pasal 31(3), five-day week: hours 1–8 at 2×, the ninth at 3×, the tenth to twelfth at 4×.
	assert.deepEqual(price('ID', restDay(11)), [
		['OT-2.0X', 8, 1600],
		['OT-3.0X', 1, 300],
		['OT-4.0X', 2, 800]
	]);
	// Pasal 31(2)(a), six-day week of seven-hour days: 1–7 at 2×, the eighth at 3×, 9–11 at 4×.
	assert.deepEqual(price('ID', restDay(10, 7)), [
		['OT-2.0X', 7, 1400],
		['OT-3.0X', 1, 300],
		['OT-4.0X', 2, 800]
	]);
	// Pasal 31(2)(b), a holiday on the shortest working day of five hours: 1–5, 6, 7–9.
	assert.deepEqual(price('ID', holiday(8, 5)), [
		['OT-2.0X', 5, 1000],
		['OT-3.0X', 1, 300],
		['OT-4.0X', 2, 800]
	]);
});

test('Vietnam — a night overtime hour carries the 30% night premium and the 20% night-overtime add', () => {
	// Labour Code 2019 art.98(3) with Decree 145/2020 art.57: on an ordinary day a night overtime
	// hour is 150% + 30% + 20% = 200% of the hourly wage. The engine prices the 150% on the
	// OVERTIME line and the rest as `night_premium.overtime_add`, so that add is 50, not 20.
	for (const version of settingsVersions('VN')) {
		assert.deepEqual(version.work_rules.night_premium, {
			from: '22:00',
			to: '06:00',
			ordinary_add: 30,
			overtime_add: 50
		});
	}
});

test('Philippines — night work on an overtime hour compounds the differential', () => {
	// DOLE Handbook ch.5 §D: an overtime hour at night is 1.25 × 1.10 of the hourly rate, so the
	// night add on top of the 125% overtime line is 12.5% of the ordinary hour; 10% on ordinary hours.
	for (const version of settingsVersions('PH')) {
		assert.deepEqual(version.work_rules.night_premium, {
			from: '22:00',
			to: '06:00',
			ordinary_add: 10,
			overtime_add: 12.5
		});
	}
});

test('Vietnam — from 1 July 2026 the overtime wage is outside personal income tax', () => {
	// Law 109/2025/QH15 art.4(8): "Tiền lương làm việc ban đêm, làm thêm giờ" is exempt income —
	// the whole overtime wage, where Law 04/2007 exempted only the part above the ordinary rate.
	const [, before, after] = settingsVersions('VN');
	const pit = (version) =>
		contributionSchemes('VN').find((row) => row.settings_id === version.id && row.code === 'PIT');
	assert.equal(after.effective_range.start.slice(0, 10), '2026-07-01');
	assert.equal(pit(after).base.overtime, false);
	assert.equal(pit(before).base.overtime, true);
});
