import { present } from './test-runtime.js';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
/**
 * The data rules, one light check each: site identity, dispatch stamps and the review reset, create-only identity keys,
 * photo provenance, append-only ledgers, and a finding resolved once.
 */
import { describe, expect, it } from '@effect/vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { siteKey } from '../src/lib/site-key.ts';
import { fixtureId } from './test-runtime.js';
import { committed, CONTROLLER, person, rows, siteWithJob, wireAct, workspace } from './kit.ts';
describe('the template', () => {
	it('declares what its catalogue card says', () => {
		const files = readdirSync('src', { recursive: true }).map(String);
		const count = (pattern: RegExp) => files.filter((file) => pattern.test(file)).length;
		expect({
			collections: count(/^data\/collection\/[^/]+\/\+collection\.ts$/),
			apps: count(/^app\/.+\/\+app\.ts$/),
			automations: count(/^automation\/\+[^/]+\.automation\.ts$/)
		}).toEqual(JSON.parse(readFileSync('norbital.template.json', 'utf8')).counts);
	});
	it('a Singapore address is its postal code plus its unit, spelled one way', () => {
		expect(siteKey('58 Kismis Avenue, Singapore 598235')).toBe('598235');
		expect(siteKey('Blk 460133 #5-12')).toBe('460133#05-12');
		expect(siteKey('Edelweiss 119 #02-06, Singapore')).toBe('EDELWEISS 119#02-06');
		expect(siteKey('12  Block  Road Street Drive Avenue')).toBe('12 BLK RD ST DR AVE');
		expect(siteKey('3 Ridgewood', '3 RIDGEWOOD CLOSE SINGAPORE 276694 #16-03')).toBe(
			'276694#16-03'
		);
	});
});
describe('sites', () => {
	it.live('an address already filed is refused with the site that carries it', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(CONTROLLER));
			committed(yield* as.act('sites.create', { name: '58 Kismis Ave, S598235' }));
			const again = yield* Effect.flip(
				as.act('sites.create', { name: '58 Kismis Avenue, Singapore 598235' })
			);
			expect(again).toMatchObject({
				_tag: 'ActRefused',
				message: 'A site at this address already exists: 58 Kismis Ave, S598235.'
			});
		})
	);
	it.live('work filed under a site is dispatched by its transform', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(CONTROLLER));
			committed(
				yield* as.act('sites.create', {
					name: '6 Sunset Vale, Singapore 597232',
					job_assignments: {
						create: [{ title: 'Survey', scheduled_for: '2026-09-25', description: 'Measure' }]
					}
				})
			);
			const [job] = yield* rows(t, `SELECT status, search_text FROM job_assignments`);
			expect(job).toMatchObject({
				status: 'unassigned',
				search_text: 'Survey, 6 Sunset Vale, Singapore 597232'
			});
		})
	);
});
describe('job assignments', () => {
	it.live(
		'naming a contractor dispatches once, completing stamps once, and any change but the stamp makes the job unread',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const { job } = yield* siteWithJob(t);
				const as = t.as(t.member(CONTROLLER));
				const read = Effect.fnUntraced(function* () {
					return present((yield* rows(t, `SELECT * FROM job_assignments WHERE id = $1`, [job]))[0]);
				});
				expect(yield* read()).toMatchObject({ status: 'unassigned', dispatched_at: null });
				const [bob] = yield* rows(
					t,
					`INSERT INTO sys_user (id, email, name, kind) VALUES (gen_random_uuid(), 'bob@x.test', 'Bob', 'staff') RETURNING id`
				);
				committed(
					yield* as.act('job_assignments.update', {
						target: job,
						set: { assignee_user_id: fixtureId('sys_user', bob?.id), status: 'assigned' }
					})
				);
				const dispatched = (yield* read()).dispatched_at;
				expect(dispatched).not.toBeNull();
				committed(
					yield* as.act('job_assignments.update', { target: job, set: { status: 'completed' } })
				);
				const completed = (yield* read()).completed_at;
				t.clock.advance('1h');
				committed(
					yield* as.act('job_assignments.update', { target: job, set: { summary: 'done' } })
				);
				expect(yield* read()).toMatchObject({
					dispatched_at: dispatched,
					completed_at: completed,
					suspicion_checked_at: null
				});
			})
	);
	it.live('identity keys are create-only, and the review stamp is not a controller field', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { job } = yield* siteWithJob(t, { external_ref: 'IMP-1' });
			const as = t.as(t.member(CONTROLLER));
			expect(
				yield* wireAct(t, as.authority, {
					collection: 'job_assignments',
					verb: 'update',
					input: { target: job, set: { external_ref: 'IMP-2' } }
				})
			).toMatchObject({ kind: 'refused' });
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', {
						target: job,
						set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
	);
});
describe('photo evidence', () => {
	it.live('a filed photo is an uninspected workspace upload whose provenance never changes', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { job } = yield* siteWithJob(t);
			const other = yield* siteWithJob(t);
			const as = t.as(t.admin);
			const up = yield* as.upload('photo_evidence.photo', {
				name: 'p.jpg',
				mime: 'image/jpeg',
				bytes: readFileSync('tests/fixtures/photo-evidence.jpg')
			});
			if (up.kind !== 'committed') throw new Error(JSON.stringify(up));
			const file = up.output;
			expect(
				yield* Effect.flip(
					as.act('photo_evidence.create', {
						photo: file,
						source: { kind: 'workspace_upload' }
					})
				)
			).toMatchObject({
				_tag: 'ActRefused'
			}); // no parent
			const [createdPhoto] = committed(
				yield* as.act('photo_evidence.create', {
					job_assignment_id: job,
					photo: file,
					source: {
						kind: 'message',
						integration: 'x',
						conversation_id: 'c',
						message_id: 'm',
						attachment_id: 'a',
						sender_id: 's'
					}
				})
			);
			const photo = fixtureId('photo_evidence', createdPhoto);
			const [row] = yield* rows(
				t,
				`SELECT job_assignment_id, photo, source, source_key, sha256, summary, flags FROM photo_evidence WHERE id = $1`,
				[photo]
			);
			expect(row).toMatchObject({
				source: { kind: 'workspace_upload' },
				sha256: '',
				summary: 'Workspace upload',
				flags: []
			});
			expect(
				yield* wireAct(t, as.authority, {
					collection: 'photo_evidence',
					verb: 'update',
					input: {
						target: photo,
						set: { job_assignment_id: other.job }
					}
				})
			).toMatchObject({
				kind: 'refused',
				code: 'invalidInput',
				message: "set.job_assignment_id: 'job_assignment_id' is not accepted here"
			});
			expect(
				yield* rows(
					t,
					`SELECT job_assignment_id, photo, source, source_key, sha256, summary, flags FROM photo_evidence WHERE id = $1`,
					[photo]
				)
			).toEqual([row]);
		})
	);
});
describe('the ledgers', () => {
	it.live(
		'messages and reviews are append-only; a human finding composes its basis and is resolved once',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const { job } = yield* siteWithJob(t);
				const as = t.as(yield* person(t, CONTROLLER));
				const [createdLog] = committed(
					yield* as.act('communication_logs.create', {
						job_assignment_id: job,
						message: 'done',
						sent_at: '2026-09-25T10:00:00.000Z',
						sender: 'bob',
						source_message_id: 'm1'
					})
				);
				const log = fixtureId('communication_logs', createdLog);
				expect(
					yield* wireAct(t, as.authority, {
						collection: 'communication_logs',
						verb: 'update',
						input: { target: log, set: { message: 'edited' } }
					})
				).toMatchObject({ kind: 'refused' });
				const [createdFinding] = committed(
					yield* as.act('suspicious_activity_logs.create', {
						job_assignment_id: job,
						reason: 'Two sites in one set'
					})
				);
				const finding = fixtureId('suspicious_activity_logs', createdFinding);
				const stored = present(
					(yield* rows(
						t,
						`SELECT basis, origin, source_key FROM suspicious_activity_logs WHERE id = $1`,
						[finding]
					))[0]
				);
				expect(stored.basis).toMatchObject({
					kind: 'human_judgement',
					reason: 'Two sites in one set'
				});
				const basis = JSON.stringify({
					kind: 'human_judgement',
					reason: 'Two sites in one set',
					evidence_id: null
				});
				expect(stored.source_key).toBe(
					`human:${job}:${createHash('sha256').update(basis).digest('hex')}`
				);
				committed(
					yield* as.act('suspicious_activity_logs.resolve', {
						target: finding,
						input: { resolution: 'Same site, two doors' }
					})
				);
				expect(
					yield* Effect.flip(
						as.act('suspicious_activity_logs.resolve', {
							target: finding,
							input: { resolution: 'again' }
						})
					)
				).toMatchObject({
					_tag: 'ActRefused'
				});
				expect(
					yield* Effect.flip(
						as.act('suspicious_activity_logs.create', {
							job_assignment_id: job,
							origin: 'automation',
							reason: 'x'
						})
					)
				).toMatchObject({
					_tag: 'ActRefused',
					message: 'An automated suspicion judgement must supply its reviewed evidence basis.'
				});
			})
	);
});
it.live('a title-only edit keeps the site in the job search text', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { job } = yield* siteWithJob(t);
		const before = present(
			(yield* rows(t, 'SELECT search_text FROM job_assignments WHERE id = $1', [job]))[0]
		);
		committed(
			yield* t.as(t.admin).act('job_assignments.update', { target: job, set: { title: 'Renamed' } })
		);
		const after = present(
			(yield* rows(t, 'SELECT search_text FROM job_assignments WHERE id = $1', [job]))[0]
		);
		expect(after.search_text).toBe(
			`Renamed, ${String(before.search_text).split(', ').slice(1).join(', ')}`
		);
	})
);
