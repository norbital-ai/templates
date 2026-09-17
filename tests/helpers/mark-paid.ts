// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Record payment the way it now lives: on each payslip of the run.
 *
 * A run carries no state of its own — payment is per slip, and the run's progress is read from
 * these. This replaces the old `payroll_runs.lifecycle = 'PAID'` write every integration test
 * used to make; a run-level gesture is exactly the thing that no longer exists.
 */
import { requireAccepted } from '@norbital-ai/test-utilities';
import { observedVersion, writeRows } from './write.ts';

type MarkPaidSession = Readonly<{
	readonly host: { readonly baseUrl: string };
	readonly credential: string;
	readonly schemaFingerprint: string;
	readonly query: (
		sql: string,
		params?: readonly unknown[]
	) => Promise<readonly Readonly<Record<string, unknown>>[]>;
}>;

export async function markRunPaid(session: MarkPaidSession, runId: string): Promise<void> {
	const slips = (await session.query(
		'select id, row_version, status from payslips where payroll_run_id = $1 order by id',
		[runId]
	)) as ReadonlyArray<{
		readonly id: string;
		readonly row_version: number;
		readonly status: string;
	}>;
	const unpaid = slips.filter((slip) => slip.status !== 'PAID');
	if (unpaid.length === 0) return;
	const result = await writeRows(
		session,
		'payslips',
		'update',
		unpaid.map((slip) => ({ id: slip.id, status: 'PAID', paid_at: new Date().toISOString() })),
		undefined,
		unpaid.map((slip) => observedVersion('payslips', slip.id, slip.row_version))
	);
	requireAccepted(result.value, `mark run ${runId} paid`);
}
