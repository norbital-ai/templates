import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { resolveHolidayInputs } from '../src/lib/holiday-inputs.ts';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const holiday = (date: string, name = 'Festival') => ({
	date,
	name,
	original_date: null,
	source: null
});
const first = {
	id: 'first',
	jurisdiction_code: 'TEST-JUR',
	year: 2026,
	revision: 1,
	published_at: '2025-12-01T00:00:00Z',
	observations: [holiday('2026-01-05')]
};
const pin = (date: string, calendar_id = first.id) => ({
	jurisdiction_code: 'TEST-JUR',
	date,
	calendar_id
});

test('pinned Work preserves holiday and nonholiday evidence while unlinked dates use the latest calendar', () => {
	const latest = {
		...first,
		id: 'latest',
		revision: 2,
		observations: [holiday('2026-01-06'), holiday('2026-01-07')]
	};
	const result = resolveHolidayInputs(
		[latest, first],
		'TEST-JUR',
		['2026-01-05', '2026-01-06', '2026-01-07'],
		[pin('2026-01-05'), pin('2026-01-06')]
	);
	assert.equal(result.holidays.has('2026-01-05'), true);
	assert.equal(result.holidays.has('2026-01-06'), false);
	assert.equal(result.holidays.has('2026-01-07'), true);
	assert.deepEqual(
		result.inputs.map((row) => row.calendar_id),
		['first', 'first', 'latest']
	);
	assert.deepEqual(
		result.calendars.map((row) => row.id),
		['first', 'latest']
	);
});

test('compatible Work pins keep every revision and deterministically select the oldest date link', () => {
	const second = {
		...first,
		id: 'second',
		revision: 2,
		observations: [...first.observations, holiday('2026-02-01')]
	};
	const pins = [pin('2026-01-05', 'second'), pin('2026-01-05')];
	for (const inputs of [pins, [...pins].reverse()]) {
		const result = resolveHolidayInputs([second, first], 'TEST-JUR', ['2026-01-05'], inputs);
		assert.equal(result.inputs[0]!.calendar_id, first.id);
		assert.deepEqual(
			result.calendars.map((row) => row.id),
			['first', 'second']
		);
	}
	for (const observations of [[], [holiday('2026-01-05', 'Different holiday')]])
		assert.throws(
			() =>
				resolveHolidayInputs(
					[first, { ...second, observations }],
					'TEST-JUR',
					['2026-01-05'],
					pins
				),
			/Work holiday inputs disagree/
		);
	assert.throws(
		() => resolveHolidayInputs([second], 'TEST-JUR', ['2026-01-05'], pins),
		/missing calendar/
	);
});

function pinnedWorld() {
	const world = createPublicPayrollWorld();
	const original = world.jurisdiction_holiday_calendars.find((row) => row.year === 2026)!;
	Object.assign(original, first);
	world.jurisdiction_holiday_calendars.push({
		...first,
		id: 'latest',
		revision: 2,
		observations: [holiday('2026-01-06'), holiday('2026-01-07')],
		approval_id: null
	});
	for (const date of ['2026-01-05', '2026-01-06'])
		world.work_days.find((row) => row.id === `work-day-${date}`)!.holiday_calendar_id = first.id;
	return world;
}

test('payroll prepares its calendar from linked Work seals rather than replacing their revisions', async () => {
	const world = pinnedWorld();
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	const configuration = prepared.configuration;
	assert.equal(configuration.holidays.has('2026-01-05'), true);
	assert.equal(configuration.holidays.has('2026-01-06'), false);
	assert.equal(configuration.holidays.has('2026-01-07'), true);
	assert.equal(
		configuration.holidayInputs.find((row) => row.date === '2026-01-05')!.calendar_id,
		first.id
	);
	assert.equal(
		configuration.holidayInputs.find((row) => row.date === '2026-01-07')!.calendar_id,
		'latest'
	);
	assert.ok(configuration.holidayCalendars.some((row) => row.id === 'first'));
	assert.ok(configuration.holidayCalendars.some((row) => row.id === 'latest'));
	assert.equal(
		world.work_days.find((row) => row.id === 'work-day-2026-01-05')!.holiday_calendar_id,
		'first',
		'Work keeps its own pinned revision'
	);
});
