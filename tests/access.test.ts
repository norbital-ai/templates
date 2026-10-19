import { present } from './test-runtime.js';
import { Schema, Effect } from 'effect';
/**
 * Who may do what: a contractor reads and progresses only the jobs they hold (and their sites, photos and messages),
 * never the review ledgers; their variation is held for Field Operations Controllers; the review automation writes one
 * transition each.
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
			expect((yield* as.read('job_assignments', { limit: 50 })).rows.map((r) => r.id)).toEqual([
				mine.job
			]);
			expect((yield* as.read('sites', { limit: 50 })).rows.map((r) => r.id)).toEqual([mine.site]);
			yield* Effect.tryPromise({
				try: () =>
					expect(Effect.runPromise(as.read('suspicion_reviews', { limit: 1 }))).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			committed(
				yield* as.act('job_assignments.update', {
					target: mine.job,
					set: { status: 'completed', summary: 'Installed' }
				})
			);
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', { target: theirs.job, set: { status: 'completed' } })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', { target: mine.job, set: { title: 'Renamed' } })
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
);
it.live("a contractor's variation waits for a Field Operations Controllers decision", () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const me = yield* person(t, CONTRACTOR);
		const { job } = yield* siteWithJob(t, { assignee_user_id: fixtureId('sys_user', me.id) });
		const outcome = yield* t.as(me).act('variation_requests.create', {
			job_assignment_id: job,
			requested_at: '2026-09-25T10:00:00.000Z',
			title: 'Extra grab bar',
			description: 'Tenant asked for a second one'
		});
		expect(outcome.kind).toBe('pendingApproval');
		const controller = yield* t.as(t.member(CONTROLLER)).act('variation_requests.create', {
			job_assignment_id: job,
			requested_at: '2026-09-25T10:00:00.000Z',
			title: 'Ramp',
			description: 'Dispatch adds it'
		});
		expect(controller.kind).toBe('committed');
	})
);
it.live('the review stamps an unchecked job once, and fills a photo’s facts once', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { job } = yield* siteWithJob(t);
		const review = t.as(t.member(['suspicion_review_automation']));
		const stamp: import('@norbital-ai/bolt').ActInput<'job_assignments.update'> = {
			target: job,
			set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' }
		};
		committed(yield* review.act('job_assignments.update', stamp));
		expect(yield* Effect.flip(review.act('job_assignments.update', stamp))).toMatchObject({
			_tag: 'ActRefused'
		});
		expect(
			yield* Effect.flip(
				review.act('job_assignments.update', { target: job, set: { status: 'completed' } })
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
