import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { currentDate } from '../lib/clock.js';
import { reviewAssignmentSuspicion } from './suspicion-review.js';

const MAX_ASSIGNMENTS_PER_RUN = 500;

const InputSchema = Schema.Struct({
	/** Manual runs may target one active assignment; scheduled runs omit it. */
	assignment_id: Schema.optionalKey(Schema.String.check(Schema.isUUID()))
});

const OutputSchema = Schema.Struct({
	reviewed_at: Schema.String,
	assignment_count: Schema.Number,
	counts: Schema.Record(Schema.String, Schema.Number)
});

export default defineAutomation(
	{ schedule: '0 * * * *' },
	{
		input: InputSchema,
		output: OutputSchema,
		policies: ['suspicion_review_automation'],
		description:
			'Hourly and on manual request, reviews non-completed assignments with AI and creates an idempotent suspicion log only when the model judges the combined evidence suspicious.',
		handler: (api, { args }) =>
			Effect.gen(function* () {
				yield* api.progress({ progress: 0.02, text: 'Loading active assignments' });
				const assignments = yield* api.db.query.job_assignments.findMany({
					where:
						args.assignment_id == null
							? {
									AND: [
										{ suspicion_checked_at: { isNull: true } },
										{ OR: [{ status: { notIn: ['completed'] } }, { status: { isNull: true } }] }
									]
								}
							: {
									id: { eq: args.assignment_id },
									suspicion_checked_at: { isNull: true },
									OR: [{ status: { notIn: ['completed'] } }, { status: { isNull: true } }]
								},
					columns: {
						id: true,
						job_id: true,
						status: true,
						summary: true,
						location: true,
						suspicion_checked_at: true
					},
					limit: args.assignment_id == null ? MAX_ASSIGNMENTS_PER_RUN : 1
				});
				const counts: Record<string, number> = {};
				for (const [index, assignment] of assignments.entries()) {
					yield* api.progress({
						progress: assignments.length === 0 ? 0.9 : 0.05 + (index / assignments.length) * 0.9,
						text: `Reviewing assignment ${index + 1} of ${assignments.length}`
					});
					const result = yield* reviewAssignmentSuspicion(api, assignment);
					yield* api.db.job_assignments.update(assignment.id, {
						suspicion_checked_at: (yield* currentDate).toISOString()
					});
					counts[result.status] = (counts[result.status] ?? 0) + 1;
				}
				yield* api.progress({ progress: 1, text: 'Suspicion review complete' });
				return {
					reviewed_at: (yield* currentDate).toISOString(),
					assignment_count: assignments.length,
					counts
				};
			})
	}
);
