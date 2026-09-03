import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
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
			action: 'create',
			collection: 'payroll_runs',
			values: {
				id: payrollRunId,
				company_id: COMPANY_ID,
				period
			}
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

			const deleted = await postGuestCommand(
				session.host.baseUrl,
				MUTATE_COMMAND,
				mutationPush(session.schemaFingerprint, {
					action: 'delete',
					collection: 'payroll_runs',
					ids: [februaryId, marchId]
				}),
				{ authorization: `Bearer ${session.credential}` }
			);
			assert.ok(
				deleted.status >= 200 && deleted.status < 300,
				`${MUTATE_COMMAND} delete returned ${deleted.status}: ${JSON.stringify(deleted.value)}`
			);
			requireAccepted(deleted.value, `${MUTATE_COMMAND} delete`);

			const remaining = (await session.query(
				`select id from payroll_runs where id in ($1, $2)`,
				[februaryId, marchId]
			)) as ReadonlyArray<{ readonly id: string }>;
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
		} finally {
			await session.stop();
		}
	}
);
