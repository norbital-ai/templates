/**
 * Round 3, letter H — 休息日 hours count toward the §32(2) overtime totals.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   勞動基準法 (LSA): https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=36
 *     §36(3) 雇主使勞工於休息日工作之時間，計入第三十二條第二項所定延長工作時間總數。但因天災、
 *            事變或突發事件，雇主有使勞工於休息日工作之必要者，其工作時數不受第三十二條第二項
 *            規定之限制。
 *     §32(2) 46 extended hours a month (54 with union / labour-management consent), 138 a quarter.
 *     §35    four continuous hours owe a thirty-minute break.
 *
 * The fixture's working day is 09:00–18:00 with a one-hour break (8 normal hours, §30); Saturday
 * is the 休息日 (a non-statutory REST day). January 2026 opens on a Thursday: the 5th–9th and
 * 12th–16th are weekdays, the 10th a Saturday.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	emergency = false
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		emergency_cause: emergency ? true : null,
		time_off_in_lieu: null,
		approval_id: null
	});
};

const TW_PERSON = { key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' } as const;
const WEEKDAYS = ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16'];

const limitWarnings = (options: { consent: boolean; emergencySaturday: boolean }) =>
	buildStatutory(
		{
			code: 'TW',
			period: '2026-01',
			riskClass: '1',
			people: [TW_PERSON],
			companyFacts: options.consent ? { overtime_consent: true } : {}
		},
		(world) => {
			// Ten weekdays 09:00–22:00 less the shift's one-hour break: 12 worked, 4 extended each —
			// 40 extended hours, under 46 on their own, and 12 a day is inside §32(2)'s daily cap.
			for (const day of WEEKDAYS) punch(world, TW_PERSON.key, `2026-01-${day}`, '09:00', '22:00');
			// The 休息日 09:00–17:30: 8.5 hours of clock with no break taken; §35 owes 30 minutes that
			// are not working time, so 8 hours worked — every one of them an §36(3) hour.
			punch(world, TW_PERSON.key, '2026-01-10', '09:00', '17:30', options.emergencySaturday);
		}
	).warnings.filter((warning) => warning.startsWith('OVERTIME_LIMIT_EXCEEDED'));

test('Taiwan round 3 H — §36(3): 40 weekday hours + 8 休息日 hours = 48 > 46 is reported', () => {
	const warnings = limitWarnings({ consent: false, emergencySaturday: false });
	assert.equal(warnings.length, 1, warnings.join('\n'));
	// 40 + 8 = 48 against the 46-hour month; the quarter (48 ≤ 138) is inside its ceiling.
	assert.match(warnings[0]!, /worked 48 regulated overtime hours in 2026-01, against a 46-hour/);
});

test('Taiwan round 3 H — §32(2) consent: the same 48 hours sit inside the 54-hour month', () => {
	assert.deepEqual(limitWarnings({ consent: true, emergencySaturday: false }), []);
});

test('Taiwan round 3 H — §36(3) proviso: 休息日 work forced by an emergency stays outside the cap', () => {
	// Only the 40 weekday hours count: 40 ≤ 46.
	assert.deepEqual(limitWarnings({ consent: false, emergencySaturday: true }), []);
});
