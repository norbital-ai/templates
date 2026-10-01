// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { settleExit } from '../src/lib/leave/exit-settlement.ts';
import encashmentDue from '../src/automation/+leave_encashment_due.automation.ts';
import { exitEncashments, exitReference } from '../src/lib/leave/exit-encashment.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { matches } from './helpers/ctx.ts';
import { leaveCatalogue } from './fixtures/statutory-world.ts';
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
/** The departure settlement over a fake run `ctx` whose reads answer with the context's rows, at a run instant. */
const harness = (
	context: LeaveContext,
	exitReason: string | null,
	separation: readonly Record<string, unknown>[] = [],
	standing: readonly Record<string, unknown>[] = [],
	now = '2026-06-30T12:00:00.000Z',
	heldRows: readonly Record<string, unknown>[] = []
) => {
	const writes: Record<string, unknown>[] = [];
	const raisedAdhoc: Record<string, unknown>[] = [];
	const raisedHolds: Record<string, unknown>[] = [];
	const stamps: Record<string, unknown>[] = [];
	const employment = {
		...context.employments[0]!,
		employee_number: 'E-1',
		exit_ground: exitReason,
		approval_id: null
	};
	const rows: Record<string, readonly unknown[]> = {
		employments: [employment],
		employees: context.employees,
		companies: context.companies,
		employment_terms: context.terms,
		leave_entries: context.entries,
		jurisdiction_settings: context.versions,
		leave_catalogue: context.catalogues,
		shift_patterns: context.patterns,
		shift_definitions: context.shifts,
		adhoc_catalogue: separation,
		adhoc_requests: standing,
		payment_holds: heldRows
	};
	const ctx = {
		now,
		today: now.slice(0, 10),
		todayIn: () => now.slice(0, 10),
		progress: async () => {},
		get: async () => employment,
		read: async (collection: string, query: { where?: unknown } = {}) => ({
			rows:
				collection === 'payment_holds'
					? (rows[collection] ?? []).filter((row) => matches(rows, collection, row, query.where))
					: collection === 'adhoc_catalogue'
						? // a row that declares its `raised_by` answers only its own read
							(rows[collection] ?? []).filter(
								(row) =>
									row.raised_by == null ||
									row.raised_by === (query.where as { raised_by?: { eq?: string } })?.raised_by?.eq
							)
						: (rows[collection] ?? []),
			next: null
		}),
		act: async (callable: string, input: unknown) => {
			if (callable === 'leave_entries.create') writes.push(...(input as Record<string, unknown>[]));
			else if (callable === 'adhoc_requests.create')
				raisedAdhoc.push(...(input as Record<string, unknown>[]));
			else if (callable === 'payment_holds.create')
				raisedHolds.push(input as Record<string, unknown>);
			else if (callable === 'employments.update')
				stamps.push((input as { set: Record<string, unknown> }).set);
			return { kind: 'committed', output: undefined, records: [] };
		}
	} as unknown as Parameters<typeof settleExit>[0];
	return { ctx, run: () => settleExit(ctx, id(1)), writes, raisedAdhoc, raisedHolds, stamps };
};
const run = async (
	context: LeaveContext,
	exitReason: string | null,
	separation: readonly Record<string, unknown>[] = [],
	standing: readonly Record<string, unknown>[] = [],
	now = '2026-06-30T12:00:00.000Z'
) => {
	const h = harness(context, exitReason, separation, standing, now);
	return { result: await h.run(), writes: h.writes, raisedAdhoc: h.raisedAdhoc, stamps: h.stamps };
};

test('tax-clearance hold starts on employer awareness and a released hold is not recreated', async () => {
	const context = closed(leaveContext());
	context.terms[0]!.residency_status = 'FOREIGNER';
	context.employments[0]!.exit_facts = { clearance_awareness_on: '2026-06-01' };
	context.versions[0]!.payroll.tax_clearance = {
		when: 'employee.citizenship == "FOREIGNER"',
		category: 'TAX_CLEARANCE',
		reference_label: 'IR21',
		authority: 'Income Tax Act s.68(7)'
	};
	const first = harness(context, 'RESIGNATION');
	await first.run();
	assert.deepEqual(
		first.raisedHolds.map((row) => row.held_on),
		['2026-06-01']
	);
	const released = harness(context, 'RESIGNATION', [], [], '2026-06-30T12:00:00.000Z', [
		{
			id: 'released-ir21',
			employment_id: id(1),
			category: 'TAX_CLEARANCE',
			held_on: '2026-06-01',
			released_on: '2026-06-20'
		}
	]);
	await released.run();
	assert.equal(released.raisedHolds.length, 0);
});

