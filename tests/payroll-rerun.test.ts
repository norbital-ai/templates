// @ts-nocheck -- fixture tables execute directly through the collection transform.
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import workDays from '../src/data/collection/work_days/+collection.ts';
import {
	createStatutoryWorld,
	COMPANY_ID,
	settingsIdOn,
	leaveCatalogue
} from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';
import { storeRun } from './helpers/settlement.ts';
const world = (code = 'MY') =>
	createStatutoryWorld({
		code,
		period: '2026-03',
		people: [
			{ key: 'A', wage: 1800 },
			{ key: 'B', wage: 1800 }
		],
		...(code === 'MY'
			? { companyFacts: { hrd_registration_class: 'OPTIONAL', hrd_form2_count: 5 } }
			: {})
	});
async function create(tables) {
	const [payload] = await runTransform(
		payrollRuns,
		[{ company_id: COMPANY_ID, period: '2026-03' }],
		{ tables }
	);
	return storeRun(tables, payload);
}
async function records(tables) {
	const employment = tables.employments[1].id;
	tables.leave_catalogue = leaveCatalogue('MY');
	const catalogue = tables.leave_catalogue.find(
		(row) => row.settings_id === settingsIdOn('MY', '2026-03-16') && row.is_npl
	);
	const [leave] = await runTransform(
		leaveEntries,
		[
			{
				employment_id: employment,
				catalogue_id: catalogue.id,
				reference: 'SYNTHETIC-RERUN-NPL',
				from_date: '2026-03-16',
				to_date: '2026-03-16',
				half_day_start: false,
				half_day_end: false,
				no_pay_origin: 'EMPLOYEE_REQUESTED',
				reason: 'Recorded before recalculation'
			}
		],
		{ tables }
	);
	tables.leave_entries.push({ id: 'new-leave', approval_id: null, payslip_id: null, ...leave });
	const [day] = await runTransform(
		workDays,
		[
			{
				employment_id: employment,
				work_date: '2026-03-20',
				worked_intervals: [
					{ start: '2026-03-20T01:00:00.000Z', end: '2026-03-20T05:00:00.000Z' },
					{ start: '2026-03-20T06:00:00.000Z', end: '2026-03-20T12:00:00.000Z' }
				],
				approved_overtime_hours: 2
			}
		],
		{ tables }
	);
	tables.work_days.push({ id: 'new-work', approval_id: null, payslip_id: null, ...day });
	const claim = tables.claim_catalogue.find(
		(row) => row.settings_id === settingsIdOn('MY', '2026-03-20') && row.code === 'MEDICAL_CLAIM'
	);
	tables.claim_requests.push({
		id: 'new-claim',
		employment_id: employment,
		catalogue_id: claim.id,
		amount: 100,
		incurred_on: '2026-03-20',
		pay_period: '2026-03',
		payslip_id: null,
		approval_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		reason: 'Synthetic medical reimbursement'
	});
}
function paidClaim(tables) {
	const catalogue = tables.claim_catalogue.find(
		(row) => row.settings_id === settingsIdOn('MY', '2026-03-10') && row.code === 'MEDICAL_CLAIM'
	);
	tables.claim_requests.push({
		id: 'paid-claim',
		employment_id: tables.employments[0].id,
		catalogue_id: catalogue.id,
		amount: 50,
		incurred_on: '2026-03-10',
		pay_period: '2026-03',
		payslip_id: null,
		approval_id: null,
		evidence_file: null,
		as_adjustment_entry: false,
		reason: 'Synthetic original paid reimbursement'
	});
}
const economic = ({ id, payroll_run_id, approval_id, ...row }) => row;
function apply(tables, run, payload) {
	for (const { target, set } of payload.payslips.update) {
		const slip = tables.payslips.find((row) => row.id === target);
		const values = { ...set };
		for (const family of [
			'work_days',
			'claim_requests',
			'adhoc_requests',
			'leave_entries',
			'loan_repayments'
		]) {
			for (const id of values[family]?.unlink ?? [])
				tables[family].find((row) => row.id === id).payslip_id = null;
			for (const id of values[family]?.link ?? [])
				tables[family].find((row) => row.id === id).payslip_id = target;
			delete values[family];
		}
		for (const family of ['payslip_wage_periods', 'payable_tranches', 'payslip_explanations'])
			delete values[family];
		Object.assign(slip, values);
	}
	const { payslips, ...values } = payload;
	Object.assign(run, values);
}
test('payroll rerun: paid bytes and pins preserved; unpaid identity recaptures attendance NPL and claims without duplicate salary', async () => {
	const tables = world();
	tables.leave_catalogue = leaveCatalogue('MY');
	paidClaim(tables);
	const run = await create(tables);
	const paid = tables.payslips[0];
	paid.status = 'PAID';
	paid.paid_at = '2026-03-31T00:00:00.000Z';
	const frozen = structuredClone(paid);
	const frozenClaim = structuredClone(tables.claim_requests.find((row) => row.id === 'paid-claim'));
	assert.equal(frozenClaim.payslip_id, paid.id);
	const unpaidId = tables.payslips[1].id;
	await records(tables);
	const fresh = world();
	paidClaim(fresh);
	await records(fresh);
	await create(fresh);
	const [payload] = await runTransform(payrollRuns, [{}], { tables, existing: [run] });
	assert.equal(payload.payslips.create.length, 0);
	assert.equal(payload.payslips.update.length, 1);
	assert.equal(payload.payslips.update[0].target, unpaidId);
	apply(tables, run, payload);
	assert.deepEqual(paid, frozen);
	assert.deepEqual(
		tables.claim_requests.find((row) => row.id === 'paid-claim'),
		frozenClaim
	);
	assert.equal(tables.payslips.length, 2);
	assert.deepEqual(economic(tables.payslips[1]), economic(fresh.payslips[1]));
	assert.deepEqual(run.company_charges, fresh.payroll_runs[0].company_charges);
	for (const [family, id] of [
		['work_days', 'new-work'],
		['leave_entries', 'new-leave'],
		['claim_requests', 'new-claim']
	])
		assert.equal(tables[family].find((row) => row.id === id).payslip_id, unpaidId);
	const saved = structuredClone(tables.payslips[1]);
	const [again] = await runTransform(payrollRuns, [{}], { tables, existing: [run] });
	apply(tables, run, again);
	assert.deepEqual(tables.payslips[1], saved);
	assert.deepEqual(paid, frozen);
});
test('payroll rerun: all-paid funded and later-dependent runs refuse', async () => {
	for (const scenario of ['paid', 'funded', 'later']) {
		const tables = world();
		const run = await create(tables);
		if (scenario === 'paid') for (const slip of tables.payslips) slip.status = 'PAID';
		if (scenario === 'funded') tables.payslips[0].funding_received = 1;
		if (scenario === 'later') tables.payroll_runs.push({ ...run, id: 'later', period: '2026-04' });
		await assert.rejects(
			runTransform(payrollRuns, [{}], { tables, existing: [run] }),
			scenario === 'paid' ? /no unpaid/ : scenario === 'funded' ? /funded/ : /newest first/
		);
	}
});
test('payroll rerun: mixed paid SDL employer-month remittance matches a fresh run', async () => {
	const tables = world('SG');
	const run = await create(tables);
	tables.payslips[0].status = 'PAID';
	tables.payslips[0].paid_at = '2026-03-31T00:00:00.000Z';
	const fresh = world('SG');
	await create(fresh);
	const [payload] = await runTransform(payrollRuns, [{}], { tables, existing: [run] });
	assert.deepEqual(payload.company_remittances, fresh.payroll_runs[0].company_remittances);
});

