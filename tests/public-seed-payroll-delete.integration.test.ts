import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	MARCH_2026,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MUTATE_COMMAND = 'collections.mutate';

const createDraft = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	period: string
): Promise<string> => {
	const payrollRunId = crypto.randomUUID();
	const created = await postGuestCommand(
		session.host.baseUrl,
		MUTATE_COMMAND,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'payroll_runs',
			rows: [
				{
					action: 'create',
					values: {
						id: payrollRunId,
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
		`${MUTATE_COMMAND} create ${period} returned ${created.status}: ${JSON.stringify(created.value)}`
	);
	requireAccepted(created.value, `${MUTATE_COMMAND} create ${period}`);
	return payrollRunId;
};

/**
 * Public-seed integration deletes two draft payroll runs in one `collections.mutate` graph.
 * One request, `ids` only — the same batch path mutate uses.
 */
test(
	'public seed deletes two draft payroll runs in one batch',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-delete-batch');
		try {
			// Later period first: an earlier DRAFT blocks every subsequent calculate (YTD).
			const marchId = await createDraft(session, MARCH_2026);
			const februaryId = await createDraft(session, FEBRUARY_2026);

			const before = (await session.query(
				`select id, period from payroll_runs where id in ($1, $2) order by period`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string; readonly period: string }>;
			assert.deepEqual(
				before.map((row) => row.period),
				[FEBRUARY_2026, MARCH_2026]
			);

			const captured = (await session.query(
				`select 'work_day' as kind, work_day_id as source_id
				 from payslip_work_day_inputs i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'component_entry', component_entry_id
				 from payslip_component_entry_inputs i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'leave_request', leave_request_id
				 from payslip_leave_request_inputs i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'loan_repayment', loan_repayment_id
				 from payslip_loan_repayment_inputs i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly kind: string; readonly source_id: string }>;

			const payslipsBefore = (await session.query(
				`select id from payslips where payroll_run_id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(
				payslipsBefore.length > 0,
				`delete cascade is unproven if the drafts have no payslips: ${JSON.stringify(payslipsBefore)}`
			);

			const versions = (await session.query(
				`select id, row_version from payroll_runs where id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string; readonly row_version: number }>;
			assert.equal(
				versions.length,
				2,
				`expected two draft versions, got ${JSON.stringify(versions)}`
			);

			const deleted = await postGuestCommand(
				session.host.baseUrl,
				MUTATE_COMMAND,
				mutationPush(
					session.schemaFingerprint,
					{
						action: 'delete',
						collection: 'payroll_runs',
						ids: [februaryId, marchId]
					},
					versions.map((row) => ({
						row: { collection: 'payroll_runs', recordId: row.id },
						rowVersion: row.row_version
					}))
				),
				{ authorization: `Bearer ${session.credential}` }
			);
			assert.ok(
				deleted.status >= 200 && deleted.status < 300,
				`${MUTATE_COMMAND} delete returned ${deleted.status}: ${JSON.stringify(deleted.value)}`
			);
			requireAccepted(deleted.value, `${MUTATE_COMMAND} delete`);

			const remaining = (await session.query(`select id from payroll_runs where id in ($1, $2)`, [
				februaryId,
				marchId
			])) as ReadonlyArray<{ readonly id: string }>;
			assert.deepEqual(remaining, []);

			const orphanPayslips = (await session.query(
				`select id from payslips where payroll_run_id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.equal(
				orphanPayslips.length,
				0,
				`expected cascade to drop payslips for the deleted runs, got ${JSON.stringify(orphanPayslips)}`
			);

			const leftoverCaptures = (await session.query(
				`select 'work_day' as kind, work_day_id as source_id
				 from payslip_work_day_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))
				 union all
				 select 'component_entry', component_entry_id
				 from payslip_component_entry_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))
				 union all
				 select 'leave_request', leave_request_id
				 from payslip_leave_request_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))
				 union all
				 select 'loan_repayment', loan_repayment_id
				 from payslip_loan_repayment_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly kind: string; readonly source_id: string }>;
			assert.deepEqual(
				leftoverCaptures,
				[],
				`expected cascade to drop capture junctions, got ${JSON.stringify(leftoverCaptures)}`
			);

			const sourceTable = {
				work_day: 'work_days',
				component_entry: 'component_entries',
				leave_request: 'leave_requests',
				loan_repayment: 'loan_repayments'
			} as const;
			for (const row of captured) {
				const table = sourceTable[row.kind];
				assert.ok(table, `unexpected capture kind ${row.kind}`);
				const surviving = (await session.query(`select id from ${table} where id = $1`, [
					row.source_id
				])) as ReadonlyArray<{ readonly id: string }>;
				assert.equal(
					surviving.length,
					1,
					`deleting a draft run must unlink ${row.kind} ${row.source_id}, not delete it`
				);
			}
		} finally {
			await session.stop();
		}
	}
);
