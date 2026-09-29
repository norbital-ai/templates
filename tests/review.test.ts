/**
 * The suspicion review (L-TPL-field-operations-004/011/016) over the host's image facts and a scripted `sys_2` model:
 * a filed photo is inspected, an unchecked job is judged once and stamped, a suspicious judgement writes one finding
 * however often it is re-judged, a change makes the job unread again, and a failed turn stamps nothing and re-queues
 * the review at the next quarter hour.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, CONTROLLER, rows, siteWithJob, workspace, type T } from './kit.ts';

type Call = { facility: string; method: string; args: readonly Json[] };
/** The host's facilities, faked: image facts from the file's id, sizes, and one scripted verdict. */
function facilities(
	verdict: () => Json | Error,
	unreadable: (ref: { id: string; name: string }) => boolean = () => false
) {
	const calls: Call[] = [];
	const facility = async (call: Call) => {
		calls.push(call);
		const ref = call.args[0] as { id: string; name: string } | undefined;
		if (call.facility === 'files' && call.method === 'image') {
			if (unreadable(ref!))
				return {
					ok: false as const,
					error: { kind: 'invalid' as const, message: 'The image could not be read.' }
				};
			return {
				ok: true as const,
				value: {
					format: 'jpeg',
					width: 1440,
					height: 1920,
					sha256: `sha-${ref!.id}`,
					pdq: '0'.repeat(63) + '1',
					exif: {}
				}
			};
		}
		if (call.facility === 'files' && call.method === 'meta')
			return { ok: true as const, value: { ...ref, bytes: 1_000, sha256: 'x' } };
		if (call.facility === 'ai' && call.method === 'sys_2.infer') {
			const v = verdict();
			return v instanceof Error
				? { ok: false as const, error: { kind: 'upstream' as const, message: v.message } }
				: { ok: true as const, value: v };
		}
		return {
			ok: false as const,
			error: { kind: 'unavailable' as const, facility: call.facility, reason: 'fake' }
		};
	};
	return { calls, facility };
}

async function filedPhoto(t: T, job: string) {
	const as = t.as(t.admin);
	const up = await as.upload('photo_evidence.photo', {
		name: 'IMG_0001.jpg',
		mime: 'image/jpeg',
		bytes: readFileSync('tests/fixtures/photo-evidence.jpg')
	});
	return committed(
		await as.act('photo_evidence.create', {
			job_assignment_id: job,
			photo: (up as { output: Json }).output
		})
	)[0]!;
}
const suspicious = {
	suspicious: true,
	reason: 'Two different door plates.',
	evidence_asset_name: 'IMG_0001.jpg'
};
const clear = { suspicious: false, reason: 'No usable photo.', evidence_asset_name: '' };

it('inspects the photo, judges the job once, writes one finding, and judges again after a change', async () => {
	const fake = facilities(() => suspicious);
	const t = await workspace({ runs: { facility: fake.facility as never } });
	const { job } = await siteWithJob(t);
	const photo = await filedPhoto(t, job);
	await t.runDue();
	const [facts] = await rows(t, `SELECT sha256, flags FROM photo_evidence WHERE id = $1`, [photo]);
	const [file] = await rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
		photo
	]);
	expect(facts).toMatchObject({ sha256: `sha-${file!['id']}`, flags: ['missing_geolocation'] });
	const checked = async () =>
		(await rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]![
			'suspicion_checked_at'
		];
	expect(await checked()).not.toBeNull();
	const logs = async () =>
		rows(
			t,
			`SELECT origin, evidence_id, reason FROM suspicious_activity_logs WHERE job_assignment_id = $1`,
			[job]
		);
	expect(await logs()).toEqual([
		{ origin: 'automation', evidence_id: photo, reason: 'Two different door plates.' }
	]);
	expect(fake.calls.filter((c) => c.method === 'sys_2.infer')).toHaveLength(1);

	committed(
		await t
			.as(t.member(CONTROLLER))
			.act('job_assignments.update', { target: job, set: { summary: 'Installed two bars' } })
	);
	expect(await checked()).toBeNull();
	await t.runDue();
	expect(await checked()).not.toBeNull();
	expect(fake.calls.filter((c) => c.method === 'sys_2.infer')).toHaveLength(2);
	expect(
		await rows(t, `SELECT id FROM suspicion_reviews WHERE job_assignment_id = $1`, [job])
	).toHaveLength(2);
	expect(await logs()).toHaveLength(1); // the open finding stands; no second one
});