test('payroll rerun: partial cash allocation refuses and unallocated materialised children are replaced', async () => {
	const tables = world('SG');
	const run = await create(tables);
	const id = tables.payslips[0].id;
	tables.payable_tranches = [{ id: 'tranche', settlement: { collection: 'payslips', id } }];
	tables.payment_allocations = [{ id: 'allocation', payable_tranche_id: 'tranche' }];
	await assert.rejects(
		runTransform(payrollRuns, [{}], { tables, existing: [run] }),
		/actual payment allocation/
	);
	tables.payment_allocations = [];
	tables.payslip_wage_periods = [{ id: 'wage-child', payslip_id: id, wage_period_id: 'wage' }];
	tables.payslip_explanations = [{ id: 'explanation', payslip_id: id }];
	const [payload] = await runTransform(payrollRuns, [{}], { tables, existing: [run] });
	const patch = payload.payslips.update.find((row) => row.target === id).set;
	assert.deepEqual(patch.payable_tranches.delete, ['tranche']);
	assert.deepEqual(patch.payslip_wage_periods.delete, ['wage-child']);
	assert.deepEqual(patch.payslip_explanations.delete, ['explanation']);
});

test('payroll rerun: zero funding with receipt evidence remains frozen like imported captures', async () => {
	for (const evidence of [
		{ funding_received_on: '2026-03-20' },
		{ funding_reference: 'SYNTHETIC-RECEIPT' }
	]) {
		const tables = world('SG');
		const run = await create(tables);
		Object.assign(tables.payslips[0], { funding_received: 0, ...evidence });
		const before = structuredClone(tables);
		await assert.rejects(
			runTransform(payrollRuns, [{}], { tables, existing: [run] }),
			/funded payslip/
		);
		assert.deepEqual(tables, before);
	}
});
