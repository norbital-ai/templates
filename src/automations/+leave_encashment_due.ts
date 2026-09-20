import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { getErrorMessage } from '@norbital-ai/std';
import { OutputSchema, runLeaveEncashmentOnExit } from './+leave_encashment_on_exit.js';

const CompletionSchema = Schema.Struct({ completed: Schema.Array(Schema.String) });

export default defineAutomation(
	{ schedule: '0 1 * * *' },
	{
		policies: ['leave_encashment_on_exit_automation'],
		description:
			'Daily catch-up for departures recorded in advance. Raises due leave encashment and separation requests for HR approval; existing requests are skipped.',
		output: Schema.Struct({
			checked: Schema.Number,
			raised: Schema.Number,
			failures: Schema.Array(Schema.String),
			completed: Schema.Array(Schema.String)
		}),
		handler: (api) =>
			Effect.gen(function* () {
				let after: string | undefined;
				let checked = 0;
				let raised = 0;
				const failures: string[] = [];
				const pending = new Set<string>();
				const settled = new Set<string>();
				const completed: string[] = [];
				for (;;) {
					const page = yield* api.db.automation_run.findMany({
						where: {
							name: { in: ['leave_encashment_on_exit', 'leave_encashment_due'] },
							status: { eq: 'done' },
							...(after == null ? {} : { id: { gt: after } })
						},
						columns: { id: true, name: true, result: true },
						orderBy: { id: 'asc' },
						limit: 200
					});
					for (const run of page) {
						if (run.name === 'leave_encashment_due') {
							const completion = Schema.decodeUnknownOption(CompletionSchema)(run.result);
							if (Option.isSome(completion))
								for (const id of completion.value.completed) settled.add(id);
							continue;
						}
						const outcome = Schema.decodeUnknownOption(OutputSchema)(run.result);
						if (Option.isNone(outcome)) continue;
						const employmentId = outcome.value.employment_id;
						if (outcome.value.status === 'not_due') pending.add(employmentId);
						else if (outcome.value.status !== 'open') settled.add(employmentId);
					}
					if (page.length < 200) break;
					after = page[page.length - 1]!.id;
				}
				// Read all completions first: run IDs do not establish chronological order. Once HR
				// received a due request, rejection or reversal must not make the scheduler raise it again.
				for (const employmentId of pending) {
					if (settled.has(employmentId)) continue;
					checked += 1;
					const result = yield* Effect.exit(runLeaveEncashmentOnExit(api, employmentId));
					if (Exit.isSuccess(result)) {
						raised += result.value.raised.length;
						if (result.value.status !== 'not_due') completed.push(employmentId);
					} else failures.push(`${employmentId}: ${getErrorMessage(Cause.squash(result.cause))}`);
				}
				yield* api.progress({
					progress: 1,
					text: `Contracts checked: ${checked}. Requests raised: ${raised}. Failures: ${failures.length}.`
				});
				return { checked, raised, failures, completed };
			})
	}
);
