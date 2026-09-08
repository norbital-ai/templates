import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import termsHooks from '../src/collections/employment_terms/+hooks.ts';
import workHooks from '../src/collections/work_days/+hooks.ts';
import payslipHooks from '../src/collections/payslips/+hooks.ts';
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
	leaveEntryHooks,
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
	leave: readonly { event: unknown; charges: unknown }[] = [],
	payslipThrough: string | null = null
) => ({
	db: {
		employments: { findFirst: () => Effect.succeed({ exit_date: null }) },
		work_days: {
			findFirst: () => Effect.succeed(workThrough == null ? undefined : { work_date: workThrough }),
			findPending: () => Effect.succeed(pendingWork == null ? [] : [{ work_date: pendingWork }])
		},
		leave_entries: {
			findMany: () => Effect.succeed(leave),
			findPending: () => Effect.succeed([])
		},
		payslips: {
			findFirst: () =>
				Effect.succeed(payslipThrough == null ? undefined : { terms_through: payslipThrough })
		}
	}
});
const change = (input: Record<string, unknown>, through: string | null, existing = term()) =>
	Effect.runSync(
		termsHooks.mutate.perRecord.before.handler({ input, existing, api: api(through) } as never)
	);
const create = (input: Record<string, unknown>, through: string | null) =>
	Effect.runSync(termsHooks.mutate.perRecord.before.handler({ input, api: api(through) } as never));

test('January approved leave protects January facts while a July salary/residency amendment remains possible', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement.proration = 'CALENDAR_DAYS';
	context.catalogues[0]!.eligibility = 'terms.basic_salary < 5000';
	const input = submission(timeOff('2026-01-05'));
	const approved = leaveEntryHooks.mutate.perRecord.before.handler({
		input,
		recordId: id(80),
		prepared: { context, inputs: [input] }
	} as never);
	const through = leaveTermsThrough(approved.event, approved.charges, null)!;
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
	const approved = leaveEntryHooks.mutate.perRecord.before.handler({
		input,
		recordId: id(82),
		prepared: { context, inputs: [input] }
	} as never);
	const consumed = api(null, null, [{ event: approved.event, charges: approved.charges }]);
	assert.equal(leaveTermsThrough(approved.event, approved.charges, null), '2026-07-07');
	const amend = (end: string) =>
		Effect.runSync(
			termsHooks.mutate.perRecord.before.handler({
				input: { effective_range: { start: '2025-01-01', end } },
				existing: term(),
				api: consumed
			} as never)
		);
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
	assert.throws(
		() =>
			Effect.runSync(
				termsHooks.delete.perRecord.before.handler({
					existing: term(),
					api: api('2026-01-31')
				} as never)
			),
		/cannot be deleted/
	);
	const closed = { ...term(), effective_range: { start: '2025-01-01', end: '2026-06-30' } };
	assert.throws(
		() => change({ effective_range: { start: '2025-01-01', end: null } }, '2026-01-31', closed),
		/only close/
	);
	assert.doesNotThrow(() => change({}, '2026-01-31', closed));
});

test('unconsumed drafts and future terms remain correctable; nested creation keeps its enclosing contract', () => {
	assert.doesNotThrow(() => change({ base_salary: { value: 4000, currency: 'MYR' } }, null));
	const future = { ...term(), effective_range: { start: '2026-07-01', end: null } };
	assert.doesNotThrow(() => change({ residency_status: 'CITIZEN' }, '2026-01-31', future));
	assert.doesNotThrow(() =>
		Effect.runSync(
			termsHooks.delete.perRecord.before.handler({
				existing: future,
				api: api('2026-01-31')
			} as never)
		)
	);
	const { employment_id: _employment, ...input } = term();
	const parent = { collection: 'employments', id: id(1), column: 'employment_id', values: {} };
	const result = Effect.runSync(
		termsHooks.mutate.perRecord.before.handler({ input, parent, api: api() } as never)
	);
	assert.equal(result.employment_id, id(1));
	assert.throws(
		() =>
			Effect.runSync(
				termsHooks.mutate.perRecord.before.handler({
					input: { ...input, employment_id: id(9) },
					parent,
					api: api()
				} as never)
			),
		/enclosing employment/
	);
});

test('pending consumer dates prevent conflicting amendments until their approval resolves', () => {
	const input = { effective_range: { start: '2025-01-01', end: '2026-06-30' } };
	assert.throws(
		() =>
			Effect.runSync(
				termsHooks.mutate.perRecord.before.handler({
					input,
					existing: term(),
					api: api('2026-01-31', '2026-07-07')
				} as never)
			),
		/consumed dates/
	);
	assert.doesNotThrow(() => change(input, '2026-01-31'));
});