test('a future departure reserves no leave; the due-day run includes intervening leave', async () => {
	const context = closed(leaveContext());
	// Future law need not have been configured to record a planned departure.
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-06-15' };
	const future = await run(context, 'RESIGNATION', [], [], '2026-06-01T00:00:00.000Z');
	assert.equal(future.result.status, 'not_due');
	assert.deepEqual(
		future.stamps,
		[{ encashment_due_on: EXIT }],
		'the deferred day is recorded for the daily catch-up'
	);
	assert.equal(future.writes.length, 0);
	assert.equal(future.raisedAdhoc.length, 0);
	context.versions[0]!.effective_range = { start: '2026-01-01', end: '2026-12-31' };
	approve(context, timeOff('2026-06-15'), 11);
	const due = await run(context, 'RESIGNATION');
	assert.equal(due.result.status, 'raised');
	assert.equal(due.result.raised[0]?.days, 11);
	assert.deepEqual(
		due.stamps,
		[{ encashment_raised_at: '2026-06-30T12:00:00.000Z' }],
		'raised once: the stamp stops a re-raise'
	);
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
			eligibility: 'employment.exit_ground == "REDUNDANCY" && employment.service_months >= 12'
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
	// EM-1: an annual class (PH 13th month, DOLE Handbook 2024 ch.13 §G) paid last December does
	// not settle this year's pro-rata share; only a request in the departure's own year does.
	const annual = [{ id: id(98), code: 'THIRTEENTH_MONTH_PAY', eligibility: '' }];
	const lastYear = await run(closed(leaveContext()), 'RESIGNATION', annual, [
		{ catalogue_id: id(98), event_date: '2025-12-15' }
	]);
	assert.deepEqual(
		lastYear.raisedAdhoc.map((row) => [row.catalogue_id, row.event_date, row.amount]),
		[[id(98), EXIT, 0]]
	);
	const thisYear = await run(closed(leaveContext()), 'RESIGNATION', annual, [
		{ catalogue_id: id(98), event_date: '2026-06-30' }
	]);
	assert.deepEqual(thisYear.raisedAdhoc, []);
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

test('a December leaver whose year-end 13th month stands is not raised the separation 13th month again', async () => {
	// PD 851 (DOLE Handbook 2024 ch.13 §§E, G): one 13th month a year. THIRTEENTH_MONTH_PAY_YEAR_END is raised from
	// 24 November for the 24 December occurrence; a leaver on 28 December is settled by it, not also by
	// THIRTEENTH_MONTH_PAY (SEPARATION), whether it is still held or already paid.
	const exit = '2026-12-28';
	const december = () => {
		const context = leaveContext();
		context.employments[0]!.effective_range = { start: '2025-01-01', end: exit };
		return context;
	};
	const bands = [
		{ when: '', amount: '(year.earned.BASIC - year.earned.ABSENCE) / 12.0', limit: null }
	];
	const rows = [
		{ id: id(98), code: 'THIRTEENTH_MONTH_PAY', eligibility: '', bands, raised_by: 'SEPARATION' },
		{
			id: id(99),
			settings_id: id(6),
			code: 'THIRTEENTH_MONTH_PAY_YEAR_END',
			eligibility: '',
			bands,
			raised_by: 'SCHEDULED',
			schedule: {
				due: '[string(year) + "-12-24"]',
				raise_days_before: 30,
				duty: 'THIRTEENTH_MONTH_PAY_OWED'
			}
		}
	];
	const at = `${exit}T12:00:00.000Z`;
	const raised = async (standing: readonly Record<string, unknown>[]) =>
		(await run(december(), 'RESIGNATION', rows, standing, at)).raisedAdhoc.map(
			(row) => row.catalogue_id
		);
	const yearEnd = { catalogue_id: id(99), event_date: '2026-12-24' };
	assert.deepEqual(await raised([yearEnd]), []);
	assert.deepEqual(await raised([{ ...yearEnd, payslip_id: id(50) }]), []);
	// No year-end on file, or only last year's: the leaver's pro-rata share is raised on departure.
	assert.deepEqual(await raised([]), [id(98)]);
	assert.deepEqual(await raised([{ ...yearEnd, event_date: '2025-12-24' }]), [id(98)]);
	// A 10 January leaver is owed this year's share: last December's year-end does not settle it.
	const january = leaveContext();
	january.employments[0]!.effective_range = { start: '2025-01-01', end: '2027-01-10' };
	assert.deepEqual(
		(
			await run(january, 'RESIGNATION', rows, [yearEnd], '2027-01-10T12:00:00.000Z')
		).raisedAdhoc.map((row) => row.catalogue_id),
		[id(98)]
	);
	// ID THR: a permanent worker leaving 10 March after THR_HOLIDAY was raised for the 20 March holiday.
	const thr = [
		{ ...rows[0], id: id(96), code: 'THR' },
		{
			...rows[1],
			id: id(97),
			code: 'THR_HOLIDAY',
			schedule: { ...rows[1].schedule, raise_days_before: 21 }
		}
	];
	const march = leaveContext();
	march.employments[0]!.effective_range = { start: '2025-01-01', end: '2026-03-10' };
	assert.deepEqual(
		(
			await run(
				march,
				'RESIGNATION',
				thr,
				[{ catalogue_id: id(97), event_date: '2026-03-13' }],
				'2026-03-10T12:00:00.000Z'
			)
		).raisedAdhoc,
		[]
	);
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
	await assert.rejects(missing.run(), /Legal cause is required/);
	assert.equal(missing.writes.length, 0);
	assert.equal(missing.raisedAdhoc.length, 0);
	context.employments[0]!.exit_facts = { legal_cause: 'LOSS' };
	const resolved = await run(context, 'RETRENCHMENT', rows);
	assert.equal(resolved.raisedAdhoc.length, 1);
	context.employments[0]!.exit_facts = { legal_cause: 'OTHER' };
	assert.equal((await run(context, 'RETRENCHMENT', rows)).raisedAdhoc.length, 0);
});

test('a contract whose settlement was raised is never raised again, even after HR rejected the request', async () => {
	const context = closed(leaveContext());
	(context.employments[0] as { encashment_raised_at?: string }).encashment_raised_at =
		'2026-06-30T12:00:00.000Z';
	const again = await run(context, 'RESIGNATION');
	assert.equal(again.result.status, 'nothing_to_encash');
	assert.deepEqual([again.writes, again.raisedAdhoc, again.stamps], [[], [], []]);
});

test('the daily catch-up settles each contract whose deferred day has come, and names a failure without stopping', async () => {
	const h = harness(closed(leaveContext()), 'RESIGNATION');
	const result = await encashmentDue.body({}, h.ctx);
	assert.deepEqual(result, { checked: 1, raised: 1, failures: [], completed: [id(1)] });
	assert.equal(h.writes.length, 1);
	const failing = harness(closed(leaveContext()), 'RESIGNATION');
	(failing.ctx as { get: unknown }).get = async () => null;
	const failed = await encashmentDue.body({}, failing.ctx);
	assert.equal(failed.failures.length, 1);
	assert.deepEqual(failed.completed, []);
});

test('Thailand s.67 pays carried annual leave on every exit and only earned current-year leave on eligible dismissal', async () => {
	// LPA s.67, Ministry consolidation: https://www.mol.go.th/wp-content/uploads/sites/2/2018/03/301.pdf
	const annual = leaveCatalogue('TH').find((row) => row.code === 'ANNUAL_LEAVE')!;
	const make = () => {
		const context = closed(leaveContext());
		context.employments[0]!.effective_range = { start: '2024-01-01', end: EXIT };
		context.versions[0]!.jurisdiction_code = 'TH';
		context.versions[0]!.exit_facts = [
			{
				key: 'dismissed_for_cause',
				type: 'boolean',
				label: 's.119 cause',
				required_when: 'employment.exit_ground == "DISMISSAL"'
			}
		];
		context.catalogues[0] = { ...annual, id: id(7), settings_id: id(6) };
		approve(
			context,
			{
				from_date: '2025-01-01',
				to_date: '2025-12-31',
				destination_from: '2026-01-01',
				destination_to: '2026-12-31',
				available_from: '2026-01-01',
				expires_on: '2026-12-31',
				effective_on: '2026-01-01',
				days: 2,
				reason: 'Agreed carry-forward'
			},
			11
		);
		return context;
	};
	for (const [reason, cause, used, expected] of [
		['RESIGNATION', null, false, 2],
		['DISMISSAL', true, false, 2],
		['DISMISSAL', false, false, 2 + (6 * 181) / 365],
		['RESIGNATION', null, true, 1],
		['DISMISSAL', false, true, 1 + (6 * 181) / 365]
	] as const) {
		const context = make();
		if (used) approve(context, timeOff('2026-03-02'), 12);
		if (cause != null) context.employments[0]!.exit_facts = { dismissed_for_cause: cause };
		const result = await run(context, reason);
		assert.equal(result.result.status, 'raised');
		assert.equal(result.writes.length, 1);
		assert.ok(Math.abs(result.result.raised[0]!.days - expected) < 1e-9, reason);
		const [approved] = planLeaveBatch(context, result.writes);
		assert.ok(approved, `${reason} must hold a fundable encashment`);
		assert.ok(Math.abs(approved.encash_days - expected) < 1e-9, reason);
		assert.equal(approved.allocations[0]?.credit_entry_id, id(11));
	}
});

test('a due departure missing an owed declaration refuses by the leaver’s name and stays due for the daily catch-up', async () => {
	const context = closed(leaveContext());
	context.employees[0]!.name = 'Aisyah Rahman';
	context.versions[0]!.exit_facts = [
		{
			key: 'terminated_without_notice',
			type: 'boolean',
			label: 'Left without notice',
			required_when: 'employment.exit_ground == "RESIGNATION"'
		}
	];
	const missing = harness(context, 'RESIGNATION');
	await assert.rejects(
		missing.run(),
		/Departure of Aisyah Rahman on 2026-06-30: Left without notice is required before calculation\./
	);
	assert.deepEqual(missing.stamps, [{ encashment_due_on: EXIT }]);
	assert.equal(missing.writes.length, 0);
	// Owed only on a resignation; recorded, it settles.
	await run(context, 'RETIREMENT');
	context.employments[0]!.exit_facts = { terminated_without_notice: false };
	await run(context, 'RESIGNATION');
});
