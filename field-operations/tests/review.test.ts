import { present } from './test-runtime.js';
import { Schema, Effect, Layer, Stream } from 'effect';
/**
 * The suspicion review (L-TPL-field-operations-004/011/016) over the host's image facts and a scripted `sys_2` model:
 * filed photos are inspected (one the host cannot read is marked failed without blocking the review), an unchecked job is judged once and stamped, a suspicious judgement writes one finding
 * however often it is re-judged, and a change makes the job unread again.
 * A failed review re-queueing itself is `read-failure.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { expect, layer, vi } from '@effect/vitest';
import {
	Ai,
	Facilities,
	type CrossAnswer,
	type FacilityCall,
	type Json
} from '@norbital-ai/bolt/engine';
import { Unavailable } from '@norbital-ai/bolt/errors';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import type { Id } from '@norbital-ai/bolt';
import { committed, CONTROLLER, rows, shared, siteWithJob, type T } from './kit.ts';
import { fixtureId } from './test-runtime.js';
/** A scripted host call: a facility crossing, or the model route's `sys_2` request as the port receives it. */
type ScriptedCall =
	| FacilityCall
	| {
			readonly _tag: 'ai.sys_2.infer';
			readonly args: readonly [Parameters<Ai['Service']['infer']>[0]];
	  };
type Script = (call: ScriptedCall) => Effect.Effect<CrossAnswer>;
const File = Schema.Struct({ id: Schema.String, name: Schema.String, mime: Schema.String });
const unavailable = (call: ScriptedCall): CrossAnswer => ({
	ok: false,
	error: { kind: 'unavailable', facility: call._tag, reason: 'fixture' }
});
/** The current test's host answers; an `unavailable` answer falls through to the native port. */
let script: Script = (call) => Effect.succeed(unavailable(call));
const scripted = Layer.effectDiscard(
	Effect.gen(function* () {
		const facilities = yield* Facilities;
		const native = facilities.dispatch;
		const spy = vi
			.spyOn(facilities, 'dispatch')
			.mockImplementation((call) =>
				script(call).pipe(
					Effect.flatMap((answer) =>
						!answer.ok && answer.error.kind === 'unavailable'
							? native(call)
							: Effect.succeed(answer)
					)
				)
			);
		// `ai.sys_2.infer` reaches automations through the host's model route, not facility dispatch; script it here so a
		// fixture keeps one verdict source.
		const ai = yield* Ai;
		const nativeInfer = ai.infer;
		const inferSpy = vi.spyOn(ai, 'infer').mockImplementation((request) =>
			Stream.unwrap(
				script({ _tag: 'ai.sys_2.infer', args: [request] }).pipe(
					Effect.map((answer): ReturnType<typeof nativeInfer> => {
						if (!answer.ok)
							return answer.error.kind === 'unavailable'
								? nativeInfer(request)
								: Stream.fail(new Unavailable({ facility: 'ai', reason: answer.error.message }));
						return Stream.make({
							_tag: 'Response' as const,
							response: {
								content: answer.value,
								toolCalls: [],
								finish: 'stop' as const,
								usage: { input: 0, output: 0, cost: 0 }
							}
						});
					})
				)
			)
		);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				spy.mockRestore();
				inferSpy.mockRestore();
			})
		);
	})
).pipe(Layer.provideMerge(shared({ now: '2026-09-25T10:07:00.000Z' })));
const vector = () => Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0));
/** The host's facilities, faked: image facts from the file's id, sizes, and one scripted verdict; installed as `script`. */
function facilities(
	verdict: () => Json | Error,
	unreadable: (ref: { id: string; name: string }) => boolean = () => false
) {
	const calls: ScriptedCall[] = [];
	script = (call) =>
		Effect.sync((): CrossAnswer => {
			calls.push(call);
			if (call._tag === 'files.image') {
				const ref = Schema.decodeUnknownSync(File)(call.args[0]);
				if (unreadable(ref))
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
						sha256: `sha-${ref.id}`,
						pdq: '0'.repeat(63) + '1',
						exif: {}
					}
				};
			}
			if (call._tag === 'files.meta')
				return {
					ok: true,
					value: { ...Schema.decodeUnknownSync(File)(call.args[0]), bytes: 1000, sha256: 'x' }
				};
			if (call._tag === 'ai.embed')
				return {
					ok: true,
					value: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(call.args[0]).map(vector)
				};
			if (call._tag === 'ai.sys_2.infer') {
				const v = verdict();
				return v instanceof Error
					? { ok: false as const, error: { kind: 'upstream' as const, message: v.message } }
					: { ok: true as const, value: v };
			}
			return unavailable(call);
		});
	return calls;
}
/** Photos filed under `job` in one act, as an upload each. */
const filedPhotos = Effect.fnUntraced(function* (
	t: T,
	job: Id<'job_assignments'>,
	names: string[]
) {
	const as = t.as(t.admin);
	const bytes = readFileSync('tests/fixtures/photo-evidence.jpg');
	const photos = yield* Effect.forEach(names, (name) =>
		as.upload('photo_evidence.photo', { name, mime: 'image/jpeg', bytes }).pipe(
			Effect.map((up) => {
				if (up.kind !== 'committed') throw new Error(JSON.stringify(up));
				return { job_assignment_id: job, photo: up.output };
			})
		)
	);
	const filed = yield* as.act('photo_evidence.create', photos);
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
				const unreadable = new Set<string>();
				const calls = facilities(
					() => suspicious,
					(ref) => unreadable.has(ref.id)
				);
				const { job } = yield* siteWithJob(t);
				const [photo, failed] = yield* filedPhotos(t, job, ['IMG_0001.jpg', 'IMG_0002.jpg']);
				if (photo === undefined || failed === undefined) throw new Error('Two photos filed');
				const [file] = yield* rows(
					t,
					`SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`,
					[failed]
				);
				const id = String(present(file).id);
				unreadable.add(id);
				yield* t.runDue();
				const [facts] = yield* rows(
					t,
					`SELECT source, source_key, sha256, photo->>'id' AS file, flags FROM photo_evidence WHERE id = $1`,
					[photo]
				);
				// a photo filed directly is a workspace upload under its assignment
				expect(facts).toMatchObject({
					source: { kind: 'workspace_upload' },
					source_key: `workspace:${present(facts).file}`,
					sha256: `sha-${present(facts).file}`,
					flags: ['missing_geolocation']
				});
				// the unreadable photo does not block the review and stays visibly failed after one attempt
				const [failure] = yield* rows(
					t,
					`SELECT inspection_failed_at, inspection_failure_reason FROM photo_evidence WHERE id = $1`,
					[failed]
				);
				expect(present(failure).inspection_failed_at).not.toBeNull();
				expect(String(present(failure).inspection_failure_reason)).toContain('could not be read');
				expect(
					calls.filter(
						(call) =>
							call._tag === 'files.image' && Schema.decodeUnknownSync(File)(call.args[0]).id === id
					)
				).toHaveLength(1);
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
				const infers = () => calls.filter((c) => c._tag === 'ai.sys_2.infer').length;
				expect(infers()).toBe(1);
				committed(
					yield* t
						.as(t.member(CONTROLLER))
						.act('job_assignments.update', [
							{ target: job, set: { summary: 'Installed two bars' } }
						])
				);
				expect(yield* checkedAt(t, job)).toBeNull();
				yield* t.runDue();
				expect(yield* checkedAt(t, job)).not.toBeNull();
				expect(infers()).toBe(2);
				expect(yield* logs()).toHaveLength(1); // the open finding stands; no second one
			})
	);
});
