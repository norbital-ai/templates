import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { createdIds, graphOf, writeGraph } from './helpers/write.ts';
import {
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import { markRunPaid } from './helpers/mark-paid.ts';
import { approveLeaveRequest, leaveTeamHeaders } from './helpers/public-leave.ts';
import { exitReference } from '../src/lib/leave/exit-encashment.ts';
import { dateKey } from '../src/lib/iso-day.ts';

test(
	'payroll freezes inputs, refuses nested payment writes, retains paid output and refuses a second payroll for the same period',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-settlement');
		try {
			const headers = bearerHeaders(session.credential);
			const command = (body: Parameters<typeof graphOf>[0], bases = []) =>
				writeGraph(session, body, bases, headers);
			const createRun = async (period = '2026-01') =>
				command({
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [{ action: 'create', values: { company_id: COMPANY_ID, period } }]
				});
			const competing = await Promise.all([createRun(), createRun()]);
			const accepted = competing.filter(
				(result) => asRecord(result.value, 'concurrent payroll').resolution === 'accepted'
			);
			assert.equal(accepted.length, 1, JSON.stringify(competing.map((row) => row.value)));
			const runId = createdIds(accepted[0].value)[0];
			assert.equal((await session.query('select id from payroll_runs')).length, 1);
			const [run] = await session.query('select * from payroll_runs where id = $1', [runId]);
			assert.ok(run);
			const initial = await session.query(
				'select * from payslips where payroll_run_id = $1 order by id',
				[runId]
			);
			assert.equal(initial.length, 4);
			const bases = [
				{
					row: { collection: 'payroll_runs', recordId: runId },
					rowVersion: Number(run.row_version)
				}
			];
			// A run is frozen once built: it exposes no update at all, so its payslips cannot be
			// re-stated through it, and a slip's money is engine output no input names.
			const refused = await command(
				{
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [{ action: 'update', values: { id: runId, warnings: '' } }]
				},
				bases
			);
			assert.match(JSON.stringify(refused.value), /exposes no update endpoint/);
			const restated = await command(
				{
					action: 'mutate',
					collection: 'payslips',
					rows: [{ action: 'update', values: { id: String(initial[0].id), gross: 0 } }]
				},
				[
					{
						row: { collection: 'payslips', recordId: String(initial[0].id) },
						rowVersion: Number(initial[0].row_version)
					}
				]
			);
			assert.match(JSON.stringify(restated.value), /not part of the declared update input/);
			await markRunPaid(session, runId);
			/**
			 * The figures are retained; the payment is recorded.
			 *
			 * Marking the run paid now writes `paid_at` on every slip it holds, because payment is
			 * the slip's fact — so the rows are no longer byte-identical, and a comparison that
			 * demanded they were would be asserting that nothing was recorded. What must not move is
			 * the money: every settled column below, and the frozen input arrays behind them.
			 */
			const settled = await session.query(
				'select * from payslips where payroll_run_id = $1 order by id',
				[runId]
			);
			const money = (rows) =>
				rows.map((row) => ({
					id: row.id,
					employment_id: row.employment_id,
					terms_through: row.terms_through,
					base: row.base,
					proration: row.proration,
					statutory: row.statutory,
					adjustments: row.adjustments,
					gross: row.gross,
					total_deductions: row.total_deductions,
					net: row.net,
					employer_cost: row.employer_cost,
					currency: row.currency
				}));
			assert.deepEqual(money(settled), money(initial));
			assert.deepEqual(
				initial.map((row) => row.paid_at),
				initial.map(() => null),
				'nobody was paid before the run was marked paid'
			);
			assert.ok(
				settled.length > 0 && settled.every((row) => row.paid_at != null),
				'and every slip carries its payment afterwards'
			);
			const [paidCounts] = (await session.query(
				"select count(*)::int as total, count(*) filter (where status = 'PAID')::int as paid from payslips where payroll_run_id = $1",
				[runId]
			)) as ReadonlyArray<{ readonly total: number; readonly paid: number }>;
			assert.equal(paidCounts.paid, paidCounts.total, 'every slip carries its payment');
			// The delete grant decides a paid run, so the request is made as the team it binds; the
			// founder bypasses policy.
			const removed = await writeGraph(
				session,
				{ action: 'delete', collection: 'payroll_runs', ids: [runId] },
				[
					{
						row: { collection: 'payroll_runs', recordId: runId },
						rowVersion: Number(run.row_version)
					}
				],
				leaveTeamHeaders(session, 'HR Manager')
			);
			assert.equal(
				asRecord(removed.value, 'paid delete').resolution,
				'rejected',
				JSON.stringify(removed.value)
			);
			const duplicate = await createRun();
			assert.match(JSON.stringify(duplicate.value), /already exists/);
			assert.equal(
				(
					await session.query('select id from payroll_runs where company_id = $1 and period = $2', [
						COMPANY_ID,
						'2026-01'
					])
				).length,
				1
			);
		} finally {
			await session.stop();
		}
	}
);

