// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRosterMonth,
	employmentMonthEmptyReason,
	employmentOverlapsMonth,
	monthProgress,
	shiftTimeCue
} from '../ui/roster/roster-month.ts';

const employment = (start, end = null) => ({
	norbital_id: 'employment-1',
	effective_range: { start, end }
});

test('month membership uses interval overlap, not current employment state', () => {
	assert.equal(employmentOverlapsMonth(employment('2026-07-15', '2026-08-12'), '2026-08'), true);
	assert.equal(employmentOverlapsMonth(employment('2026-06-01', '2026-07-31'), '2026-08'), false);
	assert.equal(employmentOverlapsMonth(employment('2026-09-01'), '2026-08'), false);
	assert.equal(
		employmentMonthEmptyReason([employment('2026-01-01', '2026-07-31')], '2026-08'),
		'ENDED'
	);
	assert.equal(employmentMonthEmptyReason([employment('2026-09-01')], '2026-08'), 'NOT_STARTED');
});

test('a mid-month exit remains on the board and marks only later days as ended', () => {
	const facts = buildRosterMonth({
		month: '2026-08',
		employments: [employment('2026-07-01', '2026-08-12')],
		rosterEntries: [],
		timeEntries: [],
		leaveRequests: [],
		holidays: [],
		rosterCodesById: new Map(),
		employmentTerms: [],
		leaveCodeById: new Map(),
		cutoff: null
	});
	assert.equal(facts.get('employment-1:2026-08-12')?.status, 'UNROSTERED');
	assert.equal(facts.get('employment-1:2026-08-13')?.status, 'EXITED');
});

test('dense cells expose a compact AM/PM time axis', () => {
	assert.equal(shiftTimeCue({ shiftStart: '09:00', shiftEnd: '18:30' }), '9a–6:30p');
	assert.equal(shiftTimeCue({ shiftStart: null, shiftEnd: null }), null);
});

test('a monthly roster stays blank until a day is assigned', () => {
	const facts = buildRosterMonth({
		month: '2026-08',
		employments: [employment('2026-01-01')],
		rosterEntries: [],
		timeEntries: [],
		leaveRequests: [],
		holidays: [],
		rosterCodesById: new Map(),
		employmentTerms: [
			{
				employment_id: 'employment-1',
				work_pattern: {
					type: 'ROSTERED',
					expectation: {
						kind: 'AS_ASSIGNED',
						period: 'MONTH',
						maximum_paid_minutes: null
					}
				},
				effective_range: { start: '2026-01-01' }
			}
		],
		leaveCodeById: new Map(),
		cutoff: null
	});
	assert.equal(facts.get('employment-1:2026-08-01')?.status, 'UNROSTERED');
	assert.equal(facts.get('employment-1:2026-08-01')?.scheduleKind, 'ROSTERED');
	const progress = monthProgress(facts, 'DRAFT');
	assert.equal(progress.peopleNeedingAssignment, 1);
	assert.equal(progress.exceptions.length, 0);
});

test('a repeating week fills itself in and is not counted as unfinished', () => {
	const day = '00000000-0000-4000-8000-000000000001';
	const rest = '00000000-0000-4000-8000-000000000002';
	const facts = buildRosterMonth({
		month: '2026-08',
		employments: [employment('2026-01-01')],
		rosterEntries: [],
		timeEntries: [],
		leaveRequests: [],
		holidays: [],
		rosterCodesById: new Map([
			[
				day,
				{
					code: 'DAY',
					variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 }
				}
			],
			[rest, { code: 'REST', variant: { kind: 'REST' } }]
		]),
		employmentTerms: [
			{
				employment_id: 'employment-1',
				work_pattern: {
					type: 'PATTERNED',
					anchor_date: '2026-08-03',
					phases: [
						{
							duration: { kind: 'CONTINUOUS' },
							day_cycle: [
								{ roster_code_id: day },
								{ roster_code_id: day },
								{ roster_code_id: day },
								{ roster_code_id: day },
								{ roster_code_id: day },
								{ roster_code_id: rest },
								{ roster_code_id: rest }
							]
						}
					]
				},
				effective_range: { start: '2026-01-01' }
			}
		],
		leaveCodeById: new Map(),
		cutoff: null
	});
	assert.equal(facts.get('employment-1:2026-08-03')?.status, 'PLANNED');
	assert.equal(facts.get('employment-1:2026-08-03')?.scheduleKind, 'PATTERNED');
	assert.equal(facts.get('employment-1:2026-08-08')?.status, 'REST');
	assert.equal(monthProgress(facts, 'DRAFT').peopleNeedingAssignment, 0);
});
