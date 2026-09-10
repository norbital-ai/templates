// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * P11: holiday work is paid or a day in lieu, and the freeze derives from references.
 *
 * A lieu day is one more leave entry, not a second mechanism: the work-day hook posts an
 * ADJUSTMENT on PUBLIC_HOLIDAY_IN_LIEU, payroll prices the day ordinary, and removing the
 * earning reverses the credit — refused when the credit is spent. Holidays carry no consumed
 * stamp: retraction is refused while a payroll run captured the holiday, and otherwise the
 * pinning days are re-saved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import workDayHooks, {
	assertLieuChoice,
	lieuReference,
	lieuWorkedHours
} from '../src/collections/work_days/+hooks.ts';
import holidayHooks from '../src/collections/jurisdiction_holidays/+hooks.ts';
import { pricedDay } from '../src/lib/payroll/work.ts';
import { deriveDailyOvertime, priceDay } from '../src/collections/payroll_runs/lib/overtime.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const DATE = '2027-05-03';
const at = (time) => `${DATE}T${time}:00.000+08:00`;
const punched = () => [{ start: at('09:00'), end: at('18:00') }];

const versions = (jurisdiction_code = 'SG') => [
	{
		id: 'v-1',
		code: 'SG',
		name: 'SG',
		jurisdiction_code,
		sealed_at: '2020-01-01T00:00:00.000Z',
		voided_at: null,
		approval_id: null,
		effective_range: { start: '2020-01-01', end: null }
	}
];

const preparedFor = (overrides = {}) => ({
	holidayByDay: new Map([
		[
			`emp-1:${DATE}`,
			{ company_id: '11111111-1111-4111-8111-111111111111', date: DATE, holiday_id: 'h-1' }
		]
	]),
	companyByEmployment: new Map([['emp-1', 'co-1']]),
	windowsByCompany: new Map(),
	leaveByEmployment: new Map(),
	overlap: {
		termsByEmployment: new Map(),
		patternById: new Map(),
		explicitByKey: new Map(),
		codeById: new Map()
	},
	versions: versions(),
	settingsCodeByCompany: new Map([['co-1', 'SG']]),
	lieuPermittedBySettings: new Map([['v-1', true]]),
	// Absent decodes as DAY, which is what every jurisdiction but Taiwan states.
	lieuUnitBySettings: new Map([['v-1', 'DAY' as const]]),
	lieuCatalogueBySettings: new Map([['v-1', { id: 'lc-1', yearStartMonth: 1 }]]),
	lieuEntries: [],
	...overrides
});

const stubWorkApi = (captured) => ({
	db: {
		leave_entries: {
			findMany: () => Effect.succeed([]),
			mutate: (rows) => Effect.sync(() => void captured.leave.push(...rows))
		},
		jurisdiction_holidays: {
			mutate: () => Effect.succeed(undefined)
		}
	}
});

const runWorkBefore = (input, existing, prepared, api, recordId) =>
	Effect.runPromise(
		workDayHooks.mutate.perRecord.before.handler({ input, existing, prepared, api, recordId })
	);

const lieuCredit = (overrides = {}) => ({
	id: 'credit-1',
	employment_id: 'emp-1',
	reference: 'lieu:wd-1',
	event: {
		kind: 'ADJUSTMENT',
		days: 1,
		effective_on: DATE,
		window: { start: '2027-01-01', end: '2027-12-31' }
	},
	charges: [],
	allocations: [
		{
			window: { start: '2027-01-01', end: '2027-12-31' },
			date: DATE,
			days: 1,
			credit_entry_id: null
		}
	],
	approval_id: null,
	...overrides
});

const lieuDay = (overrides = {}) => ({
	id: 'wd-1',
	employment_id: 'emp-1',
	work_date: DATE,
	shift_definition_id: null,
	worked_intervals: punched(),
	break_minutes: 60,
	holiday_id: 'h-1',
	compensation: 'LIEU',
	settled_payslip_id: null,
	settled_period: null,
	approval_id: null,
	...overrides
});

