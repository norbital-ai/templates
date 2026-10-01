// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * LIT-07: the overtime keying unit is the version's `work_rules.overtime_unit_hours`. It is the step
 * a binding cap floors approved hours to (split and headroom), the step a direct write refuses a
 * figure off, and the threshold below which clock hours past the plan are not reported. The law is
 * silent in every lineage, so every seed version states the recorded default 0.5 (tracker LIT-07).
 * Every figure below is computed by hand.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { workRulesValueSchema } from '../src/lib/datatypes/work_rules.ts';
import { validateUnplannedOvertime } from '../src/lib/payroll/run/validate.ts';
import { overtimeHeadroom, splitPlannedOvertime } from '../src/lib/scheduling/work-limits.ts';
import { VERSION, workDayTables, writeDay } from './helpers/work-day-db.ts';

// A 9.25-hour shift under a 12-hour DAY total leaves 12 − 9.25 = 2.75 h of overtime headroom.
const daily = [
	{
		key: 'daily_total',
		period: 'DAY',
		measure: 'TOTAL_WORK_HOURS',
		max_hours: 12,
		unit: 'WORKED_HOURS'
	}
];
const shift = {
	date: '2026-07-01',
	kind: 'WORK',
	paid_minutes: 555,
	break_minutes: 60,
	spread_hours: 10
};

test('the split floors a binding cap to the unit: 2.75 h headroom of a 4 h total', () => {
	const split = (unitHours) => {
		const day = splitPlannedOvertime({
			days: [{ ...shift, total_overtime_hours: 4 }],
			limits: daily,
			unitHours
		}).get('2026-07-01');
		return [day.approved_overtime_hours, day.incentive_hours];
	};
	assert.deepEqual(split(0.25), [2.75, 1.25], '2.75 is 11 quarter hours');
	assert.deepEqual(split(0.5), [2.5, 1.5], 'floor(2.75 / 0.5) = 5 steps');
	assert.deepEqual(split(1), [2, 2], 'floor(2.75 / 1) = 2 steps');
});

test('the headroom a day sheet offers floors to the same unit', () => {
	const maximum = (unitHours) =>
		overtimeHeadroom({
			days: [{ ...shift, approved_overtime_hours: 0 }],
			limits: daily,
			unitHours
		}).maximum.get('2026-07-01').hours;
	assert.equal(maximum(0.25), 2.75);
	assert.equal(maximum(0.5), 2.5);
	assert.equal(maximum(1), 2);
});

test('unplanned clock hours below one unit are not reported', () => {
	// 8.4 h on the clock over an 8 h normal day, nothing planned: 0.4 h unplanned.
	const issues = (unitHours) =>
		validateUnplannedOvertime({
			employeeNumber: 'E1',
			days: [
				{
					dayType: 'ORDINARY',
					workDayId: 'wd-1',
					date: '2026-07-01',
					totalWorkHours: 8.4,
					normalHours: 8
				}
			],
			plannedByWorkDayId: new Map(),
			unitHours
		}).map((issue) => issue.code);
	assert.deepEqual(issues(0.5), [], '0.4 < 0.5');
	assert.deepEqual(issues(0.25), ['UNPLANNED_OVERTIME'], '0.4 ≥ 0.25');
});

test('a direct write is keyed in the governing version’s unit', async () => {
	const plan = (unit, approved_overtime_hours) =>
		writeDay(
			workDays,
			{
				employment_id: 'emp-1',
				work_date: '2026-07-01',
				approved_overtime_hours,
				incentive_hours: 0
			},
			undefined,
			workDayTables({
				versions: [
					{
						...VERSION,
						work_rules: { limits: [], bands: [], breaks: [], overtime_unit_hours: unit }
					}
				]
			})
		);
	await plan(0.25, 1.25);
	await assert.rejects(
		plan(0.25, 1.1),
		/1\.1 h on 2026-07-01 is not keyed in the 0\.25-hour steps/
	);
	await assert.rejects(plan(1, 1.5), /1\.5 h on 2026-07-01 is not keyed in the 1-hour steps/);
	await plan(1, 2);
});

test('the unit is a positive number every version states; every seed lineage states 0.5, JP one minute', () => {
	const seeds = new URL('../seed/jurisdiction/', import.meta.url);
	const units = readdirSync(seeds).flatMap((lineage) =>
		JSON.parse(readFileSync(new URL(`${lineage}/jurisdiction_settings.json`, seeds), 'utf8')).map(
			(version) => ({ lineage, work: version.work_rules })
		)
	);
	assert.ok(units.length > 0);
	// 労働基準法 §§24, 37 with 昭和63年基発第150号: every minute of overtime is paid, no daily rounding.
	for (const { lineage, work } of units)
		assert.equal(work.overtime_unit_hours, lineage === 'JP' ? 1 / 60 : 0.5, lineage);
	const rules = units.map(({ work }) => work);
	const decode = Schema.decodeUnknownSync(workRulesValueSchema);
	const { overtime_unit_hours: _, ...without } = rules[0];
	assert.throws(() => decode(without));
	assert.throws(() => decode({ ...rules[0], overtime_unit_hours: 0 }));
	assert.equal(decode({ ...rules[0], overtime_unit_hours: 0.25 }).overtime_unit_hours, 0.25);
});
