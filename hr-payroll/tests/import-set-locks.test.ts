// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { actionCtx, workDayTables } from './helpers/work-day-db.ts';
import rosters from '../src/data/collection/rosters/+collection.ts';
import { runTransform } from './helpers/ctx.ts';
import { writeDay, writeDays } from './helpers/work-day-db.ts';
import { schedulingImportPayload } from '../src/data/collection/work_days/lib/import-workbook.ts';
const day = (employment_id, work_date, extra = {}) => ({
	id: `${employment_id}-${work_date}`,
	employment_id,
	work_date,
	worked_intervals: [{ start: `${work_date}T00:00:00.000Z`, end: `${work_date}T09:00:00.000Z` }],
	shift_definition_id: null,
	...extra
});
const clock = (employee_number, work_date) => ({
	employee_number,
	work_date,
	clock_in: '08:00',
	clock_out: '17:00'
});
const run = async (tables, payload) => {
	const ctx = actionCtx(tables);
	const result = workDays.bodies.actions.import_month(
		{ legal_entity: 'Test Sdn Bhd', month: '2026-01', timezone: 'Asia/Kuala_Lumpur', ...payload },
		ctx
	);
	return { ctx, result };
};
test('SET replaces the whole entity month, clearing editable omitted people and blank cells', async () => {
	const tables = workDayTables({
		employees: ['A', 'B'],
		days: [day('A', '2026-01-05'), day('A', '2026-01-06'), day('B', '2026-01-05')]
	});
	const { ctx, result } = await run(tables, { attendance: [clock('A', '2026-01-05')] });
	await result;

	assert.deepEqual(ctx.acts.find((a) => a.callable === 'work_days.delete').input, {
		target: ['A-2026-01-06', 'B-2026-01-05']
	});
	const grids = new Map([
		[
			'Settings',
			[
				['key', 'value'],
				['legal_entity', 'Test Sdn Bhd'],
				['month', '2026-01'],
				['timezone', 'Asia/Kuala_Lumpur']
			]
		],
		[
			'Time entries',
			[
				['employee_number', '1', '2'],
				['A', '', '']
			]
		]
	]);
	const payload = schedulingImportPayload(grids);

	const blank = await run(tables, payload);
	await blank.result;

	assert.equal(
		blank.ctx.acts.find((a) => a.callable === 'work_days.delete').input.target.length,
		3
	);
});
test('paid individual window: changed or new entry fails the entire import before any write, while identical rows pass', async () => {
	const tables = workDayTables({
		employees: ['A', 'B'],
		days: [day('A', '2026-01-05'), day('B', '2026-01-05')],
		runs: [
			{
				id: 'payroll',
				period: '2026-01',
				kind: 'REGULAR',
				attendance_from: '2026-01-01',
				attendance_to: '2026-01-31'
			}
		],
		payslips: [
			{
				id: 'paid',
				payroll_run_id: 'payroll',
				employment_id: 'A',
				paid_at: '2026-02-01T00:00:00Z'
			},
			{ id: 'held', payroll_run_id: 'payroll', employment_id: 'B', paid_at: null }
		]
	});
	for (const attendance of [
		[{ ...clock('A', '2026-01-05'), clock_out: '18:00' }, clock('B', '2026-01-06')],
		[clock('A', '2026-01-05'), clock('A', '2026-01-06')]
	]) {
		const { ctx, result } = await run(tables, { attendance });
		await assert.rejects(result, /paid payroll/);
		assert.deepEqual(ctx.acts, []);
	}
	const identical = await run(tables, {
		attendance: [clock('A', '2026-01-05'), clock('B', '2026-01-06')]
	});
	await identical.result;
	assert.equal(
		identical.ctx.acts.some((a) => a.callable === 'work_days.create'),
		true
	);
});

test('omitting a paid captured colleague refuses the whole month SET before any write', async () => {
	const tables = workDayTables({
		employees: ['A', 'B'],
		days: [day('A', '2026-01-05'), day('B', '2026-01-05', { payslip_id: 'paid' })],
		payslips: [{ id: 'paid', employment_id: 'B', paid_at: '2026-02-01T00:00:00Z' }]
	});
	const { ctx, result } = await run(tables, { attendance: [clock('A', '2026-01-06')] });
	await assert.rejects(result, /B on 2026-01-05.*file leaves it out/);
	assert.deepEqual(ctx.acts, []);
});

