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
	const slips = buildPayrollRun(prepared).payslip_payroll_run;
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
		slip.payslip_work_day_input_payslip,
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
	world.jurisdiction_holiday_calendars.find((row) => row.year === 2025)!.observations = [
		{ date: '2025-12-12', name: 'Source holiday', original_date: null, source: null },
		{
			date: '2025-12-25',
			name: 'Source holiday outside contract',
			original_date: null,
			source: null
		}
	];
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
		const original = world.jurisdiction_holiday_calendars.find((row) => row.year === 2025)!;
		for (const day of world.work_days)
			world.holiday_calendar_inputs.push({
				id: `seal-${day.id}`,
				work_day_id: day.id,
				jurisdiction_code: 'TEST-JUR',
				date: day.work_date,
				calendar_id: original.id,
				approval_id: null
			});
		world.jurisdiction_holiday_calendars.push({
			...structuredClone(original),
			id: 'source-latest',
			revision: 2,
			observations: ['2025-12-13', '2025-12-25', '2025-12-26'].map((date) => ({
				date,
				name: 'Latest holiday',
				original_date: null,
				source: null
			}))
		});
		const prepared = await prepare(world);
		const source = prepared.gathered.bundles[0]!.allowanceConfigurations!.get('2025-12')!;
		assert.equal(
			source.holidays.has('2025-12-12'),
			true,
			'linked holiday retains its original classification'
		);
		assert.equal(source.holidays.has('2025-12-13'), false, 'linked ordinary day remains ordinary');
		assert.equal(
			source.holidays.has('2025-12-26'),
			true,
			'unlinked date follows the latest source-year publication'
		);
		assert.equal(
			source.holidayInputs.find((row) => row.date === '2025-12-12')!.calendar_id,
			original.id
		);
		assert.equal(
			source.holidayInputs.find((row) => row.date === '2025-12-26')!.calendar_id,
			'source-latest'
		);
		assert.ok(prepared.configuration.holidayCalendars.some((row) => row.id === original.id));
		assert.ok(prepared.configuration.holidayCalendars.some((row) => row.id === 'source-latest'));
		const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
		assert.equal(
			slip.payslip_adjustment_payslip.find((row) => row.input.kind === 'ALLOWANCE_REQUEST_INPUT')
				?.amount,
			ended ? 103.57 : 196.79,
			'290 × pinned covered days / 28 days after the unlinked new holiday'
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
	const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
	assert.equal(slip.gross, 100, '290 × 10 covered working days / 29 source-month working days');
	assert.deepEqual(slip.base, []);
	assert.equal(
		slip.payslip_work_day_input_payslip.length,
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
	assert.equal(
		created.payroll_holiday_input_run.filter((row) => row.date.startsWith('2025-12')).length,
		31
	);
	assert.ok(created.holiday_calendars.some((row) => row.year === 2025));
	const changed = structuredClone(world);
	changed.jurisdiction_holiday_calendars.find((row) => row.year === 2025)!.observations.shift();
	const next = await prepare(changed);
	assert.notEqual(
		next.configuration.hash,
		prepared.configuration.hash,
		'historical holiday classification affects the run identity'
	);
	assert.equal(buildPayrollRun(next).payslip_payroll_run[0]!.gross, 106.33);
});

test('working-day Allowance refuses missing source-year calendars or incomplete source rosters', async () => {
	const missingCalendar = historicalWorkingDaysWorld();
	missingCalendar.jurisdiction_holiday_calendars =
		missingCalendar.jurisdiction_holiday_calendars.filter((row) => row.year !== 2025);
	await assert.rejects(prepare(missingCalendar), /Publish the TEST-JUR holiday calendar for 2025/);
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
	const slip = buildPayrollRun(prepared).payslip_payroll_run[0]!;
	assert.deepEqual(
		slip.base,
		wages.base,
		'source-month Work does not replace current salary rules'
	);
	assert.deepEqual(slip.proration, wages.proration);
	assert.equal(slip.gross, Math.round((wages.gross + 200) * 100) / 100);
	assert.equal(
		slip.payslip_adjustment_payslip.find((row) => row.input.kind === 'ALLOWANCE_REQUEST_INPUT')
			?.amount,
		200,
		'290 × 20 covered working days / 29 source-month working days'
	);
	assert.equal(slip.payslip_work_day_input_payslip.length, 11);
	assert.equal(
		prepared.configuration.holidayInputs.filter((row) => row.date.startsWith('2025-12')).length,
		31
	);
});
