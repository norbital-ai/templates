import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateBoolean,
	evaluateNumber,
	expressionEngine
} from '../src/lib/expressions/evaluate.ts';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

// Labour Code 45/2019/QH14 arts.98(1)(a), 105(1)–(2), Official Gazette 993+994 pp.43,46:
// https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf
test('Vietnam — art.105 selects eight daily or ten weekly normal hours in every version', () => {
	for (const version of settingsVersions('VN')) {
		for (const [facts, hours] of [
			[{}, 8],
			[{ normal_hours_arrangement: 'DAILY' }, 8],
			[{ normal_hours_arrangement: 'WEEKLY' }, 10]
		] as const) {
			assert.equal(
				evaluateNumber(expressionEngine, version.work_rules.normal_hours, { terms: { facts } }),
				hours
			);
		}
		const gate = version.checks.find((row) => row.code === 'NORMAL_WEEK_OVER_48_HOURS')!;
		assert.ok(gate);
		for (const [hours, refused] of [
			[48, false],
			[49, true]
		] as const) {
			assert.equal(
				evaluateBoolean(expressionEngine, gate.when, { terms: { ordinary_hours_per_week: hours } }),
				refused
			);
		}
	}
});

test('Vietnam — art.105 notification date cannot follow the terms effective date', () => {
	for (const version of settingsVersions('VN')) {
		const gate = version.checks.find((row) => row.code === 'NORMAL_HOURS_NOTIFICATION_REQUIRED')!;
		assert.ok(gate);
		for (const [facts, refused] of [
			[{}, false],
			[{ normal_hours_arrangement: 'WEEKLY' }, true],
			[{ normal_hours_arrangement: 'WEEKLY', normal_hours_notified_on: '2026-01-31' }, false],
			[{ normal_hours_arrangement: 'DAILY', normal_hours_notified_on: '2026-02-01' }, false],
			[{ normal_hours_arrangement: 'WEEKLY', normal_hours_notified_on: '2026-02-02' }, true]
		] as const) {
			assert.equal(
				evaluateBoolean(expressionEngine, gate.when, {
					terms: { facts },
					check: { date: '2026-02-01' }
				}),
				refused
			);
		}
	}
});

test('Vietnam — art.105 weekly ten-hour day prices only hour eleven at 150 percent', () => {
	// Four normal ten-hour days = forty hours a week. VND100,000/hour × one overtime
	// hour × 150% = VND150,000; hours nine and ten earn no overtime premium.
	const { slips } = buildStatutory(
		{
			code: 'VN',
			period: '2026-02',
			region: 'I',
			people: [
				{ key: 'WEEKLY', wage: 100_000, pay_frequency: 'HOURLY', ordinary_hours_per_week: 40 }
			]
		},
		(world) => {
			for (const terms of world.employment_terms) {
				terms.facts = {
					...terms.facts,
					normal_hours_arrangement: 'WEEKLY',
					normal_hours_notified_on: '2014-12-31'
				};
			}
			const shift = world.shift_definitions.find((row) => row.variant.kind === 'WORK')!;
			shift.variant = { kind: 'WORK', start_time: '09:00', end_time: '20:00', break_minutes: 60 };
			const rest = world.shift_definitions.find((row) => row.variant.kind === 'REST')!;
			world.shift_patterns[0]!.pattern.days[4] = { roster_code_id: rest.id };
			world.work_days.push({
				id: 'wd-WEEKLY-2026-02-02',
				employment_id: world.employments[0]!.id,
				work_date: '2026-02-02',
				shift_definition_id: null,
				worked_intervals: [
					{ start: '2026-02-02T09:00:00+07:00', end: '2026-02-02T13:00:00+07:00' },
					{ start: '2026-02-02T14:00:00+07:00', end: '2026-02-02T21:00:00+07:00' }
				],
				approval_id: null
			});
		}
	);
	const overtime = slips.get('WEEKLY')!.adjustments.filter((row) => row.family === 'WORK_DAY');
	assert.deepEqual(
		overtime.map((row) => [row.label, row.quantity, row.amount]),
		[['OT-1.5X', 1, 150_000]]
	);
});
