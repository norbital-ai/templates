import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { capturesOf } from './helpers/settlement.ts';

const prepare = (world: ReturnType<typeof createPublicPayrollWorld>, period = '2026-02') =>
	Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);

function endedWorld() {
	const world = createPublicPayrollWorld();
	world.employments[0]!.exit_date = '2026-01-20';
	world.employments[0]!.exit_reason = 'RESIGNATION';
	world.employment_terms[0]!.effective_range.end = '2026-01-20';
	world.allowance_requests.push({
		...world.allowance_requests[0],
		id: 'one-off',
		amount: 310,
		recurrence: { kind: 'ONE_OFF', period: '2026-01' }
	});
	return world;
}

test('an ended contract settles its approved one-off allowance using source-month service and captures it once', async () => {
	const world = endedWorld();
	const prepared = await prepare(world);
	const built = buildPayrollRun(prepared);
	const slips = built.payslip_payroll_run;
	assert.equal(slips.length, 1);
	const slip = slips[0]!;
	assert.deepEqual(slip.base, []);
	assert.deepEqual(slip.proration, []);
	assert.equal(slip.gross, 200, '310 × 20/31 January service days');
	assert.equal(slip.net, 200);
	assert.deepEqual(
		slip.payslip_allowance_request_input_payslip.map((row) => row.allowance_request_id),
		['one-off']
	);
	assert.deepEqual(
		capturesOf(built, slip).workDays,
		[],
		'calendar-day proration does not consume a roster'
	);
	world.payslip_allowance_request_inputs.push({
		...slip.payslip_allowance_request_input_payslip[0],
		payslip_id: 'paid-slip'
	});
	assert.deepEqual(buildPayrollRun(await prepare(world, '2026-03')).payslip_payroll_run, []);
});

test('pending, future and recurring allowances do not restart a departed contract', async () => {
	for (const state of ['pending', 'future', 'recurring']) {
		const world = endedWorld();
		const oneOff = world.allowance_requests.find((row) => row.id === 'one-off')!;
		if (state === 'pending') oneOff.approval_id = 'pending';
		if (state === 'future') oneOff.pay_period = '2026-03';
		if (state === 'recurring')
			oneOff.recurrence = { kind: 'RECURRING', from: '2026-01-01', to: null };
		assert.deepEqual(buildPayrollRun(await prepare(world)).payslip_payroll_run, [], state);
	}
});

const sourceHoliday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	jurisdiction_code: 'TEST-JUR',
	date,
	name,
	original_date: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	consumed_at: null,
	approval_id: null
});

function historicalWorkingDaysWorld() {
	const world = endedWorld();
	world.employments[0]!.hire_date = '2025-12-10';
	world.employments[0]!.exit_date = '2025-12-20';
	world.employments[0]!.exit_reason = 'RESIGNATION';
	world.employment_terms[0]!.effective_range = { start: '2025-12-10', end: '2025-12-20' };
	const oneOff = world.allowance_requests.find((row) => row.id === 'one-off')!;
	oneOff.recurrence = { kind: 'ONE_OFF', period: '2025-12' };
	oneOff.amount = 290;
	const originalSettings = world.jurisdiction_settings[0]!;
	originalSettings.effective_range = { ...originalSettings.effective_range, end: '2026-01-01' };
	world.jurisdiction_settings.push({
		...structuredClone(originalSettings),
		id: 'current-settings',
		effective_range: { start: '2026-01-01', end: null }
	});
	const originalWork = world.work_catalogue[0]!;
	originalWork.proration = { by: 'WORKING_DAYS' };
	world.work_catalogue.push({
		...structuredClone(originalWork),
		id: 'current-work',
		settings_id: 'current-settings',
		proration: { by: 'FIXED_DAYS', days: 30 }
	});
	const shift = world.shift_definitions[0]!;
	shift.effective_range = { ...shift.effective_range, end: '2025-12-31' };
	world.shift_patterns[0]!.pattern = {
		type: 'PATTERNED',
		anchor_date: '2025-12-01',
		phases: [{ duration: { kind: 'CONTINUOUS' }, day_cycle: [{ roster_code_id: shift.id }] }]
	};
	world.work_days = Array.from({ length: 11 }, (_, index) => ({
		id: `source-day-${index}`,
		employment_id: EMPLOYMENT_ID,
		work_date: `2025-12-${10 + index}`,
		shift_definition_id: shift.id,
		worked_intervals: null,
		break_minutes: null,
		approval_id: null
	}));
	world.jurisdiction_holidays.push(
		sourceHoliday('2025-12-12', 'Source holiday'),
		sourceHoliday('2025-12-25', 'Source holiday outside contract')
	);
	return world;
}