test('unpaid captures remain editable and deletable; paid captures of every run kind and funding/allocations stay locked', async () => {
	const tables = workDayTables({
		employees: ['A'],
		days: [day('A', '2026-01-05', { payslip_id: 'capture' })],
		payslips: [{ id: 'capture', employment_id: 'A', payroll_run_id: 'payroll', paid_at: null }]
	});
	const stored = tables.work_days[0];
	await writeDay(workDays, { worked_intervals: [] }, stored, tables);
	await writeDays(workDays, [{ $delete: true }], tables, [stored]);
	const editable = await run(tables, { attendance: [clock('A', '2026-01-06')] });
	await editable.result;
	assert.ok(editable.ctx.acts.find((a) => a.callable === 'work_days.delete'));
	for (const kind of ['EARLY', 'OFF_CYCLE', 'CORRECTION', 'REGULAR', 'FINAL']) {
		tables.payroll_runs = [
			{
				id: 'payroll',
				company_id: 'co-1',
				kind,
				period: '2026-01',
				attendance_from: '2026-01-01',
				attendance_to: '2026-01-31'
			}
		];
		tables.payslips[0].paid_at = '2026-02-01T00:00:00Z';
		const locked = await run(tables, { attendance: [clock('A', '2026-01-06')] });
		await assert.rejects(locked.result, /already taken into account/);
		assert.deepEqual(locked.ctx.acts, []);
	}
	tables.payroll_runs = [];
	tables.payslips[0].paid_at = null;
	for (const funding of [{ funding_received: 1 }, { funding_reference: 'RECEIPT' }]) {
		Object.assign(tables.payslips[0], funding);
		const locked = await run(tables, { attendance: [] });
		await assert.rejects(locked.result, /already taken into account/);
		await assert.rejects(
			writeDay(workDays, { worked_intervals: [] }, stored, tables),
			/already taken this record/
		);
		await assert.rejects(
			writeDays(workDays, [{ $delete: true }], tables, [stored]),
			/already taken this record/
		);
		assert.deepEqual(locked.ctx.acts, []);
	}
	tables.payslips[0].funding_received = 0;
	tables.payslips[0].funding_reference = null;
	tables.payable_tranches = [
		{ id: 'tranche', settlement: { collection: 'payslips', id: 'capture' } }
	];
	tables.payment_allocations = [{ payable_tranche_id: 'tranche', amount: 1 }];
	const allocated = await run(tables, { attendance: [] });
	await assert.rejects(allocated.result, /already taken into account/);
	assert.deepEqual(allocated.ctx.acts, []);
});
test('empty sheets replace editable recorded data, while malformed empty headers refuse', () => {
	const settings = [
		['key', 'value'],
		['legal_entity', 'Test Sdn Bhd'],
		['month', '2026-01'],
		['timezone', 'Asia/Kuala_Lumpur']
	];
	assert.deepEqual(
		schedulingImportPayload(
			new Map([
				['Settings', settings],
				['Time entries', [['employee_number', '1', '2']]]
			])
		).attendance,
		[]
	);
	assert.throws(
		() =>
			schedulingImportPayload(
				new Map([
					['Settings', settings],
					['Time entries', [['random']]]
				])
			),
		/missing column/
	);
});
test('paid individual regular window prevents deleting or creating the monthly roster of record', async () => {
	const tables = workDayTables({
		employees: ['A', 'B'],
		runs: [
			{ id: 'r', period: '2026-01', attendance_from: '2026-01-01', attendance_to: '2026-01-31' }
		],
		payslips: [{ employment_id: 'A', payroll_run_id: 'r', paid_at: '2026-02-01T00:00:00Z' }]
	});
	await assert.rejects(
		runTransform(rosters, [{ employment_id: 'A', period: '2026-01' }], { tables }),
		/inside paid payroll/
	);
	await assert.rejects(
		runTransform(rosters, [{ $delete: true }], {
			tables,
			existing: [{ employment_id: 'A', period: '2026-01' }]
		}),
		/inside paid payroll/
	);
	await runTransform(rosters, [{ employment_id: 'B', period: '2026-01' }], { tables });
});