test('a committed payslip consumes its terms through the settlement date', () => {
	assert.throws(
		() =>
			Effect.runSync(
				termsHooks.mutate.perRecord.before.handler({
					input: { base_salary: { value: 4000, currency: 'MYR' } },
					existing: term(),
					api: api(null, null, [], '2026-01-31')
				} as never)
			),
		/consumed/
	);
});

test('manual encashment and carry consume their actual source valuation, while credits and reversals do not advance it', () => {
	const encashment = {
		kind: 'ENCASHMENT',
		source_window: annualWindow,
		days: 1,
		gross_amount: { value: 100, currency: 'MYR' },
		rate: null,
		effective_on: '2027-02-01',
		due_on: '2027-02-28',
		reason: 'Agreed'
	} as const;
	assert.equal(leaveTermsThrough(encashment, [], '2026-10-31'), '2026-10-31');
	const carry = {
		kind: 'CARRY_FORWARD',
		source_window: annualWindow,
		destination_window: { start: '2027-01-01', end: '2027-12-31' },
		days: 1,
		effective_on: '2027-01-01',
		available_from: '2027-01-01',
		expires_on: '2027-03-31',
		reason: 'Agreed'
	} as const;
	assert.equal(leaveTermsThrough(carry, [], null), '2026-12-31');
	const adjustment = {
		kind: 'ADJUSTMENT',
		window: annualWindow,
		days: 1,
		effective_on: '2026-02-01',
		reason: 'Credit'
	} as const;
	assert.equal(leaveTermsThrough(adjustment, [], null), null);
	assert.equal(leaveTermsThrough({ ...adjustment, days: -1 }, [], null), '2026-02-01');
	assert.equal(
		leaveTermsThrough(
			{
				kind: 'REVERSAL',
				entry_id: id(80),
				effective_on: '2026-09-01',
				reason: 'Correction',
				days: 1,
				due_on: null,
				gross_amount: null
			},
			[],
			null
		),
		null
	);
});

test('a moved Work day is classified afresh; a Work day that stands keeps its pinned revision', () => {
	const date = '2026-02-05';
	const prepared = {
		holidayByDay: new Map([
			[`${id(1)}:${date}`, { jurisdiction_code: 'TEST', date, calendar_id: id(20) }],
			[
				`${id(1)}:2026-01-05`,
				{ jurisdiction_code: 'TEST', date: '2026-01-05', calendar_id: id(21) }
			]
		]),
		companyByEmployment: new Map(),
		windowsByCompany: new Map(),
		leaveByEmployment: new Map(),
		overlap: {
			termsByEmployment: new Map(),
			patternById: new Map(),
			explicitByKey: new Map(),
			codeById: new Map()
		}
	};
	const workApi = {
		db: {
			payslip_work_day_inputs: { findFirst: () => Effect.succeed(null) },
			employments: { findFirst: () => Effect.succeed({ company_id: id(3) }) },
			payroll_runs: { findMany: () => Effect.succeed([]) },
			leave_entries: { findMany: () => Effect.succeed([]) }
		}
	};
	const existing = {
		id: id(10),
		employment_id: id(1),
		work_date: '2026-01-05',
		shift_definition_id: null,
		worked_intervals: null,
		break_minutes: 0,
		holiday_calendar_id: id(19),
		approval_id: null
	};
	const write = (input: Record<string, unknown>) =>
		Effect.runSync(
			workHooks.mutate.perRecord.before.handler({
				input,
				existing,
				prepared,
				api: workApi
			} as never)
		);
	assert.equal(write({ work_date: date }).holiday_calendar_id, id(20));
	assert.equal(write({ break_minutes: 15 }).holiday_calendar_id, id(19));
	assert.doesNotThrow(() =>
		Effect.runSync(workHooks.delete.perRecord.before.handler({ existing, api: workApi } as never))
	);
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
	const parent = { collection: 'payroll_runs', id: id(40), column: 'payroll_run_id', values: {} };
	assert.doesNotThrow(() =>
		payslipHooks.mutate.perRecord.before.handler({ input: payslip, parent } as never)
	);
	assert.throws(
		() => payslipHooks.mutate.perRecord.before.handler({ input: payslip } as never),
		/payroll run/
	);
});