test('active and ended late Allowance use source-month Work calendar pins and latest unlinked dates', async () => {
	for (const ended of [true, false]) {
		const world = historicalWorkingDaysWorld();
		world.allowance_requests.splice(0, 1);
		if (!ended) {
			world.employments[0]!.exit_date = null;
			world.employment_terms[0]!.effective_range.end = null;
			world.shift_definitions[0]!.effective_range.end = null;
		}
		// Every source day was classified when written: the 12th as its holiday, the rest as none.
		// Two holidays published since then reach the days nothing pinned, and only those.
		for (const day of world.work_days)
			day.holiday_id = day.work_date === '2025-12-12' ? 'holiday-2025-12-12' : null;
		world.jurisdiction_holidays.push(
			sourceHoliday('2025-12-13', 'Latest holiday'),
			sourceHoliday('2025-12-26', 'Latest holiday')
		);
		const prepared = await prepare(world);
		const source = prepared.gathered.bundles[0]!.allowanceConfigurations!.get('2025-12')!;
		assert.equal(
			source.holidays.has('2025-12-12'),
			true,
			'linked holiday retains its original classification'
		);
		assert.equal(
			source.holidays.has('2025-12-13'),
			true,
			'a day nothing pinned takes what is published at the point of running'
		);
		assert.equal(source.holidays.has('2025-12-26'), true);
		assert.equal(
			source.holidayInputs.find((row) => row.date === '2025-12-12')!.holiday_id,
			'holiday-2025-12-12'
		);
		assert.equal(
			source.holidayInputs.find((row) => row.date === '2025-12-26')!.holiday_id,
			'holiday-2025-12-26'
		);
		assert.ok(
			prepared.configuration.holidaySnapshots.some((row) => row.id === 'holiday-2025-12-12')
		);
		assert.ok(
			prepared.configuration.holidaySnapshots.some((row) => row.id === 'holiday-2025-12-26')
		);
		const built = buildPayrollRun(prepared);
		const slip = built.payslip_payroll_run[0]!;
		assert.equal(
			slip.adjustments.find((row) => row.family === 'ALLOWANCE')?.amount,
			ended ? 96.67 : 193.33,
			'290 × covered days / 27 days once the two later holidays reach the unpinned days'
		);
	}
});

test('late working-day Allowance uses historical Work, shifts and holidays and seals that evidence with the run', async () => {
	const world = historicalWorkingDaysWorld();
	const prepared = await prepare(world);
	assert.equal(
		prepared.configuration.work.proration.by,
		'FIXED_DAYS',
		'current Work stays current'
	);
	const source = prepared.gathered.bundles[0]!.allowanceConfigurations!.get('2025-12')!;
	assert.equal(source.work.proration.by, 'WORKING_DAYS');
	assert.equal(source.shiftById.size, 1, 'expired shift is available in its source month');
	const built = buildPayrollRun(prepared);
	const slip = built.payslip_payroll_run[0]!;
	assert.equal(slip.gross, 100, '290 × 10 covered working days / 29 source-month working days');
	assert.deepEqual(slip.base, []);
	assert.equal(
		capturesOf(built, slip).workDays.length,
		11,
		'actual historical roster inputs are captured'
	);
	const input = { company_id: COMPANY_ID, period: '2026-02' };
	const created = await Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input,
			existing: undefined,
			prepared: new Map([[`${COMPANY_ID}:2026-02`, prepared]]),
			api: memoryPayrollApi(world)
		} as never)
	);
	assert.ok(created.holidays.some((row) => row.date === '2025-12-12'));
	const changed = structuredClone(world);
	changed.jurisdiction_holidays.find((row) => row.date === '2025-12-12')!.published_at = null;
	const next = await prepare(changed);
	assert.notEqual(
		next.configuration.hash,
		prepared.configuration.hash,
		'historical holiday classification affects the run identity'
	);
	assert.equal(buildPayrollRun(next).payslip_payroll_run[0]!.gross, 106.33);
});

