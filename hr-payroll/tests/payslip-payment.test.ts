// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Payment is a fact of the payslip, not of the run: `status` (DRAFT ↔ ON_HOLD → PAID, PAID terminal) and
 * `paid_at` are its doors, validated with the funding receipt, the open disbursement holds and the person's own
 * payment order. Deleting a slip keeps the later slips of the same person standing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import payslips from '../src/data/collection/payslips/+collection.ts';
import holds from '../src/data/collection/payment_holds/+collection.ts';
import payslipModel from '../src/data/model/payslips/+model.ts';
import { memoryDb, runDelete, runTransform } from './helpers/ctx.ts';
import { settingsVersions } from './fixtures/statutory-world.ts';

const JAN = { id: 'run-jan', company_id: 'co-1', period: '2026-01' };
const FEB = { id: 'run-feb', company_id: 'co-1', period: '2026-02' };
const slip = (id, run, employment, extra = {}) => ({
	id,
	payroll_run_id: run.id,
	employment_id: employment,
	status: 'DRAFT',
	paid_at: null,
	currency: 'MYR',
	unfunded_contributions: 0,
	funding_received: 0,
	...extra
});
const write = (tables, stored, input) =>
	runTransform(payslips, [input], { tables, existing: [stored] });
const pay = (tables, stored, paid_at = '2026-02-28T00:00:00.000Z') =>
	write(tables, stored, { status: 'PAID', paid_at });

test('the state is the lock: PAID is terminal and edits nothing; a held slip returns to draft', () => {
	const { states } = payslipModel.fields.status;
	assert.deepEqual(states.DRAFT.to, ['ON_HOLD', 'PAID']);
	assert.deepEqual(states.ON_HOLD.to, ['DRAFT', 'PAID']);
	assert.equal(states.PAID.to, undefined);
	assert.equal(states.PAID.edit, 'none');
	assert.equal(payslips.spec.create, undefined, 'a slip is born under its run');
});

test('a person’s own earlier period is paid first; a colleague’s is not their problem', async () => {
	const tables = {
		payroll_runs: [JAN, FEB],
		payslips: [
			slip('jan-a', JAN, 'emp-a'),
			slip('jan-b', JAN, 'emp-b', { status: 'PAID' }),
			slip('feb-a', FEB, 'emp-a'),
			slip('feb-b', FEB, 'emp-b')
		]
	};
	await assert.rejects(pay(tables, tables.payslips[2]), /2026-01 pay is still unpaid/);
	await pay(tables, tables.payslips[3]);
});

test('paid_at travels only with PAID, and PAID needs it', async () => {
	const tables = { payroll_runs: [FEB], payslips: [slip('a', FEB, 'emp-a')] };
	await assert.rejects(pay(tables, tables.payslips[0], null), /needs the day it was paid/);
	await assert.rejects(
		write(tables, tables.payslips[0], { status: 'ON_HOLD', paid_at: '2026-02-28' }),
		/only when it is paid/
	);
	await write(tables, tables.payslips[0], { status: 'ON_HOLD' });
});

test('an open disbursement hold stops a payslip being marked paid', async () => {
	const tables = {
		payroll_runs: [FEB],
		payslips: [slip('a', FEB, 'emp-a')],
		payment_holds: [
			{ employment_id: 'emp-a', directive_reference: 'IR21-2026-1', released_on: null }
		]
	};
	await assert.rejects(pay(tables, tables.payslips[0]), /Disbursement hold IR21-2026-1 is open/);
	tables.payment_holds[0].released_on = '2026-02-20';
	await pay(tables, tables.payslips[0]);
});

