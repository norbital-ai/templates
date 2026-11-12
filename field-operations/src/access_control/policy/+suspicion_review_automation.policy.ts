import { policy, type Id, type WorkspaceQuery } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
const UNCHECKED = { suspicion_checked_at: { is_null: true } } as const;
const UNCHECKED_JOB = { job_assignment_id: { is: UNCHECKED } } as const;
/** Whether every named assignment is still unchecked (one read for the whole batch). */
const unchecked = Effect.fnUntraced(function* (
	db: WorkspaceQuery,
	ids: readonly Id<'job_assignments'>[]
) {
	const wanted = [...new Set(ids)];
	const { job_assignments } = yield* db.query({
		job_assignments: { where: { id: { in: wanted }, ...UNCHECKED }, fields: ['id'] }
	});
	return job_assignments.rows.length === wanted.length;
});
/**
 * The review run's authority. It inspects any photo still awaiting facts (so it reads every assignment, site
 * and photo), and judges only unchecked assignments: the private ledgers and messages it reads and appends
 * are scoped to those. Each write is one transition: a photo's facts once (stored with an empty hash or no scene), and
 * an unchecked job's stamp once.
 */
export default policy({
	description:
		'Inspects filed photos awaiting facts, reviews unchecked assignments, appends immutable suspicion evidence, and marks a completed review checked.',
	grants: {
		job_assignments: {
			outputs: { default: {} },
			update: {
				columns: { fields: ['suspicion_checked_at'] },
				verdict: function* (changes, ctx) {
					const twice = changes.findIndex(
						({ before, set }) =>
							before.suspicion_checked_at !== null || set.suspicion_checked_at == null
					);
					return twice < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.assignment_stamped_once', {
								row: twice
							});
				}
			}
		},
		sites: { outputs: { default: {} } },
		photo_evidence: {
			outputs: { default: {} },
			update: {
				// a photo awaiting inspection, or a hashed one (seeded, bank-loaded) still without a scene
				verdict: function* (changes, ctx) {
					const settled = changes.findIndex(
						({ before }) => before.sha256 !== '' && before.scene_embedding !== null
					);
					return settled < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.photo_already_inspected', {
								row: settled
							});
				}
			}
		},
		communication_logs: { outputs: { default: { where: UNCHECKED_JOB } } },
		suspicious_activity_logs: {
			outputs: { default: { where: UNCHECKED_JOB } },
			create: {
				verdict: function* (changes, ctx) {
					const rows = changes.map(({ set }) => set);
					const human = rows.findIndex((row) => row.origin !== 'automation');
					if (human >= 0)
						return yield* ctx.refuse('errors.review_automated_only', {
							row: human,
							field: 'origin'
						});
					return (yield* unchecked(
						ctx,
						rows.map((row) => row.job_assignment_id)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.assignment_already_judged', {
								field: 'job_assignment_id'
							});
				}
			}
		},
		suspicion_reviews: {
			outputs: { default: { where: UNCHECKED_JOB } },
			create: {
				verdict: function* (changes, ctx) {
					return (yield* unchecked(
						ctx,
						changes.map(({ set }) => set.job_assignment_id)
					))
						? ctx.allow()
						: yield* ctx.refuse('errors.assignment_already_reviewed', {
								field: 'job_assignment_id'
							});
				}
			}
		}
	},
	limits: { act: '600/min', read: '600/min', agent: '500/h' }
});
