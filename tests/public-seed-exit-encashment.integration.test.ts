import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	postGuestCommand,
	requireAccepted,
	authoredSeedStages,
	jsonSqlParameter
} from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	publicSeedDirectory,
	publicSeedRows,
	templateManifestPath,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { writeGraph, writeRows } from './helpers/write.ts';
import { approveLeaveRequest, leaveTeamHeaders } from './helpers/public-leave.ts';

test(
	'a dismissed contract triggers one held encashment, which HR can approve; retries do not duplicate it',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-exit-encashment');
		try {
			const [contract] = await session.query(
				'select row_version, effective_range from employments where id = $1',
				[EMPLOYMENT_ID]
			);
			const departure = await writeGraph(
				session,
				{
					action: 'mutate',
					collection: 'employments',
					rows: [
						{
							action: 'update',
							values: {
								id: EMPLOYMENT_ID,
								effective_range: {
									start: contract.effective_range.start,
									end: '2026-06-30T00:00:00.000Z'
								},
								exit_reason: 'DISMISSAL'
							}
						}
					]
				},
				[
					{
						row: { collection: 'employments', recordId: EMPLOYMENT_ID },
						rowVersion: Number(contract.row_version)
					}
				],
				bearerHeaders(session.credential)
			);
			requireAccepted(departure.value, 'record dismissal');
			const entries = () =>
				session.query(
					'select id, approval_id, encash_days, reference, payslip_id from leave_entries where reference = $1',
					[`exit:${EMPLOYMENT_ID}:ANNUAL`]
				);
			const held = await entries();
			assert.equal(
				held.length,
				1,
				'the collection event must run the automation, without a manual start'
			);
			assert.equal(Number(held[0].encash_days), 7);
			assert.ok(held[0].approval_id, 'automation authority must require HR approval');
			assert.equal(held[0].payslip_id, null);

			const retry = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{
					name: 'leave_encashment_on_exit',
					input: { employment_id: EMPLOYMENT_ID }
				},
				bearerHeaders(session.credential)
			);
			assert.ok(retry.status < 300, JSON.stringify(retry.value));
			const [run] = await session.query(
				'select status, result, error from automation_run where task_id = $1',
				[asRecord(retry.value, 'retry').taskId]
			);
			assert.equal(run.status, 'done', JSON.stringify(run));
			assert.equal(run.result.status, 'nothing_to_encash');
			assert.equal((await entries()).length, 1);

			await approveLeaveRequest(session, String(held[0].approval_id), String(held[0].id));
			const approved = await entries();
			assert.equal(approved.length, 1);
			assert.equal(approved[0].approval_id, null);
			assert.equal(Number(approved[0].encash_days), 7);

			const payroll = await writeRows(session, 'payroll_runs', 'create', [
				{ company_id: COMPANY_ID, period: '2026-07' }
			]);
			requireAccepted(payroll.value, 'settle approved departure cash-out');
			const [paid] = await session.query(
				`select payslips.adjustments, payslips.base from payslips
				 join payroll_runs on payroll_runs.id = payslips.payroll_run_id
				 where payroll_runs.period = '2026-07' and payslips.employment_id = $1`,
				[EMPLOYMENT_ID]
			);
			const lines = paid.adjustments as {
				component_code: string;
				amount: number;
				quantity: number;
				rate: number;
			}[];
			const cash = lines.find((line) => line.component_code === 'ANNUAL_ENCASHMENT');
			assert.ok(cash, 'the approved automation request must become a payroll line');
			assert.equal(Number(cash.quantity), 7);
			// Synthetic fixture: 3,451 / 26 × 7 = 929.11538… → 929.12 MYR, rounded once.
			assert.equal(Number(cash.amount), 929.12);
			assert.equal(Number(cash.rate), 3451 / 26);
			assert.deepEqual(paid.base, [], 'later settlement must not restart an ended salary');
			assert.ok((await entries())[0].payslip_id, 'the request is captured by its payslip');
		} finally {
			await session.stop();
		}
	}
);

