import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import pipeline from '../src/collections/work_days/+pipelines.ts';
import {
	EMPLOYEE_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';

type Sheet = 'ROSTER' | 'ATTENDANCE';
const OTHER_COMPANY = 'other-company';
const REHIRE = 'rehire-contract';
const OTHER_CONTRACT = 'other-entity-contract';

function importWorld() {
	const world = createPublicPayrollWorld();
	world.work_days = [];
	world.companies.push({
		...world.companies[0],
		id: OTHER_COMPANY,
		name: 'Other Entity',
		registration_number: 'OTHER'
	});
	const original = {
		...world.employments[0],
		employee_id: EMPLOYEE_ID,
		employee_number: 'PERSON',
		hire_date: '2026-01-01',
		effective_range: { start: '2026-01-01', end: null },
		exit_date: '2026-01-15',
		exit_reason: 'RESIGNATION'
	};
	world.employments = [
		{
			...original,
			id: REHIRE,
			hire_date: '2026-01-16',
			effective_range: { start: '2026-01-16', end: null },
			exit_date: null,
			exit_reason: null
		},
		{
			...original,
			id: OTHER_CONTRACT,
			company_id: OTHER_COMPANY,
			exit_date: null,
			exit_reason: null
		},
		original
	];
	return world;
}

function runImport(
	world: PayrollWorld,
	sheet: Sheet,
	dates: readonly string[],
	legalEntity: string | null = 'Public Fixture Co'
) {
	const api = memoryPayrollApi(world);
	const input = {
		sheet,
		legal_entity: legalEntity ?? undefined,
		month: '2026-01',
		timezone: 'Asia/Singapore',
		rows: dates.map((work_date) => ({
			employee_number: 'PERSON',
			work_date,
			...(sheet === 'ROSTER' ? { shift_code: '7.5AM' } : { clock_in: '08:00', clock_out: '17:00' })
		}))
	};
	return Effect.runPromise(pipeline.import.handler({ input } as never, api as never));
}

for (const sheet of ['ROSTER', 'ATTENDANCE'] as const) {
	test(`${sheet} resolves departure-day and next-day rehire to their own contracts regardless of row order`, async () => {
		const world = importWorld();
		world.work_days.push({
			id: 'existing-old-day',
			employment_id: EMPLOYMENT_ID,
			work_date: '2026-01-15',
			shift_definition_id: sheet === 'ATTENDANCE' ? world.shift_definitions[0].id : null,
			worked_intervals:
				sheet === 'ROSTER'
					? [{ start: '2026-01-15T08:00:00+08:00', end: '2026-01-15T17:00:00+08:00' }]
					: null
		});
		const results = await runImport(world, sheet, ['2026-01-15', '2026-01-16']);
		assert.deepEqual(
			results.map((row) => [row.employment_id, row.work_date, row.id ?? null]),
			[
				[EMPLOYMENT_ID, '2026-01-15', 'existing-old-day'],
				[REHIRE, '2026-01-16', null]
			]
		);
	});
	test(`${sheet} refuses a date in the gap between contracts`, async () => {
		const world = importWorld();
		world.employments.find((row) => row.id === REHIRE)!.hire_date = '2026-01-17';
		await assert.rejects(
			runImport(world, sheet, ['2026-01-16']),
			/No approved employment contract covers PERSON on 2026-01-16/
		);
	});
	test(`${sheet} refuses a date before the signed service range starts`, async () => {
		const world = importWorld();
		world.employments.find((row) => row.id === EMPLOYMENT_ID)!.effective_range = {
			start: '2026-01-02',
			end: null
		};
		await assert.rejects(
			runImport(world, sheet, ['2026-01-01']),
			/No approved employment contract/
		);
	});
	test(`${sheet} refuses overlapping contracts instead of selecting the last row`, async () => {
		const world = importWorld();
		world.employments.push({
			...world.employments.find((row) => row.id === REHIRE)!,
			id: 'overlap'
		});
		await assert.rejects(
			runImport(world, sheet, ['2026-01-16']),
			/More than one employment contract.*overlapping/
		);
	});
	test(`${sheet} ignores an unapproved rehire`, async () => {
		const world = importWorld();
		world.employments.push({
			...world.employments.find((row) => row.id === REHIRE)!,
			id: 'pending-rehire',
			approval_id: 'pending'
		});
		const results = await runImport(world, sheet, ['2026-01-15', '2026-01-16']);
		assert.deepEqual(
			results.map((row) => row.employment_id),
			[EMPLOYMENT_ID, REHIRE]
		);
	});
}

test('attendance requires legal_entity when the person has contracts in two entities on the work date', async () => {
	await assert.rejects(
		runImport(importWorld(), 'ATTENDANCE', ['2026-01-16'], null),
		/Set legal_entity/
	);
});

test('attendance without legal_entity can resolve a rehire when only one entity covers the work date', async () => {
	const world = importWorld();
	world.employments.find((row) => row.id === OTHER_CONTRACT)!.effective_range = {
		start: '2026-01-01',
		end: '2026-01-14'
	};
	const results = await runImport(world, 'ATTENDANCE', ['2026-01-15', '2026-01-16'], null);
	assert.deepEqual(
		results.map((row) => row.employment_id),
		[EMPLOYMENT_ID, REHIRE]
	);
});

test('a paid payroll in another entity does not lock the selected entity’s Work import', async () => {
	const world = importWorld();
	world.payroll_runs.push({
		id: 'other-paid',
		company_id: OTHER_COMPANY,
		period: '2026-01',
		lifecycle: 'PAID',
		attendance_from: '2026-01-01',
		attendance_to: '2026-01-31'
	});
	const results = await runImport(world, 'ATTENDANCE', ['2026-01-16']);
	assert.equal(results[0]?.employment_id, REHIRE);
});
