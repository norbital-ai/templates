import { policy, type Id, type PolicyReads } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
const UNCHECKED = { suspicion_checked_at: { isNull: true } } as const;
const UNCHECKED_JOB = { job_assignment_id: { is: UNCHECKED } } as const;
/** Whether every named assignment is still unchecked (one read for the whole batch). */
const unchecked = Effect.fnUntraced(function* (
	db: PolicyReads,
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
			read: true,
			update: {
				columns: { job_assignments: ['suspicion_checked_at'] },
				check: function* (changes, ctx) {
					const twice = changes.findIndex(
						({ before, set }) =>
							before.suspicion_checked_at !== null || set.suspicion_checked_at == null
					);
					return twice < 0
						? ctx.allow()
						: ctx.deny('Only an unchecked assignment is stamped checked, once.', { row: twice });
				}
			}
		},
		sites: { read: true },
		photo_evidence: {
			read: true,
			update: {
				// a photo awaiting inspection, or a hashed one (seeded, bank-loaded) still without a scene
				check: function* (changes, ctx) {
					const settled = changes.findIndex(
						({ before }) => before.sha256 !== '' && before.scene_embedding !== null
					);
					return settled < 0
						? ctx.allow()
						: ctx.deny('Only a photo awaiting its facts or its scene is inspected.', {
								row: settled
							});
				}
			}
		},
		communication_logs: { read: { communication_logs: { where: UNCHECKED_JOB } } },
		suspicious_activity_logs: {
			read: { suspicious_activity_logs: { where: UNCHECKED_JOB } },
			create: {
				check: function* (rows, ctx) {
					const human = rows.findIndex((row) => row.origin !== 'automation');
					if (human >= 0)
						return ctx.deny('The review records automated judgements only.', {
							row: human,
							field: 'origin'
						});
					return (yield* unchecked(
						ctx.db,
						rows.map((row) => row.job_assignment_id)
					))
						? ctx.allow()
						: ctx.deny('Only an unchecked assignment is judged.', { field: 'job_assignment_id' });
				}
			}
		},
		suspicion_reviews: {
			read: { suspicion_reviews: { where: UNCHECKED_JOB } },
			create: {
				check: function* (rows, ctx) {
					return (yield* unchecked(
						ctx.db,
						rows.map((row) => row.job_assignment_id)
					))
						? ctx.allow()
						: ctx.deny('Only an unchecked assignment is reviewed.', { field: 'job_assignment_id' });
				}
			}
		}
	},
	limits: { act: '600/min', read: '600/min', agent: '500/h' }
});
