import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import terms from '../src/collections/employment_terms/+collection.ts';
import workDays from '../src/collections/work_days/+collection.ts';
import payslips from '../src/collections/payslips/+collection.ts';
import { peopleGrants } from '../src/lib/policy_grants.ts';
import { transformOne } from './helpers/transform.ts';
import { workDayDb } from './helpers/work-day-db.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import { leaveTermsThrough } from '../src/lib/employment-contract.ts';
import { dateKey } from '../src/lib/iso-day.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	annualWindow,
	id,
	leaveContext,
	scheduleDb,
	planLeaveBatch,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';

const term = () => ({ ...leaveContext().terms[0]!, pay_frequency: 'MONTHLY', job_title: null });
/**
 * The consumers a term read sees: the latest stored Work date, a held Work proposal, stored and
 * held Leave, the latest payslip. There is no seal log; these rows are the evidence.
 */
const api = (
	workThrough: string | null = null,
	pendingWork: string | null = null,
	leave: readonly { charges: unknown }[] = [],
	payslipThrough: string | null = null
) => ({
	...scheduleDb(),
	employments: {
		findMany: () =>
			Effect.succeed([{ id: id(1), effective_range: { start: '2025-01-01', end: null } }])
	},
	work_days: {
		findMany: () =>
			Effect.succeed(
				[
					...(workThrough == null ? [] : [{ work_date: workThrough }]),
					// A held proposal is a committed row stamped `approval_id`; its date protects too.
					...(pendingWork == null ? [] : [{ work_date: pendingWork, approval_id: id(200) }])
				].map((row) => ({ employment_id: id(1), ...row }))
			)
	},
	leave_entries: {
		findMany: () => Effect.succeed(leave.map((row) => ({ employment_id: id(1), ...row })))
	},
	payslips: {
		findMany: () =>
			Effect.succeed(
				payslipThrough == null ? [] : [{ employment_id: id(1), terms_through: payslipThrough }]
			)
	}
});
const change = (input: Record<string, unknown>, through: string | null, existing = term()) =>
	transformOne(terms, input, existing, api(through));
const create = (input: Record<string, unknown>, through: string | null) =>
	transformOne(terms, input, undefined, api(through));
/** The delete grant's decision on a stored row, as the runtime asks it. */
const deletable = (existing: Record<string, unknown>, through: string | null) =>
	Effect.runSync(
		peopleGrants('delete').employment_terms.delete.authorize(
			{ record: existing },
			{ db: api(through) }
		)
	);

test('January approved leave protects January facts while a July salary/residency amendment remains possible', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement.proration = 'CALENDAR_DAYS';
	context.catalogues[0]!.eligibility = 'terms.basic_salary < 5000';
	const input = submission(timeOff('2026-01-05'));
	const approved = planLeaveBatch(context, [input])[0]!;
	const through = leaveTermsThrough(approved, approved.charges, null)!;
	assert.equal(through, '2026-01-05');
	const original = structuredClone(approved);
	const closed = change({ effective_range: { start: '2025-01-01', end: '2026-06-30' } }, through);
	const successor = create(
		{
			...term(),
			id: id(81),
			base_salary: { value: 6000, currency: 'MYR' },
			residency_status: 'FOREIGNER',
			effective_range: { start: '2026-07-01', end: null }
		},
		through
	);
	assert.equal(successor.employment_id, id(1));
	const before = leaveRules(context, id(1), id(7)).entitlementAt(
		annualWindow,
		'2026-01-05'
	).available;
	context.terms = [
		{ ...context.terms[0]!, ...closed },
		{ ...context.terms[0]!, ...successor }
	];
	const after = leaveRules(context, id(1), id(7)).entitlementAt(
		annualWindow,
		'2026-01-05'
	).available;
	assert.ok(
		after! < before!,
		'future availability remains a query rather than a frozen annual grant'
	);
	assert.deepEqual(approved, original, 'the original charge and allocation are unchanged');
	for (const values of [
		{ base_salary: { value: 4000, currency: 'MYR' } },
		{ residency_status: 'CITIZEN' },
		{ effective_range: { start: '2026-01-02', end: null } }
	])
		assert.throws(() => change(values, through), /consumed/);
});

test('approved future time off consumes its actual dates, and shortening a term cannot uncover them', () => {
	const context = leaveContext();
	const input = submission(timeOff('2026-07-06', '2026-07-07'));
	const approved = planLeaveBatch(context, [input])[0]!;
	const consumed = api(null, null, [approved]);
	assert.equal(leaveTermsThrough(approved, approved.charges, null), '2026-07-07');
	const amend = (end: string) =>
		transformOne(terms, { effective_range: { start: '2025-01-01', end } }, term(), consumed);
	assert.throws(() => amend('2026-06-30'), /consumed dates must remain covered/);
	assert.doesNotThrow(() => amend('2026-07-07'));
});

