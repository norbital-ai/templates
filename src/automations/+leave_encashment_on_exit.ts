import { defineAutomation, refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { stint } from '../lib/employment-contract.js';
import { readLeaveContext } from '../lib/leave/context.js';
import { exitEncashments, NO_AUTOMATIC_ENCASHMENT_EXIT } from '../lib/leave/exit-encashment.js';
import { leaveBalanceSummaries } from '../lib/leave/summary.js';

const OutputSchema = Schema.Struct({
	employment_id: Schema.String,
	status: Schema.Literals(['open', 'dismissal', 'nothing_to_encash', 'raised']),
	/** The entries this run raised, awaiting the HR Manager's decision. */
	raised: Schema.Array(
		Schema.Struct({ code: Schema.String, days: Schema.Number, reference: Schema.String })
	)
});

/**
 * Off-boarding raises the leaver's encashment. When a contract closes, every encashable leave type
 * with a balance on the last day becomes one `ENCASHMENT` entry for the whole balance, keyed
 * `exit:<employment>:<code>` so a re-run, a later departure-note edit or the off-boarding form
 * having posted it first never raises a second one. The entry goes through the ordinary HR leave
 * door under this automation's own policy, so it lands held for the HR Manager (or Senior
 * Management), who approves it into the next regular payroll — priced there at the ordinary day
 * wage — or rejects it and enters the agreed figure by hand. A dismissal raises nothing: the
 * misconduct exception is HR's call, not the engine's. A zero balance raises nothing and alerts
 * nobody.
 */
export const runLeaveEncashmentOnExit = (api: AutomationApi, employmentId: string) =>
	Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } },
			columns: { id: true, employee_number: true, effective_range: true, exit_reason: true }
		});
		if (employment == null) refuse(`No employment contract is named ${employmentId}.`);
		const { exit_date, exit_reason } = stint(employment);
		if (exit_date == null)
			return { employment_id: employmentId, status: 'open' as const, raised: [] };
		if (exit_reason === NO_AUTOMATIC_ENCASHMENT_EXIT)
			return { employment_id: employmentId, status: 'dismissal' as const, raised: [] };
		yield* api.progress({ progress: 0.2, text: `Reading ${employment.employee_number} balances` });
		const context = yield* readLeaveContext(api, [employmentId]);
		const submissions = exitEncashments({
			employmentId,
			exitDate: exit_date,
			summaries: leaveBalanceSummaries(context, employmentId, exit_date),
			encashable: new Set(context.catalogues.flatMap((row) => (row.can_encash ? [row.id] : []))),
			posted: new Set(
				context.entries.flatMap((row) =>
					row.employment_id === employmentId ? [row.reference] : []
				)
			),
			reason: `Unused leave on departure ${exit_date}; raised for HR review.`
		});
		if (submissions.length === 0)
			return { employment_id: employmentId, status: 'nothing_to_encash' as const, raised: [] };
		yield* api.progress({ progress: 0.6, text: `Raising ${submissions.length} encashment(s)` });
		const rows = yield* api.collection.leave_entries.createMany(submissions);
		return {
			employment_id: employmentId,
			status: 'raised' as const,
			raised: rows.map((row) => ({
				code: row.leave_code,
				days: row.encash_days ?? 0,
				reference: row.reference
			}))
		};
	});

export default defineAutomation(
	{ trigger: { collection: 'employments', event: 'updated' } },
	{
		input: Schema.Struct({
			/** The contract to settle, when started by hand; the changed contract otherwise. */
			employment_id: Schema.optional(Schema.String)
		}),
		output: OutputSchema,
		policies: ['leave_encashment_on_exit_automation'],
		description:
			'When an employment contract closes, raises one ENCASHMENT leave entry per encashable leave type for the leaver’s unused balance on the last day, held for the HR Manager to approve into the next payroll or reject. Keyed per contract, so it never raises twice; a dismissal raises nothing.',
		handler: (api, { args, scope }) =>
			runLeaveEncashmentOnExit(api, args.employment_id ?? scope.incoming_record.id)
	}
);
