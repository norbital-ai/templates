import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

test(
	'payroll freezes inputs, refuses nested payment writes, retains paid output and pays only an ad hoc difference',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-settlement');
		try {
			const headers = bearerHeaders(session.credential);
			const command = (
				body: Parameters<typeof mutationPush>[1],
				bases: Parameters<typeof mutationPush>[2] = []
			) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, body, bases),
					headers
				);
			const createRun = async (id: string, run_kind: 'REGULAR' | 'AD_HOC') =>
				command({
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{
							action: 'create',
							values: { id, company_id: COMPANY_ID, period: '2026-01', run_kind }
						}
					]
				});
			const runId = crypto.randomUUID();
			requireAccepted((await createRun(runId, 'REGULAR')).value, 'regular payroll');
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
			const refused = await command(
				{
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{
							action: 'update',
							values: {
								id: runId,
								lifecycle: 'PAID',
								payslip_payroll_run: initial.map((row) => ({ id: String(row.id), gross: 0 }))
							}
						}
					]
				},
				[
					...bases,
					...initial.map((row) => ({
						row: { collection: 'payslips', recordId: String(row.id) },
						rowVersion: Number(row.row_version)
					}))
				]
			);
			assert.match(JSON.stringify(refused.value), /cannot change its payslips/);
			const paidBody = mutationPush(
				session.schemaFingerprint,
				{
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{
							action: 'update',
							values: { id: runId, lifecycle: 'PAID' }
						}
					]
				},
				bases
			);
			const paid = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				paidBody,
				headers
			);
			requireAccepted(paid.value, 'mark paid');
			requireAccepted(
				(await postGuestCommand(session.host.baseUrl, 'collections.mutate', paidBody, headers))
					.value,
				'payment replay'
			);
			assert.deepEqual(
				await session.query('select * from payslips where payroll_run_id = $1 order by id', [
					runId
				]),
				initial
			);
			const [stored] = await session.query('select * from payroll_runs where id = $1', [runId]);
			assert.equal(stored.lifecycle, 'PAID');
			assert.deepEqual(stored.configuration_snapshot, run.configuration_snapshot);
			const removed = await command(
				{ action: 'delete', collection: 'payroll_runs', ids: [runId] },
				[
					{
						row: { collection: 'payroll_runs', recordId: runId },
						rowVersion: Number(stored.row_version)
					}
				]
			);
			assert.equal(
				asRecord(removed.value, 'paid delete').resolution,
				'rejected',
				JSON.stringify(removed.value)
			);
			const duplicate = await createRun(crypto.randomUUID(), 'REGULAR');
			assert.match(JSON.stringify(duplicate.value), /ad hoc/);
			// A fixture correction in the same month is additional monetary input, not a salary rewrite.
			await session.query(
				`insert into component_entries (employment_id, pay_component_id, amount, event_date, effective_range, event)
			values ($1, $2, 100, '2026-01-01', $3, $4)`,
				[
					EMPLOYMENT_ID,
					'77777777-7777-4777-8777-777777777777',
					{ start: '2026-01-01', end: '2026-01-31' },
					{ kind: 'ALLOWANCE' }
				]
			);
			const supplementId = crypto.randomUUID();
			const supplement = await createRun(supplementId, 'AD_HOC');
			requireAccepted(supplement.value, `ad hoc payroll: ${JSON.stringify(supplement.value)}`);
			const deltas = await session.query(
				'select employment_id, gross, base, proration from payslips where payroll_run_id = $1',
				[supplementId]
			);
			assert.equal(deltas.length, 4);
			assert.equal(
				deltas.reduce((sum, row) => sum + Number(row.gross), 0),
				100
			);
			assert.ok(
				deltas.every(
					(row) =>
						Array.isArray(row.base) &&
						row.base.length === 0 &&
						Array.isArray(row.proration) &&
						row.proration.length === 0
				)
			);
			assert.deepEqual(
				await session.query('select * from payslips where payroll_run_id = $1 order by id', [
					runId
				]),
				initial
			);
		} finally {
			await session.stop();
		}
	}
);
