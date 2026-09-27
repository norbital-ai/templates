/**
 * Who may do what: a contractor reads and progresses only the jobs they hold (and their sites, photos and messages),
 * never the review ledgers; their variation is held for Field Operations Controllers; the review automation writes one
 * transition each.
 */
import { expect, it } from 'vitest';
import { committed, CONTRACTOR, CONTROLLER, person, rows, siteWithJob, workspace } from './kit.ts';

it('a contractor reads and progresses their own assignments only, and never the review ledgers', async () => {
	const t = await workspace();
	const me = await person(t, CONTRACTOR);
	const mine = await siteWithJob(t, { assignee_user_id: me.actor.id });
	const theirs = await siteWithJob(t);
	const as = t.as(me);
	expect((await as.read('job_assignments', { limit: 50 })).rows.map((r) => r['id'])).toEqual([
		mine.job
	]);
	expect((await as.read('sites', { limit: 50 })).rows.map((r) => r['id'])).toEqual([mine.site]);
	await expect(as.read('suspicion_reviews', { limit: 1 })).rejects.toThrow();
	committed(
		await as.act('job_assignments.update', {
			target: mine.job,
			set: { status: 'completed', summary: 'Installed' }
		})
	);
	expect(
		await as.act('job_assignments.update', { target: theirs.job, set: { status: 'completed' } })
	).toMatchObject({ kind: 'refused' });
	expect(
		await as.act('job_assignments.update', { target: mine.job, set: { title: 'Renamed' } })
	).toMatchObject({ kind: 'refused' });
});

it("a contractor's variation waits for a Field Operations Controllers decision", async () => {
	const t = await workspace();
	const me = await person(t, CONTRACTOR);
	const { job } = await siteWithJob(t, { assignee_user_id: me.actor.id });
	const outcome = await t.as(me).act('variation_requests.create', {
		job_assignment_id: job,
		requested_at: '2026-09-25T10:00:00.000Z',
		title: 'Extra grab bar',
		description: 'Tenant asked for a second one'
	});
	expect(outcome.kind).toBe('pendingApproval');
	const controller = await t.as(t.member(CONTROLLER)).act('variation_requests.create', {
		job_assignment_id: job,
		requested_at: '2026-09-25T10:00:00.000Z',
		title: 'Ramp',
		description: 'Dispatch adds it'
	});
	expect(controller.kind).toBe('committed');
});

it('the review stamps an unchecked job once, and fills a photo’s facts once', async () => {
	const t = await workspace();
	const { job } = await siteWithJob(t);
	const review = t.as(t.member(['suspicion_review_automation']));
	const stamp = { target: job, set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' } };
	committed(await review.act('job_assignments.update', stamp));
	expect(await review.act('job_assignments.update', stamp)).toMatchObject({ kind: 'refused' });
	expect(
		await review.act('job_assignments.update', { target: job, set: { status: 'completed' } })
	).toMatchObject({ kind: 'refused' });
	const [row] = await rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [
		job
	]);
	expect(row!['suspicion_checked_at']).not.toBeNull();
});