test(
	'the standalone timer dispatches and settles the declared daily encashment schedule',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const seedRows = await publicSeedRows();
		seedRows.employments = seedRows.employments!.map((row) =>
			row.id === EMPLOYMENT_ID
				? {
						...row,
						effective_range: { start: '2021-06-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
						exit_reason: 'RESIGNATION'
					}
				: row
		);
		// Simulate a host restarting after an occurrence became due. Activation keeps the due slot
		// for the unchanged declaration, supplies its real authority and arms the production timer.
		seedRows.bolt_schedule = [
			{
				id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
				key: 'automations.leave_encashment_due',
				command: 'automations.leave_encashment_due',
				crontab: '0 1 * * *',
				input: {},
				next_run_at: new Date(Date.now() - 1000).toISOString()
			}
		];
		seedRows.automation_run = [
			{
				id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
				task_id: 'synthetic-future-departure',
				name: 'leave_encashment_on_exit',
				status: 'done',
				result: { employment_id: EMPLOYMENT_ID, status: 'not_due', raised: [] }
			}
		];
		const session = await startPublicSeedHost('hr-exit-timer', {
			seed: {
				stages: [
					...authoredSeedStages(templateManifestPath, publicSeedDirectory),
					'automation_run',
					'bolt_schedule'
				],
				rows: seedRows,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			const deadline = Date.now() + 10_000;
			let tasks: Readonly<Record<string, unknown>>[] = [];
			do {
				tasks = (await session.query(
					"select status, result, error from bolt_task where command = 'automations.leave_encashment_due'"
				)) as typeof tasks;
				if (tasks[0]?.status === 'done' || tasks[0]?.status === 'failed') break;
				await new Promise((resolve) => setTimeout(resolve, 25));
			} while (Date.now() < deadline);
			assert.equal(tasks.length, 1, 'the timer creates one occurrence without automations.start');
			assert.equal(tasks[0]?.status, 'done', JSON.stringify(tasks));
			const entries = await session.query(
				'select approval_id, encash_days from leave_entries where reference = $1',
				[`exit:${EMPLOYMENT_ID}:ANNUAL`]
			);
			assert.equal(entries.length, 1);
			assert.ok(entries[0].approval_id);
			assert.equal(Number(entries[0].encash_days), 7);
		} finally {
			await session.stop();
		}
	}
);

test(
	'the daily catch-up processes registered departures once and leaves imported history alone',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-exit-due');
		try {
			// Historical imports without a registered departure must not reopen old settlements.
			const closeOn = (date: string) =>
				session.query(
					"update employments set effective_range = jsonb_set(effective_range, '{end}', to_jsonb($2::text)), exit_reason = 'RESIGNATION' where id = $1",
					[EMPLOYMENT_ID, `${date}T00:00:00.000Z`]
				);
			const catchUp = async () => {
				const response = await postGuestCommand(
					session.host.baseUrl,
					'automations.start',
					{ name: 'leave_encashment_due', input: {} },
					bearerHeaders(session.credential)
				);
				assert.equal(response.status, 200, JSON.stringify(response.value));
				const [run] = await session.query(
					'select status, result from automation_run where task_id = $1',
					[asRecord(response.value, 'daily catch-up').taskId]
				);
				assert.equal(run.status, 'done');
				assert.deepEqual(run.result.failures, []);
				return run.result;
			};
			await closeOn('2026-06-30');
			assert.equal((await catchUp()).checked, 0);
			await closeOn('2099-06-30');
			const registration = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_encashment_on_exit', input: { employment_id: EMPLOYMENT_ID } },
				bearerHeaders(session.credential)
			);
			assert.equal(registration.status, 200, JSON.stringify(registration.value));
			const [registered] = await session.query(
				'select result from automation_run where task_id = $1',
				[asRecord(registration.value, 'registration').taskId]
			);
			assert.equal(registered.result.status, 'not_due');
			assert.equal((await catchUp()).raised, 0);
			await closeOn('2026-06-30');
			assert.equal((await catchUp()).raised, 2, 'leave and the eligible separation request');
			const [held] = await session.query(
				'select approval_id, encash_days from leave_entries where reference = $1',
				[`exit:${EMPLOYMENT_ID}:ANNUAL`]
			);
			assert.ok(held.approval_id);
			assert.equal(Number(held.encash_days), 7);
			const separation = await session.query(
				'select approval_id from adhoc_requests where employment_id = $1',
				[EMPLOYMENT_ID]
			);
			assert.equal(separation.length, 1);
			assert.ok(separation[0].approval_id);
			const headers = leaveTeamHeaders(session, 'HR Manager');
			const approval = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId: held.approval_id },
				headers
			);
			const rejected = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state: approval.value, decision: 'reject' },
				headers
			);
			assert.equal(asRecord(rejected.value, 'rejected encashment')._tag, 'Rejected');
			const discarded = await postGuestCommand(
				session.host.baseUrl,
				'collections.discard',
				{ requestId: held.approval_id },
				headers
			);
			assert.equal(discarded.status, 200, JSON.stringify(discarded.value));
			const retry = await catchUp();
			assert.equal(
				retry.checked,
				0,
				'a completed departure must not be submitted for review again'
			);
			assert.equal(retry.raised, 0);
			assert.equal(
				(
					await session.query('select id from leave_entries where reference = $1', [
						`exit:${EMPLOYMENT_ID}:ANNUAL`
					])
				).length,
				0,
				'the rejected request must remain absent'
			);
		} finally {
			await session.stop();
		}
	}
);