test(
	'departure raises the leaver’s encashment once, held for the HR Manager; approved, it settles once in a later regular payroll',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('exit-encashment');
		try {
			const employmentId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
			const reference = exitReference(employmentId, 'ANNUAL');
			const headers = bearerHeaders(session.credential);
			const command = (body: Parameters<typeof graphOf>[0], bases = []) =>
				writeGraph(session, body, bases, headers);
			const exitEntries = () =>
				session.query(
					'select id, encash_days, effective_on, due_on, approval_id from leave_entries where employment_id = $1 and reference = $2',
					[employmentId, reference]
				) as Promise<
					{
						readonly id: string;
						readonly encash_days: number | string;
						readonly effective_on: string;
						readonly due_on: string;
						readonly approval_id: string | null;
					}[]
				>;
			const [contract] = await session.query(
				'select row_version, effective_range from employments where id = $1',
				[employmentId]
			);
			const rangeStart =
				typeof contract.effective_range === 'string'
					? JSON.parse(contract.effective_range).start
					: contract.effective_range.start;
			assert.equal((await exitEntries()).length, 0);
			requireAccepted(
				(
					await command(
						{
							action: 'mutate',
							collection: 'employments',
							rows: [
								{
									action: 'update',
									values: {
										id: employmentId,
										effective_range: { start: rangeStart, end: '2026-02-10T00:00:00.000Z' },
										exit_reason: 'RESIGNATION'
									}
								}
							]
						},
						[
							{
								row: { collection: 'employments', recordId: employmentId },
								rowVersion: Number(contract.row_version)
							}
						]
					)
				).value,
				'record departure'
			);

			// The close trips the automation; its run settles before the entry is on the record.
			const raised = await waitForRun(session, `event:leave_encashment_on_exit`);
			assert.equal(raised.status, 'done', JSON.stringify(raised));
			assert.deepEqual(asRecord(raised.result, 'exit run').status, 'raised');
			const [held, ...others] = await exitEntries();
			assert.equal(others.length, 0);
			assert.ok(held, 'the exit encashment is on the record');
			assert.equal(Number(held.encash_days), 8, 'the whole unused balance on the last day');
			assert.equal(dateKey(String(held.effective_on)), '2026-02-10');
			assert.equal(dateKey(String(held.due_on)), '2026-02-10');
			assert.ok(held.approval_id, 'held, not settled money');
			// The alert: the HR Manager's approval inbox carries the request, routed to their team.
			const [request] = (await session.query(
				'select id, status, approver_teams from approval_request where collection_name = $1 and record_id = $2',
				['leave_entries', held.id]
			)) as { readonly id: string; readonly status: string; readonly approver_teams: unknown }[];
			assert.ok(request, 'an approval request names the held entry');
			assert.equal(request.status, 'ONGOING');
			assert.match(JSON.stringify(request.approver_teams), /hr manager/i);
			// And every member of the approver teams has the inbox row, written with the hold: the
			// public seed carries no people on those teams, so the resolved set is empty here and the
			// rule's presence is what is proven — a team recipient, not a user id, is what the
			// collection declares.
			const inbox = (await session.query(
				"select recipient, payload from bolt_notifications where payload->>'collection' = 'leave_entries' and payload->>'approvalRequestId' = $1",
				[request.id]
			)) as { readonly recipient: string; readonly payload: Record<string, unknown> }[];
			const members = (await session.query(
				'select u.id from "user" as u join "team" as t on t.id = u.team_id where lower(t.name) in (\'hr manager\', \'senior management\')',
				[]
			)) as { readonly id: string }[];
			assert.deepEqual(
				inbox.map((row) => row.recipient).toSorted(),
				members.map((row) => row.id).toSorted()
			);

			// Idempotent: a manual re-run finds the reference and raises nothing more.
			const again = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_encashment_on_exit', input: { employment_id: employmentId } },
				headers
			);
			assert.ok(again.status < 300, JSON.stringify(again.value));
			const rerun = await waitForRun(session, String(asRecord(again.value, 'start').taskId));
			assert.equal(rerun.status, 'done', JSON.stringify(rerun));
			assert.equal(asRecord(rerun.result, 'rerun').status, 'nothing_to_encash');
			assert.equal((await exitEntries()).length, 1);

			await approveLeaveRequest(session, request.id, held.id);
			const march = await command({
				action: 'mutate',
				collection: 'payroll_runs',
				rows: [{ action: 'create', values: { company_id: COMPANY_ID, period: '2026-03' } }]
			});
			requireAccepted(march.value, 'March regular payroll');
			const [runId] = createdIds(march.value);
			const [slip] = await session.query(
				'select id, gross, base from payslips where payroll_run_id = $1 and employment_id = $2',
				[runId, employmentId]
			);
			assert.ok(slip);
			// Leave carries no keyed money: eight encashed days at the ordinary day wage (90.32). The
			// fixture's hospitalisation row is `can_encash` too and is not paid out: exit pays annual leave.
			assert.equal(Number(slip.gross), 722.56);
			assert.deepEqual(slip.base, []);
			assert.equal(
				(
					await session.query('select id from leave_entries where id = $1 and payslip_id = $2', [
						held.id,
						slip.id
					])
				).length,
				1
			);
			await markRunPaid(session, runId);
			const april = await command({
				action: 'mutate',
				collection: 'payroll_runs',
				rows: [{ action: 'create', values: { company_id: COMPANY_ID, period: '2026-04' } }]
			});
			requireAccepted(april.value, 'April regular payroll');
			const [nextId] = createdIds(april.value);
			assert.equal(
				(
					await session.query(
						'select id from payslips where payroll_run_id = $1 and employment_id = $2',
						[nextId, employmentId]
					)
				).length,
				0
			);
			assert.equal((await exitEntries()).length, 1);
		} finally {
			await session.stop();
		}
	}
);

/** The automation run whose task id ends with `suffix`, once it has settled; bounded. */
async function waitForRun(
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	suffix: string
) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const [run] = (await session.query(
			'select status, result, error from automation_run where task_id like $1 order by created_at desc limit 1',
			[`%${suffix}`]
		)) as { readonly status: string; readonly result: unknown; readonly error: unknown }[];
		if (run != null && run.status !== 'queued' && run.status !== 'running') return run;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`automation run ${suffix} did not settle within 30 s`);
}
