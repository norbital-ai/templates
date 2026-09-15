// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Cross-period capture after RFC 0001: a time-off entry settles whole in one period, and a loan
 * repayment is recovered whole by exactly one payslip — the next due row on the next run. This file
 * drives gather + the create hook in memory, then proves the migrated public-seed guest persists
 * both across two payroll periods.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import { readLeaveContext } from '../src/lib/leave/context.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { createLeave } from './helpers/public-leave.ts';
import { settledBy } from './helpers/settlement.ts';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import {
	HOSPITALIZATION_LEAVE_CATALOGUE_ID,
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const CREATE_PAYROLL_COMMAND = 'collections.mutate';

const LEAVE_CATALOGUE_ID = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LEAVE_REQUEST_ID = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const FEB_LEAVE_REQUEST_ID = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const LOAN_COMPONENT_ID = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const LOAN_ID = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const REPAYMENT_ID = 'bbbb3333-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const FEB_REPAYMENT_ID = 'bbbb3333-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const JAN_RUN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const FEB_RUN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

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
	const payslip = firstPayslip(options.created);
	world.payroll_runs.push({
		...options.created,
		id: options.runId,
		company_id: COMPANY_ID,
		period: options.period,
		approval_id: null
	});
	// The RFC run's own write already pinned every source it consumed in the world; persisting the
	// slip is what makes it read as history, because consumption is summed from slip adjustments.
	world.payslips.push({
		...payslip,
		id: payslip.id,
		payroll_run_id: options.runId,
		employment_id: EMPLOYMENT_ID,
		base: [],
		adjustments: [],
		paid_at: options.paid === true ? `${options.period}-28` : null,
		approval_id: null
	});
}

async function withLeaveEntries(world) {
	world.leave_catalogue.push({
		id: LEAVE_CATALOGUE_ID,
		settings_id: JURISDICTION_ID,
		code: 'ANNUAL',
		name: 'Annual leave',
		authority: null,
		eligibility: '',
		destination: 'PAY',
		direction: 'ADD',
		evidence: 'NONE',
		paid: true,
		entitlement: { availability: 'UNLIMITED', proration: 'NONE', year_start_month: 1, bands: [] },
		approval_id: null
	});
	const context = await Effect.runPromise(
		readLeaveContext(memoryPayrollApi(world), [EMPLOYMENT_ID], {
			start: '2026-01-19',
			end: '2026-02-02'
		})
	);
	// RFC 0001 settles a time-off entry whole in the period that contains all of its days, so a
	// span across the cutoff is two entries, one per period — exactly what the old junction sliced.
	for (const [id, start, end] of [
		[LEAVE_REQUEST_ID, '2026-01-19', '2026-01-20'],
		[FEB_LEAVE_REQUEST_ID, '2026-01-21', '2026-02-02']
	] as const) {
		const { certificateRequired, ...entry } = planLeaveActivity(
			context,
			{
				employment_id: EMPLOYMENT_ID,
				catalogue_id: LEAVE_CATALOGUE_ID,
				reference: `CROSS-PERIOD-${id}`,
				event: {
					kind: 'TIME_OFF',
					range: {
						start: { date: start, half: 'FIRST' },
						end: { date: end, half: 'SECOND' }
					},
					chargeable_days: null,
					reason: 'Cross-period leave'
				}
			},
			id
		);
		world.leave_entries.push({ id, ...entry, approval_id: null });
	}
	return world;
}

function withRecoverableLoan(world) {
	// Fully worked shifts isolate loan recovery from unrelated absence deductions.
	for (const row of world.work_days) {
		row.worked_intervals = [
			{ start: `${row.work_date}T07:30:00+08:00`, end: `${row.work_date}T16:30:00+08:00` }
		];
		row.break_minutes = 60;
	}
	world.loan_catalogue.push({
		id: LOAN_COMPONENT_ID,
		settings_id: JURISDICTION_ID,
		code: 'LOAN',
		loan_type: 'STAFF',
		destination: 'NET',
		direction: 'SUBTRACT',
		minimum_repayment: null,
		bands: [],
		eligibility: '',
		approval_id: null
	});
	world.loans.push({
		id: LOAN_ID,
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: LOAN_COMPONENT_ID,
		principal: 2000,
		effective_range: { start: '2026-01-01', end: null },
		reference: 'ADV-1',
		reason: 'salary advance',
		approval_id: null
	});
	world.loan_repayments.push(
		{
			id: REPAYMENT_ID,
			loan_id: LOAN_ID,
			employment_id: EMPLOYMENT_ID,
			due_date: '2026-01-15',
			amount_due: 1000,
			sequence: 1
		},
		{
			id: FEB_REPAYMENT_ID,
			loan_id: LOAN_ID,
			employment_id: EMPLOYMENT_ID,
			due_date: '2026-02-15',
			amount_due: 1000,
			sequence: 2
		}
	);
	return world;
}