test('working-day Allowance with no published holidays counts every day, and refuses incomplete source rosters', async () => {
	const noHolidays = historicalWorkingDaysWorld();
	noHolidays.jurisdiction_holidays = [];
	assert.equal(
		buildPayrollRun(await prepare(noHolidays)).payslip_payroll_run[0]!.gross,
		102.9,
		'290 × 11 covered days / 31 source-month days: a missing holiday is simply not a holiday'
	);
	const missingRoster = historicalWorkingDaysWorld();
	missingRoster.shift_patterns[0]!.pattern = {
		type: 'ROSTERED',
		expectation: {
			kind: 'GUARANTEED_SCHEDULE',
			period: 'WEEK',
			required_work_days: 6,
			required_paid_minutes: 2700
		}
	};
	const preparedRoster = await prepare(missingRoster);
	assert.throws(
		() => buildPayrollRun(preparedRoster),
		/requires a source-month roster assignment on 2025-12-01/
	);
});

test('active late approval uses the same source-month fraction without changing current wages', async () => {
	const world = historicalWorkingDaysWorld();
	world.employments[0]!.exit_date = null;
	world.employments[0]!.effective_range = { start: '2025-12-10', end: null };
	world.employment_terms[0]!.effective_range.end = '2025-12-31';
	const currentShift = {
		...structuredClone(world.shift_definitions[0]),
		id: 'current-shift',
		effective_range: { start: '2026-01-01', end: null }
	};
	world.shift_definitions.push(currentShift);
	world.shift_patterns.push({
		...structuredClone(world.shift_patterns[0]),
		id: 'current-pattern',
		effective_range: { start: '2026-01-01', end: null },
		pattern: {
			type: 'PATTERNED',
			anchor_date: '2026-01-01',
			phases: [
				{ duration: { kind: 'CONTINUOUS' }, day_cycle: [{ roster_code_id: currentShift.id }] }
			]
		}
	});
	world.employment_terms.push({
		...structuredClone(world.employment_terms[0]),
		id: 'current-terms',
		shift_pattern_id: 'current-pattern',
		effective_range: { start: '2026-01-01', end: null }
	});
	world.allowance_requests.splice(0, 1);
	const baseline = structuredClone(world);
	baseline.allowance_requests.length = 0;
	const wages = buildPayrollRun(await prepare(baseline)).payslip_payroll_run[0]!;
	const prepared = await prepare(world);
	const built = buildPayrollRun(prepared);
	const slip = built.payslip_payroll_run[0]!;
	assert.deepEqual(
		slip.base,
		wages.base,
		'source-month Work does not replace current salary rules'
	);
	assert.deepEqual(slip.proration, wages.proration);
	assert.equal(slip.gross, Math.round((wages.gross + 200) * 100) / 100);
	assert.equal(
		slip.adjustments.find((row) => row.family === 'ALLOWANCE')?.amount,
		200,
		'290 × 20 covered working days / 29 source-month working days'
	);
	assert.equal(capturesOf(built, slip).workDays.length, 11);
	assert.equal(
		prepared.configuration.holidayInputs.filter((row) => row.date.startsWith('2025-12')).length,
		31
	);
});