it('a photo the host cannot read does not block its assignment and stays visibly failed', async () => {
	const unreadable = new Set<string>();
	const fake = facilities(
		() => clear,
		(ref) => unreadable.has(ref.id)
	);
	const t = await workspace({ runs: { facility: fake.facility as never } });
	const { job } = await siteWithJob(t);
	const photo = await filedPhoto(t, job);
	const [file] = await rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
		photo
	]);
	unreadable.add(String(file!['id']));
	await t.runDue();
	// the review proceeds on the evidence it has instead of waiting forever
	expect(
		(await rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]![
			'suspicion_checked_at'
		]
	).not.toBeNull();
	expect(
		await rows(t, `SELECT suspicious FROM suspicion_reviews WHERE job_assignment_id = $1`, [job])
	).toEqual([{ suspicious: false }]);
	const [failure] = await rows(
		t,
		`SELECT inspection_failed_at, inspection_failure_reason FROM photo_evidence WHERE id = $1`,
		[photo]
	);
	expect(failure!['inspection_failed_at']).not.toBeNull();
	expect(String(failure!['inspection_failure_reason'])).toContain('could not be read');
});

it('an unreadable photo is not inspected again by a later run', async () => {
	const unreadable = new Set<string>();
	const fake = facilities(
		() => clear,
		(ref) => unreadable.has(ref.id)
	);
	const t = await workspace({ runs: { facility: fake.facility as never } });
	const { job } = await siteWithJob(t);
	const failed = await filedPhoto(t, job);
	const [file] = await rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
		failed
	]);
	unreadable.add(String(file!['id']));
	const attempts = () =>
		fake.calls.filter(
			(call) =>
				call.facility === 'files' &&
				call.method === 'image' &&
				(call.args[0] as { id?: string } | undefined)?.id === file!['id']
		).length;
	await t.runDue();
	expect(attempts()).toBe(1);
	// a later photo is inspected while the failed one keeps its one attempt
	const later = await filedPhoto(t, job);
	await t.runDue();
	expect(attempts()).toBe(1);
	expect(
		(await rows(t, `SELECT sha256 FROM photo_evidence WHERE id = $1`, [later]))[0]!['sha256']
	).not.toBe('');
});

it('a failed turn stamps nothing and re-queues the review at the next quarter hour', async () => {
	const fake = facilities(() => new Error('provider down'));
	const t = await workspace({
		runs: { facility: fake.facility as never },
		now: '2026-09-25T10:07:00.000Z'
	});
	const { job } = await siteWithJob(t);
	await t.runDue();
	expect(
		(await rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]![
			'suspicion_checked_at'
		]
	).toBeNull();
	const queued = await rows(
		t,
		`SELECT due_at::text AS due, state FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND key = 'suspicion_retry'`
	);
	expect(queued).toEqual([{ due: expect.stringMatching(/^2026-09-25 10:15:00/), state: 'queued' }]);
	const [failed] = await rows(
		t,
		`SELECT state, error::text AS error FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND cause = 'created'`
	);
	expect(failed!['state']).toBe('failed');
	// the run names the cause it actually hit: a failed turn used to surface as the guest's own 'unawaited' complaint,
	// which named neither the provider nor the assignment
	expect(failed!['error']).toContain('provider down');
	expect(failed!['error']).not.toContain('unawaited');
});
