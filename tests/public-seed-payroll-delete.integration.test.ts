import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAccepted } from '@norbital-ai/test-utilities';
import { WRITE_COMMAND, createdIds, observedVersion, writeRows } from './helpers/write.ts';
import {
	COMPANY_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	MARCH_2026,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MUTATE_COMMAND = WRITE_COMMAND;

const createDraft = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	period: string
): Promise<string> => {
	const created = await writeRows(session, 'payroll_runs', 'create', [
		{ company_id: COMPANY_ID, period }
	]);
	assert.ok(
		created.status >= 200 && created.status < 300,
		`${MUTATE_COMMAND} create ${period} returned ${created.status}: ${JSON.stringify(created.value)}`
	);
	requireAccepted(created.value, `${MUTATE_COMMAND} create ${period}`);
	return createdIds(created.value)[0]!;
};

/**
 * Public-seed integration deletes two draft payroll runs in one `collections.write` graph.
 * One request, one delete action naming two ids — the same batch path every write uses.
 *
 * Deleting a draft is the settlement lock's release: every source the run sealed — work days,
 * claims, leave entries, loan repayments — is free again, and every allowance entry the run priced
 * is gone with its slip. Each family the seed can seal is proven sealed first, so an empty capture
 * cannot pass for a release.
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
				(id, company_id, period, settings_id, configuration_hash,
				 calculation_version, pay_date, attendance_from, attendance_to, holidays)
				select $1, company_id, $2, settings_id, configuration_hash,
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
				 join payslips p on p.id = w.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'claim_request', c.id
				 from claim_requests c
				 join payslips p on p.id = c.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'allowance_entry', a.id
				 from allowance_entries a
				 join payslips p on p.id = a.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'leave_request', l.id
				 from leave_entries l
				 join payslips p on p.id = l.payslip_id
				 where p.payroll_run_id in ($1, $2)
				 union all
				 select 'loan_repayment', rp.id
				 from loan_repayments rp
				 join payslips p on p.id = rp.payslip_id
				 where p.payroll_run_id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly kind: string; readonly source_id: string }>;

			// The seal is proven before its release: the public seed pays a standing allowance, so
			// the drafts must have priced its entries (the seed carries no rostered days, claims,
			// leave or loans inside these periods; the Bolt runtime's own test proves the release of
			// a pinned row).
			for (const kind of ['allowance_entry'])
				assert.ok(
					captured.some((row) => row.kind === kind),
					`the drafts sealed no ${kind}; the release below would prove nothing`
				);

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

			const deleted = await writeRows(
				session,
				'payroll_runs',
				'delete',
				[{ id: februaryId }, { id: marchId }],
				undefined,
				versions.map((row) => observedVersion('payroll_runs', row.id, row.row_version))
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
				 where payslip_id is not null and id = any($1::uuid[])
				 union all
				 select 'claim_request', id
				 from claim_requests
				 where payslip_id is not null and id = any($1::uuid[])
				 union all
				 select 'leave_request', id
				 from leave_entries
				 where payslip_id is not null and id = any($1::uuid[])
				 union all
				 select 'loan_repayment', id
				 from loan_repayments
				 where payslip_id is not null and id = any($1::uuid[])`,
				[captured.map((row) => row.source_id)]
			)) as ReadonlyArray<{ readonly kind: string; readonly source_id: string }>;
			assert.deepEqual(
				leftoverCaptures,
				[],
				`expected cascade to drop capture junctions, got ${JSON.stringify(leftoverCaptures)}`
			);

			const sourceTable = {
				work_day: 'work_days',
				claim_request: 'claim_requests',
				leave_request: 'leave_entries',
				loan_repayment: 'loan_repayments'
			} as const;
			for (const row of captured) {
				// The entries a run priced from a standing allowance are the slip's own rows: they go
				// with it, and the standing allowance is due again for the next run.
				if (row.kind === 'allowance_entry') {
					const surviving = (await session.query(`select id from allowance_entries where id = $1`, [
						row.source_id
					])) as ReadonlyArray<{ readonly id: string }>;
					assert.deepEqual(
						surviving,
						[],
						`deleting a draft run must delete entry ${row.source_id}`
					);
					continue;
				}
				const table = sourceTable[row.kind as keyof typeof sourceTable];
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
