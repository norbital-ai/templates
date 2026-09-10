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
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

test(
	'payroll freezes inputs, refuses nested payment writes, retains paid output and refuses a second payroll for the same period',
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
			const createRun = async (id: string, period = '2026-01') =>
				command({
					action: 'mutate',
					collection: 'payroll_runs',
					rows: [
						{
							action: 'create',
							values: { id, company_id: COMPANY_ID, period }
						}
					]
				});
			const competingIds = [crypto.randomUUID(), crypto.randomUUID()];
			const competing = await Promise.all(competingIds.map((id) => createRun(id)));
			const accepted = competing.flatMap((result, index) =>
				asRecord(result.value, 'concurrent payroll').resolution === 'accepted' ? [index] : []
			);
			assert.equal(accepted.length, 1, JSON.stringify(competing.map((row) => row.value)));
			const runId = competingIds[accepted[0]];
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
			const [stored] = await session.query('select * from payroll_runs where id = $1', [runId]);
			assert.equal(stored.lifecycle, 'PAID');
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
			const duplicate = await createRun(crypto.randomUUID());
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
	'departure creates no payout; approved manual encashment settles once in a later regular payroll',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('manual-departure');
		try {
			const employmentId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
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
			const [contract] = await session.query('select row_version from employments where id = $1', [
				employmentId
			]);
			requireAccepted(
				(
					await command(
						{
							action: 'mutate',
							collection: 'employments',
							rows: [
								{
									action: 'update',
									values: { id: employmentId, exit_date: '2026-02-10', exit_reason: 'MISCONDUCT' }
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

			assert.equal(
				(
					await session.query('select id from leave_entries where employment_id = $1', [
						employmentId
					])
				).length,
				0
			);
			const entryId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'leave_entries',
						rows: [
							{
								action: 'create',
								values: {
									id: entryId,
									employment_id: employmentId,
									leave_catalogue_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
									reference: 'MANUAL-DEPARTURE-1',
									certificate_file: null,
									event: {
										kind: 'ENCASHMENT',
										source_window: { start: '2026-01-01', end: '2026-12-31' },
										days: 2,
										gross_amount: { currency: 'MYR', value: 200 },
										rate: 100,
										effective_on: '2026-03-01',
										due_on: '2026-03-10',
										reason: 'Explicit HR settlement decision'
									}
								}
							}
						]
					})
				).value,
				'manual encashment'
			);
			const runId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: {
									id: runId,
									company_id: COMPANY_ID,
									period: '2026-03'
								}
							}
						]
					})
				).value,
				'March regular payroll'
			);
			const [slip] = await session.query(
				'select id, gross, base from payslips where payroll_run_id = $1 and employment_id = $2',
				[runId, employmentId]
			);
			assert.ok(slip);
			assert.equal(Number(slip.gross), 200);
			assert.deepEqual(slip.base, []);
			assert.equal(
				(
					await session.query(
						'select id from payslip_leave_inputs where leave_entry_id = $1 and payslip_id = $2',
						[entryId, slip.id]
					)
				).length,
				1
			);
			const [run] = await session.query('select row_version from payroll_runs where id = $1', [
				runId
			]);
			requireAccepted(
				(
					await command(
						{
							action: 'mutate',
							collection: 'payroll_runs',
							rows: [{ action: 'update', values: { id: runId, lifecycle: 'PAID' } }]
						},
						[
							{
								row: { collection: 'payroll_runs', recordId: runId },
								rowVersion: Number(run.row_version)
							}
						]
					)
				).value,
				'settle March'
			);
			const nextId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'payroll_runs',
						rows: [
							{
								action: 'create',
								values: {
									id: nextId,
									company_id: COMPANY_ID,
									period: '2026-04'
								}
							}
						]
					})
				).value,
				'April regular payroll'
			);
			assert.equal(
				(
					await session.query(
						'select id from payslips where payroll_run_id = $1 and employment_id = $2',
						[nextId, employmentId]
					)
				).length,
				0
			);
			assert.equal(
				(
					await session.query('select id from leave_entries where employment_id = $1', [
						employmentId
					])
				).length,
				1
			);
		} finally {
			await session.stop();
		}
	}
);