test('SG IR21: a foreign leaver cannot be marked paid before an asynchronous clearance hold exists', async () => {
	const draft = slip('sg-final', FEB, 'emp-sg', { currency: 'SGD' });
	const tables = {
		payroll_runs: [FEB],
		payslips: [draft],
		companies: [{ id: 'co-1', settings_code: 'SG' }],
		employees: [{ id: 'person-sg' }],
		employments: [
			{
				id: 'emp-sg',
				company_id: 'co-1',
				employee_id: 'person-sg',
				effective_range: { start: '2025-01-01', end: '2026-01-31' },
				exit_reason: 'RESIGNATION',
				exit_facts: { notice_served: true, clearance_awareness_on: '2026-01-01' }
			}
		],
		employment_terms: [
			{
				id: 'terms-sg',
				employment_id: 'emp-sg',
				effective_range: { start: '2025-01-01', end: null },
				residency_status: 'FOREIGNER'
			}
		],
		jurisdiction_settings: settingsVersions('SG'),
		payment_holds: []
	};
	await assert.rejects(pay(tables, draft), /tax clearance.*released hold/i);
	tables.payment_holds.push({
		employment_id: 'emp-sg',
		category: 'TAX_CLEARANCE',
		directive_reference: 'IR21 pending',
		released_on: '2026-02-20'
	});
	await assert.rejects(pay(tables, draft, '2026-02-19'), /Disbursement hold IR21 pending is open/);
	await pay(tables, draft);
	tables.payment_holds.length = 0;
	tables.employments[0].exit_facts.clearance_awareness_on = '2026-03-01';
	await pay(tables, draft);
	delete tables.employments[0].exit_facts.clearance_awareness_on;
	await assert.rejects(pay(tables, draft), /awareness date is required/);
	tables.employment_terms[0].residency_status = 'CITIZEN';
	await pay(tables, draft);
	tables.employment_terms[0].residency_status = 'PERMANENT_RESIDENT';
	await assert.rejects(pay(tables, draft), /Leaving Singapore permanently is required/);
	tables.employments[0].exit_facts.leaving_singapore = false;
	await pay(tables, draft);
	tables.employments[0].exit_facts.leaving_singapore = true;
	await assert.rejects(pay(tables, draft), /awareness date is required/);
});

test('a contribution shortfall needs dated funding evidence, in currency precision, before payment', async () => {
	const draft = slip('f', FEB, 'emp-a', { unfunded_contributions: 150 });
	const tables = { payroll_runs: [FEB], payslips: [draft] };
	await assert.rejects(pay(tables, draft), /remain unfunded/);
	for (const funding_received of [-1, 151])
		await assert.rejects(write(tables, draft, { funding_received }), /between zero/);
	await assert.rejects(write(tables, draft, { funding_received: 100.001 }), /currency precision/);
	await assert.rejects(
		write(tables, draft, { funding_received: 150 }),
		/receipt date and reference/
	);
	const funded = {
		...draft,
		funding_received: 150,
		funding_received_on: '2026-02-25',
		funding_reference: 'R-1'
	};
	await assert.rejects(pay(tables, funded, '2026-02-24T00:00:00.000Z'), /cannot precede/);
	await pay(tables, funded);
});

test('an unpaid slip is deleted only while no later slip of the person stands on it', async () => {
	const tables = {
		payroll_runs: [JAN, FEB],
		payslips: [slip('jan-a', JAN, 'emp-a'), slip('feb-a', FEB, 'emp-a')]
	};
	await assert.rejects(
		runDelete(payslips, [tables.payslips[0]], { tables }),
		/2026-02 payslip stands on this one/
	);
	await runDelete(payslips, [tables.payslips[1]], { tables });
	await runDelete(payslips, tables.payslips, { tables });
});

test('a hold release records its directive, never exceeds the amount held, nor precedes the hold', async () => {
	const tables = {
		employments: [{ id: 'e1', company_id: 'c1' }],
		companies: [{ id: 'c1', settings_code: 'MY' }],
		jurisdiction_settings: [
			{
				id: 'v1',
				code: 'MY',
				payroll: { currency: 'MYR' },
				effective_range: { from: '2020-01-01', to: null },
				sealed_at: '2020-01-01T00:00:00.000Z',
				voided_at: null,
				approval_id: null
			}
		]
	};
	const hold = (extra) =>
		runTransform(
			holds,
			[
				{
					employment_id: 'e1',
					directive_reference: 'IR21-2026-1',
					amount: 1000,
					held_on: '2026-01-20',
					...extra
				}
			],
			{ tables }
		);
	const release = { released_on: '2026-02-01', released_amount: 1000 };
	await assert.rejects(hold(release), /directive or filing receipt reference/);
	await assert.rejects(
		hold({ ...release, released_amount: 1500, reconciliation_reference: 'C-1' }),
		/cannot exceed the held amount/
	);
	await assert.rejects(
		hold({ ...release, held_on: '2026-02-02', reconciliation_reference: 'C-1' }),
		/before it was placed/
	);
	await assert.rejects(hold({ amount: 10.001 }), /currency precision/);
	assert.equal((await hold({ ...release, reconciliation_reference: 'C-1' })).length, 1);
});

