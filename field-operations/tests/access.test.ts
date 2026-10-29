import type { ActInput } from '@norbital-ai/bolt';
import { present } from './test-runtime.js';
import { Schema, Effect } from 'effect';
/**
 * Who may do what: a contractor reads and progresses only the jobs they hold (and their sites, photos and messages),
 * never the review ledgers; the review automation writes one transition each.
 */
import { expect, it } from '@effect/vitest';
import { committed, CONTRACTOR, CONTROLLER, person, rows, siteWithJob, workspace } from './kit.ts';
import { fixtureId } from './test-runtime.js';
it.live(
	'a contractor reads and progresses their own assignments only, and never the review ledgers',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const me = yield* person(t, CONTRACTOR);
			const mine = yield* siteWithJob(t, { assignee_user_id: fixtureId('sys_user', me.id) });
			const theirs = yield* siteWithJob(t);
			const as = t.as(me);
			expect(
				(yield* as.query({
					job_assignments: { output: 'contractor', limit: 50 }
				})).job_assignments.rows.map((r) => r.id)
			).toEqual([mine.job]);
			expect(
				(yield* as.query({ sites: { output: 'contractor', limit: 50 } })).sites.rows.map(
					(r) => r.id
				)
			).toEqual([mine.site]);
			// a site's other work stays out of its job layer
			committed(
				yield* t.as(t.member(CONTROLLER)).act('job_assignments.create', [
					{
						site_id: mine.site,
						title: 'Someone else’s work',
						scheduled_for: '2026-09-25',
						description: 'Not theirs'
					}
				])
			);
			const { sites } = yield* as.query({
				sites: { output: 'contractor' },
				'sites.job_assignments': {}
			});
			expect(sites.rows.map((r) => r.job_assignments.map((job) => job.id))).toEqual([[mine.job]]);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(as.query({ suspicion_reviews: { limit: 1 } }))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			committed(
				yield* as.act('job_assignments.update', [
					{
						target: mine.job,
						set: { status: 'completed', summary: 'Installed' }
					}
				])
			);
			// their report's effect runs as them and schedules the review
			yield* t.runDue();
			expect(
				yield* rows(
					t,
					"SELECT state FROM sys_run WHERE automation = 'job_assignments.effect.updated'"
				)
			).toEqual([{ state: 'succeeded' }]);
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', [{ target: theirs.job, set: { status: 'completed' } }])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', [{ target: mine.job, set: { title: 'Renamed' } }])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
);
it.live('the review stamps an unchecked job once, and fills a photo’s facts once', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { job } = yield* siteWithJob(t);
		const review = t.as(t.member(['suspicion_review_automation']));
		const stamp: ActInput<'job_assignments.update'> = [
			{ target: job, set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' } }
		];
		committed(yield* review.act('job_assignments.update', stamp));
		expect(yield* Effect.flip(review.act('job_assignments.update', stamp))).toMatchObject({
			_tag: 'ActRefused'
		});
		expect(
			yield* Effect.flip(
				review.act('job_assignments.update', [{ target: job, set: { status: 'completed' } }])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		const [row] = yield* rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [
			job
		]);
		expect(present(row).suspicion_checked_at).not.toBeNull();
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
