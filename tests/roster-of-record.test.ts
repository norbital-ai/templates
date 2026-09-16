// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A roster of record outranks the shift pattern; without one the pattern is the contract. A
 * roster is whole or a run refuses it, its cycle is resolved from the entity's cutoff, and a
 * pattern's cycle is whole weeks so every day has an answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { resolveSchedule } from '../src/collections/payroll_runs/lib/schedule.ts';
import { payrollRunPrecheck } from '../src/collections/payroll_runs/lib/precheck.ts';
import rosterHooks from '../src/collections/rosters/+hooks.ts';
import patternHooks from '../src/collections/shift_patterns/+hooks.ts';

const range = { start: '2020-01-01', end: null };
const DAY_ID = '00000000-0000-4000-8000-000000000001';
const REST_ID = '00000000-0000-4000-8000-000000000003';
const OFF_ID = '00000000-0000-4000-8000-000000000004';
const code = (id, value, variant) => ({
	id,
	code: value,
	name: value,
	variant,
	effective_range: range
});
const DAY = code(DAY_ID, 'D', {
	kind: 'WORK',
	start_time: '08:30',
	end_time: '17:30',
	break_minutes: 60
});
const REST = code(REST_ID, 'REST', { kind: 'REST' });
const OFF = code(OFF_ID, 'OFF', { kind: 'OFF' });
const shiftById = new Map([DAY, REST, OFF].map((row) => [row.id, row]));
const weeklyPattern = {
	days: [DAY_ID, DAY_ID, DAY_ID, DAY_ID, DAY_ID, OFF_ID, REST_ID].map((roster_code_id) => ({
		roster_code_id
	}))
};
const terms = () => ({
	work_pattern: weeklyPattern,
	pattern_anchor: '2026-03-02',
	normal_daily_hours: 8
});
const configuration = { holidayRestPrecedence: 'REST_DAY', shiftById, holidays: new Map() };
const sunday = '2026-03-08';

test('a rostered WORK day on a patterned rest day is an ordinary day: the roster is the contract', () => {
	const schedule = resolveSchedule({
		window: { start: sunday, end: sunday },
		dates: [sunday],
		terms,
		workDays: [{ work_date: sunday, shift_definition_id: DAY_ID }],
		rosters: [{ start: '2026-03-02', end: '2026-03-08' }],
		configuration
	});
	assert.equal(schedule.get(sunday).dayType, 'ORDINARY');
	assert.equal(schedule.get(sunday).shift.code, 'D');
});

test('the same row without a roster keeps the pattern as the baseline', () => {
	const schedule = resolveSchedule({
		window: { start: sunday, end: sunday },
		dates: [sunday],
		terms,
		workDays: [{ work_date: sunday, shift_definition_id: DAY_ID }],
		configuration
	});
	assert.equal(schedule.get(sunday).dayType, 'REST_DAY');
});

test('a rostered REST day on a patterned work day is a rest day', () => {
	const friday = '2026-03-06';
	const schedule = resolveSchedule({
		window: { start: friday, end: friday },
		dates: [friday],
		terms,
		workDays: [{ work_date: friday, shift_definition_id: REST_ID }],
		rosters: [{ start: '2026-03-02', end: '2026-03-08' }],
		configuration
	});
	assert.equal(schedule.get(friday).dayType, 'REST_DAY');
});

const precheckConfiguration = {
	holidayRestPrecedence: 'REST_DAY',
	shiftById,
	holidays: new Map(),
	patternById: new Map(),
	jurisdiction: { id: 'j', code: 'TEST' },
	work: { proration: { by: 'CALENDAR_DAYS' }, bands: [], limits: [] },
	catalogueComponents: [],
	contributions: [],
	company: { id: 'c', name: 'Test Co' }
};
const bundle = (workDays, rosters = [{ start: '2026-03-02', end: '2026-03-08' }]) => ({
	employment: { id: 'e', employee_number: 'E-1' },
	termsHistory: [],
	workDays,
	rosters,
	attendance: { start: '2026-03-02', end: '2026-03-08' },
	employedDays: { start: '2026-03-02', end: '2026-03-08' },
	deferral: null
});
const rosteredWeek = (missing = []) =>
	['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']
		.filter((date) => !missing.includes(date))
		.map((date) => ({
			work_date: date,
			shift_definition_id: DAY_ID,
			roster_id: 'roster-1',
			worked_intervals: null
		}));

