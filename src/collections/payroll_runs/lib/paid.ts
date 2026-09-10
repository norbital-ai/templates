import { Effect } from 'effect';

/**
 * A run's lifecycle is a reading of its payslips, not a fact of its own.
 *
 * Payment lives on the slip (`payslips.paid_at`). `payroll_runs.lifecycle` stays, because "is this
 * whole run settled" is a real question a dozen readers ask — a settlement lock, a leave charge, a
 * roster window — and none of them should have to count slips. It is `PAID` when every slip of the
 * run carries a payment and `DRAFT` while any does not, so a run that is half paid reads `DRAFT`:
 * the conservative answer, and the one that keeps every existing lock closed.
 *
 * A run with no payslips is `DRAFT`. "Nothing to pay" is not "paid", and the create path refuses
 * to mark an empty run paid for the same reason.
 */
const runLifecycleFromSlips = (
	slips: readonly { readonly paid_at: unknown }[]
): 'DRAFT' | 'PAID' =>
	slips.length > 0 && slips.every((slip) => slip.paid_at != null) ? 'PAID' : 'DRAFT';

/**
 * Promote one run to `PAID` once every slip it holds carries a payment.
 *
 * Promotion only. The run's own declared input permits `lifecycle: 'PAID'` and nothing else, and
 * that is right: a paid slip cannot be unpaid, and a paid slip cannot be deleted, so a run that has
 * reached `PAID` has no legitimate route back to `DRAFT`. A half-paid run simply stays `DRAFT`.
 */
export const promoteRunIfFullyPaid = (
	api: {
		readonly db: {
			readonly payslips: {
				readonly findMany: (query: {
					readonly where: { readonly payroll_run_id: { readonly eq: string } };
					readonly columns: { readonly paid_at: true };
					readonly limit: number;
				}) => Effect.Effect<readonly { readonly paid_at: unknown }[]>;
			};
			readonly payroll_runs: {
				readonly findFirst: (query: {
					readonly where: { readonly id: { readonly eq: string } };
					readonly columns: { readonly lifecycle: true };
				}) => Effect.Effect<{ readonly lifecycle: string } | null | undefined>;
				readonly mutate: (
					values: readonly { readonly id: string; readonly lifecycle?: 'PAID' | undefined }[]
				) => Effect.Effect<unknown>;
			};
		};
	},
	runId: string
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const slips = yield* api.db.payslips.findMany({
			where: { payroll_run_id: { eq: runId } },
			columns: { paid_at: true },
			limit: 20_000
		});
		if (runLifecycleFromSlips(slips) !== 'PAID') return;
		const run = yield* api.db.payroll_runs.findFirst({
			where: { id: { eq: runId } },
			columns: { lifecycle: true }
		});
		if (run != null && run.lifecycle !== 'PAID')
			yield* api.db.payroll_runs.mutate([{ id: runId, lifecycle: 'PAID' }]);
	});
