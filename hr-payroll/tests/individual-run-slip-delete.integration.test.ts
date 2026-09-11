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

/**
 * The operator sequence: run for one person, decide to add more, and run for everyone.
 *
 * A period holds one run, so "add more" is a draft delete and a rebuild — the same period is free
 * again the moment the draft is gone, and the withheld person's inputs were never consumed.
 */
test(
	'a run for one person, deleted and rebuilt for everyone',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-partial-then-full');
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
			const employments = (await session.query(
				'select id from employments where company_id = $1 and approval_id is null order by employee_number',
				[COMPANY_ID]
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(
				employments.length >= 2,
				'a partial run needs at least two people to choose between'
			);
			const kept = employments[0]!.id;
			const withheld = employments
				.slice(1)
				.map((row) => ({ employment_id: row.id, reason: 'QA: partial run' }));

			const partialId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: { id: partialId, company_id: COMPANY_ID, period: FEBRUARY_2026, withheld }
							}
						]
					})
				).value,
				'create the per-person run'
			);
			const partialSlips = (await session.query(
				'select employment_id from payslips where payroll_run_id = $1',
				[partialId]
			)) as ReadonlyArray<{ readonly employment_id: string }>;
			assert.equal(partialSlips.length, 1, 'the per-person run paid exactly one person');
			assert.equal(partialSlips[0]!.employment_id, kept);

			const [draft] = (await session.query('select row_version from payroll_runs where id = $1', [
				partialId
			])) as ReadonlyArray<{ readonly row_version: number }>;
			requireAccepted(
				(
					await command({ action: 'delete', collection: 'payroll_runs', ids: [partialId] }, [
						{
							row: { collection: 'payroll_runs', recordId: partialId },
							rowVersion: draft!.row_version
						}
					])
				).value,
				'delete the per-person draft'
			);
			assert.deepEqual(
				await session.query('select id from payroll_runs where id = $1', [partialId]),
				[]
			);

			const fullId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: { id: fullId, company_id: COMPANY_ID, period: FEBRUARY_2026 }
							}
						]
					})
				).value,
				'rebuild the same period for everyone'
			);
			const fullSlips = (await session.query(
				'select employment_id from payslips where payroll_run_id = $1',
				[fullId]
			)) as ReadonlyArray<{ readonly employment_id: string }>;
			assert.equal(fullSlips.length, employments.length, 'the rebuilt run paid everyone');
		} finally {
			await session.stop();
		}
	}
);
