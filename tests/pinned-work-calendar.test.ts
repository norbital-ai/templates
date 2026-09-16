import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const holiday = (date: string, published = true) => ({
	id: `holiday-${date}`,
	company_id: '11111111-1111-4111-8111-111111111111',
	date,
	name: 'Festival',
	replaces: null,
	source: null,
	published_at: published ? '2025-12-01T00:00:00Z' : null,
	approval_id: null
});

/**
 * The 5th's holiday has been unpublished; the 6th and 7th carry published ones. Work days sit on
 * all three, and none of them pins anything: the run overlays what the calendar publishes now.
 */
function calendarWorld() {
	const world = createPublicPayrollWorld();
	world.jurisdiction_holidays.push(
		holiday('2026-01-05', false),
		holiday('2026-01-06'),
		holiday('2026-01-07')
	);
	return world;
}

test('payroll reads the published calendar for every day; a work day pins nothing', async () => {
	const world = calendarWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const configuration = prepared.configuration;
	assert.equal(configuration.holidays.has('2026-01-05'), false, 'unpublished is not there');
	assert.equal(configuration.holidays.has('2026-01-06'), true);
	assert.equal(configuration.holidays.has('2026-01-07'), true);
	assert.deepEqual(
		configuration.holidayInputs
			.filter((row) => row.date >= '2026-01-05' && row.date <= '2026-01-07')
			.map((row) => row.holiday_id),
		[null, 'holiday-2026-01-06', 'holiday-2026-01-07']
	);
	assert.deepEqual(configuration.holidaySnapshots.map((row) => row.id).toSorted(), [
		'holiday-2026-01-06',
		'holiday-2026-01-07'
	]);
	assert.equal(
		'holiday_id' in world.work_days.find((row) => row.id === 'work-day-2026-01-05')!,
		false,
		'a work day carries no holiday column to pin with'
	);
});