test('a lieu day posts a +1 day ADJUSTMENT on PUBLIC_HOLIDAY_IN_LIEU', async () => {
	const captured = { leave: [] };
	const result = await runWorkBefore(
		{
			employment_id: 'emp-1',
			work_date: DATE,
			shift_definition_id: null,
			worked_intervals: punched(),
			break_minutes: 60,
			compensation: 'LIEU'
		},
		undefined,
		preparedFor(),
		stubWorkApi(captured),
		'wd-1'
	);
	assert.equal(result.holiday_id, 'h-1');
	assert.equal(captured.leave.length, 1);
	assert.deepEqual(captured.leave[0], {
		id: captured.leave[0].id,
		employment_id: 'emp-1',
		leave_catalogue_id: 'lc-1',
		reference: 'lieu:wd-1',
		event: {
			kind: 'ADJUSTMENT',
			window: { start: '2027-01-01', end: '2027-12-31' },
			days: 1,
			effective_on: DATE,
			reason: `Day in lieu for ${DATE}`
		}
	});
});

test('a substitute day worked earns the same way', async () => {
	const captured = { leave: [] };
	await runWorkBefore(
		{
			employment_id: 'emp-1',
			work_date: DATE,
			shift_definition_id: null,
			worked_intervals: punched(),
			break_minutes: 60,
			compensation: 'LIEU'
		},
		undefined,
		preparedFor({
			holidayByDay: new Map([
				[
					`emp-1:${DATE}`,
					{
						company_id: '11111111-1111-4111-8111-111111111111',
						date: DATE,
						holiday_id: 'h-substitute'
					}
				]
			])
		}),
		stubWorkApi(captured),
		'wd-9'
	);
	assert.equal(captured.leave.length, 1);
	assert.equal(captured.leave[0].reference, 'lieu:wd-9');
	assert.equal(captured.leave[0].event.days, 1);
});

test('a rest day worked earns where no holiday is pinned', async () => {
	const captured = { leave: [] };
	await runWorkBefore(
		{
			employment_id: 'emp-1',
			work_date: DATE,
			shift_definition_id: 'code-rest',
			worked_intervals: punched(),
			break_minutes: 60,
			compensation: 'LIEU'
		},
		undefined,
		preparedFor({
			holidayByDay: new Map([
				[
					`emp-1:${DATE}`,
					{ company_id: '11111111-1111-4111-8111-111111111111', date: DATE, holiday_id: null }
				]
			]),
			overlap: {
				termsByEmployment: new Map(),
				patternById: new Map(),
				explicitByKey: new Map(),
				codeById: new Map([['code-rest', { code: 'R', variant: { kind: 'REST' } }]])
			}
		}),
		stubWorkApi(captured),
		'wd-2'
	);
	assert.equal(captured.leave.length, 1);
	assert.equal(captured.leave[0].reference, 'lieu:wd-2');
});

test('an unworked lieu choice posts nothing until the punch arrives', async () => {
	const captured = { leave: [] };
	await runWorkBefore(
		{
			employment_id: 'emp-1',
			work_date: DATE,
			shift_definition_id: 'code-rest',
			worked_intervals: null,
			break_minutes: 0,
			compensation: 'LIEU'
		},
		undefined,
		preparedFor({
			holidayByDay: new Map([
				[
					`emp-1:${DATE}`,
					{ company_id: '11111111-1111-4111-8111-111111111111', date: DATE, holiday_id: null }
				]
			]),
			overlap: {
				termsByEmployment: new Map(),
				patternById: new Map(),
				explicitByKey: new Map(),
				codeById: new Map([['code-rest', { code: 'R', variant: { kind: 'REST' } }]])
			}
		}),
		stubWorkApi(captured),
		'wd-3'
	);
	assert.equal(captured.leave.length, 0);
});

