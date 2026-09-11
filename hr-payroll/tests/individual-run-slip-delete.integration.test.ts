import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationPush, postGuestCommand, requireAccepted } from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	FEBRUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const MUTATE = 'collections.mutate';

/**
 * A run pays everyone eligible, and the payslips it writes are engine output: a person may delete
 * one while it is unpaid, whatever the run's lifecycle says, and a paid one is refused.
 *
 * This exercises the sequence an operator asked for — build a run, then remove one person's slip —
 * through the same guest command the app uses.
 */
test(
	'a run can be built, then one of its unpaid payslips deleted individually',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-individual-slip-delete');
		const headers = { authorization: `Bearer ${session.credential}` };
		const command = (
			body: Parameters<typeof mutationPush>[1],
			bases: Parameters<typeof mutationPush>[2] = []
		) =>
			postGuestCommand(
				session.host.baseUrl,
				MUTATE,
				mutationPush(session.schemaFingerprint, body, bases),
				headers
			);
		try {
			const runId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: { id: runId, company_id: COMPANY_ID, period: FEBRUARY_2026 }
							}
						]
					})
				).value,
				'create a run'
			);

			const slips = (await session.query(
				'select id, row_version, paid_at from payslips where payroll_run_id = $1 order by employment_id',
				[runId]
			)) as ReadonlyArray<{
				readonly id: string;
				readonly row_version: number;
				readonly paid_at: string | null;
			}>;
			assert.ok(slips.length > 0, 'the run produced no payslips to delete');
			const victim = slips[0]!;
			assert.equal(victim.paid_at, null, 'a freshly built slip is unpaid');

			requireAccepted(
				(
					await command({ action: 'delete', collection: 'payslips', ids: [victim.id] }, [
						{
							row: { collection: 'payslips', recordId: victim.id },
							rowVersion: victim.row_version
						}
					])
				).value,
				'delete one unpaid payslip'
			);

			const after = (await session.query('select id from payslips where payroll_run_id = $1', [
				runId
			])) as ReadonlyArray<{ readonly id: string }>;
			assert.equal(after.length, slips.length - 1, 'exactly one slip left with it');
			assert.ok(!after.some((row) => row.id === victim.id), 'the deleted slip is gone');
		} finally {
			await session.stop();
		}
	}
);
