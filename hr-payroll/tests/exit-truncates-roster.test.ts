// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A departure takes the plan after its last day with it: the rosters and work days written past the new last day are
 * deleted in the same employments write. It is refused while a payslip has consumed such a day, naming the payslip and
 * run; a departure moved later or withdrawn is refused while a payslip settled it. The helper clock's today is
 * 2026-06-15.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import employments from '../src/data/collection/employments/+collection.ts';
import { transform } from './helpers/bodies.ts';

const contract = (to, over = {}) => ({
	id: 'a',
	employee_id: 'person',
	company_id: 'entity',
	employee_number: 'E1',
	effective_range: { from: '2025-01-01', to },
	exit_ground: null,
	exit_facts: null,
	comments: null,
	...over
});
const day = (date, over = {}) => ({
	id: `day-${date}`,
	employment_id: 'a',
	work_date: date,
	payslip_id: null,
	...over
});
const roster = (period) => ({ id: `roster-${period}`, employment_id: 'a', period });
const run = { id: 'run-6', period: '2026-06', kind: 'REGULAR', sequence: 1 };
const slip = (status, through) => ({
	id: 'slip-6',
	employment_id: 'a',
	payroll_run_id: 'run-6',
	status,
	terms_through: through
});
const world = (stored, over = {}) => ({
	employments: [stored],
	companies: [{ id: 'entity', settings_code: 'X' }],
	jurisdiction_settings: [
		{
			id: 'x',
			code: 'X',
			sealed_at: '2025-01-01T00:00:00.000Z',
			voided_at: null,
			approval_id: null,
			effective_range: { from: '2025-01-01', to: null },
			exit_facts: []
		}
	],
	reference_rows: [
		{
			settings_id: 'x',
			table: 'TERMINATION_GROUND',
			code: 'RESIGNATION',
			effective_range: { from: '2025-01-01', to: null }
		}
	],
	work_days: [day('2026-06-09'), day('2026-06-10'), day('2026-06-11'), day('2026-07-01')],
	rosters: [roster('2026-05'), roster('2026-06'), roster('2026-07'), roster('2026-08')],
	payroll_runs: [run],
	payslips: [],
	...over
});
const write = (stored, to, over = {}, tables = world(stored)) =>
	transform(
		employments,
		[
			{
				effective_range: { from: '2025-01-01', to },
				exit_ground: to == null ? null : 'RESIGNATION',
				...over
			}
		],
		{ existing: [stored], tables }
	);

test('a departure deletes the work days after its last day and the rosters of later months', async () => {
	const [out] = await write(contract(null), '2026-06-10');
	assert.deepEqual(out.work_days, { delete: ['day-2026-06-11', 'day-2026-07-01'] });
	// The exit month's roster stays: its days up to the last day are still the plan of record.
	assert.deepEqual(out.rosters, { delete: ['roster-2026-07', 'roster-2026-08'] });
});

test('an end moved earlier truncates from the new last day; nothing past it leaves the write alone', async () => {
	const [earlier] = await write(contract('2026-12-31'), '2026-06-30');
	assert.deepEqual(earlier.work_days, { delete: ['day-2026-07-01'] });
	assert.deepEqual(earlier.rosters, { delete: ['roster-2026-07', 'roster-2026-08'] });
	const [clean] = await write(contract(null), '2026-08-31');
	assert.equal('work_days' in clean, false);
	assert.equal('rosters' in clean, false);
});

test('a payslip past the new last day refuses the departure, naming the payslip, its run and the recovery', async () => {
	const stored = contract(null);
	await assert.rejects(
		write(stored, '2026-06-10', {}, world(stored, { payslips: [slip('DRAFT', '2026-06-30')] })),
		/Payslip slip-6 in the 2026-06 REGULAR payroll run #1 .* through 2026-06-30, after the new last day 2026-06-10\. Delete that unpaid run first/
	);
	await assert.rejects(
		write(stored, '2026-06-10', {}, world(stored, { payslips: [slip('PAID', '2026-06-30')] })),
		/It is paid, so it is kept: record a last day on or after 2026-06-30/
	);
	// A work day a payslip consumed after the new last day refuses it too.
	await assert.rejects(
		write(
			stored,
			'2026-06-10',
			{},
			world(stored, {
				payslips: [slip('DRAFT', '2026-06-10')],
				work_days: [day('2026-06-11', { payslip_id: 'slip-6' })]
			})
		),
		/Payslip slip-6 .* Delete that unpaid run first/
	);
	// A payslip through the last day itself does not.
	const [out] = await write(
		stored,
		'2026-06-10',
		{},
		world(stored, { payslips: [slip('DRAFT', '2026-06-10')] })
	);
	assert.deepEqual(out.work_days, { delete: ['day-2026-06-11', 'day-2026-07-01'] });
});

test('a departure moves back out or is withdrawn until a payslip settles it', async () => {
	const left = contract('2026-06-10', {
		exit_ground: 'RESIGNATION',
		encashment_due_on: '2026-06-10'
	});
	const [later] = await write(left, '2026-07-31');
	assert.equal('work_days' in later, false);
	const [withdrawn] = await write(left, null, { exit_facts: {} });
	assert.equal(withdrawn.encashment_due_on, null);
	// Passed ends are recoverable too: a mistyped past date is withdrawn.
	await write(contract('2026-01-31', { exit_ground: 'RESIGNATION' }), null);
	await assert.rejects(
		write(left, null, {}, world(left, { payslips: [slip('DRAFT', '2026-06-10')] })),
		/settled the departure on 2026-06-10\. Delete that unpaid run first, then move or withdraw the departure/
	);
	await assert.rejects(
		write(left, '2026-07-31', {}, world(left, { payslips: [slip('PAID', '2026-06-10')] })),
		/It is paid, so the departure stands: create a new contract for a rehire/
	);
});
