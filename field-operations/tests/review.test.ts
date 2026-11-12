import { present } from './test-runtime.js';
import { Effect, Layer, Stream } from 'effect';
/**
 * The suspicion review (L-TPL-field-operations-004/011/016) over the host's image facts and a scripted `sys_2` model:
 * filed photos are inspected (one the host cannot read is marked failed without blocking the review), an unchecked job is judged once and stamped, a suspicious judgement writes one finding
 * however often it is re-judged, and a change makes the job unread again.
 * A failed review re-queueing itself is `read-failure.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, layer } from '@effect/vitest';
import { Ai, Files, Port, type Json } from '@norbital-ai/bolt/engine';
import { Unavailable } from '@norbital-ai/bolt/errors';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import type { Id } from '@norbital-ai/bolt';
import { committed, CONTROLLER, rows, shared, siteWithJob, target, type T } from './kit.ts';
import { fixtureId } from './test-runtime.js';
const JPEG = readFileSync('tests/fixtures/photo-evidence.jpg');
/** Bytes the host's image decoder cannot read. */
const UNREADABLE = Buffer.from('not an image');
/** The current test's `sys_2` verdict, and the host calls it observed. */
let verdict: () => Json | Error = () => new Error('no verdict scripted');
const calls = { infer: 0, unreadable_reads: 0 };
const blobs = new Map<string, Uint8Array>();
/** The host's file store in memory: it counts the reads of the unreadable photo's bytes. */
const MemoryFiles = Layer.succeed(Files, {
	put: (bytes, meta) =>
		Effect.sync(() => {
			const key = crypto.randomUUID();
			blobs.set(key, bytes);
			return {
				key,
				bytes: bytes.byteLength,
				mime: meta.mime,
				sha256: createHash('sha256').update(bytes).digest('hex')
			};
		}),
	get: (key) =>
		Effect.suspend(() => {
			const bytes = blobs.get(key);
			if (bytes === undefined) return Port.unavailable('files', `Missing fixture blob ${key}`);
			if (UNREADABLE.equals(bytes)) calls.unreadable_reads += 1;
			return Effect.succeed(bytes);
		}),
	url: (key) => Effect.succeed(`memory://${key}`),
	remove: (key) =>
		Effect.sync(() => {
			blobs.delete(key);
		}),
	download: () => Port.unavailable('files', 'the review downloads nothing')
});
/** One model class, a deterministic scene vector per input, and the scripted `sys_2` verdict. */
const ScriptedAi = Layer.succeed(Ai, {
	ask: () => Port.unavailable('ai'),
	maxChoices: undefined,
	models: ['default'],
	catalog: Port.unavailable('ai'),
	infer: () =>
		Stream.suspend(() => {
			calls.infer += 1;
			const v = verdict();
			return v instanceof Error
				? Stream.fail(new Unavailable({ facility: 'ai', reason: v.message }))
				: Stream.make({
						_tag: 'Response' as const,
						response: {
							content: v,
							tool_calls: [],
							finish: 'stop' as const,
							usage: { input: 0, output: 0, cost: 0 }
						}
					});
		}),
	embed: (inputs, _model, dimensions = 256) =>
		Effect.succeed(
			inputs.map(() => Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0)))
		)
});
const scripted = shared({
	now: '2026-09-25T10:07:00.000Z',
	ports: Layer.mergeAll(MemoryFiles, ScriptedAi)
});
/** Photos filed under `job` in one act, as an upload each. */
const filedPhotos = Effect.fnUntraced(function* (
	t: T,
	job: Id<'job_assignments'>,
	files: readonly { readonly name: string; readonly bytes: Uint8Array }[]
) {
	const as = yield* t.as(t.admin);
	const photos = yield* Effect.forEach(files, ({ name, bytes }) =>
		as.upload('photo_evidence.photo', { name, mime: 'image/jpeg', bytes }).pipe(
			Effect.map((up) => {
				if (up.kind !== 'committed') throw new Error(JSON.stringify(up));
				return { job_assignment_id: job, photo: up.output };
			})
		)
	);
	const filed = yield* as.act({ 'photo_evidence.create': photos });
	if (filed.kind !== 'committed') throw new Error(JSON.stringify(filed));
	return filed.records.flatMap((record) =>
		record.model === 'photo_evidence' ? [fixtureId('photo_evidence', record.id)] : []
	);
});
const checkedAt = Effect.fnUntraced(function* (t: T, job: Id<'job_assignments'>) {
	return present(
		(yield* rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]
	).suspicion_checked_at;
});
const suspicious = {
	suspicious: true,
	reason: 'Two different door plates.',
	evidence_asset_name: 'IMG_0001.jpg'
};
layer(scripted)('suspicion review', (it) => {
	it.effect(
		'inspects the photos past one the host cannot read, judges the job once with one finding, and judges again after a change',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				verdict = () => suspicious;
				const { job } = yield* siteWithJob(t);
				const [photo, failed] = yield* filedPhotos(t, job, [
					{ name: 'IMG_0001.jpg', bytes: JPEG },
					{ name: 'IMG_0002.jpg', bytes: UNREADABLE }
				]);
				if (photo === undefined || failed === undefined) throw new Error('Two photos filed');
				yield* t.run_due();
				const [facts] = yield* rows(
					t,
					`SELECT source, source_key, sha256, photo->>'id' AS file, flags FROM photo_evidence WHERE id = $1`,
					[photo]
				);
				// a photo filed directly is a workspace upload under its assignment
				expect(facts).toMatchObject({
					source: { kind: 'workspace_upload' },
					source_key: `workspace:${present(facts).file}`,
					sha256: createHash('sha256').update(JPEG).digest('hex'),
					flags: ['missing_geolocation']
				});
				// the unreadable photo does not block the review and stays visibly failed after one attempt
				const [failure] = yield* rows(
					t,
					`SELECT inspection_failed_at, inspection_failure_reason FROM photo_evidence WHERE id = $1`,
					[failed]
				);
				expect(present(failure).inspection_failed_at).not.toBeNull();
				expect(String(present(failure).inspection_failure_reason)).toContain('JPEG, PNG and HEIC');
				expect(calls.unreadable_reads).toBe(1);
				expect(yield* checkedAt(t, job)).not.toBeNull();
				const logs = () =>
					rows(
						t,
						`SELECT origin, evidence_id, reason FROM suspicious_activity_logs WHERE job_assignment_id = $1`,
						[job]
					);
				expect(yield* logs()).toEqual([
					{ origin: 'automation', evidence_id: photo, reason: 'Two different door plates.' }
				]);
				expect(calls.infer).toBe(1);
				committed(
					yield* (yield* t.as(t.member(CONTROLLER))).act({
						'job_assignments.update': [
							{
								target: yield* target(t, 'job_assignments', job),
								set: { summary: 'Installed two bars' }
							}
						]
					})
				);
				expect(yield* checkedAt(t, job)).toBeNull();
				yield* t.run_due();
				expect(yield* checkedAt(t, job)).not.toBeNull();
				expect(calls.infer).toBe(2);
				expect(yield* logs()).toHaveLength(1); // the open finding stands; no second one
			})
	);
});
