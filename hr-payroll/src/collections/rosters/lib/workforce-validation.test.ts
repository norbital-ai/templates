// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRosterSchedule } from './workforce-validation.ts';

const DAY = { code: 'DAY', start_time: '09:00', end_time: '18:00', break_minutes: 60 };
const NIGHT = { code: 'NIGHT', start_time: '22:00', end_time: '06:00', break_minutes: 60 };

function work(employment_id, work_date, shift = DAY) {
	return { employment_id, work_date, designation: 'WORK', shift };
}

test('an exact patterned load accepts the derived month', () => {
	assert.deepEqual(
		validateRosterSchedule({
			days: [work('e1', '2026-08-03'), work('e1', '2026-08-04')],
			expectations: [{ employment_id: 'e1', kind: 'EXACT', work_days: 2, paid_minutes: 960 }]
		}),
		[]
	);
});

test('replacing a patterned workday with an off day is caught at publication', () => {
	const violations = validateRosterSchedule({
		days: [
			work('e1', '2026-08-03'),
			{ employment_id: 'e1', work_date: '2026-08-04', designation: 'OFF', shift: null }
		],
		expectations: [{ employment_id: 'e1', kind: 'EXACT', work_days: 2, paid_minutes: 960 }]
	});
	assert.equal(violations[0].code, 'WORKLOAD_DIFFERS_FROM_PATTERN');
});

test('a guaranteed rostered load is a minimum', () => {
	const violations = validateRosterSchedule({
		days: [work('e1', '2026-08-03')],
		expectations: [{ employment_id: 'e1', kind: 'MINIMUM', work_days: 2, paid_minutes: 960 }]
	});
	assert.equal(violations[0].code, 'WORKLOAD_BELOW_TERMS');
});

test('as-assigned work can be capped without inventing required days', () => {
	const violations = validateRosterSchedule({
		days: [work('e1', '2026-08-03'), work('e1', '2026-08-04')],
		expectations: [{ employment_id: 'e1', kind: 'MAXIMUM', work_days: null, paid_minutes: 900 }]
	});
	assert.equal(violations[0].code, 'WORKLOAD_ABOVE_TERMS');
});

test('cross-midnight paid minutes are derived from the roster code', () => {
	assert.deepEqual(
		validateRosterSchedule({
			days: [work('e1', '2026-08-03', NIGHT)],
			expectations: [{ employment_id: 'e1', kind: 'EXACT', work_days: 1, paid_minutes: 420 }]
		}),
		[]
	);
});

test('a missing code is explicit rather than silently inferred as rest', () => {
	const violations = validateRosterSchedule({
		days: [{ employment_id: 'e1', work_date: '2026-08-03', designation: null, shift: null }],
		expectations: []
	});
	assert.equal(violations[0].code, 'SCHEDULE_CODE_MISSING');
});
