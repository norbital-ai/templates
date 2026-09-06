// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Leave and loan junctions recapture the same source across periods. Headers already said so;
 * a later global unique put one-capture back. Gather never refused a second-period leave or a
 * remainder loan recovery — the database did. This file drives gather + the create hook in
 * memory, then proves the migrated public-seed guest can persist the same leave and repayment
 * on two payroll periods.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import {
	ANNUAL_LEAVE_REQUEST_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const TRANSPORT_COMPONENT_ID = '77777777-7777-4777-8777-777777777777';
const CREATE_PAYROLL_COMMAND = 'collections.mutate';

const LEAVE_TYPE_ID = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LEAVE_REQUEST_ID = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const LEAVE_PLAN_ID = 'aaaa3333-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const LEAVE_ACCOUNT_ID = 'aaaa4444-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const LOAN_COMPONENT_ID = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const LOAN_ID = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const REPAYMENT_ID = 'bbbb3333-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const JAN_RUN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const FEB_RUN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const JAN_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const FEB_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

async function createPayrollRun(world, period) {
	const api = memoryPayrollApi(world);
	const prepared = await Effect.runPromise(
		payrollRunHooks.mutate.prepare({
			inputs: [{ company_id: COMPANY_ID, period }],
			api
		})
	);
	return Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input: { company_id: COMPANY_ID, period },
			existing: undefined,
			prepared,
			api
		})
	);
}

function firstPayslip(created) {
	const payslip = created.payslip_payroll_run?.[0];
	assert.ok(payslip, 'the run must produce a payslip');
	return payslip;
}

function persistPayslip(world, options) {
	world.payroll_runs.push({
		id: options.runId,
		company_id: COMPANY_ID,
		period: options.period,
		lifecycle: options.lifecycle,
		approval_id: null
	});
	world.payslips.push({
		id: options.payslipId,
		payroll_run_id: options.runId,
		employment_id: EMPLOYMENT_ID,
		statutory: [],
		approval_id: null
	});
	for (const capture of options.leaveCaptures ?? []) {
		world.payslip_leave_request_inputs.push({
			id: capture.id,
			payslip_id: options.payslipId,
			leave_request_id: capture.leave_request_id,
			period: capture.period
		});
	}
	for (const capture of options.repaymentCaptures ?? []) {
		world.payslip_loan_repayment_inputs.push({
			id: capture.id,
			payslip_id: options.payslipId,
			loan_repayment_id: capture.loan_repayment_id,
			period: capture.period
		});
	}
	for (const adjustment of options.adjustments ?? []) {
		world.payslip_adjustments.push({
			...adjustment,
			payslip_id: options.payslipId
		});
	}
}

function withSpanningLeave(world) {
	world.leave_plans.length = 0;
	world.leave_plans.push({
		id: LEAVE_PLAN_ID,
		company_id: COMPANY_ID,
		code: 'STANDARD',
		name: 'Standard leave plan',
		lifecycle: 'ACTIVE',
		transition: 'NEXT_LEAVE_YEAR',
		effective_range: { start: '2020-01-01', end: null },
		approval_id: null
	});
	world.leave_types.push({
		id: LEAVE_TYPE_ID,
		company_id: COMPANY_ID,
		leave_plan_id: LEAVE_PLAN_ID,
		code: 'AL',
		name: 'Annual leave',
		statutory_kind: 'ANNUAL',
		eligibility: [],
		exit_settlement: { exit: 'FORFEIT' },
		requires_certificate_after_days: null,
		accrual: { kind: 'UNLIMITED' },
		entitlement: { layers: [] },
		payroll_effect: { kind: 'PAID' },
		approval_id: null
	});
	world.leave_accounts.push({
		id: LEAVE_ACCOUNT_ID,
		employment_id: EMPLOYMENT_ID,
		leave_type_id: LEAVE_TYPE_ID,
		leave_code: 'AL',
		leave_name: 'Annual leave',
		opening_plan_id: LEAVE_PLAN_ID,
		opening_statutory_profile_id: JURISDICTION_ID,
		leave_year: 2026,
		starts_on: '2026-01-01',
		ends_on: '2026-12-31',
		status: 'OPEN',
		entitlement_days: 0,
		accrual_kind: 'UNLIMITED',
		carry_limit_days: null,
		carry_expiry_months: null,
		settlement: { settlement: 'FORFEIT' },
		calculation: {
			calculated_on: '2026-01-01',
			service_months: 0,
			statutory_days: 0,
			company_days: 0,
			selected_days: 0,
			formula_version: 'LEAVE_ACCOUNT_V1'
		},
		approval_id: null
	});
	world.leave_requests.push({
		id: LEAVE_REQUEST_ID,
		employment_id: EMPLOYMENT_ID,
		leave_type_id: LEAVE_TYPE_ID,
		leave_account_id: LEAVE_ACCOUNT_ID,
		event: {
			kind: 'TIME_OFF',
			range: {
				start: { date: '2026-01-15', half: 'FIRST' },
				end: { date: '2026-02-10', half: 'SECOND' }
			},
			chargeable_days: 18,
			reason: 'spans January and February'
		},
		approval_id: null
	});
	return world;
}