test('TW credits the worked hours, not a day', async () => {
	const captured = { leave: [] };
	await runWorkBefore(
		{
			employment_id: 'emp-1',
			work_date: DATE,
			shift_definition_id: null,
			worked_intervals: punched(),
			break_minutes: 60,
			compensation: 'LIEU'
		},
		undefined,
		// 勞基法 §32-1 credits 補休 by the hour, and the TAIWANESE REGIME says so — the engine used to
		// test the jurisdiction code here, which put Taiwan's rule in the engine instead of its seed.
		preparedFor({
			versions: versions('TW'),
			lieuUnitBySettings: new Map([['v-1', 'HOUR' as const]])
		}),
		stubWorkApi(captured),
		'wd-4'
	);
	assert.equal(captured.leave.length, 1);
	assert.equal(captured.leave[0].event.days, 8);
});

test('lieu is refused where the regime pays and on an ordinary day', async () => {
	const input = {
		employment_id: 'emp-1',
		work_date: DATE,
		shift_definition_id: null,
		worked_intervals: punched(),
		break_minutes: 60,
		compensation: 'LIEU'
	};
	await assert.rejects(
		runWorkBefore(
			input,
			undefined,
			preparedFor({ lieuPermittedBySettings: new Map([['v-1', false]]) }),
			stubWorkApi({ leave: [] }),
			'wd-5'
		),
		/states no lieu/
	);
	await assert.rejects(
		runWorkBefore(
			{ ...input, shift_definition_id: 'code-work' },
			undefined,
			preparedFor({
				holidayByDay: new Map([
					[
						`emp-1:${DATE}`,
						{ company_id: '11111111-1111-4111-8111-111111111111', date: DATE, holiday_id: null }
					]
				]),
				overlap: {
					termsByEmployment: new Map(),
					patternById: new Map(),
					explicitByKey: new Map(),
					codeById: new Map([
						[
							'code-work',
							{
								code: 'D',
								variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
							}
						]
					])
				}
			}),
			stubWorkApi({ leave: [] }),
			'wd-6'
		),
		/no premium/
	);
});

test('changing back to pay reverses an unspent credit', async () => {
	const captured = { leave: [] };
	await runWorkBefore(
		{ id: 'wd-1', compensation: 'PAY' },
		lieuDay(),
		preparedFor({ lieuEntries: [lieuCredit()] }),
		stubWorkApi(captured),
		'wd-1'
	);
	assert.equal(captured.leave.length, 1);
	assert.match(captured.leave[0].reference, /^lieu-reversal:credit-1$/);
	assert.deepEqual(captured.leave[0].event, {
		kind: 'REVERSAL',
		entry_id: 'credit-1',
		effective_on: DATE,
		due_on: null,
		days: null,
		gross_amount: null,
		reason: `Day in lieu for ${DATE} no longer earned`
	});
});

test('changing back to pay is refused while the credit is spent', async () => {
	const captured = { leave: [] };
	const spent = lieuCredit();
	const taken = {
		id: 'take-1',
		employment_id: 'emp-1',
		reference: 'TAKEN',
		event: { kind: 'TIME_OFF', chargeable_days: 1 },
		charges: [{ date: '2027-06-01', days: 1 }],
		allocations: [],
		approval_id: null
	};
	await assert.rejects(
		runWorkBefore(
			{ id: 'wd-1', compensation: 'PAY' },
			lieuDay(),
			preparedFor({ lieuEntries: [spent, taken] }),
			stubWorkApi(captured),
			'wd-1'
		),
		/already taken/
	);
	assert.equal(captured.leave.length, 0);
});

