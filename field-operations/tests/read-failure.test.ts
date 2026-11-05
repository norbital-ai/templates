import { DbError } from '@norbital-ai/bolt/engine';
import { Effect } from 'effect';
import { expect, it, vi } from '@effect/vitest';
import { rows, siteWithJob, workspace } from './kit.ts';
import { present } from './test-runtime.js';
it.live('a failed batched facts read writes no review or finding and schedules retry', () =>
	Effect.gen(function* () {
		const t = yield* workspace({ now: '2026-09-25T10:07:00.000Z' });
		const { job } = yield* siteWithJob(t);
		const read = t.db.read;
		let failures = 0;
		const failedRead = vi.spyOn(t.db, 'read').mockImplementation((statements) => {
			if (
				statements.some(({ text }) =>
					['sites', 'communication_logs'].every((table) => text.includes(`FROM "${table}"`))
				)
			) {
				failures++;
				return Effect.fail(
					new DbError({ sqlstate: 'XX000', message: 'Fixture batched facts read failure' })
				);
			}
			return read(statements);
		});
		yield* t.runDue().pipe(Effect.ensuring(Effect.sync(() => failedRead.mockRestore())));
		expect(failures).toBe(1);
		expect(yield* rows(t, 'SELECT count(*)::int AS n FROM suspicion_reviews')).toEqual([{ n: 0 }]);
		expect(yield* rows(t, 'SELECT count(*)::int AS n FROM suspicious_activity_logs')).toEqual([
			{ n: 0 }
		]);
		expect(
			yield* rows(t, 'SELECT suspicion_checked_at FROM job_assignments WHERE id = $1', [job])
		).toEqual([{ suspicion_checked_at: null }]);
		expect(
			yield* rows(
				t,
				"SELECT due_at::text AS due, state FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND key = 'suspicion_retry'"
			)
		).toEqual([{ due: expect.stringMatching(/^2026-09-25 12:00:00/), state: 'queued' }]);
		// filing the job ran its effect, which scheduled the review
		expect(
			yield* rows(
				t,
				"SELECT cause, state FROM sys_run WHERE automation = 'job_assignments.effect.created'"
			)
		).toEqual([{ cause: 'effect', state: 'succeeded' }]);
		const failed = yield* rows(
			t,
			"SELECT state, error::text AS error FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND cause = 'schedule' AND state = 'failed'"
		);
		expect(failed).toEqual([
			{ state: 'failed', error: expect.stringContaining('Fixture batched facts read failure') }
		]);
		expect(present(failed[0]).error).not.toContain('unawaited');
	})
);