function withRecoverableLoan(world) {
	world.pay_components.push({
		id: LOAN_COMPONENT_ID,
		company_id: COMPANY_ID,
		statutory_profile_id: JURISDICTION_ID,
		code: 'LOAN',
		name: 'Loan recovery',
		nature: 'DEDUCTION',
		policy: { kind: 'DEDUCTION', settlement: 'DEDUCT', statutory_treatments: [] },
		sequence: 80,
		eligibility: [],
		definition: {
			source: 'ENTRY',
			unit: 'MONEY',
			evidence: 'NONE',
			cap: null,
			settlement: 'PAYROLL'
		},
		approval_id: null
	});
	world.loans.push({
		id: LOAN_ID,
		employment_id: EMPLOYMENT_ID,
		pay_component_id: LOAN_COMPONENT_ID,
		principal: 5000,
		effective_range: { start: '2026-01-01', end: null },
		reference: 'ADV-1',
		reason: 'salary advance',
		approval_id: null
	});
	world.loan_repayments.push({
		id: REPAYMENT_ID,
		loan_id: LOAN_ID,
		due_date: '2026-01-15',
		amount_due: 5000,
		sequence: 1
	});
	return world;
}

test('a leave request spanning January and February is captured on both payslips', async () => {
	const world = withSpanningLeave(createPublicPayrollWorld());
	const january = await createPayrollRun(world, '2026-01');
	const januaryCaptures = firstPayslip(january).payslip_leave_request_input_payslip ?? [];
	assert.deepEqual(
		januaryCaptures.map((row) => row.leave_request_id),
		[LEAVE_REQUEST_ID]
	);
	persistPayslip(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		leaveCaptures: januaryCaptures
	});

	const february = await createPayrollRun(world, '2026-02');
	const februaryCaptures = firstPayslip(february).payslip_leave_request_input_payslip ?? [];
	assert.deepEqual(
		februaryCaptures.map((row) => row.leave_request_id),
		[LEAVE_REQUEST_ID]
	);
	assert.equal(januaryCaptures[0].period, '2026-01');
	assert.equal(februaryCaptures[0].period, '2026-02');
});

test('a part-recovered loan repayment is recaptured on the next period for the remainder', async () => {
	const world = withRecoverableLoan(createPublicPayrollWorld());
	const january = await createPayrollRun(world, '2026-01');
	const januaryPayslip = firstPayslip(january);
	const januaryCaptures = januaryPayslip.payslip_loan_repayment_input_payslip ?? [];
	assert.deepEqual(
		januaryCaptures.map((row) => row.loan_repayment_id),
		[REPAYMENT_ID]
	);
	const januaryRecovery = januaryPayslip.payslip_adjustment_payslip.find(
		(row) => row.input?.kind === 'LOAN_REPAYMENT_INPUT'
	);
	assert.ok(januaryRecovery, 'January must recover part of the repayment');
	assert.ok(
		januaryRecovery.amount < 5000,
		'net-pay protection must leave a remainder for February'
	);
	persistPayslip(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		repaymentCaptures: januaryCaptures,
		adjustments: januaryPayslip.payslip_adjustment_payslip
	});

	const february = await createPayrollRun(world, '2026-02');
	const februaryPayslip = firstPayslip(february);
	const februaryCaptures = februaryPayslip.payslip_loan_repayment_input_payslip ?? [];
	assert.deepEqual(
		februaryCaptures.map((row) => row.loan_repayment_id),
		[REPAYMENT_ID]
	);
	const februaryRecovery = februaryPayslip.payslip_adjustment_payslip.find(
		(row) => row.input?.kind === 'LOAN_REPAYMENT_INPUT'
	);
	assert.ok(februaryRecovery, 'February must recover the outstanding remainder');
	assert.ok(februaryRecovery.amount > 0);
	assert.ok(januaryRecovery.amount + februaryRecovery.amount <= 5000.01);
	assert.equal(januaryCaptures[0].period, '2026-01');
	assert.equal(februaryCaptures[0].period, '2026-02');
});