test('SG December exit accepts an IR21 hold that began with November notice', async () => {
	const tables = {
		employments: [
			{
				id: 'e-sg',
				company_id: 'c-sg',
				effective_range: { start: '2024-01-01', end: '2025-12-15' }
			}
		],
		companies: [{ id: 'c-sg', settings_code: 'SG' }],
		jurisdiction_settings: settingsVersions('SG')
	};
	await runTransform(
		holds,
		[
			{
				employment_id: 'e-sg',
				category: 'TAX_CLEARANCE',
				directive_reference: 'IR21 pending',
				held_on: '2025-11-15',
				amount: 1000
			}
		],
		{ tables }
	);
});

test('SG IR21 hold release requires a dated IRAS directive or 30 days after receipt', async () => {
	const tables = {
		employments: [
			{
				id: 'e-sg',
				company_id: 'c-sg',
				effective_range: { start: '2025-01-01', end: '2026-01-31' }
			}
		],
		companies: [{ id: 'c-sg', settings_code: 'SG' }],
		jurisdiction_settings: settingsVersions('SG')
	};
	const hold = (extra) =>
		runTransform(
			holds,
			[
				{
					employment_id: 'e-sg',
					category: 'TAX_CLEARANCE',
					directive_reference: 'IR21 pending',
					amount: 1000,
					held_on: '2026-01-05',
					released_on: '2026-02-04',
					released_amount: 1000,
					reconciliation_reference: 'IRAS-1',
					...extra
				}
			],
			{ tables }
		);
	await assert.rejects(hold({}), /release basis/);
	await assert.rejects(hold({ category: undefined }), /release basis/);
	await assert.rejects(hold({ release_basis: 'RELEASE_NOTICE' }), /evidence/);
	const notice = { release_basis: 'RELEASE_NOTICE', evidence_file: { path: 'iras-notice.pdf' } };
	await assert.rejects(hold(notice), /directive date/);
	await assert.rejects(
		hold({ ...notice, release_directive_on: '2026-02-05' }),
		/after the release/
	);
	await assert.rejects(
		hold({ ...notice, release_directive_on: '2026-01-31', amended_notice_filed_on: '2026-02-01' }),
		/amended IR21/
	);
	await hold({ ...notice, release_directive_on: '2026-02-01' });
	const payTax = {
		release_basis: 'PAY_TAX_DIRECTIVE',
		evidence_file: { path: 'iras-pay-tax.pdf' },
		release_directive_on: '2026-02-01',
		directive_tax_amount: 200,
		tax_remitted_amount: 200,
		tax_remitted_on: '2026-02-06',
		tax_remittance_reference: 'BANK-1',
		tax_remittance_evidence_file: { path: 'iras-payment.pdf' },
		released_amount: 800
	};
	await assert.rejects(hold({ ...payTax, directive_tax_amount: null }), /positive tax amount/);
	await assert.rejects(hold({ ...payTax, tax_remitted_on: null }), /tax remittance date/);
	await assert.rejects(
		hold({ ...payTax, tax_remittance_evidence_file: null }),
		/remittance evidence/
	);
	await assert.rejects(hold({ ...payTax, tax_remitted_amount: 201 }), /reconcile/);
	await assert.rejects(hold({ ...payTax, tax_remitted_on: '2026-10-01' }), /future tax remittance/);
	await assert.rejects(hold({ ...payTax, released_amount: 900 }), /reconcile/);
	assert.equal((await hold(payTax))[0].tax_remittance_due_on, '2026-02-11');
	await hold({ ...payTax, tax_remitted_on: '2026-02-12' });
	await assert.rejects(hold({ ...payTax, amended_notice_filed_on: '2026-02-02' }), /amended IR21/);
	const [openTax] = await runTransform(
		holds,
		[
			{
				employment_id: 'e-sg',
				category: 'TAX_CLEARANCE',
				directive_reference: 'IR21 pending',
				held_on: '2026-01-05',
				release_basis: 'PAY_TAX_DIRECTIVE',
				release_directive_on: '2026-02-01',
				amended_notice_filed_on: '2026-02-02',
				directive_tax_amount: 200,
				evidence_file: { path: 'iras-pay-tax.pdf' }
			}
		],
		{ tables }
	);
	assert.equal(openTax.tax_remittance_due_on, '2026-02-11');
	await hold({
		...payTax,
		tax_remitted_amount: null,
		tax_remitted_on: null,
		tax_remittance_reference: null
	});
	const expiry = {
		release_basis: 'NOTICE_EXPIRY',
		evidence_file: { path: 'iras-receipt.pdf' },
		authority_notice_received_on: '2026-01-05'
	};
	await assert.rejects(hold({ ...expiry, released_on: '2026-02-03' }), /30 days/);
	await assert.rejects(hold({ ...expiry, amended_notice_filed_on: '2026-01-20' }), /amended IR21/);
	await hold(expiry);
});

