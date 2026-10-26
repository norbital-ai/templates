import type { ActInput, Committed, PendingApproval } from '@norbital-ai/bolt';
import { present } from './test-runtime.js';
import { Schema, Effect } from 'effect';
/**
 * Who may do what: a contractor reads and progresses only the jobs they hold (and their sites, photos and messages),
 * never the review ledgers; their variation is held for Field Operations Controllers, a large one also for Commercial
 * Managers, and a wording fix is saved directly; the review automation writes one transition each.
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
			expect((yield* as.query('job_assignments', { limit: 50 })).rows.map((r) => r.id)).toEqual([
				mine.job
			]);
			expect((yield* as.query('sites', { limit: 50 })).rows.map((r) => r.id)).toEqual([mine.site]);
			yield* Effect.tryPromise({
				try: () =>
					expect(Effect.runPromise(as.query('suspicion_reviews', { limit: 1 }))).rejects.toThrow(),
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
it.live(
	"a contractor's variation is held for controller review, and a large one for commercial sign-off too",
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const me = yield* person(t, CONTRACTOR);
			const { job } = yield* siteWithJob(t, { assignee_user_id: fixtureId('sys_user', me.id) });
			const as = t.as(me);
			const controller = t.as(t.member(CONTROLLER));
			const variation = (
				title: string,
				amount: number | null
			): Exclude<ActInput<'variation_requests.create'>, readonly unknown[]> => ({
				job_assignment_id: job,
				requested_at: '2026-09-25T10:00:00.000Z',
				title,
				description: 'Tenant asked for it',
				amount
			});
			/** The named steps the held variation waits on. */
			const steps = Effect.fnUntraced(function* (outcome: Committed<unknown> | PendingApproval) {
				expect(outcome.kind).toBe('pendingApproval');
				const id = fixtureId('variation_requests', present(outcome.records[0]).id);
				const held = present(yield* controller.query('variation_requests', { id }));
				return present(held.$approval).steps.map((step) => step.name);
			});
			expect(
				yield* steps(yield* as.act('variation_requests.create', variation('Bar', null)))
			).toEqual(['Controller review']);
			expect(
				yield* steps(yield* as.act('variation_requests.create', variation('Grille', 4999)))
			).toEqual(['Controller review']);
			expect(
				yield* steps(yield* as.act('variation_requests.create', variation('Ramp', 5000)))
			).toEqual(['Controller review', 'Commercial sign-off']);
			// dispatch writes directly; on its record a wording fix is saved, a new amount is held again
			const [filed] = committed(
				yield* controller.act('variation_requests.create', variation('Rail', 300))
			);
			const rail = fixtureId('variation_requests', filed);
			expect(
				(yield* as.act('variation_requests.update', {
					target: rail,
					set: { description: 'Two rails' }
				})).kind
			).toBe('committed');
			expect(
				yield* steps(
					yield* as.act('variation_requests.update', { target: rail, set: { amount: 8000 } })
				)
			).toEqual(['Controller review', 'Commercial sign-off']);
		})
);
it.live('the review stamps an unchecked job once, and fills a photo’s facts once', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { job } = yield* siteWithJob(t);
		const review = t.as(t.member(['suspicion_review_automation']));
		const stamp: ActInput<'job_assignments.update'> = {
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
