import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const holiday = (date: string, published = true) => ({
	id: `holiday-${date}`,
	jurisdiction_code: 'TEST-JUR',
	date,
	name: 'Festival',
	original_date: null,
	source: null,
	published_at: published ? '2025-12-01T00:00:00Z' : null,
	approval_id: null
});

/**
 * The 5th was classified as its holiday when the day was written and the holiday has been
 * unpublished since; the 6th was written as an ordinary day and a holiday was published on it
 * later; the 7th has a published holiday nothing pinned.
 */
function pinnedWorld() {
	const world = createPublicPayrollWorld();
	world.jurisdiction_holidays.push(
		holiday('2026-01-05', false),
		holiday('2026-01-06'),
		holiday('2026-01-07')
	);
	world.work_days.find((row) => row.id === 'work-day-2026-01-05')!.holiday_id =
		'holiday-2026-01-05';
	world.work_days.find((row) => row.id === 'work-day-2026-01-06')!.holiday_id = null;
	return world;
}

test('payroll keeps a pinned holiday, and reads what is published now for every other day', async () => {
	const world = pinnedWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const configuration = prepared.configuration;
	assert.equal(configuration.holidays.has('2026-01-05'), true, 'the pin is what the day was');
	assert.equal(
		configuration.holidays.has('2026-01-06'),
		true,
		'a day pinned to no holiday takes the holiday published since'
	);
	assert.equal(configuration.holidays.has('2026-01-07'), true);
	assert.deepEqual(
		configuration.holidayInputs
			.filter((row) => row.date >= '2026-01-05' && row.date <= '2026-01-07')
			.map((row) => row.holiday_id),
		['holiday-2026-01-05', 'holiday-2026-01-06', 'holiday-2026-01-07']
	);
	assert.deepEqual(configuration.holidaySnapshots.map((row) => row.id).toSorted(), [
		'holiday-2026-01-05',
		'holiday-2026-01-06',
		'holiday-2026-01-07'
	]);
	assert.equal(
		world.work_days.find((row) => row.id === 'work-day-2026-01-05')!.holiday_id,
		'holiday-2026-01-05',
		'Work keeps its own pin'
	);
});
