import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import termsHooks from '../src/collections/employment_terms/+hooks.ts';
import sealHooks from '../src/collections/employment_contract_inputs/+hooks.ts';
import workHooks from '../src/collections/work_days/+hooks.ts';
import payslipHooks from '../src/collections/payslips/+hooks.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import { leaveTermsThrough } from '../src/lib/leave/activity.ts';
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

type Seal = { id: string; employment_id: string; terms_through: string | null };
const term = () => ({ ...leaveContext().terms[0]!, pay_frequency: 'MONTHLY', job_title: null });
const seal = (through: string | null): Seal => ({
	id: id(100),
	employment_id: id(1),
	terms_through: through
});
const api = (stored: readonly Seal[] = [], pending: readonly Seal[] = []) => ({
	db: {
		employment_contract_inputs: {
			findFirst: () =>
				Effect.succeed(
					stored.toSorted((a, b) => (b.terms_through ?? '').localeCompare(a.terms_through ?? ''))[0]
				),
			findPending: () => Effect.succeed(pending)
		}
	}
});
const change = (input: Record<string, unknown>, through: string | null, existing = term()) =>
	Effect.runSync(
		termsHooks.mutate.perRecord.before.handler({
			input,
			existing,
			api: api([seal(through)])
		} as never)
	);
const create = (input: Record<string, unknown>, through: string | null) =>
	Effect.runSync(
		termsHooks.mutate.perRecord.before.handler({ input, api: api([seal(through)]) } as never)
	);

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
	assert.equal(approved.employment_contract_input?.[0]?.terms_through, '2026-01-05');
	const original = structuredClone(approved);
	const through = approved.employment_contract_input![0]!.terms_through!;
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
	const through = approved.employment_contract_input![0]!.terms_through!;
	assert.equal(through, '2026-07-07');
	assert.throws(
		() => change({ effective_range: { start: '2025-01-01', end: '2026-06-30' } }, through),
		/consumed dates must remain covered/
	);
	assert.doesNotThrow(() =>
		change({ effective_range: { start: '2025-01-01', end: '2026-07-07' } }, through)
	);
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
					api: api([seal('2026-01-31')])
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
				api: api([seal('2026-01-31')])
			} as never)
		)
	);
	const { employment_id: _employment, ...input } = term();
	const parent = { collection: 'employments', id: id(1), column: 'employment_id', values: {} };
	const result = Effect.runSync(
		termsHooks.mutate.perRecord.before.handler({ input, parent, api: api() } as never)
	);
	assert.equal(result.employment_id, id(1));
	assert.deepEqual(result.employment_contract_input, [{ employment_id: id(1) }]);
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
					api: api([seal('2026-01-31')], [seal('2026-07-07')])
				} as never)
			),
		/consumed dates/
	);
	assert.doesNotThrow(() => change(input, '2026-01-31'));
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

test('Work preserves earlier seals when its date moves; deleting the workday cannot unseal terms', () => {
	const old = { ...seal('2026-01-05'), work_days_id: id(10) };
	const date = '2026-02-05';
	const prepared = {
		holidayByDay: new Map([
			[`${id(1)}:${date}`, { jurisdiction_code: 'TEST', date, calendar_id: id(20) }]
		]),
		holidayHistory: new Map(),
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
			employment_contract_inputs: { findMany: () => Effect.succeed([old]) },
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
		approval_id: null
	};
	const moved = Effect.runSync(
		workHooks.mutate.perRecord.before.handler({
			input: { work_date: date },
			existing,
			prepared,
			api: workApi
		} as never)
	);
	assert.deepEqual(moved.employment_contract_input, [
		old,
		{ employment_id: id(1), terms_through: date }
	]);
	assert.doesNotThrow(() =>
		Effect.runSync(workHooks.delete.perRecord.before.handler({ existing, api: workApi } as never))
	);
	assert.throws(
		() => change({ base_salary: { value: 4000, currency: 'MYR' } }, old.terms_through),
		/consumed/
	);
	assert.throws(() => sealHooks.delete.perRecord.before.handler(), /cannot be deleted/);
});

test('new consumed seals guard term reads and cannot substitute a different Work date or contract', () => {
	const reads: string[] = [];
	const sourceApi = {
		db: {
			employments: {
				findFirst: () => {
					reads.push('contract');
					return Effect.succeed({
						effective_range: { start: '2025-01-01', end: null },
						employment_departure: []
					});
				}
			},
			employment_terms: {
				findMany: () => {
					reads.push('terms');
					return Effect.succeed([term()]);
				}
			}
		}
	};
	const parent = {
		collection: 'work_days',
		id: id(10),
		column: 'work_days_id',
		values: { employment_id: id(1), work_date: '2026-01-05' }
	};
	const input = { employment_id: id(1), terms_through: '2026-01-05' };
	Effect.runSync(
		sealHooks.mutate.perRecord.before.handler({ input, parent, api: sourceApi } as never)
	);
	assert.deepEqual(reads, ['contract', 'terms']);
	assert.throws(
		() =>
			Effect.runSync(
				sealHooks.mutate.perRecord.before.handler({
					input: { ...input, terms_through: '2026-12-31' },
					parent,
					api: sourceApi
				} as never)
			),
		/actual work date/
	);
	assert.throws(
		() =>
			Effect.runSync(
				sealHooks.mutate.perRecord.before.handler({
					input: { ...input, employment_id: id(9) },
					parent,
					api: sourceApi
				} as never)
			),
		/consumer’s employment/
	);
	assert.throws(
		() =>
			Effect.runSync(
				sealHooks.mutate.perRecord.before.handler({
					input: { terms_through: '2026-01-01' },
					existing: seal('2026-01-05'),
					api: sourceApi
				} as never)
			),
		/cannot be changed/
	);
});

test('payroll creates its permanent terms seal with the graph; previews leave source data unchanged', async () => {
	const world = createPublicPayrollWorld();
	const original = structuredClone(world.employment_terms);
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	assert.deepEqual(world.employment_terms, original);
	const [payslip] = buildPayrollRun(prepared).payslip_payroll_run;
	assert.ok(payslip);
	assert.equal(dateKey(payslip.employment_contract_input[0]!.terms_through), '2026-01-31');
	assert.equal(payslip.employment_contract_input[0]!.employment_id, payslip.employment_id);
	const parent = { collection: 'payroll_runs', id: id(40), column: 'payroll_run_id', values: {} };
	assert.doesNotThrow(() =>
		payslipHooks.mutate.perRecord.before.handler({
			input: payslip,
			parent,
			relationshipSizes: { employment_contract_input: 1 }
		} as never)
	);
	assert.throws(
		() =>
			payslipHooks.mutate.perRecord.before.handler({
				input: payslip,
				parent,
				relationshipSizes: {}
			} as never),
		/permanent employment input seal/
	);
});