test('a Leave entry in each period is captured by that period’s January and February payroll', async () => {
	const world = await withLeaveEntries(createPublicPayrollWorld());
	const january = await createPayrollRun(world, '2026-01');
	const januarySlip = firstPayslip(january);
	assert.deepEqual(settledBy(world, 'leave_entries', januarySlip.id), [LEAVE_REQUEST_ID]);
	persistPayslip(world, {
		created: january,
		runId: JAN_RUN,
		period: '2026-01',
		paid: true
	});

	const february = await createPayrollRun(world, '2026-02');
	const februarySlip = firstPayslip(february);
	assert.deepEqual(settledBy(world, 'leave_entries', februarySlip.id), [FEB_LEAVE_REQUEST_ID]);
	const januaryEntry = world.leave_entries.find((row) => row.id === LEAVE_REQUEST_ID)!;
	const februaryEntry = world.leave_entries.find((row) => row.id === FEB_LEAVE_REQUEST_ID)!;
	assert.deepEqual(
		januaryEntry.charges.map((row) => row.date),
		['2026-01-19', '2026-01-20']
	);
	assert.equal(februaryEntry.charges.length, 13);
	assert.equal(februaryEntry.charges[0].date, '2026-01-21');
	assert.equal(februaryEntry.charges.at(-1).date, '2026-02-02');
	assert.deepEqual(
		[...januaryEntry.charges, ...februaryEntry.charges],
		world.leave_entries[0].charges.concat(world.leave_entries[1].charges)
	);
});

test('each due loan repayment is recovered whole by the payslip of its own period', async () => {
	const world = withRecoverableLoan(createPublicPayrollWorld());
	const january = await createPayrollRun(world, '2026-01');
	const januarySlip = firstPayslip(january);
	const januaryRecovery = januarySlip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');
	assert.equal(januaryRecovery?.amount, 1000, 'January recovers the first instalment whole');
	assert.equal(januaryRecovery?.source_id, REPAYMENT_ID);
	persistPayslip(world, {
		created: january,
		runId: JAN_RUN,
		period: '2026-01',
		paid: true
	});
	assert.deepEqual(settledBy(world, 'loan_repayments', januarySlip.id), [REPAYMENT_ID]);

	const february = await createPayrollRun(world, '2026-02');
	const februarySlip = firstPayslip(february);
	const februaryRecovery = februarySlip.adjustments.find((row) => row.family === 'LOAN_REPAYMENT');
	assert.equal(februaryRecovery?.amount, 1000, 'February recovers the second instalment whole');
	assert.equal(februaryRecovery?.source_id, FEB_REPAYMENT_ID);
});

