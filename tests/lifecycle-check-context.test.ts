/**
 * A lifecycle check (`employmentCheckIssues`) reads the stage's whole context, as the run's checks do: the version in
 * force's reference tables (`table()`), the terms' pattern week (`terms.ordinary_hours_per_week`), and a rule date
 * before the lineage's first version is judged on that version's first day, never skipped; a hole in the lineage refuses.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { employmentCheckIssues } from '../src/lib/checks.ts';
import { memoryDb } from './helpers/ctx.ts';

const settled = { approval_id: null };
const version = (id: string, from: string, to: string | null) => ({
	id,
	code: 'LX',
	jurisdiction_code: 'LX',
	sealed_at: '2025-01-01T00:00:00.000Z',
	voided_at: null,
	effective_range: { start: from, end: to },
	facts: [],
	exit_facts: [],
	payroll: { currency: 'XXX' },
	tables: [
		{
			name: 'FLOOR',
			label: 'Floors by worksite',
			keys: ['code'],
			columns: [{ key: 'hourly', type: 'number', label: 'Hourly', required: true }]
		}
	],
	checks: [
		{
			code: 'HOURLY_FLOOR',
			at: 'TERMS_CHANGE',
			when: 'after.pay_frequency == "HOURLY" && table("FLOOR", after.worksite) != null && double(after.basic_salary) < double(table("FLOOR", after.worksite).hourly)',
			severity: 'REFUSE',
			message: 'Below the hourly floor.'
		},
		{
			code: 'LONG_WEEK',
			at: 'TERMS_CHANGE',
			when: 'terms.ordinary_hours_per_week > 40',
			severity: 'REFUSE',
			message: 'Over forty hours a week.'
		}
	],
	...settled
});

const tables = () => ({
	companies: [
		{ id: 'co', settings_code: 'LX', region: null, pay_frequency: 'MONTHLY', facts: {}, ...settled }
	],
	jurisdiction_settings: [
		version('v1', '2025-12-01', '2026-06-30'),
		version('v2', '2026-09-01', null)
	],
	reference_rows: [
		{
			id: 'r1',
			settings_id: 'v1',
			table: 'FLOOR',
			code: 'CITY',
			effective_range: { start: '2025-12-01', end: null },
			values: { hourly: 22 },
			...settled
		}
	],
	employees: [{ id: 'p1', gender: 'F', date_of_birth: '1990-01-01', children: [] }],
	employments: [],
	shift_definitions: [
		{
			id: 'c-day',
			company_id: 'co',
			code: 'DAY',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '17:00', break_minutes: 60 },
			effective_range: { start: '2020-01-01', end: null },
			...settled
		},
		{
			id: 'c-rest',
			company_id: 'co',
			code: 'REST',
			variant: { kind: 'REST' },
			effective_range: { start: '2020-01-01', end: null },
			...settled
		}
	],
	shift_patterns: [
		{
			id: 'six-day',
			company_id: 'co',
			code: 'SIX',
			pattern: {
				days: [
					...Array.from({ length: 6 }, () => ({ roster_code_id: 'c-day' })),
					{ roster_code_id: 'c-rest' }
				]
			},
			effective_range: { start: '2020-01-01', end: null },
			...settled
		}
	]
});

const judge = (
	terms: Record<string, unknown>,
	date: string,
	world: ReturnType<typeof tables> = tables()
) =>
	employmentCheckIssues(memoryDb(world), {
		at: 'TERMS_CHANGE',
		employment: {
			employee_id: 'p1',
			company_id: 'co',
			employee_number: 'E1',
			effective_range: { start: date, end: null }
		},
		terms: [
			{
				id: 't1',
				effective_range: { start: date, end: null },
				currency: 'XXX',
				employment_type: 'PART_TIME',
				shift_pattern_id: null,
				...terms
			}
		],
		date
	}).then((issues) => issues.map((issue) => [issue.code, issue.message]));

const hourly = (rate: number) => ({ pay_frequency: 'HOURLY', base_salary: rate, worksite: 'CITY' });

test('lifecycle checks: table() reads the version in force’s rows — 21.99 refuses, a lawful 22.00 passes', async () => {
	assert.deepEqual(await judge(hourly(21.99), '2026-01-05'), [
		['HOURLY_FLOOR', 'E1: Below the hourly floor.']
	]);
	assert.deepEqual(await judge(hourly(22), '2026-01-05'), []);
});

test('lifecycle checks: the terms’ pattern gives the week — six 8-hour days is 48 hours and refuses', async () => {
	assert.deepEqual(await judge({ ...hourly(30), shift_pattern_id: 'six-day' }, '2026-01-05'), [
		['LONG_WEEK', 'E1: Over forty hours a week.']
	]);
	assert.deepEqual(await judge(hourly(30), '2026-01-05'), []);
});

test('lifecycle checks: terms dated before the first version are judged on its first day; a gap refuses', async () => {
	// 2 June 2025 precedes v1 (1 December 2025): the open-ended row stands on 1 December and meets v1's floor.
	assert.deepEqual(await judge(hourly(21.99), '2025-06-02'), [
		['HOURLY_FLOOR', 'E1: Below the hourly floor.']
	]);
	// A row that closed before the first version met no stated law.
	assert.deepEqual(
		await judge(
			{ ...hourly(21.99), effective_range: { start: '2025-06-02', end: '2025-08-31' } },
			'2025-06-02'
		),
		[]
	);
	// July 2026 falls between v1 and v2: no version covers it.
	assert.deepEqual(await judge(hourly(22), '2026-07-15'), [
		[
			'NO_VERSION_IN_FORCE',
			'E1: LX has no sealed version in force on 2026-07-15, so its TERMS_CHANGE checks cannot be judged. Seal a version whose effective range covers it.'
		]
	]);
});
