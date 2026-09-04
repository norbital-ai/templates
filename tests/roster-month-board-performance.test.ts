// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { buildRosterMonth, monthDays } from '../src/lib/ui/roster/roster-month.ts';
import { decodeNumber } from '@norbital-ai/std/json';

const EMPLOYEE_COUNT = 290;
const MONTH = '2026-06';
const DAYS = monthDays(MONTH);
const EXPECTED_PERSON_DAYS = EMPLOYEE_COUNT * DAYS.length;
const ITERATIONS = 12;

const percentile95 = (values: readonly number[]): number =>
	values.toSorted((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1] ?? 0;

test('realistic month board benchmarks database, payload, and client matrix as bounded work', (t) => {
	const database = new DatabaseSync(':memory:');
	database.exec(`
		create table employments (
			id text primary key,
			company_id text not null,
			effective_start text not null,
			effective_end text
		);
		create table work_days (
			id text primary key,
			employment_id text not null,
			work_date text not null,
			shift_definition_id text,
			planned_origin text,
			worked_intervals text,
			break_minutes integer
		);
		create index work_days_employment_date on work_days (employment_id, work_date);
		create index work_days_date on work_days (work_date);
	`);
	const insertEmployment = database.prepare('insert into employments values (?, ?, ?, ?)');
	const insertWorkDay = database.prepare('insert into work_days values (?, ?, ?, ?, ?, ?, ?)');
	database.exec('begin');
	for (let employee = 0; employee < EMPLOYEE_COUNT; employee += 1) {
		const employmentId = `employment-${String(employee).padStart(4, '0')}`;
		insertEmployment.run(employmentId, 'company-1', '2026-01-01', null);
		for (const [dayIndex, date] of DAYS.entries()) {
			const attended = dayIndex % 3 !== 0;
			insertWorkDay.run(
				`${employmentId}:${date}`,
				employmentId,
				date,
				'code-day',
				'IMPORT',
				attended
					? JSON.stringify([
							{
								start: `${date}T00:00:00.000Z`,
								end: `${date}T09:00:00.000Z`
							}
						])
					: null,
				attended ? 60 : null
			);
		}
	}
	database.exec('commit');

	const query = database.prepare(`
		select w.*
		from work_days w
		join employments e on e.id = w.employment_id
		where e.company_id = ? and w.work_date >= ? and w.work_date <= ?
		order by w.employment_id, w.work_date
	`);
	const employments = Array.from({ length: EMPLOYEE_COUNT }, (_, employee) => ({
		id: `employment-${String(employee).padStart(4, '0')}`,
		effective_range: { start: '2026-01-01', end: null }
	}));
	const databaseTimes: number[] = [];
	const matrixTimes: number[] = [];
	let payloadBytes = 0;
	let matrixSize = 0;

	for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
		const databaseStarted = performance.now();
		const selected = query.all('company-1', DAYS[0], DAYS.at(-1));
		databaseTimes.push(performance.now() - databaseStarted);
		assert.equal(selected.length, EXPECTED_PERSON_DAYS);
		payloadBytes = Buffer.byteLength(JSON.stringify(selected));

		const workDays = selected.map((row) => ({
			...row,
			worked_intervals:
				typeof row.worked_intervals === 'string' ? JSON.parse(row.worked_intervals) : null
		}));
		const matrixStarted = performance.now();
		const matrix = buildRosterMonth({
			month: MONTH,
			employments,
			workDays,
			leaveRequests: [],
			pendingLeaveRequests: [],
			holidays: [],
			rosterCodesById: new Map([
				[
					'code-day',
					{
						code: 'DAY',
						variant: {
							kind: 'WORK',
							start_time: '08:00',
							end_time: '17:00',
							break_minutes: 60,
							paid_minutes: 480
						}
					}
				]
			]),
			employmentTerms: [],
			leaveCodeById: new Map(),
			cutoff: { start: DAYS[0], end: DAYS.at(-1) },
			locks: new Map(),
			today: '2026-07-01'
		});
		matrixTimes.push(performance.now() - matrixStarted);
		matrixSize = matrix.size;
	}

	database.close();
	const receipt = {
		people: EMPLOYEE_COUNT,
		days: DAYS.length,
		personDays: EXPECTED_PERSON_DAYS,
		queriesPerBoard: 1,
		payloadBytes,
		databaseP95Ms: decodeNumber(percentile95(databaseTimes).toFixed(2)),
		matrixP95Ms: decodeNumber(percentile95(matrixTimes).toFixed(2))
	};
	t.diagnostic(JSON.stringify(receipt));
	assert.equal(matrixSize, EXPECTED_PERSON_DAYS);
	assert.ok(payloadBytes > 0 && payloadBytes < 5_000_000);
	assert.ok(receipt.databaseP95Ms < 1_000, `database p95 was ${receipt.databaseP95Ms}ms`);
	assert.ok(receipt.matrixP95Ms < 1_000, `matrix p95 was ${receipt.matrixP95Ms}ms`);
});
