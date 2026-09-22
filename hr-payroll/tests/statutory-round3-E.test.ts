/**
 * Round 3, letter E — the work day's emergency cause and the time-off-in-lieu election.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   勞動基準法 (LSA): https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001
 *     §24(1)(3) 依第三十二條第四項規定，延長工作時間者，按平日每小時工資額加倍發給。
 *     §32(2)    caps the 前項 (§32(1)) extension: 12 hours a day, 46 (54) a month, 138 a quarter.
 *     §32(4)    天災、事變或突發事件 — a separate extension, not the §32(1) one the caps govern.
 *     §32-1     the worker may elect 補休 for a §32(1)–(2) extension or 休息日 work, hour for
 *               hour; untaken at expiry or on termination it is paid at that day's rates.
 *   SG EA 1968 s.38(4): https://sso.agc.gov.sg/Act/EmA1968 — overtime "must be paid" at 1.5×;
 *     no election of time off in lieu exists for Part 4 overtime.
 *
 * The fixture's working day is 09:00–18:00 with a one-hour break (8 normal hours, §30); Saturday
 * is the 休息日 and Sunday the rest day. 60,000 a month on TW's 30-day divisor is 2,000 a day
 * and 250 an hour (60,000 ÷ 30 ÷ 8).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, leaveCatalogue, type BuiltPayslip } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	flags: { emergency_cause?: boolean; time_off_in_lieu?: boolean } = {}
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		emergency_cause: flags.emergency_cause ?? null,
		time_off_in_lieu: flags.time_off_in_lieu ?? null,
		approval_id: null
	});
};

const THIRD = 'OT-1.3333333333333333X';
const TWO_THIRDS = 'OT-1.6666666666666667X';
const TW_PERSON = { key: 'TW-60000', wage: 60_000, citizenship: 'CITIZEN' } as const;

test('Taiwan round 3 — §32(4) emergency hours are paid double and sit outside the §32(2) caps', () => {
	const EMERGENCY_DAYS = [
		'2026-01-05',
		'2026-01-06',
		'2026-01-07',
		'2026-01-08',
		'2026-01-09',
		'2026-01-12',
		'2026-01-13',
		'2026-01-14',
		'2026-01-15',
		'2026-01-16'
	];
	const { slips, warnings } = buildStatutory(
		{ code: 'TW', period: '2026-01', riskClass: '1', people: [TW_PERSON] },
		(world) => {
			// Ten weekdays, each 09:00–23:00 less the one-hour break: 13 worked, 5 extended, under
			// an emergency. 50 extended hours in the month, past both the 46-hour month and the
			// 12-hour day of §32(2).
			for (const date of EMERGENCY_DAYS)
				punch(world, TW_PERSON.key, date, '09:00', '23:00', { emergency_cause: true });
			// An ordinary Tuesday in the next week, 09:00–21:00: 11 worked, 3 extended under §32(1).
			punch(world, TW_PERSON.key, '2026-01-20', '09:00', '21:00');
		}
	);
	assert.deepEqual(workLines(slips.get(TW_PERSON.key)!), [
		// §24(1)(3): 5 h × 250 × 2 = 2,500 a day, every day — none funnelled past the 46-hour
		// month, since §32(2) does not reach the §32(4) extension.
		...EMERGENCY_DAYS.map((date) => [date, 'EMERGENCY-2.0X', 5, 2500] as const),
		// §24(1)(1)–(2) on the ordinary day, unchanged: 2 × 250 × 4/3 = 666.67, 1 × 250 × 5/3 = 416.67.
		// The month's regulated count is these 3 hours alone, well under 46: no INCENTIVE line.
		['2026-01-20', THIRD, 2, 666.67],
		['2026-01-20', TWO_THIRDS, 1, 416.67]
	]);
	// Thirteen worked hours is over §32(2)'s twelve only for a §32(1) day: no daily or monthly
	// limit is reported for the emergency days.
	assert.deepEqual(warnings, []);
});

test('Taiwan round 3 — §32-1 time off elected instead of overtime pay is priced at nothing and stated as owed', () => {
	const STATUTORY_REST = 'c0000000-0000-4000-8000-0000000000e9';
	const { slips, warnings } = buildStatutory(
		{ code: 'TW', period: '2026-01', riskClass: '1', people: [TW_PERSON] },
		(world) => {
			// Sunday is the statutory 例假 (§36), Saturday the 休息日.
			world.shift_definitions.push({
				...world.shift_definitions[1]!,
				id: STATUTORY_REST,
				code: 'LIJIA',
				name: '例假',
				variant: { kind: 'REST', statutory: true }
			});
			world.shift_patterns[0]!.pattern.days[6] = { roster_code_id: STATUTORY_REST };
			// The 補休 balance expires with the annual-leave year (施行細則 §22-2), read off the catalogue.
			world.leave_catalogue.push(...(leaveCatalogue('TW') as never[]));
			const inLieu = { time_off_in_lieu: true };
			// Monday 09:00–21:00: 3 extended hours under §32(1), elected as 補休: the §24(1) ladder stands aside.
			punch(world, TW_PERSON.key, '2026-01-05', '09:00', '21:00', inLieu);
			// Saturday 休息日 09:00–12:00: 3 hours, elected as 補休 (§32-1 reaches 休息日 work).
			punch(world, TW_PERSON.key, '2026-01-10', '09:00', '12:00', inLieu);
			// Sunday 例假 09:00–13:00: §32-1 does not reach it; §40 pays a further day's wage, 2,000.
			punch(world, TW_PERSON.key, '2026-01-11', '09:00', '13:00', inLieu);
			// Tuesday 09:00–20:00 in an emergency: §32-1 reaches only §32(1)–(2) extensions, so the
			// 2 extended hours are paid at §24(1)(3): 2 × 250 × 2 = 1,000.
			punch(world, TW_PERSON.key, '2026-01-13', '09:00', '20:00', {
				...inLieu,
				emergency_cause: true
			});
		}
	);
	assert.deepEqual(workLines(slips.get(TW_PERSON.key)!), [
		['2026-01-11', 'REST-STATUTORY-DOUBLE', 3.5, 2000],
		['2026-01-13', 'EMERGENCY-2.0X', 2, 1000]
	]);
	// What the two elected days would have paid, which §32-1(2) owes as wages if the time off is
	// not taken by expiry or termination:
	//   Monday   2 × 250 × 4/3 + 1 × 250 × 5/3 = 666.67 + 416.67 = 1,083.33 (1,083.333… to the cent)
	//   Saturday §24(2), the same ladder from the first hour: 1,083.33
	// Six hours in all.
	assert.equal(warnings.length, 1);
	const [warning] = warnings;
	assert.match(
		warning!,
		/^TIME_OFF_IN_LIEU_OWED: TW-60000 elected time off instead of overtime pay for 6 hours /
	);
	assert.ok(warning!.includes('2026-01-05: 3 h, 1083.33; 2026-01-10: 3 h, 1083.33'), warning);
});

test('Singapore round 3 — s.38(4) has no time off in lieu: an elected day is still paid its overtime', () => {
	// s.38(4): extra work "must be paid" at not less than 1.5 × the hourly basic rate. A 2,000
	// monthly salary (inside Part 4, s.35(b): not over 2,600) on the Fourth Schedule:
	// 12 × 2,000 ÷ (52 × 44) = 10.4895 an hour; the fixture's Monday 09:00–21:00 is 11 worked
	// hours, 3 beyond the 8-hour day: 3 × 10.4895 × 1.5 = 47.20.
	const { slips } = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'SG-2000', wage: 2000, citizenship: 'CITIZEN' }]
		},
		(world) => punch(world, 'SG-2000', '2026-01-05', '09:00', '21:00', { time_off_in_lieu: true })
	);
	const lines = workLines(slips.get('SG-2000')!);
	assert.equal(
		lines.reduce((sum, row) => sum + row[2], 0),
		3
	);
	assert.equal(
		lines.reduce((sum, row) => sum + row[3], 0),
		47.2
	);
});
