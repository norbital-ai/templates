// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRosterMaterialization,
	formatRosterMaterializationRefusal,
	referencedRosterCodeIds
} from '../../src/lib/scheduling/roster-materialization.ts';

const COMPANY = 'company-a';

const range = (start, end = null) => ({ start, end });

const employment = (id, employeeNumber, start, end = start) => ({
	id,
	company_id: COMPANY,
	employee_number: employeeNumber,
	effective_range: range(start, end)
});

const patterned = (anchorDate, ...rosterCodeIds) => ({
	type: 'PATTERNED',
	anchor_date: anchorDate,
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: rosterCodeIds.map((roster_code_id) => ({ roster_code_id }))
		}
	]
});

const rostered = () => ({
	type: 'ROSTERED',
	expectation: { kind: 'AS_ASSIGNED', period: 'MONTH', maximum_paid_minutes: null }
});

const term = (id, employmentId, start, end, workPattern) => ({
	id,
	employment_id: employmentId,
	effective_range: range(start, end),
	work_pattern: workPattern
});

const code = (id, token, kind, start = '2020-01-01', end = null, companyId = COMPANY) => ({
	id,
	company_id: companyId,
	code: token,
	variant:
		kind === 'WORK'
			? { kind, start_time: '08:00', end_time: '17:00', break_minutes: 60 }
			: { kind },
	effective_range: range(start, end)
});

const plan = (overrides = {}) =>
	buildRosterMaterialization({
		company_id: COMPANY,
		month: '2026-08',
		employments: [],
		terms: [],
		roster_codes: [],
		work_days: [],
		...overrides
	});

const requireReady = (result) => {
	assert.equal(result.kind, 'ready', result.kind === 'refused' ? JSON.stringify(result) : '');
	return result;
};

test('materializes complete WORK, REST and OFF person-days through one generic cycle', () => {
	const result = requireReady(
		plan({
			employments: [employment('employment-1', 'EMP001', '2026-08-01', '2026-08-03')],
			terms: [
				term(
					'term-1',
					'employment-1',
					'2026-08-01',
					'2026-08-03',
					patterned('2026-08-01', 'work', 'rest', 'off')
				)
			],
			roster_codes: [
				code('work', 'DAY', 'WORK'),
				code('rest', 'REST', 'REST'),
				code('off', 'OFF', 'OFF')
			]
		})
	);

	assert.equal(result.expected_count, 3);
	assert.equal(result.created_count, 3);
	assert.deepEqual(
		result.work_day_roster.map((day) => [day.work_date, day.assignment_code]),
		[
			['2026-08-01', 'DAY'],
			['2026-08-02', 'REST'],
			['2026-08-03', 'OFF']
		]
	);
	assert.ok(
		result.work_day_roster.every(
			(day) => day.planned_origin === 'GENERATED' && day.planned_note === null
		)
	);
});

test('uses the single term effective on each active boundary date', () => {
	const result = requireReady(
		plan({
			employments: [employment('employment-1', 'EMP001', '2026-08-02', '2026-08-03')],
			terms: [
				term('term-a', 'employment-1', '2026-08-02', '2026-08-02', patterned('2026-08-02', 'day')),
				term('term-b', 'employment-1', '2026-08-03', null, patterned('2026-08-03', 'off'))
			],
			roster_codes: [code('day', 'DAY', 'WORK'), code('off', 'OFF', 'OFF')]
		})
	);

	assert.deepEqual(
		result.work_day_roster.map((day) => [day.work_date, day.shift_definition_id]),
		[
			['2026-08-02', 'day'],
			['2026-08-03', 'off']
		]
	);
});

test('preserves an explicit plan and actual fields while filling an attendance-only row', () => {
	const result = requireReady(
		plan({
			employments: [employment('employment-1', 'EMP001', '2026-08-01', '2026-08-02')],
			terms: [term('term-1', 'employment-1', '2026-08-01', null, patterned('2026-08-01', 'day'))],
			roster_codes: [code('day', 'DAY', 'WORK'), code('manual-rest', 'REST', 'REST')],
			work_days: [
				{
					id: 'explicit-day',
					employment_id: 'employment-1',
					work_date: '2026-08-01',
					shift_definition_id: 'manual-rest',
					roster_id: null,
					assignment_code: 'REST',
					planned_origin: 'MANUAL',
					worked_intervals: []
				},
				{
					id: 'attendance-only-day',
					employment_id: 'employment-1',
					work_date: '2026-08-02',
					shift_definition_id: null,
					roster_id: null,
					worked_intervals: [{ start: '2026-08-02T00:00:00.000Z', end: '2026-08-02T08:00:00.000Z' }]
				}
			]
		})
	);

	assert.equal(result.updated_count, 2);
	assert.equal(result.preserved_explicit_plan_count, 1);
	assert.equal(result.materialized_attendance_only_count, 1);
	assert.deepEqual(result.work_day_roster[0], { id: 'explicit-day' });
	assert.deepEqual(result.work_day_roster[1], {
		id: 'attendance-only-day',
		shift_definition_id: 'day',
		assignment_code: 'DAY',
		planned_origin: 'GENERATED',
		planned_note: null
	});
	assert.equal('worked_intervals' in result.work_day_roster[0], false);
	assert.equal('worked_intervals' in result.work_day_roster[1], false);
});

