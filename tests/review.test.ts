import { present } from './test-runtime.js';
import { Context, Schema, Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect';
/**
 * The suspicion review (L-TPL-field-operations-004/011/016) over the host's image facts and a scripted `sys_2` model:
 * a filed photo is inspected, an unchecked job is judged once and stamped, a suspicious judgement writes one finding
 * however often it is re-judged, a change makes the job unread again, and a failed turn stamps nothing and re-queues
 * the review at the next two-hour slot.
 */
import { readFileSync } from 'node:fs';
import { expect, it, vi } from '@effect/vitest';
import {
	Ai,
	DbError,
	Facilities,
	Port,
	type CrossAnswer,
	type FacilityCall,
	type Json
} from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import type { Id } from '@norbital-ai/bolt';
import {
	committed,
	CONTRACTOR,
	CONTROLLER,
	person,
	rows,
	siteWithJob,
	workspace,
	type T
} from './kit.ts';
import { fixtureId } from './test-runtime.js';
const overrideFacilities = Effect.fnUntraced(function* (
	t: T,
	dispatch: Facilities['Service']['dispatch']
) {
	const facilities = Context.get(t.services, Facilities);
	const native = facilities.dispatch;
	const spy = vi
		.spyOn(facilities, 'dispatch')
		.mockImplementation((call) =>
			dispatch(call).pipe(
				Effect.flatMap((answer) =>
					!answer.ok && answer.error.kind === 'unavailable' ? native(call) : Effect.succeed(answer)
				)
			)
		);
	yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));
});
const File = Schema.Struct({ id: Schema.String, name: Schema.String, mime: Schema.String });
const unavailable = (call: FacilityCall): CrossAnswer => ({
	ok: false,
	error: { kind: 'unavailable', facility: call._tag, reason: 'fixture' }
});
/** The host's facilities, faked: image facts from the file's id, sizes, and one scripted verdict. */
function facilities(
	verdict: () => Json | Error,
	unreadable: (ref: { id: string; name: string }) => boolean = () => false
) {
	const calls: FacilityCall[] = [];
	const dispatch: Facilities['Service']['dispatch'] = (call) =>
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
			if (call._tag === 'ai.sys_2.infer') {
				const v = verdict();
				return v instanceof Error
					? { ok: false as const, error: { kind: 'upstream' as const, message: v.message } }
					: { ok: true as const, value: v };
			}
			return unavailable(call);
		});
	return { calls, dispatch };
}
const filedPhoto = Effect.fnUntraced(function* (t: T, job: Id<'job_assignments'>) {
	const as = t.as(t.admin);
	const up = yield* as.upload('photo_evidence.photo', {
		name: 'IMG_0001.jpg',
		mime: 'image/jpeg',
		bytes: readFileSync('tests/fixtures/photo-evidence.jpg')
	});
	if (up.kind !== 'committed') throw new Error(JSON.stringify(up));
	const [photo] = committed(
		yield* as.act('photo_evidence.create', {
			job_assignment_id: job,
			photo: up.output,
			source: { kind: 'workspace_upload' }
		})
	);
	return fixtureId('photo_evidence', photo);
});
const suspicious = {
	suspicious: true,
	reason: 'Two different door plates.',
	evidence_asset_name: 'IMG_0001.jpg'
};
const clear = { suspicious: false, reason: 'No usable photo.', evidence_asset_name: '' };
it.live(
	'inspects the photo, judges the job once, writes one finding, and judges again after a change',
	() =>
		Effect.gen(function* () {
			const fake = facilities(() => suspicious);
			const t = yield* workspace();
			yield* overrideFacilities(t, fake.dispatch);
			const { job } = yield* siteWithJob(t);
			const photo = yield* filedPhoto(t, job);
			const reads = vi.spyOn(t.db, 'read');
			yield* t.runDue();
			// The native resolver already combines the independent facts reads into one statement.
			const factsReads = reads.mock.calls.filter(([statements]) =>
				statements.some(({ text }) =>
					['sites', 'variation_requests', 'communication_logs'].every((table) =>
						text.includes(`FROM "${table}"`)
					)
				)
			);
			expect(factsReads).toHaveLength(1);
			expect(factsReads.map(([statements]) => statements.length)).toEqual([1]);
			reads.mockRestore();
			const [facts] = yield* rows(t, `SELECT sha256, flags FROM photo_evidence WHERE id = $1`, [
				photo
			]);
			const [file] = yield* rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
				photo
			]);
			expect(facts).toMatchObject({
				sha256: `sha-${present(file).id}`,
				flags: ['missing_geolocation']
			});
			const checked = Effect.fnUntraced(function* () {
				return present(
					(yield* rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [
						job
					]))[0]
				).suspicion_checked_at;
			});
			expect(yield* checked()).not.toBeNull();
			const logs = Effect.fnUntraced(function* () {
				return yield* rows(
					t,
					`SELECT origin, evidence_id, reason FROM suspicious_activity_logs WHERE job_assignment_id = $1`,
					[job]
				);
			});
			expect(yield* logs()).toEqual([
				{ origin: 'automation', evidence_id: photo, reason: 'Two different door plates.' }
			]);
			expect(fake.calls.filter((c) => c._tag === 'ai.sys_2.infer')).toHaveLength(1);
			expect(fake.calls.filter((c) => c._tag === 'files.meta')).toHaveLength(1);
			committed(
				yield* t
					.as(t.member(CONTROLLER))
					.act('job_assignments.update', { target: job, set: { summary: 'Installed two bars' } })
			);
			expect(yield* checked()).toBeNull();
			yield* t.runDue();
			expect(yield* checked()).not.toBeNull();
			expect(fake.calls.filter((c) => c._tag === 'ai.sys_2.infer')).toHaveLength(2);
			expect(fake.calls.filter((c) => c._tag === 'files.meta')).toHaveLength(2);
			expect(
				yield* rows(t, `SELECT id FROM suspicion_reviews WHERE job_assignment_id = $1`, [job])
			).toHaveLength(2);
			expect(yield* logs()).toHaveLength(1); // the open finding stands; no second one
		})
);
it.live(
	"the review's finding is read by a controller and by neither the contractor holding the job nor the envoy",
	() =>
		Effect.gen(function* () {
			const fake = facilities(() => suspicious);
			const t = yield* workspace();
			yield* overrideFacilities(t, fake.dispatch);
			const contractor = yield* person(t, CONTRACTOR);
			const controller = yield* person(t, CONTROLLER);
			const envoy = yield* person(t, ['field_ops_whatsapp']);
			const { job } = yield* siteWithJob(t, {
				assignee_user_id: fixtureId('sys_user', contractor.id)
			});
			const photo = yield* filedPhoto(t, job);
			yield* t.runDue(); // the create trigger runs the review, which judges the scripted verdict
			const where = { job_assignment_id: { eq: job } };
			const findings = yield* t
				.as(controller)
				.read('suspicious_activity_logs', { where, limit: 10 });
			expect(findings.rows).toEqual([
				expect.objectContaining({
					job_assignment_id: job,
					origin: 'automation',
					evidence_id: photo,
					reason: 'Two different door plates.'
				})
			]);
			expect(
				(yield* t.as(controller).read('suspicion_reviews', { where, limit: 10 })).rows
			).toEqual([expect.objectContaining({ suspicious: true })]);
			for (const outsider of [contractor, envoy])
				expect(
					yield* Effect.flip(t.as(outsider).read('suspicious_activity_logs', { limit: 10 }))
				).toMatchObject({ _tag: 'ReadFailed' });
			// the contractor still reads the job the finding is about
			expect(
				(yield* t.as(contractor).read('job_assignments', { limit: 10 })).rows.map((r) => r.id)
			).toEqual([job]);
		})
);
it.live.each(['invalid', 'unavailable'] as const)(
	'metadata %s preserves the native fallback and visual budget',
	(kind) =>
		Effect.gen(function* () {
			let metadata = 0;
			const inferences: Json[] = [];
			const t = yield* workspace();
			yield* overrideFacilities(t, (call) =>
				Effect.sync((): CrossAnswer => {
					if (call._tag === 'files.image')
						return {
							ok: true,
							value: {
								format: 'jpeg',
								width: 1440,
								height: 1920,
								sha256: 'metadata-fixture',
								pdq: '0'.repeat(63) + '1',
								exif: {}
							}
						};
					if (call._tag === 'files.meta') {
						metadata++;
						return kind === 'invalid'
							? { ok: false, error: { kind: 'invalid', message: 'metadata fixture' } }
							: {
									ok: false,
									error: { kind: 'unavailable', facility: 'files', reason: 'metadata fixture' }
								};
					}
					if (call._tag === 'ai.sys_2.infer') {
						inferences.push(call.args[0] ?? null);
						return { ok: true, value: clear };
					}
					return unavailable(call);
				})
			);
			const { job } = yield* siteWithJob(t);
			yield* filedPhoto(t, job);
			yield* t.runDue();
			expect(metadata).toBe(1);
			const fileBytes = readFileSync('tests/fixtures/photo-evidence.jpg').byteLength;
			expect(inferences).toEqual([
				expect.objectContaining({
					files:
						kind === 'invalid'
							? []
							: [expect.objectContaining({ name: 'IMG_0001.jpg', bytes: fileBytes })],
					prompt: expect.stringContaining(`"file_size":${kind === 'invalid' ? -1 : fileBytes}`)
				})
			]);
			expect(
				yield* rows(t, 'SELECT suspicious FROM suspicion_reviews WHERE job_assignment_id = $1', [
					job
				])
			).toEqual([{ suspicious: false }]);
			const stamps = yield* rows(
				t,
				'SELECT suspicion_checked_at FROM job_assignments WHERE id = $1',
				[job]
			);
			expect(stamps.map((row) => row.suspicion_checked_at)).toEqual([expect.anything()]);
		})
);
it.live('a photo the host cannot read does not block its assignment and stays visibly failed', () =>
	Effect.gen(function* () {
		const unreadable = new Set<string>();
		const fake = facilities(
			() => clear,
			(ref) => unreadable.has(ref.id)
		);
		const t = yield* workspace();
		yield* overrideFacilities(t, fake.dispatch);
		const { job } = yield* siteWithJob(t);
		const photo = yield* filedPhoto(t, job);
		const [file] = yield* rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
			photo
		]);
		unreadable.add(String(present(file).id));
		yield* t.runDue();
		// the review proceeds on the evidence it has instead of waiting forever
		expect(
			present(
				(yield* rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]
			).suspicion_checked_at
		).not.toBeNull();
		expect(
			yield* rows(t, `SELECT suspicious FROM suspicion_reviews WHERE job_assignment_id = $1`, [job])
		).toEqual([{ suspicious: false }]);
		const [failure] = yield* rows(
			t,
			`SELECT inspection_failed_at, inspection_failure_reason FROM photo_evidence WHERE id = $1`,
			[photo]
		);
		expect(present(failure).inspection_failed_at).not.toBeNull();
		expect(String(present(failure).inspection_failure_reason)).toContain('could not be read');
	})
);
it.live('an unreadable photo is not inspected again by a later run', () =>
	Effect.gen(function* () {
		const unreadable = new Set<string>();
		const fake = facilities(
			() => clear,
			(ref) => unreadable.has(ref.id)
		);
		const t = yield* workspace();
		yield* overrideFacilities(t, fake.dispatch);
		const { job } = yield* siteWithJob(t);
		const failed = yield* filedPhoto(t, job);
		const [file] = yield* rows(t, `SELECT photo->>'id' AS id FROM photo_evidence WHERE id = $1`, [
			failed
		]);
		unreadable.add(String(present(file).id));
		const attempts = () =>
			fake.calls.filter(
				(call) =>
					call._tag === 'files.image' &&
					Schema.decodeUnknownSync(File)(call.args[0]).id === file?.id
			).length;
		yield* t.runDue();
		expect(attempts()).toBe(1);
		// a later photo is inspected while the failed one keeps its one attempt
		const later = yield* filedPhoto(t, job);
		yield* t.runDue();
		expect(attempts()).toBe(1);
		expect(
			present((yield* rows(t, `SELECT sha256 FROM photo_evidence WHERE id = $1`, [later]))[0])
				.sha256
		).not.toBe('');
	})
);
it.live('a failed turn stamps nothing and re-queues the review at the next two-hour slot', () =>
	Effect.gen(function* () {
		const fake = facilities(() => new Error('provider down'));
		const t = yield* workspace({
			now: '2026-09-25T10:07:00.000Z'
		});
		yield* overrideFacilities(t, fake.dispatch);
		const { job } = yield* siteWithJob(t);
		yield* t.runDue();
		expect(
			present(
				(yield* rows(t, `SELECT suspicion_checked_at FROM job_assignments WHERE id = $1`, [job]))[0]
			).suspicion_checked_at
		).toBeNull();
		const queued = yield* rows(
			t,
			`SELECT due_at::text AS due, state FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND key = 'suspicion_retry'`
		);
		expect(queued).toEqual([
			{ due: expect.stringMatching(/^2026-09-25 12:00:00/), state: 'queued' }
		]);
		const [failed] = yield* rows(
			t,
			`SELECT state, error::text AS error FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND cause = 'created'`
		);
		expect(present(failed).state).toBe('failed');
		// the run names the cause it actually hit: a failed turn used to surface as the guest's own 'unawaited' complaint,
		// which named neither the provider nor the assignment
		expect(present(failed).error).toContain('provider down');
		expect(present(failed).error).not.toContain('unawaited');
	})
);
it.live.each(['success', 'inference', 'progress'] as const)(
	'bounds review admission to six and drains a seven-assignment run (failure=%s)',
	(scenario) =>
		Effect.gen(function* () {
			const failFirst = scenario === 'inference';
			const progressFailed = yield* Deferred.make<void>();
			const gates = yield* Effect.forEach(Array.from({ length: 7 }), () => Deferred.make<void>());
			const arrivals = yield* Queue.unbounded<number>();
			let started = 0;
			const t = yield* workspace();
			yield* overrideFacilities(t, (call) =>
				Effect.gen(function* (): Effect.fn.Return<CrossAnswer> {
					if (call._tag !== 'ai.sys_2.infer') return unavailable(call);
					const index = started++;
					const gate = gates[index];
					if (gate === undefined) throw new Error('Unexpected inference');
					yield* Queue.offer(arrivals, index);
					yield* Deferred.await(gate);
					return failFirst && index === 0
						? { ok: false, error: { kind: 'upstream', message: 'Fixture inference failure' } }
						: { ok: true, value: clear };
				})
			);
			const jobs: Id<'job_assignments'>[] = [];
			for (let i = 0; i < 7; i++) jobs.push((yield* siteWithJob(t)).job);
			// Only this manual run exercises the batch; creation triggers belong to separate runs.
			yield* t.db.write({ text: 'DELETE FROM sys_run', params: [] });
			expect(
				yield* t.as(t.admin).start('review_job_assignment_suspicion', { ids: jobs })
			).toMatchObject({ kind: 'committed' });
			const returning = t.db.returning;
			let injected = false;
			const failReturning: typeof t.db.returning = (schema, statement, lock) =>
				Effect.gen(function* () {
					if (
						scenario === 'progress' &&
						!injected &&
						statement.text.includes('SET progress') &&
						JSON.stringify(statement.params).includes('Reviewed assignment 1 of 7')
					) {
						injected = true;
						yield* Deferred.succeed(progressFailed, undefined);
						return yield* Effect.fail(
							new DbError({ sqlstate: 'XX000', message: 'Fixture progress write failure' })
						);
					}
					return yield* returning(schema, statement, lock);
				});
			const writeSpy = vi.spyOn(t.db, 'returning').mockImplementation(failReturning);
			yield* Effect.addFinalizer(() => Effect.sync(() => writeSpy.mockRestore()));
			let settled = false;
			const running = yield* t.runDue().pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						settled = true;
					})
				),
				Effect.forkScoped
			);
			yield* Effect.gen(function* () {
				for (let i = 0; i < 6; i++) expect(yield* Queue.take(arrivals)).toBe(i);
				expect(started).toBe(6);
				const first = gates[0];
				if (first === undefined) throw new Error('Missing first gate');
				yield* Deferred.succeed(first, undefined);
				if (scenario === 'progress') {
					yield* Deferred.await(progressFailed);
					yield* rows(t, 'SELECT state FROM sys_run');
					expect(settled).toBe(false);
					expect(started).toBe(6);
				} else expect(yield* Queue.take(arrivals)).toBe(6);
				for (const gate of gates.slice(1)) yield* Deferred.succeed(gate, undefined);
				yield* Fiber.join(running);
				const checked = yield* rows(
					t,
					'SELECT count(*)::int AS n FROM job_assignments WHERE suspicion_checked_at IS NOT NULL'
				);
				expect(checked).toEqual([{ n: scenario === 'success' ? 7 : 6 }]);
				expect(started).toBe(scenario === 'progress' ? 6 : 7);
				if (scenario === 'progress') {
					const failed = yield* rows(
						t,
						"SELECT state, error::text AS error FROM sys_run WHERE automation = 'review_job_assignment_suspicion'"
					);
					expect(failed).toEqual([
						{ state: 'failed', error: expect.stringContaining('Fixture progress write failure') }
					]);
				}
			}).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						for (const gate of gates) yield* Deferred.succeed(gate, undefined);
						yield* Fiber.await(running);
						yield* Effect.sync(() => writeSpy.mockRestore());
					})
				)
			);
		})
);
it.live.each(['success', 'provider', 'write'] as const)(
	'backfills 65 photos in four bounded 16-photo batches (failure=%s)',
	(scenario) =>
		Effect.gen(function* () {
			const failFirst = scenario === 'provider';
			const writeFailed = yield* Deferred.make<void>();
			const gates = yield* Effect.forEach(Array.from({ length: 5 }), () => Deferred.make<void>());
			const arrivals = yield* Queue.unbounded<number>();
			const sizes: number[] = [];
			const t = yield* workspace({
				ports: Layer.succeed(Ai, {
					ask: () => Effect.die(new Error('Unexpected decision')),
					maxChoices: undefined,
					models: ['default'],
					catalog: Port.unavailable('ai'),
					infer: () =>
						Stream.make({
							_tag: 'Response',
							response: {
								content: clear,
								toolCalls: [],
								finish: 'stop',
								usage: { input: 0, output: 0, cost: 0 }
							}
						}),
					embed: (inputs) =>
						Effect.gen(function* () {
							const index = sizes.length;
							sizes.push(inputs.length);
							const gate = gates[index];
							if (gate === undefined) throw new Error('Unexpected embedding');
							yield* Queue.offer(arrivals, index);
							yield* Deferred.await(gate);
							if (failFirst && index === 0)
								return yield* Effect.fail(
									new FacilityFailure({
										kind: 'upstream',
										message: 'Fixture embedding unavailable'
									})
								);
							return inputs.map(() => Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)));
						})
				})
			});
			const { job } = yield* siteWithJob(t);
			for (let i = 0; i < 65; i++) yield* filedPhoto(t, job);
			yield* t.db.write({ text: "UPDATE photo_evidence SET sha256 = 'inspected'", params: [] });
			yield* t.db.write({ text: 'DELETE FROM sys_run', params: [] });
			expect(
				yield* t.as(t.admin).start('review_job_assignment_suspicion', { ids: [job] })
			).toMatchObject({ kind: 'committed' });
			const returning = t.db.returning;
			let injected = false;
			const failReturning: typeof t.db.returning = (schema, statement, lock) =>
				Effect.gen(function* () {
					if (
						scenario === 'write' &&
						!injected &&
						statement.text.includes('photo_evidence') &&
						statement.text.includes('scene_embedding') &&
						statement.text.includes('UPDATE')
					) {
						injected = true;
						yield* Deferred.succeed(writeFailed, undefined);
						return yield* Effect.fail(
							new DbError({ sqlstate: 'XX000', message: 'Fixture scene write failure' })
						);
					}
					return yield* returning(schema, statement, lock);
				});
			const writeSpy = vi.spyOn(t.db, 'returning').mockImplementation(failReturning);
			yield* Effect.addFinalizer(() => Effect.sync(() => writeSpy.mockRestore()));
			const running = yield* Effect.forkScoped(t.runDue());
			yield* Effect.gen(function* () {
				for (let i = 0; i < 4; i++) expect(yield* Queue.take(arrivals)).toBe(i);
				expect(sizes).toEqual([16, 16, 16, 16]);
				const first = gates[0];
				if (first === undefined) throw new Error('Missing first embedding');
				yield* Deferred.succeed(first, undefined);
				if (scenario === 'write') {
					yield* Deferred.await(writeFailed);
					expect(sizes).toEqual([16, 16, 16, 16]);
				} else expect(yield* Queue.take(arrivals)).toBe(4);
				for (const gate of gates.slice(1)) yield* Deferred.succeed(gate, undefined);
				yield* Fiber.join(running);
				expect(sizes).toEqual(scenario === 'write' ? [16, 16, 16, 16] : [16, 16, 16, 16, 1]);
				expect(
					yield* rows(
						t,
						'SELECT count(*)::int AS n FROM photo_evidence WHERE scene_embedding IS NOT NULL'
					)
				).toEqual([{ n: scenario === 'write' ? 48 : failFirst ? 49 : 65 }]);
				if (scenario === 'write') {
					expect(
						yield* rows(
							t,
							"SELECT state FROM sys_run WHERE automation = 'review_job_assignment_suspicion'"
						)
					).toEqual([{ state: 'failed' }]);
				} else {
					expect(
						yield* rows(
							t,
							"SELECT state, error, output FROM sys_run WHERE automation = 'review_job_assignment_suspicion'"
						)
					).toEqual([
						{
							state: 'succeeded',
							error: null,
							output: {
								assignment_count: 1,
								inference_count: 1,
								failure_count: 0,
								counts: { checked: 1, inspected_photos: 0, inspection_failed: 0, clear: 1 }
							}
						}
					]);
					expect(
						yield* rows(t, 'SELECT job_assignment_id, suspicious FROM suspicion_reviews')
					).toEqual([{ job_assignment_id: job, suspicious: false }]);
					expect(
						yield* rows(
							t,
							'SELECT suspicion_checked_at = $2::timestamptz AS stamped FROM job_assignments WHERE id = $1',
							[job, t.clock.now()]
						)
					).toEqual([{ stamped: true }]);
				}
			}).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						for (const gate of gates) yield* Deferred.succeed(gate, undefined);
						yield* Fiber.await(running);
						yield* Effect.sync(() => writeSpy.mockRestore());
					})
				)
			);
		})
);
it.live.each(['decision', 'pair', 'reuse'] as const)(
	'settles decision and scene-pair calls (scenario=%s)',
	(scenario) =>
		Effect.gen(function* () {
			const decision = yield* Deferred.make<void>();
			const pair = yield* Deferred.make<void>();
			const arrivals = yield* Queue.unbounded<string>();
			const t = yield* workspace();
			yield* overrideFacilities(t, (call) =>
				Effect.gen(function* (): Effect.fn.Return<CrossAnswer> {
					if (call._tag === 'files.meta')
						return {
							ok: true,
							value: { ...Schema.decodeUnknownSync(File)(call.args[0]), bytes: 1000 }
						};
					if (call._tag !== 'ai.sys_2.infer') return unavailable(call);
					const kind = JSON.stringify(call.args).includes('"same_scene"') ? 'pair' : 'decision';
					yield* Queue.offer(arrivals, kind);
					yield* Deferred.await(kind === 'pair' ? pair : decision);
					return kind === scenario
						? { ok: false, error: { kind: 'upstream', message: `Fixture ${kind} failure` } }
						: {
								ok: true,
								value:
									kind === 'pair'
										? { same_scene: scenario === 'reuse', reason: 'Fixture scene decision' }
										: clear
							};
				})
			);
			const { job } = yield* siteWithJob(t);
			const other = yield* siteWithJob(t);
			yield* filedPhoto(t, job);
			yield* filedPhoto(t, other.job);
			yield* t.db.write({
				text: "UPDATE photo_evidence SET sha256 = 'inspected', scene_embedding = $1::vector",
				params: [JSON.stringify(Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)))]
			});
			yield* t.db.write({ text: 'DELETE FROM sys_run', params: [] });
			expect(
				yield* t.as(t.admin).start('review_job_assignment_suspicion', { ids: [job] })
			).toMatchObject({ kind: 'committed' });
			const running = yield* Effect.forkScoped(t.runDue());
			yield* Effect.gen(function* () {
				const started = [yield* Queue.take(arrivals), yield* Queue.take(arrivals)];
				expect(started.sort()).toEqual(['decision', 'pair']);
				yield* Deferred.succeed(scenario === 'decision' ? decision : pair, undefined);
				expect(yield* rows(t, 'SELECT count(*)::int AS n FROM suspicion_reviews')).toEqual([
					{ n: 0 }
				]);
				yield* Deferred.succeed(scenario === 'decision' ? pair : decision, undefined);
				yield* Fiber.join(running);
				expect(yield* rows(t, 'SELECT suspicious FROM suspicion_reviews')).toEqual(
					scenario === 'decision' ? [] : [{ suspicious: scenario === 'reuse' }]
				);
				expect(yield* rows(t, 'SELECT count(*)::int AS n FROM suspicious_activity_logs')).toEqual([
					{ n: scenario === 'reuse' ? 1 : 0 }
				]);
				expect(yield* Queue.size(arrivals)).toBe(0);
				const failed = yield* rows(
					t,
					"SELECT error::text AS error FROM sys_run WHERE automation = 'review_job_assignment_suspicion' AND state = 'failed'"
				);
				if (scenario === 'decision') {
					expect(failed).toEqual([{ error: expect.stringContaining('Fixture decision failure') }]);
					expect(present(failed[0]).error).not.toContain('unawaited');
				} else expect(failed).toEqual([]);
			}).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						yield* Deferred.succeed(decision, undefined);
						yield* Deferred.succeed(pair, undefined);
						yield* Fiber.await(running);
					})
				)
			);
		})
);
it.live('loads metadata once per nominated foreign photo after two scene probes', () =>
	Effect.gen(function* () {
		let metadata = 0;
		let decisions = 0;
		let pairs = 0;
		const t = yield* workspace();
		yield* overrideFacilities(t, (call) =>
			Effect.sync((): CrossAnswer => {
				if (call._tag === 'files.meta') {
					metadata++;
					return {
						ok: true,
						value: { ...Schema.decodeUnknownSync(File)(call.args[0]), bytes: 1000 }
					};
				}
				if (call._tag === 'ai.sys_2.infer') {
					if (JSON.stringify(call.args).includes('"same_scene"')) {
						pairs++;
						return { ok: true, value: { same_scene: false, reason: 'Fixture scene' } };
					}
					decisions++;
					return { ok: true, value: clear };
				}
				return unavailable(call);
			})
		);
		const { job } = yield* siteWithJob(t);
		const other = yield* siteWithJob(t);
		yield* filedPhoto(t, job);
		yield* filedPhoto(t, job);
		yield* filedPhoto(t, other.job);
		yield* t.db.write({
			text: "UPDATE photo_evidence SET sha256 = 'inspected', scene_embedding = $1::vector",
			params: [JSON.stringify(Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)))]
		});
		yield* t.db.write({ text: 'DELETE FROM sys_run', params: [] });
		expect(
			yield* t.as(t.admin).start('review_job_assignment_suspicion', { ids: [job] })
		).toMatchObject({ kind: 'committed' });
		yield* t.runDue();
		expect(metadata).toBe(3); // two own photos plus one nominated foreign photo
		expect(decisions).toBe(1);
		expect(pairs).toBe(1);
		expect(yield* rows(t, 'SELECT suspicious FROM suspicion_reviews')).toEqual([
			{ suspicious: false }
		]);
	})
);