test('historical gaps cannot acquire new terms, consumed rows cannot be deleted or reopened', () => {
	assert.throws(
		() =>
			create(
				{ ...term(), effective_range: { start: '2025-06-01', end: '2025-12-31' } },
				'2026-01-31'
			),
		/historical gaps/
	);
	assert.equal(deletable(term(), '2026-01-31'), false, 'consumed terms are not deleted');
	const closed = { ...term(), effective_range: { start: '2025-01-01', end: '2026-06-30' } };
	assert.throws(
		() => change({ effective_range: { start: '2025-01-01', end: null } }, '2026-01-31', closed),
		/only close/
	);
	assert.doesNotThrow(() => change({}, '2026-01-31', closed));
});

test('unconsumed drafts and future terms remain correctable, and terms always name their contract', () => {
	assert.doesNotThrow(() => change({ base_salary: { value: 4000, currency: 'MYR' } }, null));
	const future = { ...term(), effective_range: { start: '2026-07-01', end: null } };
	assert.doesNotThrow(() => change({ residency_status: 'CITIZEN' }, '2026-01-31', future));
	assert.equal(deletable(future, '2026-01-31'), true, 'unconsumed future terms may go');
	const { employment_id: _employment, ...input } = term();
	assert.throws(() => create(input, null), /must reference an employment contract/);
	assert.equal(create({ ...input, employment_id: id(1) }, null).employment_id, id(1));
});

test('pending consumer dates prevent conflicting amendments until their approval resolves', () => {
	const input = { effective_range: { start: '2025-01-01', end: '2026-06-30' } };
	assert.throws(
		() => transformOne(terms, input, term(), api('2026-01-31', '2026-07-07')),
		/consumed dates/
	);
	assert.doesNotThrow(() => change(input, '2026-01-31'));
});

test('a committed payslip consumes its terms through the settlement date', () => {
	assert.throws(
		() =>
			transformOne(
				terms,
				{ base_salary: { value: 4000, currency: 'MYR' } },
				term(),
				api(null, null, [], '2026-01-31')
			),
		/consumed/
	);
});

test('manual encashment and carry consume their actual source valuation, while credits and reversals do not advance it', () => {
	const encashment = {
		from_date: annualWindow.start,
		to_date: annualWindow.end,
		days: 1,
		encash_days: 1,
		effective_on: '2027-02-01',
		due_on: '2027-02-28',
		reason: 'Agreed'
	} as const;
	assert.equal(leaveTermsThrough(encashment, [], '2026-10-31'), '2026-10-31');
	const carry = {
		from_date: annualWindow.start,
		to_date: annualWindow.end,
		destination_from: '2027-01-01',
		destination_to: '2027-12-31',
		days: 1,
		effective_on: '2027-01-01',
		available_from: '2027-01-01',
		expires_on: '2027-03-31',
		reason: 'Agreed'
	} as const;
	assert.equal(leaveTermsThrough(carry, [], null), '2026-12-31');
	const adjustment = {
		from_date: annualWindow.start,
		to_date: annualWindow.end,
		days: 1,
		effective_on: '2026-02-01',
		reason: 'Credit'
	} as const;
	assert.equal(leaveTermsThrough(adjustment, [], null), null);
	assert.equal(leaveTermsThrough({ ...adjustment, days: -1 }, [], null), '2026-02-01');
	assert.equal(
		leaveTermsThrough(
			{
				as_adjustment_entry: true,
				reversal_of_id: id(80),
				effective_on: '2026-09-01',
				reason: 'Correction',
				days: null,
				due_on: null
			},
			[],
			null
		),
		null
	);
});

test('a Work day carries no holiday: moving it, editing it and deleting it touch no calendar', () => {
	const date = '2026-02-05';
	// No `jurisdiction_holidays` here: a transform that still read or wrote the calendar would throw.
	const workDb = workDayDb({ employees: [id(1)] });
	const existing = {
		id: id(10),
		employment_id: id(1),
		work_date: '2026-01-05',
		shift_definition_id: null,
		worked_intervals: null,
		approval_id: null
	};
	const write = (input: Record<string, unknown>) => transformOne(workDays, input, existing, workDb);
	// The write passes through as the row it was given, the day in its stored form: the holiday on
	// a date is the calendar's to say when the day is read, never a column the transform stamps.
	assert.deepEqual(write({ work_date: date }), { work_date: `${date}T00:00:00.000Z` });
	assert.deepEqual(write({ worked_intervals: [] }), { worked_intervals: [] });
});

test('payroll writes the consumed terms date on the payslip; previews leave source data unchanged', async () => {
	const world = createPublicPayrollWorld();
	const original = structuredClone(world.employment_terms);
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	assert.deepEqual(world.employment_terms, original);
	const [payslip] = buildPayrollRun(prepared).payslip_payroll_run;
	assert.ok(payslip);
	assert.equal(dateKey(payslip.terms_through), '2026-01-31');
	// The run creates calculated outputs; direct edits are limited to payment and funding evidence.
	assert.equal(payslips.create, undefined);
	assert.deepEqual(Object.keys(payslips.update.input.columns), [
		'status',
		'paid_at',
		'funding_received',
		'funding_received_on',
		'funding_reference'
	]);
	assert.throws(() => transformOne(payslips, { status: 'ON_HOLD' }, undefined, {}), /payroll run/);
});
