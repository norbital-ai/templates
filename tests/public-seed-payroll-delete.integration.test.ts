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
			// Legacy outstanding drafts must remain deletable even though new runs now enforce chronology.
			const marchId = await createDraft(session, MARCH_2026);
			const februaryId = crypto.randomUUID();
			await session.query(
				`insert into payroll_runs
				(id, company_id, period, lifecycle, settings_id, configuration_hash,
				 calculation_version, pay_date, attendance_from, attendance_to, holidays)
				select $1, company_id, $2, lifecycle, settings_id, configuration_hash,
				 calculation_version, pay_date, attendance_from, attendance_to, holidays
				from payroll_runs where id = $3`,
				[februaryId, FEBRUARY_2026, marchId]
			);

			const before = (await session.query(
				`select id, period from payroll_runs where id in ($1, $2) order by period`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string; readonly period: string }>;
			assert.deepEqual(
				before.map((row) => row.period),
				[FEBRUARY_2026, MARCH_2026]
			);

			const captured = (await session.query(
				`select 'work_day' as kind, w.id as source_id
				 from work_days w
				 join payslips p on p.id = w.settled_payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'claim_request', c.id
				 from claim_requests c
				 join payslips p on p.id = c.settled_payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'allowance_request', allowance_request_id
				 from payslip_allowance_request_inputs i
				 join payslips p on p.id = i.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'payment_request', r.id
				 from payment_requests r
				 join payslips p on p.id = r.settled_payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'leave_request', leave_entry_id
				 from payslip_leave_inputs i
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
				`select 'work_day' as kind, id as source_id
				 from work_days
				 where settled_payslip_id is not null and id = any($3::uuid[])
				 union all
				 select 'claim_request', id
				 from claim_requests
				 where settled_payslip_id is not null and id = any($3::uuid[])
				 union all
				 select 'allowance_request', allowance_request_id
				 from payslip_allowance_request_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))
				 union all
				 select 'payment_request', id
				 from payment_requests
				 where settled_payslip_id is not null and id = any($3::uuid[])
				 union all
				 select 'leave_request', leave_entry_id
				 from payslip_leave_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))
				 union all
				 select 'loan_repayment', loan_repayment_id
				 from payslip_loan_repayment_inputs
				 where payslip_id in (select id from payslips where payroll_run_id in ($1, $2))`,
				[februaryId, marchId, captured.map((row) => row.source_id)]
			)) as ReadonlyArray<{ readonly kind: string; readonly source_id: string }>;
			assert.deepEqual(
				leftoverCaptures,
				[],
				`expected cascade to drop capture junctions, got ${JSON.stringify(leftoverCaptures)}`
			);

			const sourceTable = {
				work_day: 'work_days',
				claim_request: 'claim_requests',
				allowance_request: 'allowance_requests',
				payment_request: 'payment_requests',
				leave_request: 'leave_entries',
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
