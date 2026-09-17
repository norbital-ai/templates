import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { runLeaveEncashmentOnExit } from '../src/automations/+leave_encashment_on_exit.ts';
import { exitEncashments, exitReference } from '../src/lib/leave/exit-encashment.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import type { LeaveContext } from '../src/lib/leave/context.ts';
import {
	approve,
	id,
	leaveContext,
	planLeaveBatch,
	timeOff
} from './helpers/manual-leave-context.ts';

const EXIT = '2026-06-30';
const closed = (context: LeaveContext) => {
	context.employments[0]!.effective_range = { start: '2025-01-01', end: EXIT };
	return context;
};
const plan = (context: LeaveContext, posted: readonly string[] = []) =>
	exitEncashments({
		employmentId: id(1),
		exitDate: EXIT,
		summaries: leaveBalanceSummaries(context, id(1), EXIT),
		encashable: new Set(context.catalogues.flatMap((row) => (row.can_encash ? [row.id] : []))),
		posted: new Set(posted),
		reason: 'departure'
	});

test('the unused balance on the last day is the encashment, and the leave door accepts it whole', () => {
	const context = closed(leaveContext());
	approve(context, timeOff('2026-03-02'), 11);
	const [entry, ...rest] = plan(context);
	assert.equal(rest.length, 0);
	assert.deepEqual(entry, {
		employment_id: id(1),
		catalogue_id: id(7),
		reference: exitReference(id(1), 'ANNUAL'),
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 11,
		encash_days: 11,
		effective_on: EXIT,
		due_on: EXIT,
		reason: 'departure'
	});
	const [approved] = planLeaveBatch(context, [entry!]);
	assert.equal(approved!.encash_days, 11);
	assert.equal(
		approved!.allocations.reduce((sum, row) => sum + row.days, 0),
		-11
	);
});

test('a spent balance, a posted exit reference, a non-encashable row or a non-annual row raises nothing', () => {
	const spent = closed(leaveContext());
	approve(spent, timeOff('2026-03-02', '2026-03-13'), 12);
	assert.deepEqual(plan(spent), []);
	assert.deepEqual(plan(closed(leaveContext()), [exitReference(id(1), 'ANNUAL')]), []);
	const locked = closed(leaveContext());
	locked.catalogues[0]!.can_encash = false;
	assert.deepEqual(plan(locked), []);
	// Sick or hospitalisation leave is never paid out at exit, whatever `can_encash` defaults to.
	const sick = closed(leaveContext());
	sick.catalogues[0]!.code = 'HOSPITALIZATION_LEAVE';
	assert.deepEqual(plan(sick), []);
});

/** The automation's api over one in-memory context: reads answer from it, writes are recorded. */
const harness = (context: LeaveContext, exitReason: string | null) => {
	const writes: Record<string, unknown>[] = [];
	const employment = {
		...context.employments[0]!,
		employee_number: 'E-1',
		exit_reason: exitReason,
		employment_employee: context.employees[0],
		employment_company: context.companies[0]
	};
	const rows = (list: readonly unknown[]) => ({ findMany: () => Effect.succeed(list) });
	const api = {
		progress: () => Effect.void,
		db: {
			employments: { ...rows([employment]), findFirst: () => Effect.succeed(employment) },
			employment_terms: rows(context.terms),
			leave_entries: rows(context.entries),
			work_days: rows([]),
			jurisdiction_settings: rows(context.versions),
			leave_catalogue: rows(context.catalogues),
			payroll_runs: rows([]),
			shift_patterns: rows(context.patterns),
			shift_definitions: rows(context.shifts),
			jurisdiction_holidays: rows([]),
			payslips: rows([])
		},
		collection: {
			leave_entries: {
				createMany: (inputs: Record<string, unknown>[]) =>
					Effect.sync(() => {
						writes.push(...inputs);
						return inputs.map((row, index) => ({
							...row,
							leave_code: 'ANNUAL',
							id: id(90 + index),
							approval_id: 'held'
						}));
					})
			}
		}
	} as unknown as Parameters<typeof runLeaveEncashmentOnExit>[0];
	return { api, writes };
};
const run = (context: LeaveContext, exitReason: string | null) => {
	const { api, writes } = harness(context, exitReason);
	return Effect.runPromise(runLeaveEncashmentOnExit(api, id(1))).then((result) => ({
		result,
		writes
	}));
};

test('closing a contract raises the held encashment once; a dismissal or an open contract raises nothing', async () => {
	const context = closed(leaveContext());
	const first = await run(context, 'RESIGNATION');
	assert.equal(first.result.status, 'raised');
	assert.deepEqual(first.result.raised, [
		{ code: 'ANNUAL', days: 12, reference: exitReference(id(1), 'ANNUAL') }
	]);
	assert.equal(first.writes.length, 1);
	// The held row is on the record now; the same run again finds its reference and stops.
	context.entries.push({
		...(first.writes[0] as (typeof context.entries)[number]),
		id: id(90),
		leave_code: 'ANNUAL',
		charges: [],
		allocations: [],
		approval_id: 'held',
		payslip_id: null
	});
	const again = await run(context, 'RESIGNATION');
	assert.equal(again.result.status, 'nothing_to_encash');
	assert.equal(again.writes.length, 0);
	const dismissed = await run(closed(leaveContext()), 'DISMISSAL');
	assert.equal(dismissed.result.status, 'dismissal');
	assert.equal(dismissed.writes.length, 0);
	const open = await run(leaveContext(), null);
	assert.equal(open.result.status, 'open');
	assert.equal(open.writes.length, 0);
});
