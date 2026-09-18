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
import { assessedOnMentions } from '../src/lib/expressions/compile.ts';
import { nightAddsFor, priceWorkDay } from '../src/lib/payroll/work-bands.ts';
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
function price(code, day, who = person) {
	const version = settingsVersions(code).at(-1);
	const rows = priceWorkDay({
		work: version.work_rules,
		person: who,
		day: {
			workDayId: 'd',
			date: '2026-06-15',
			breakMinutes: 60,
			holidayKind: '',
			holidayName: '',
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
		// EA 1955 s.60(3)(b), the monthly-rated limb: "does not exceed half" the normal hours → half
		// a day's wages; over half, up to the normal hours → one day's wages. The row carries the
		// hours actually worked, so a 4.5-hour day reads as 4.5 hours at a day's wage, never as four
		// fabricated hours at twice the hourly rate. The labels say what the statute pays, not a
		// multiple the payslip reader has to reverse-engineer.
		assert.deepEqual(price(code, restDay(4)), [['RESTDAY-HALF-DAY-PAY', 4, 400]]);
		assert.deepEqual(price(code, restDay(4.5)), [['RESTDAY-FULL-DAY-PAY', 4.5, 800]]);
		// s.60(3)(c): work in excess of the normal hours on a rest day, two times the hourly rate.
		assert.deepEqual(price(code, restDay(10)), [
			['RESTDAY-FULL-DAY-PAY', 8, 800],
			['RESTDAY-OT-2.0X', 2, 400]
		]);
		// s.60D(3)(a)(i): two days' wages for work on a paid holiday, in addition to the holiday pay;
		// s.60D(3)(aa): three times the hourly rate beyond the normal hours. Two statutes, two rows.
		assert.deepEqual(price(code, holiday(10)), [
			['HOLIDAY-2-DAYS-PAY', 8, 1600],
			['HOLIDAY-OT-3.0X', 2, 600]
		]);
		// s.60A(3)(a): an ordinary day's overrun at one and a half times the hourly rate.
		assert.deepEqual(price(code, ordinary(10)), [['WORKDAY-OT-1.5X', 2, 300]]);
	}
	// Singapore EA s.37(3): one day's basic pay up to half, two days' over half, 1.5× beyond. The
	// day's basic pay is Third Schedule item 2, priced by the band from the contract itself —
	// 12 × 2,860 ÷ (52 × 5) = 132.00 — never from the hourly divisor (Fourth Schedule, 52 × 44).
	const singaporean = personContext({
		employee: null,
		employment: { service_start: '2020-01-01' },
		terms: { base_salary: { value: 2860, currency: 'SGD' } },
		week: { ordinary_hours_per_week: 40, working_days_per_week: 5 },
		asOf: '2026-06-30'
	});
	assert.deepEqual(price('SG', restDay(4), singaporean), [['OT-1.0X', 4, 132]]);
	assert.deepEqual(price('SG', restDay(4.5), singaporean), [['OT-2.0X', 4.5, 264]]);
	assert.deepEqual(price('SG', restDay(10), singaporean), [
		['OT-2.0X', 8, 264],
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

test('Vietnam — Labour Code art.98(1) prices 150% on a working day, 200% on a rest day, 300% on a holiday', () => {
	// Art.98(1)(a): every hour beyond the normal day at 150% of the hourly wage.
	assert.deepEqual(price('VN', ordinary(11)), [['OT-1.5X', 3, 450]]);
	// Art.98(1)(b): every hour on the weekly rest day at 200%, the hours beyond a normal day too;
	// a half day worked is priced for the hours worked, not fabricated to a full day.
	assert.deepEqual(price('VN', restDay(4)), [['OT-2.0X', 4, 800]]);
	assert.deepEqual(price('VN', restDay(10)), [
		['OT-2.0X', 8, 1600],
		['OT-2.0X', 2, 400]
	]);
	// Art.98(1)(c): every hour on a public holiday at 300%, on top of the holiday wage a monthly
	// salary already carries.
	assert.deepEqual(price('VN', holiday(10)), [
		['OT-3.0X', 8, 2400],
		['OT-3.0X', 2, 600]
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

test('Vietnam — a night overtime hour carries the 30% night premium and 20% of the day-type wage', () => {
	// Labour Code 2019 art.98(3) with Decree 145/2020 art.57: a night overtime hour is the overtime
	// wage plus 30% for the night plus 20% of the daytime wage of that day type. The engine prices
	// the overtime multiple on the OVERTIME line and the rest as `night_premium.overtime_add`: 50
	// on an ordinary day (30 + 20% of 100%), 70 on a rest day (20% of 200%), 90 on a holiday.
	const day = (dayType, extra = {}) => ({
		workDayId: 'd',
		date: '2026-06-15',
		dayType,
		workedHours: 10,
		overtimeHours: dayType === 'ORDINARY' ? 2 : 10,
		normalHours: 8,
		breakMinutes: 60,
		holidayKind: dayType === 'PUBLIC_HOLIDAY' ? 'PUBLIC_HOLIDAY' : '',
		holidayName: '',
		consecutiveHours: 4,
		continuousAttendance: false,
		restDay: dayType === 'REST_DAY',
		offDay: false,
		nightHours: 4,
		requestedBy: 'EMPLOYER',
		...extra
	});
	for (const version of settingsVersions('VN')) {
		const premium = version.work_rules.night_premium;
		// Art.98(3): the bands carry the 20% of the day-type increment (0.2× on a rest day, 0.4× on a
		// holiday over the slice's night hours), so the add over the line is 30 + 20 = 50 on every
		// overtime hour — and on a rest day or holiday every hour is overtime (art.98(1)(b),(c)).
		assert.deepEqual([premium.from, premium.to, premium.overtime_add], ['22:00', '06:00', 50]);
		const adds = (d) => nightAddsFor({ work: version.work_rules, premium, person, day: d, rates });
		assert.deepEqual(adds(day('ORDINARY')), { ordinary: 30, overtime: 50 });
		assert.deepEqual(adds(day('REST_DAY')), { ordinary: 50, overtime: 50 });
		assert.deepEqual(adds(day('PUBLIC_HOLIDAY')), { ordinary: 50, overtime: 50 });
	}
});

test('Philippines — the night differential follows the day’s own rate', () => {
	// Art.86 and DOLE Handbook ch.5: 10% of the hour’s own rate, so on top of each line the add
	// is the line’s multiple × 10 — 10/12.5 on an ordinary day, 13/16.9 on a rest day or a special
	// day, 20/26 on a regular holiday, 26/33.8 where the holiday falls on the rest day, 15/19.5
	// for a special day on the rest day.
	const day = (dayType, extra = {}) => ({
		workDayId: 'd',
		date: '2026-06-15',
		dayType,
		workedHours: 10,
		overtimeHours: dayType === 'ORDINARY' ? 2 : 10,
		normalHours: 8,
		breakMinutes: 60,
		holidayKind: dayType === 'PUBLIC_HOLIDAY' || dayType === 'SPECIAL_HOLIDAY' ? dayType : '',
		holidayName: '',
		consecutiveHours: 4,
		continuousAttendance: false,
		restDay: false,
		offDay: false,
		nightHours: 4,
		requestedBy: 'EMPLOYER',
		...extra
	});
	for (const version of settingsVersions('PH')) {
		const premium = version.work_rules.night_premium;
		assert.deepEqual([premium.from, premium.to], ['22:00', '06:00']);
		const adds = (d) => nightAddsFor({ work: version.work_rules, premium, person, day: d, rates });
		assert.deepEqual(adds(day('ORDINARY')), { ordinary: 10, overtime: 12.5 });
		assert.deepEqual(adds(day('REST_DAY', { restDay: true })), { ordinary: 13, overtime: 16.9 });
		assert.deepEqual(adds(day('SPECIAL_HOLIDAY')), { ordinary: 13, overtime: 16.9 });
		assert.deepEqual(adds(day('PUBLIC_HOLIDAY')), { ordinary: 20, overtime: 26 });
		assert.deepEqual(adds(day('PUBLIC_HOLIDAY', { restDay: true })), {
			ordinary: 26,
			overtime: 33.8
		});
		assert.deepEqual(adds(day('SPECIAL_HOLIDAY', { restDay: true })), {
			ordinary: 15,
			overtime: 19.5
		});
	}
});

test('Vietnam — from the 2026 tax year the overtime wage is outside personal income tax', () => {
	// Law 109/2025/QH15 art.4(8): "Tiền lương làm việc ban đêm, làm thêm giờ" is exempt income —
	// the whole overtime wage, where Law 04/2007 exempted only the part above the ordinary rate.
	// Art.29(2): the salary-income rules apply "từ kỳ tính thuế năm 2026" — both 2026 versions.
	const [december, january, july] = settingsVersions('VN');
	const pit = (version) =>
		contributionSchemes('VN').find((row) => row.settings_id === version.id && row.code === 'PIT');
	assert.equal(january.effective_range.start.slice(0, 10), '2026-01-01');
	assert.equal(july.effective_range.start.slice(0, 10), '2026-07-01');
	const chargesOvertime = (version) =>
		assessedOnMentions(pit(version).assessed_on).reserved.includes('OVERTIME');
	assert.equal(chargesOvertime(december), true);
	assert.equal(chargesOvertime(january), false);
	assert.equal(chargesOvertime(july), false);
});