const rosterIssues = (workDays, rosters) =>
	payrollRunPrecheck({
		configuration: precheckConfiguration,
		window: { period: '2026-03', attendance: { start: '2026-03-02', end: '2026-03-08' } },
		bundles: [bundle(workDays, rosters)]
	}).filter((issue) => issue.code === 'ROSTER_INCOMPLETE');

test('a roster covering every day of the cycle raises nothing', () => {
	assert.deepEqual(rosterIssues(rosteredWeek()), []);
});

test('a roster with a day missing, or a day without a shift, is refused and names the dates', () => {
	const missing = rosterIssues(rosteredWeek(['2026-03-05']));
	assert.equal(missing.length, 1);
	assert.match(missing[0].message, /E-1's roster of record/);
	assert.match(missing[0].message, /2026-03-05/);
	const blank = rosteredWeek().map((day) =>
		day.work_date === '2026-03-07' ? { ...day, shift_definition_id: null } : day
	);
	assert.match(rosterIssues(blank)[0].message, /2026-03-07/);
});

test('days with no roster at all are the pattern’s business, not the roster check’s', () => {
	assert.deepEqual(rosterIssues(rosteredWeek(['2026-03-05']), []), []);
});

const rosterApi = {
	db: {
		companies: {
			findMany: () =>
				Effect.succeed([
					{ id: 'monthly', pay_frequency: 'MONTHLY', pay_cutoff_day: 21 },
					{ id: 'halves', pay_frequency: 'SEMI_MONTHLY', pay_cutoff_day: 15 }
				])
		}
	}
};
const createRoster = async (input) => {
	const prepared = await Effect.runPromise(
		rosterHooks.mutate.prepare({ inputs: [input], api: rosterApi })
	);
	return Effect.runPromise(
		rosterHooks.mutate.perRecord.before.handler({
			input,
			existing: undefined,
			prepared,
			api: rosterApi
		})
	);
};

test('a roster resolves its cycle from the entity cutoff: 21st to 20th at a monthly entity', async () => {
	const out = await createRoster({
		employment_id: 'e',
		company_id: 'monthly',
		period: '2026-01',
		origin: 'IMPORT'
	});
	assert.deepEqual(out.range, {
		start: '2025-12-21T00:00:00.000Z',
		end: '2026-01-20T00:00:00.000Z'
	});
});

test('a semi-monthly roster is one half, and a monthly one is not', async () => {
	const half = await createRoster({
		employment_id: 'e',
		company_id: 'halves',
		period: '2026-03-2',
		origin: 'IMPORT'
	});
	assert.deepEqual(half.range, {
		start: '2026-03-16T00:00:00.000Z',
		end: '2026-03-31T00:00:00.000Z'
	});
	await assert.rejects(
		createRoster({ employment_id: 'e', company_id: 'halves', period: '2026-03', origin: 'IMPORT' }),
		/pays by the half/
	);
	await assert.rejects(
		createRoster({
			employment_id: 'e',
			company_id: 'monthly',
			period: '2026-03-1',
			origin: 'IMPORT'
		}),
		/pays monthly/
	);
});

test('a shift pattern cycle is whole weeks', async () => {
	const handler = patternHooks.mutate.perRecord.before.handler;
	await assert.rejects(
		Effect.runPromise(
			handler({
				input: {
					pattern: { days: Array.from({ length: 10 }, () => ({ roster_code_id: DAY_ID })) }
				},
				existing: undefined,
				api: { db: {} }
			})
		),
		/whole weeks; this one has 10 days/
	);
});