test('SG IR21 remittance query distinguishes upcoming, overdue, on-time and late payment', async () => {
	const tables = {
		companies: [
			{ id: 'c1', settings_code: 'SG' },
			{ id: 'c2', settings_code: 'MY' }
		],
		employments: [
			{ id: 'e1', company_id: 'c1' },
			{ id: 'e2', company_id: 'c1' },
			{ id: 'e3', company_id: 'c1' },
			{ id: 'e4', company_id: 'c2' }
		],
		jurisdiction_settings: [...settingsVersions('SG'), ...settingsVersions('MY')],
		payment_holds: [
			{
				id: 'h1',
				employment_id: 'e1',
				held_on: '2026-02-01',
				category: 'TAX_CLEARANCE',
				release_basis: 'PAY_TAX_DIRECTIVE',
				released_on: null,
				release_directive_on: '2026-02-01',
				directive_tax_amount: 200,
				tax_remittance_due_on: '2026-02-11'
			},
			{
				id: 'h2',
				employment_id: 'e2',
				held_on: '2026-02-01',
				category: 'TAX_CLEARANCE',
				release_basis: 'PAY_TAX_DIRECTIVE',
				released_on: '2026-02-04',
				release_directive_on: '2026-02-01',
				directive_tax_amount: 300,
				tax_remittance_due_on: '2026-02-11',
				tax_remitted_on: '2026-02-10'
			},
			{
				id: 'h3',
				employment_id: 'e3',
				held_on: '2026-02-01',
				category: 'TAX_CLEARANCE',
				release_basis: 'PAY_TAX_DIRECTIVE',
				released_on: '2026-02-04',
				release_directive_on: '2026-02-01',
				directive_tax_amount: 400,
				tax_remittance_due_on: '2026-02-11',
				tax_remitted_on: '2026-02-12'
			},
			{
				id: 'h4',
				employment_id: 'e4',
				held_on: '2026-02-01',
				category: 'TAX_CLEARANCE',
				release_basis: 'PAY_TAX_DIRECTIVE',
				released_on: '2026-02-04',
				release_directive_on: '2026-02-01',
				directive_tax_amount: 500,
				tax_remittance_due_on: '2026-02-11'
			}
		]
	};
	const read = memoryDb(tables).read;
	const status = (as_of) =>
		holds.bodies.queries.tax_clearance_remittance_status({ company_id: 'c1', as_of }, { read });
	assert.deepEqual(
		await holds.bodies.queries.tax_clearance_remittance_status(
			{ company_id: 'c2', as_of: '2026-02-12' },
			{ read }
		),
		[]
	);
	assert.deepEqual(await status('2026-01-31'), []);
	assert.deepEqual(
		(await status('2026-02-10')).map((row) => row.status),
		['PENDING', 'PAID_ON_TIME', 'PENDING']
	);
	assert.deepEqual(
		(await status('2026-02-11')).map((row) => row.status),
		['DUE', 'PAID_ON_TIME', 'DUE']
	);
	assert.deepEqual(
		(await status('2026-02-12')).map((row) => row.status),
		['OVERDUE', 'PAID_ON_TIME', 'PAID_LATE']
	);
});