test('the choice guard names its reason', () => {
	assert.throws(
		() =>
			assertLieuChoice({
				compensation: 'LIEU',
				regimePermitsLieu: false,
				premiumDay: true,
				workDate: DATE,
				jurisdictionCode: 'PH'
			}),
		/states no lieu/
	);
	assert.throws(
		() =>
			assertLieuChoice({
				compensation: 'LIEU',
				regimePermitsLieu: true,
				premiumDay: false,
				workDate: DATE,
				jurisdictionCode: 'SG'
			}),
		/no premium/
	);
	assert.doesNotThrow(() =>
		assertLieuChoice({
			compensation: 'PAY',
			regimePermitsLieu: false,
			premiumDay: false,
			workDate: DATE,
			jurisdictionCode: 'PH'
		})
	);
});

test('lieu references and hours are measured like every derived duration', () => {
	assert.equal(lieuReference('wd-1'), 'lieu:wd-1');
	assert.equal(lieuWorkedHours(null, 60), 0);
	assert.equal(lieuWorkedHours([{ start: at('09:00'), end: null }], 0), 0);
	assert.equal(lieuWorkedHours(punched(), 60), 8);
	assert.equal(
		lieuWorkedHours([{ start: at('08:30'), end: at('18:15') }], 60),
		8.5,
		'nine and three-quarter hours less one are floored to the half hour'
	);
});

const DAY_SHIFT = {
	id: 'shift-day',
	code: 'D',
	start_time: '08:30',
	end_time: '17:30',
	break_minutes: 60,
	crosses_midnight: false,
	elapsed_minutes: 540,
	paid_minutes: 480
};

const holidayRules = () => [
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	}
];

const holidayEntry = (overrides = {}) => ({
	id: 'work-day',
	work_date: '2026-03-10',
	worked_intervals: [
		{ start: '2026-03-10T08:30:00.000+08:00', end: '2026-03-10T17:30:00.000+08:00' }
	],
	break_minutes: 60,
	...overrides
});

const holidayScheduled = (overrides = {}) => ({
	date: '2026-03-10',
	dayType: 'PUBLIC_HOLIDAY',
	shift: DAY_SHIFT,
	clampStart: '08:30',
	normalHours: 8,
	...overrides
});

test('a lieu day prices as an ordinary day, a paid one on the premium ladder', () => {
	const paidDay = holidayScheduled();
	assert.equal(pricedDay({ compensation: 'PAY' }, paidDay), paidDay);
	const unpublishedDay = holidayScheduled();
	assert.equal(pricedDay({}, unpublishedDay), unpublishedDay);
	assert.equal(pricedDay({ compensation: 'LIEU' }, holidayScheduled()).dayType, 'ORDINARY');
	assert.equal(
		pricedDay({ compensation: 'LIEU' }, holidayScheduled({ dayType: 'REST_DAY' })).dayType,
		'ORDINARY'
	);
	assert.equal(
		pricedDay({ compensation: 'LIEU' }, holidayScheduled({ dayType: 'SPECIAL_HOLIDAY' })).dayType,
		'ORDINARY'
	);
	assert.equal(
		pricedDay({ compensation: 'LIEU' }, holidayScheduled({ dayType: 'ORDINARY' })).dayType,
		'ORDINARY'
	);
	assert.equal(
		pricedDay({ compensation: 'LIEU' }, holidayScheduled({ dayType: 'OFF_DAY' })).dayType,
		'OFF_DAY'
	);

	const paid = deriveDailyOvertime(holidayEntry(), holidayScheduled(), []);
	assert.ok(paid);
	const priced = priceDay({ day: paid, rules: holidayRules(), retainedHours: paid.hours });
	assert.ok(
		priced.segments.some((segment) => segment.award === 'DAY_WAGE_MULTIPLE'),
		'the paid holiday earns its day-wage premium'
	);
	const lieu = deriveDailyOvertime(
		holidayEntry({ compensation: 'LIEU' }),
		pricedDay({ compensation: 'LIEU' }, holidayScheduled()),
		[]
	);
	assert.equal(lieu, null, 'the same clocks inside the shift earn no overtime at all');
});