test(
	'public seed guest persists the same leave and repayment on January and February payslips',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-cross-period-capture');
		try {
			for (const period of [JANUARY_2026, FEBRUARY_2026]) {
				const created = await postGuestCommand(
					session.host.baseUrl,
					CREATE_PAYROLL_COMMAND,
					mutationPush(session.schemaFingerprint, {
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: {
									id: crypto.randomUUID(),
									company_id: COMPANY_ID,
									period
								}
							}
						]
					}),
					{ authorization: `Bearer ${session.credential}` }
				);
				assert.ok(
					created.status >= 200 && created.status < 300,
					`${CREATE_PAYROLL_COMMAND} ${period} returned ${created.status}: ${JSON.stringify(created.value)}`
				);
				requireAccepted(created.value, `${CREATE_PAYROLL_COMMAND} ${period}`);
				if (period === JANUARY_2026) {
					await session.query(
						`update payroll_runs set lifecycle = 'PAID' where company_id = $1 and period = $2`,
						[COMPANY_ID, JANUARY_2026]
					);
				}
			}

			const payslips = (await session.query(
				`select p.id, r.period
				 from payslips p
				 join payroll_runs r on r.id = p.payroll_run_id
				 where p.employment_id = $1
				   and r.period in ($2, $3)
				 order by r.period`,
				[EMPLOYMENT_ID, JANUARY_2026, FEBRUARY_2026]
			)) as ReadonlyArray<{ readonly id: string; readonly period: string }>;
			assert.equal(
				payslips.length,
				2,
				`expected one public-employment payslip per period, got ${JSON.stringify(payslips)}`
			);
			const januaryPayslip = payslips.find((row) => row.period === JANUARY_2026);
			const februaryPayslip = payslips.find((row) => row.period === FEBRUARY_2026);
			assert.ok(januaryPayslip && februaryPayslip);

			await session.query(
				`insert into payslip_leave_request_inputs
				 (id, payslip_id, leave_request_id, period)
				 values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
				[
					crypto.randomUUID(),
					januaryPayslip.id,
					ANNUAL_LEAVE_REQUEST_ID,
					JANUARY_2026,
					crypto.randomUUID(),
					februaryPayslip.id,
					ANNUAL_LEAVE_REQUEST_ID,
					FEBRUARY_2026
				]
			);
			const leaveCaptures = (await session.query(
				`select period from payslip_leave_request_inputs
				 where leave_request_id = $1
				 order by period`,
				[ANNUAL_LEAVE_REQUEST_ID]
			)) as ReadonlyArray<{ readonly period: string }>;
			assert.deepEqual(
				leaveCaptures.map((row) => row.period),
				[JANUARY_2026, FEBRUARY_2026]
			);
			await assert.rejects(() =>
				session.query(
					`insert into payslip_leave_request_inputs
					 (id, payslip_id, leave_request_id, period)
					 values ($1, $2, $3, $4)`,
					[crypto.randomUUID(), januaryPayslip.id, ANNUAL_LEAVE_REQUEST_ID, JANUARY_2026]
				)
			);

			const loanId = crypto.randomUUID();
			const repaymentId = crypto.randomUUID();
			await session.query(
				`insert into loans
				 (id, employment_id, pay_component_id, principal, effective_range, reference)
				 values ($1, $2, $3, $4, $5::jsonb, $6)`,
				[
					loanId,
					EMPLOYMENT_ID,
					TRANSPORT_COMPONENT_ID,
					5000,
					JSON.stringify({ start: '2026-01-01', end: null }),
					'ADV-PUBLIC'
				]
			);
			await session.query(
				`insert into loan_repayments
				 (id, loan_id, due_date, amount_due, sequence)
				 values ($1, $2, $3::timestamptz, $4, $5)`,
				[repaymentId, loanId, '2026-01-15T00:00:00Z', 5000, 1]
			);
			await session.query(
				`insert into payslip_loan_repayment_inputs
				 (id, payslip_id, loan_repayment_id, period)
				 values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
				[
					crypto.randomUUID(),
					januaryPayslip.id,
					repaymentId,
					JANUARY_2026,
					crypto.randomUUID(),
					februaryPayslip.id,
					repaymentId,
					FEBRUARY_2026
				]
			);
			const repaymentCaptures = (await session.query(
				`select period from payslip_loan_repayment_inputs
				 where loan_repayment_id = $1
				 order by period`,
				[repaymentId]
			)) as ReadonlyArray<{ readonly period: string }>;
			assert.deepEqual(
				repaymentCaptures.map((row) => row.period),
				[JANUARY_2026, FEBRUARY_2026]
			);
			await assert.rejects(() =>
				session.query(
					`insert into payslip_loan_repayment_inputs
					 (id, payslip_id, loan_repayment_id, period)
					 values ($1, $2, $3, $4)`,
					[crypto.randomUUID(), januaryPayslip.id, repaymentId, JANUARY_2026]
				)
			);
		} finally {
			await session.stop();
		}
	}
);