test('collects every unresolved ROSTERED employee-date before refusing the graph', () => {
	const result = plan({
		employments: [employment('employment-1', 'EMP001', '2026-08-01', '2026-08-03')],
		terms: [term('term-1', 'employment-1', '2026-08-01', null, rostered())],
		roster_codes: [code('day', 'DAY', 'WORK')],
		work_days: [
			{
				id: 'explicit-day',
				employment_id: 'employment-1',
				work_date: '2026-08-01',
				shift_definition_id: 'day',
				roster_id: null
			}
		]
	});

	assert.equal(result.kind, 'refused');
	const unresolved = result.diagnostics.filter(
		(diagnostic) => diagnostic.code === 'ROSTERED_ASSIGNMENT_MISSING'
	);
	assert.deepEqual(
		unresolved.map((diagnostic) => diagnostic.work_date),
		['2026-08-02', '2026-08-03']
	);
	assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'INCOMPLETE_GRAPH'));
});

test('refuses missing and ambiguous terms, wrong-company and ineffective codes, and duplicates', () => {
	const result = plan({
		employments: [employment('employment-1', 'EMP001', '2026-08-01', '2026-08-04')],
		terms: [
			term('term-a', 'employment-1', '2026-08-02', '2026-08-02', patterned('2026-08-02', 'day')),
			term('term-b', 'employment-1', '2026-08-02', '2026-08-02', patterned('2026-08-02', 'day')),
			term(
				'term-c',
				'employment-1',
				'2026-08-03',
				'2026-08-03',
				patterned('2026-08-03', 'foreign')
			),
			term('term-d', 'employment-1', '2026-08-04', '2026-08-04', patterned('2026-08-04', 'expired'))
		],
		roster_codes: [
			code('day', 'DAY', 'WORK'),
			code('foreign', 'FOREIGN', 'REST', '2020-01-01', null, 'company-b'),
			code('expired', 'OLD', 'OFF', '2020-01-01', '2026-08-03')
		],
		work_days: [
			{
				id: 'duplicate-a',
				employment_id: 'employment-1',
				work_date: '2026-08-04',
				shift_definition_id: null,
				roster_id: null
			},
			{
				id: 'duplicate-b',
				employment_id: 'employment-1',
				work_date: '2026-08-04',
				shift_definition_id: null,
				roster_id: null
			}
		]
	});

	assert.equal(result.kind, 'refused');
	const diagnosticCodes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));
	for (const expected of [
		'DUPLICATE_PERSON_DAY',
		'MISSING_TERM',
		'AMBIGUOUS_TERM',
		'ROSTER_CODE_WRONG_COMPANY',
		'ROSTER_CODE_INEFFECTIVE',
		'INCOMPLETE_GRAPH'
	]) {
		assert.ok(diagnosticCodes.has(expected), `missing ${expected}`);
	}
});

test('collects every referenced pattern and explicit roster-code id in one bounded set', () => {
	assert.deepEqual(
		referencedRosterCodeIds(
			[
				term(
					'term-1',
					'employment-1',
					'2026-08-01',
					null,
					patterned('2026-08-01', 'work', 'rest', 'work')
				)
			],
			[
				{
					id: 'day-1',
					employment_id: 'employment-1',
					work_date: '2026-08-01',
					shift_definition_id: 'manual',
					roster_id: null
				}
			]
		),
		['manual', 'rest', 'work']
	);
});

test('the refusal formatter includes every employee-date diagnostic without truncation', () => {
	const diagnostics = Array.from({ length: 25 }, (_value, index) => ({
		code: 'ROSTERED_ASSIGNMENT_MISSING',
		message: `EMP001 on 2026-08-${String(index + 1).padStart(2, '0')} is unresolved.`
	}));
	const message = formatRosterMaterializationRefusal('Example Co', '2026-08', diagnostics);
	assert.match(message, /25 validation check/);
	assert.match(message, /2026-08-25 is unresolved/);
});