test('a lieu payslip carries no premium while a paid one does', async () => {
	const runWith = async (compensation) => {
		const world = createPublicPayrollWorld();
		world.work_catalogue[0].regime = {
			holiday_rest_precedence: 'REST_DAY',
			holiday_work_compensation: 'PAY_OR_LIEU',
			overtime_coverage: null,
			overtime_rules: holidayRules(),
			overtime_limits: []
		};
		world.jurisdiction_holidays.push({
			id: 'h-2026-01-05',
			company_id: '11111111-1111-4111-8111-111111111111',
			date: '2026-01-05',
			name: 'New Year',
			kind: 'PUBLIC',
			original_date: null,
			source: null,
			published_at: '2025-12-01T00:00:00.000Z',
			approval_id: null
		});
		const day = world.work_days.find((row) => row.work_date === '2026-01-05');
		assert.ok(day);
		day.worked_intervals = [
			{ start: '2026-01-05T07:30:00+08:00', end: '2026-01-05T16:30:00+08:00' }
		];
		day.break_minutes = 60;
		day.holiday_id = 'h-2026-01-05';
		if (compensation != null) day.compensation = compensation;
		const prepared = await Effect.runPromise(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
		);
		return buildPayrollRun(prepared).payslip_payroll_run[0];
	};
	const paid = await runWith(undefined);
	const paidOvertime = paid.adjustments.filter((row) => row.label.startsWith('OT_'));
	assert.ok(paidOvertime.length > 0, 'the paid holiday earns premium overtime');
	assert.ok(
		paidOvertime.every((row) => row.label.startsWith('OT_PUBLIC_HOLIDAY')),
		JSON.stringify(paidOvertime.map((row) => row.label))
	);
	const lieu = await runWith('LIEU');
	assert.deepEqual(
		lieu.adjustments.filter((row) => row.label.startsWith('OT_')),
		[],
		'the lieu day prices ordinary: no overtime adjustment at all'
	);
	assert.ok(lieu.gross < paid.gross);
});

const holidayRow = (overrides = {}) => ({
	id: 'h-1',
	company_id: '11111111-1111-4111-8111-111111111111',
	date: DATE,
	name: 'Vesak',
	kind: 'PUBLIC',
	original_date: null,
	source: null,
	published_at: '2027-01-01T00:00:00.000Z',
	...overrides
});

const stubHolidayApi = (runs, pins, released) => ({
	db: {
		payroll_runs: {
			findMany: () => Effect.succeed(runs)
		},
		work_days: {
			findMany: () => Effect.succeed(pins),
			mutate: (rows) => Effect.sync(() => void released.push(...rows))
		}
	}
});

test('a captured holiday refuses unpublish and delete', async () => {
	const runs = [{ id: 'r-1', period: '2027-05', lifecycle: 'DRAFT', holidays: [{ id: 'h-1' }] }];
	const api = stubHolidayApi(runs, [], []);
	await assert.rejects(
		Effect.runPromise(
			holidayHooks.mutate.perRecord.before.handler({
				input: { published_at: null },
				existing: holidayRow(),
				api
			})
		),
		/captured by payroll run 2027-05/
	);
	await assert.rejects(
		Effect.runPromise(
			holidayHooks.delete.perRecord.before.handler({ existing: holidayRow(), api })
		),
		/captured by payroll run 2027-05/
	);
});

test('an uncaptured holiday unpublishes by releasing its pinning days', async () => {
	const released = [];
	const api = stubHolidayApi([], [{ id: 'wd-1' }], released);
	const result = await Effect.runPromise(
		holidayHooks.mutate.perRecord.before.handler({
			input: { published_at: null },
			existing: holidayRow(),
			api
		})
	);
	assert.deepEqual(result, { published_at: null });
	// The release is explicit: this retraction is not written yet, so a day re-reading the
	// calendar would still find the holiday published and keep its pin.
	assert.deepEqual(released, [{ id: 'wd-1', holiday_id: null }]);
});
