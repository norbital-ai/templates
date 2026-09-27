import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';

// Direct catalogue probes, not saved-input or payroll evidence. SG Part-Time
// Regulations reg.8 and MOM's part-time leave guidance preserve sick leave as
// leave; cashing it out must not debit the statutory entitlement.
const leaves: { id: string; code: string; can_encash: boolean }[] = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
);
for (const row of leaves.filter((row) =>
	['SICK_LEAVE', 'HOSPITALIZATION_LEAVE'].includes(row.code)
))
	test(`SG ${row.id}: ${row.code} cannot be exchanged for cash`, () => {
		assert.equal(row.can_encash, false);
	});

// Reg.5(2) disapplies EA s.38(6)'s Fourth Schedule hourly-rate calculation.
// It does not disapply s.38(5)'s 72-hour cap. Test covered workers on both sides
// of the 35-hour part-time definition, including a permanent part-time contract.
const engine = new Environment({ unlistedVariablesAreDyn: true });
const settings: {
	id: string;
	work_rules: {
		normal_hours: string;
		limits: { key: string; when?: string; max_hours?: number }[];
	};
}[] = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/SG/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);
for (const version of settings)
	for (const key of ['monthly_ot', 'monthly_ot_all'])
		for (const [type, weeklyHours] of [
			['PERMANENT', 20],
			['PART_TIME', 34.5],
			['PERMANENT', 35]
		] as const)
			test(`SG ${version.id}: ${key} retains 72h for ${type}, ${weeklyHours}h/week`, () => {
				const limit = version.work_rules.limits.find((row) => row.key === key);
				assert.ok(limit);
				assert.equal(limit.max_hours, 72);
				const person = {
					employment: { type, classification: 'EA_COVERED' },
					terms: {
						ordinary_hours_per_week: weeklyHours,
						monthly_basic: 1000,
						statutory_work_category: 'NON_MANUAL'
					}
				};
				assert.equal(engine.evaluate(limit.when?.trim() || 'true', person), true);
			});

// EA s.38(1)(d): an agreed shorter day can support days up to nine hours,
// including a six-day week. The pattern 8.5h*5 + 1.5h is a 44-hour example.
for (const version of settings)
	for (const [days, weeklyHours, expected] of [
		[5, 40, 9],
		[6, 44, 9],
		[6, 48, 8],
		[6, 0, 8]
	] as const)
		test(`SG ${version.id}: normal-day ceiling, ${days} days and ${weeklyHours}h/week`, () => {
			const actual = engine.evaluate(version.work_rules.normal_hours, {
				terms: { working_days_per_week: days, ordinary_hours_per_week: weeklyHours }
			});
			assert.equal(actual, expected);
		});
