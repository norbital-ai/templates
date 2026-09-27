// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import terms from '../src/data/collection/employment_terms/+collection.ts';
import { transform } from './helpers/bodies.ts';
import { leaveRules } from '../src/lib/leave/context.ts';
import { leaveTermsThrough } from '../src/lib/employment-contract.ts';
import { dateKey } from '../src/lib/iso-day.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { COMPANY_ID, createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import {
	annualWindow,
	id,
	leaveContext,
	planLeaveBatch,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';

const term = () => ({
	...leaveContext().terms[0]!,
	pay_frequency: 'MONTHLY',
	job_title: null,
	effective_range: { from: '2025-01-01', to: null }
});
/**
 * The consumers a term read sees: the latest stored Work date, a held Work proposal, stored and held Leave, the latest
 * payslip. There is no seal log; these rows are the evidence.
 */
const tables = (
	workThrough: string | null = null,
	pendingWork: string | null = null,
	leave: readonly { charges: unknown }[] = [],
	payslipThrough: string | null = null
) => ({
	employments: [{ id: id(1), effective_range: { from: '2025-01-01', to: null } }],
	work_days: [
		...(workThrough == null ? [] : [{ work_date: workThrough }]),
		// A held proposal is a committed row stamped `approval_id`; its date protects too.
		...(pendingWork == null ? [] : [{ work_date: pendingWork, approval_id: id(200) }])
	].map((row) => ({ employment_id: id(1), ...row })),
	leave_entries: leave.map((row) => ({ employment_id: id(1), ...row })),
	payslips: payslipThrough == null ? [] : [{ employment_id: id(1), terms_through: payslipThrough }]
});
const one = async (input, existing, world) =>
	(await transform(terms, [input], { existing: [existing], tables: world }))[0];
const change = (input: Record<string, unknown>, through: string | null, existing = term()) =>
	one(input, existing, tables(through));
const create = (input: Record<string, unknown>, through: string | null) =>
	one(input, undefined, tables(through));
/** Whether the delete guard admits deleting a stored row. */
const deletable = (existing: Record<string, unknown>, through: string | null) =>
	one({ $delete: true }, existing, tables(through)).then(
		() => true,
		() => false
	);

test('January approved leave protects January facts while a July salary/residency amendment remains possible', async () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement.proration = 'CALENDAR_DAYS';
	context.catalogues[0]!.eligibility = 'terms.basic_salary < 5000';
	const input = submission(timeOff('2026-01-05'));
	const approved = planLeaveBatch(context, [input])[0]!;
	const through = leaveTermsThrough(approved, approved.charges, null)!;
	assert.equal(through, '2026-01-05');
	const original = structuredClone(approved);
	const closed = await change(
		{ effective_range: { from: '2025-01-01', to: '2026-06-30' } },
		through
	);
	const successor = await create(
		{
			...term(),
			id: id(81),
			base_salary: '6000.00',
			residency_status: 'FOREIGNER',
			effective_range: { from: '2026-07-01', to: null }
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
		{ base_salary: '4000.00' },
		{ residency_status: 'CITIZEN' },
		{ effective_range: { from: '2026-01-02', to: null } }
	])
		await assert.rejects(change(values, through), /consumed/);
});

test('approved future time off consumes its actual dates, and shortening a term cannot uncover them', async () => {
	const context = leaveContext();
	const input = submission(timeOff('2026-07-06', '2026-07-07'));
	const approved = planLeaveBatch(context, [input])[0]!;
	const consumed = tables(null, null, [approved]);
	assert.equal(leaveTermsThrough(approved, approved.charges, null), '2026-07-07');
	const amend = (to: string) =>
		one({ effective_range: { from: '2025-01-01', to } }, term(), consumed);
	await assert.rejects(amend('2026-06-30'), /consumed dates must remain covered/);
	await amend('2026-07-07');
});

test('historical gaps cannot acquire new terms, consumed rows cannot be deleted or reopened', async () => {
	const { id: _id, ...gap } = {
		...term(),
		effective_range: { from: '2025-06-01', to: '2025-12-31' }
	};
	await assert.rejects(create(gap, '2026-01-31'), /historical gaps/);
	assert.equal(await deletable(term(), '2026-01-31'), false, 'consumed terms are not deleted');
	const closed = { ...term(), effective_range: { from: '2025-01-01', to: '2026-06-30' } };
	await assert.rejects(
		change({ effective_range: { from: '2025-01-01', to: null } }, '2026-01-31', closed),
		/only close/
	);
	await change({}, '2026-01-31', closed);
});

test('unconsumed drafts and future terms remain correctable, and terms always name their contract', async () => {
	await change({ base_salary: '4000.00' }, null);
	const future = { ...term(), effective_range: { from: '2026-07-01', to: null } };
	await change({ residency_status: 'CITIZEN' }, '2026-01-31', future);
	assert.equal(await deletable(future, '2026-01-31'), true, 'unconsumed future terms may go');
	const { employment_id: _employment, id: _id, ...input } = term();
	await assert.rejects(create(input, null), /must reference an employment contract/);
	assert.equal((await create({ ...input, employment_id: id(1) }, null)).employment_id, id(1));
});

test('pending consumer dates prevent conflicting amendments until their approval resolves', async () => {
	const input = { effective_range: { from: '2025-01-01', to: '2026-06-30' } };
	await assert.rejects(one(input, term(), tables('2026-01-31', '2026-07-07')), /consumed dates/);
	await change(input, '2026-01-31');
});

test('a committed payslip consumes its terms through the settlement date', async () => {
	await assert.rejects(
		one({ base_salary: '4000.00' }, term(), tables(null, null, [], '2026-01-31')),
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

test('payroll writes the consumed terms date on the payslip; previews leave source data unchanged', async () => {
	const world = createPublicPayrollWorld();
	const original = structuredClone(world.employment_terms);
	const prepared = gatherPayrollRun({
		world: payrollWorld(world),
		companyId: COMPANY_ID,
		period: '2026-01'
	});
	assert.deepEqual(world.employment_terms, original);
	const [payslip] = buildPayrollRun(prepared).payslip_payroll_run;
	assert.ok(payslip);
	assert.equal(dateKey(payslip.terms_through), '2026-01-31');
	// That the run alone creates payslips, and what a slip's edit may touch: `payslip-payment.test.ts`.
});
