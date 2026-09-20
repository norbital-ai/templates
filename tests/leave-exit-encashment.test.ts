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
		encashable: new Set(
			context.catalogues.flatMap((row) => (row.can_encash && row.encash_on_exit ? [row.id] : []))
		),
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
	// A row the version does not mark `encash_on_exit` (sick, hospitalisation) is never paid out
	// at exit, whatever `can_encash` says; the code is not read.
	const sick = closed(leaveContext());
	sick.catalogues[0]!.code = 'HOSPITALIZATION_LEAVE';
	sick.catalogues[0]!.encash_on_exit = false;
	assert.deepEqual(plan(sick), []);
});

/** The automation's api over one in-memory context: reads answer from it, writes are recorded. */
const harness = (
	context: LeaveContext,
	exitReason: string | null,
	separation: readonly Record<string, unknown>[] = [],
	standing: readonly Record<string, unknown>[] = []
) => {
	const writes: Record<string, unknown>[] = [];
	const raisedAdhoc: Record<string, unknown>[] = [];
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
			payslips: rows([]),
			statutory_contributions: rows([]),
			employment_statutory_facts: rows([]),
			adhoc_catalogue: rows(separation),
			adhoc_requests: rows(standing)
		},
		collection: {
			adhoc_requests: {
				createMany: (inputs: Record<string, unknown>[]) =>
					Effect.sync(() => {
						raisedAdhoc.push(...inputs);
						return inputs;
					})
			},
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
	return { api, writes, raisedAdhoc };
};
const run = (
	context: LeaveContext,
	exitReason: string | null,
	separation: readonly Record<string, unknown>[] = [],
	standing: readonly Record<string, unknown>[] = [],
	now = new Date('2026-06-30T12:00:00Z')
) => {
	const { api, writes, raisedAdhoc } = harness(context, exitReason, separation, standing);
	return Effect.runPromise(runLeaveEncashmentOnExit(api, id(1), now)).then((result) => ({
		result,
		writes,
		raisedAdhoc
	}));
};

test('a future departure reserves no leave; the due-day run includes intervening leave', async () => {
	const context = closed(leaveContext());
	// Future law need not have been configured to record a planned departure.
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-06-15' };
	const future = await run(context, 'RESIGNATION', [], [], new Date('2026-06-01T00:00:00Z'));
	assert.equal(future.result.status, 'not_due');
	assert.equal(future.writes.length, 0);
	assert.equal(future.raisedAdhoc.length, 0);
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-12-31' };
	approve(context, timeOff('2026-06-15'), 11);
	const due = await run(context, 'RESIGNATION');
	assert.equal(due.result.status, 'raised');
	assert.equal(due.result.raised[0]?.days, 11);
});

test('closing a contract raises the held encashment once, including dismissals; an open contract raises nothing', async () => {
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
	assert.equal(dismissed.result.status, 'raised');
	assert.equal(dismissed.writes.length, 1);
	const open = await run(leaveContext(), null);
	assert.equal(open.result.status, 'open');
	assert.equal(open.writes.length, 0);
	const unbounded = leaveContext();
	unbounded.employments[0]!.effective_range = {
		start: '2025-01-01',
		end: '9999-12-31T23:59:59.999Z'
	};
	assert.equal((await run(unbounded, null)).result.status, 'open');
});

test('off-boarding raises the separation payments the version owes the leaver, once, where their eligibility holds', async () => {
	const rows = [
		{
			id: id(95),
			code: 'TERMINATION_BENEFIT',
			eligibility: 'employment.exit_reason == "REDUNDANCY" && employment.service_months >= 12'
		},
		{ id: id(96), code: 'NOTICE_IN_LIEU', eligibility: 'terms.notice_days > 0' }
	];
	// A leaver made redundant after a year: the termination benefit is owed, notice in lieu is
	// not (the contract states no notice), and the encashment rides beside it.
	const redundant = await run(closed(leaveContext()), 'REDUNDANCY', rows);
	assert.equal(redundant.result.status, 'raised');
	assert.deepEqual(
		redundant.raisedAdhoc.map((row) => [
			row.catalogue_id,
			row.event_date,
			row.pay_period,
			row.amount
		]),
		// Dated the last day, due in the last day's own month — not the cutoff's next period.
		[[id(95), EXIT, EXIT.slice(0, 7), 0]]
	);
	assert.deepEqual(
		redundant.result.raised.map((row) => row.code),
		['ANNUAL', `TERMINATION_BENEFIT on departure ${EXIT}; raised for HR review.`]
	);
	// A resignation owes neither; and a row already standing on the day is not raised again.
	const resigned = await run(closed(leaveContext()), 'RESIGNATION', rows);
	assert.deepEqual(resigned.raisedAdhoc, []);
	const again = await run(closed(leaveContext()), 'REDUNDANCY', rows, [
		{ catalogue_id: id(95), event_date: EXIT }
	]);
	assert.deepEqual(again.raisedAdhoc, []);
	// A payment owed in a window before a dated event (ID THR for a leaver in the thirty days
	// before Idulfitri, Permenaker 6/2016 art.7(1)): the eligibility compares the exit day.
	const thr = [
		{
			id: id(97),
			code: 'THR',
			eligibility: 'employment.exit_date >= "2026-06-01" && employment.exit_date < "2026-07-01"'
		}
	];
	const inWindow = await run(closed(leaveContext()), 'RESIGNATION', thr);
	assert.deepEqual(
		inWindow.raisedAdhoc.map((row) => row.catalogue_id),
		[id(97)]
	);
	const outside = await run(closed(leaveContext()), 'RESIGNATION', [
		{ ...thr[0], eligibility: 'employment.exit_date >= "2026-07-01"' }
	]);
	assert.deepEqual(outside.raisedAdhoc, []);
});

test('departure automation validates the final-day input declaration before creating requests', async () => {
	const context = closed(leaveContext());
	context.versions[0]!.exit_facts = [
		{
			key: 'legal_cause',
			type: 'string',
			label: 'Legal cause',
			required: true,
			options: ['LOSS', 'OTHER']
		}
	];
	const rows = [
		{
			id: id(95),
			code: 'TERMINATION_BENEFIT',
			eligibility: 'employment.exit_facts.legal_cause == "LOSS"'
		}
	];
	const missing = harness(context, 'RETRENCHMENT', rows);
	await assert.rejects(
		Effect.runPromise(
			runLeaveEncashmentOnExit(missing.api, id(1), new Date('2026-06-30T12:00:00Z'))
		),
		/Legal cause is required/
	);
	assert.equal(missing.writes.length, 0);
	assert.equal(missing.raisedAdhoc.length, 0);
	context.employments[0]!.exit_facts = { legal_cause: 'LOSS' };
	const resolved = await run(context, 'RETRENCHMENT', rows);
	assert.equal(resolved.raisedAdhoc.length, 1);
	context.employments[0]!.exit_facts = { legal_cause: 'OTHER' };
	assert.equal((await run(context, 'RETRENCHMENT', rows)).raisedAdhoc.length, 0);
});