test(
	'public seed guest persists per-period leave and one whole loan repayment per payslip on January and February',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-cross-period-capture');
		try {
			// RFC 0001 settles a time-off entry whole in one period, so the span is two entries.
			const januaryLeaveId = crypto.randomUUID();
			const februaryLeaveId = crypto.randomUUID();
			for (const [id, start, end, reference] of [
				[januaryLeaveId, '2026-01-19', '2026-01-20', 'CROSS-PERIOD-JAN'],
				[februaryLeaveId, '2026-01-21', '2026-02-02', 'CROSS-PERIOD-FEB']
			] as const) {
				requireAccepted(
					(
						await createLeave(session, {
							id,
							reference,
							catalogue_id: HOSPITALIZATION_LEAVE_CATALOGUE_ID,
							event: {
								kind: 'TIME_OFF',
								range: {
									start: { date: start, half: 'FIRST' },
									end: { date: end, half: 'SECOND' }
								},
								chargeable_days: null,
								reason: 'Cross-period leave'
							}
						})
					).value,
					reference
				);
			}
			// A recovery settles as a payroll deduction; the public seed carries none, so one is
			// written in SQL the way provisioning writes facts.
			const loanCatalogueId = crypto.randomUUID();
			await session.query(
				`insert into loan_catalogue (id, settings_id, code, loan_type, eligibility)
				 values ($1, $2, 'CROSS_PERIOD_LOAN', 'STAFF', '')`,
				[loanCatalogueId, JURISDICTION_ID]
			);
			const loanId = crypto.randomUUID();
			const repaymentId = crypto.randomUUID();
			const februaryRepaymentId = crypto.randomUUID();
			await session.query(
				`insert into loans
				 (id, employment_id, loan_catalogue_id, principal, effective_range, reference)
				 values ($1, $2, $3, $4, $5::jsonb, $6)`,
				[
					loanId,
					EMPLOYMENT_ID,
					loanCatalogueId,
					2000,
					JSON.stringify({ start: '2026-01-01', end: null }),
					'ADV-PUBLIC'
				]
			);
			await session.query(
				`insert into loan_repayments
				 (id, loan_id, employment_id, due_date, amount_due, sequence)
				 values ($1, $2, $3, $4::timestamptz, $5, $6)`,
				[repaymentId, loanId, EMPLOYMENT_ID, '2026-01-15T00:00:00Z', 1000, 1]
			);
			await session.query(
				`insert into loan_repayments
				 (id, loan_id, employment_id, due_date, amount_due, sequence)
				 values ($1, $2, $3, $4::timestamptz, $5, $6)`,
				[februaryRepaymentId, loanId, EMPLOYMENT_ID, '2026-02-15T00:00:00Z', 1000, 2]
			);

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
					const [januaryRun] = (await session.query(
						'select id, row_version from payroll_runs where company_id = $1 and period = $2',
						[COMPANY_ID, JANUARY_2026]
					)) as ReadonlyArray<{ readonly id: string; readonly row_version: number }>;
					requireAccepted(
						(
							await postGuestCommand(
								session.host.baseUrl,
								CREATE_PAYROLL_COMMAND,
								mutationPush(
									session.schemaFingerprint,
									{
										action: 'mutate',
										collection: 'payslips',
										rows: (
											(await session.query(
												'select id, row_version from payslips where payroll_run_id = $1',
												[januaryRun!.id]
											)) as ReadonlyArray<{ readonly id: string; readonly row_version: number }>
										).map((slip) => ({
											action: 'update',
											values: { id: slip.id, status: 'PAID', paid_at: '2026-01-28' }
										}))
									},
									(
										(await session.query(
											'select id, row_version from payslips where payroll_run_id = $1',
											[januaryRun!.id]
										)) as ReadonlyArray<{ readonly id: string; readonly row_version: number }>
									).map((slip) => ({
										row: { collection: 'payslips', recordId: slip.id },
										rowVersion: slip.row_version
									}))
								),
								{ authorization: `Bearer ${session.credential}` }
							)
						).value,
						'pay January'
					);
				}
			}

			const leaveCaptures = (await session.query(
				`select l.id, r.period
				 from leave_entries l
				 join payslips p on p.id = l.payslip_id
				 join payroll_runs r on r.id = p.payroll_run_id
				 where l.id in ($1, $2)
				 order by r.period`,
				[januaryLeaveId, februaryLeaveId]
			)) as ReadonlyArray<{ readonly id: string; readonly period: string }>;
			assert.deepEqual(
				leaveCaptures.map((row) => [row.id, row.period]),
				[
					[januaryLeaveId, JANUARY_2026],
					[februaryLeaveId, FEBRUARY_2026]
				]
			);

			const recovery = (await session.query(
				`select r.period,
				        coalesce((select sum((a->>'amount')::numeric)
				                    from jsonb_array_elements(p.adjustments) a
				                   where a->>'family' = 'LOAN_REPAYMENT'), 0)::numeric as recovered
				 from payslips p
				 join payroll_runs r on r.id = p.payroll_run_id
				 where p.employment_id = $1 and r.period in ($2, $3)
				 order by r.period`,
				[EMPLOYMENT_ID, JANUARY_2026, FEBRUARY_2026]
			)) as ReadonlyArray<{ readonly period: string; readonly recovered: string }>;
			assert.equal(recovery.length, 2, JSON.stringify(recovery));
			assert.deepEqual(
				recovery.map((row) => [row.period, Number(row.recovered)]),
				[
					[JANUARY_2026, 1000],
					[FEBRUARY_2026, 1000]
				],
				'each period recovers exactly its own instalment, whole'
			);
			const pinned = (await session.query(
				`select l.id, r.period
				 from loan_repayments l
				 join payslips p on p.id = l.payslip_id
				 join payroll_runs r on r.id = p.payroll_run_id
				 where l.id in ($1, $2)
				 order by r.period`,
				[repaymentId, februaryRepaymentId]
			)) as ReadonlyArray<{ readonly id: string; readonly period: string }>;
			assert.deepEqual(
				pinned.map((row) => [row.id, row.period]),
				[
					[repaymentId, JANUARY_2026],
					[februaryRepaymentId, FEBRUARY_2026]
				],
				'each repayment is linked to the one payslip that recovered it'
			);
		} finally {
			await session.stop();
		}
	}
);
