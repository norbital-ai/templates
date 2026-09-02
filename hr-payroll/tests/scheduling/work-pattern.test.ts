// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { patternRosterCodeId, patternWorkload } from '../../src/lib/scheduling/work-pattern.ts';
import { workWindow } from '../../src/lib/scheduling/roster-code.ts';

const DAY = '00000000-0000-4000-8000-000000000001';
const NIGHT = '00000000-0000-4000-8000-000000000002';
const REST = '00000000-0000-4000-8000-000000000003';
const OFF = '00000000-0000-4000-8000-000000000004';
const codes = new Map([
	[
		DAY,
		{
			code: 'DAY',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 }
		}
	],
	[
		NIGHT,
		{
			code: 'NIGHT',
			variant: { kind: 'WORK', start_time: '20:00', end_time: '08:00', break_minutes: 60 }
		}
	],
	[REST, { code: 'REST', variant: { kind: 'REST' } }],
	[OFF, { code: 'OFF', variant: { kind: 'OFF' } }]
]);

test('one seven-day cycle normalizes a fixed five-day employment', () => {
	const pattern = {
		type: 'PATTERNED',
		anchor_date: '2026-08-03',
		phases: [
			{
				duration: { kind: 'CONTINUOUS' },
				day_cycle: [DAY, DAY, DAY, DAY, DAY, OFF, REST].map((roster_code_id) => ({
					roster_code_id
				}))
			}
		]
	};
	assert.equal(patternRosterCodeId(pattern, '2026-08-08'), OFF);
	assert.equal(patternRosterCodeId(pattern, '2026-08-09'), REST);
	assert.equal(patternRosterCodeId(pattern, '2026-08-02'), REST);
	assert.deepEqual(patternWorkload(pattern, codes), {
		work_days: 5,
		paid_minutes: 2400,
		reference_days: 7,
		average_weekly_paid_minutes: 2400
	});
});

test('calendar-month phases model three months of days then three months of nights', () => {
	const pattern = {
		type: 'PATTERNED',
		anchor_date: '2026-01-01',
		phases: [
			{ duration: { kind: 'CALENDAR_MONTHS', months: 3 }, day_cycle: [{ roster_code_id: DAY }] },
			{ duration: { kind: 'CALENDAR_MONTHS', months: 3 }, day_cycle: [{ roster_code_id: NIGHT }] }
		]
	};
	assert.equal(patternRosterCodeId(pattern, '2026-03-31'), DAY);
	assert.equal(patternRosterCodeId(pattern, '2025-12-31'), NIGHT);
	assert.equal(patternRosterCodeId(pattern, '2026-04-01'), NIGHT);
	assert.equal(patternRosterCodeId(pattern, '2026-07-01'), DAY);
	assert.equal(patternRosterCodeId(pattern, '2027-01-01'), DAY);
});

test('crossing midnight and paid minutes derive from the WORK code', () => {
	assert.deepEqual(workWindow(codes.get(NIGHT)!.variant), {
		start_time: '20:00',
		end_time: '08:00',
		break_minutes: 60,
		crosses_midnight: true,
		elapsed_minutes: 720,
		paid_minutes: 660
	});
});

test('monthly-rostered guarantees expose only the non-derivable contractual expectation', () => {
	assert.deepEqual(
		patternWorkload(
			{
				type: 'ROSTERED',
				expectation: {
					kind: 'GUARANTEED_SCHEDULE',
					period: 'WEEK',
					required_work_days: 3,
					required_paid_minutes: 1440
				}
			},
			codes
		),
		{
			work_days: 3,
			paid_minutes: 1440,
			reference_days: 7,
			average_weekly_paid_minutes: 1440
		}
	);
});
