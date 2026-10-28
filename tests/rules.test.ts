import { present } from './test-runtime.js';
import type { Id, Patch } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
/**
 * The data rules, one light check each: site identity, dispatch stamps and the review reset, create-only identity keys,
 * photo provenance, append-only ledgers, and a finding resolved once.
 */
import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import { siteKey } from '../src/lib/site-key.ts';
import { fixtureId } from './test-runtime.js';
import {
	committed,
	completedRun,
	CONTROLLER,
	person,
	rows,
	siteWithJob,
	wireAct,
	workspace,
	type T
} from './kit.ts';
/** One site as the caller reads it, or `null`. */
const siteRow = Effect.fnUntraced(function* (as: ReturnType<T['as']>, site: Id<'sites'>) {
	const { sites } = yield* as.query({ sites: { where: { id: { eq: site } }, limit: 1 } });
	return sites.rows[0] ?? null;
});
describe('the template', () => {
	it('a Singapore address is its postal code plus its unit, spelled one way', () => {
		expect(siteKey('58 Kismis Avenue, Singapore 598235')).toBe('598235');
		expect(siteKey('Blk 460133 #5-12')).toBe('460133#05-12');
		expect(siteKey('Blk 460133 #5-12', null)).toBe('460133');
		expect(siteKey('Edelweiss 119 #02-06, Singapore')).toBe('EDELWEISS 119#02-06');
		expect(siteKey('12  Block  Road Street Drive Avenue')).toBe('12 BLK RD ST DR AVE');
		expect(siteKey('3 RIDGEWOOD CLOSE SINGAPORE 276694', '16-03')).toBe('276694#16-03');
	});
});
describe('sites', () => {
	it.live('an address already filed is refused with the site that carries it', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(CONTROLLER));
			committed(
				yield* as.act('sites.create', [
					{
						location: { lat: 1.34, lng: 103.77 },
						address: '58 Kismis Ave, S598235'
					}
				])
			);
			const again = yield* Effect.flip(
				as.act('sites.create', [
					{
						location: { lat: 1.34, lng: 103.77 },
						address: '58 Kismis Avenue, Singapore 598235'
					}
				])
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
				yield* as.act('sites.create', [
					{
						location: { lat: 1.34, lng: 103.77 },
						address: '6 Sunset Vale, Singapore 597232',
						job_assignments: [
							{ title: 'Survey', scheduled_for: '2026-09-25', description: 'Measure' }
						]
					}
				])
			);
			const [job] = yield* rows(t, `SELECT status FROM job_assignments`);
			expect(job).toMatchObject({ status: 'pending' });
		})
	);
	it.live(
		'requires a location on writes, derives the title, and distinguishes optional units',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const as = t.as(t.member(CONTROLLER));
				expect(
					yield* Effect.flip(as.act('sites.create', [{ address: 'Unresolved address' }]))
				).toMatchObject({
					_tag: 'ActRefused',
					message: 'Choose a location for the site.'
				});
				const [created] = committed(
					yield* as.act('sites.create', [
						{
							location: { lat: 1.34, lng: 103.77 },
							unit_number: '05-12'
						}
					])
				);
				const site = fixtureId('sites', created);
				expect(yield* siteRow(as, site)).toMatchObject({
					name: '1.34, 103.77',
					unit_number: '05-12'
				});
				committed(
					yield* as.act('sites.create', [
						{
							location: { lat: 1.34, lng: 103.77 },
							unit_number: '05-13'
						}
					])
				);
				expect(
					yield* Effect.flip(as.act('sites.update', [{ target: site, set: { location: null } }]))
				).toMatchObject({
					_tag: 'ActRefused',
					message: 'Choose a location for the site.'
				});
				committed(
					yield* as.act('sites.update', [
						{
							target: site,
							set: {
								location: { lat: 1.35, lng: 103.78 },
								address: 'Resolved map address, Singapore 598236'
							}
						}
					])
				);
				expect(yield* siteRow(as, site)).toMatchObject({
					name: 'Resolved map address, Singapore 598236',
					unit_number: '05-12'
				});
				committed(
					yield* as.act('sites.update', [
						{
							target: site,
							set: { location: { lat: 1.36, lng: 103.79 } }
						}
					])
				);
				expect(yield* siteRow(as, site)).toMatchObject({
					name: '1.36, 103.79',
					address: null
				});
				expect(
					yield* wireAct(t, as.authority, {
						model: 'sites',
						verb: 'create',
						input: [
							{
								name: 'Free text title',
								location: { lat: 1.36, lng: 103.79 }
							}
						]
					})
				).toMatchObject({ kind: 'refused', code: 'invalidInput' });
			})
	);
	it.live('restores an unlocated row but requires a location before editing it', () =>
		Effect.gen(function* () {
			const site = fixtureId('sites', '019f8a40-0000-7000-8000-000000000104');
			// Nullable persisted locations are restorable; current guarded creates require a location.
			const t = yield* workspace({
				seed: {
					sites: [{ id: site, name: 'Restored site', site_key: 'RESTORED SITE', location: null }]
				}
			});
			const as = t.as(t.member(CONTROLLER));
			expect(present(yield* siteRow(as, site)).location).toBeNull();
			expect(
				yield* Effect.flip(
					as.act('sites.update', [{ target: site, set: { client_name: 'Edited client' } }])
				)
			).toMatchObject({
				_tag: 'ActRefused',
				message: 'Choose a location for the site.'
			});
			committed(
				yield* as.act('sites.update', [
					{
						target: site,
						set: { location: { lat: 1.34, lng: 103.77 } }
					}
				])
			);
			expect(yield* siteRow(as, site)).toMatchObject({ name: '1.34, 103.77' });
		})
	);
	it.live(
		'keeps an embedded legacy unit when the location label changes, unless explicitly cleared',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const as = t.as(t.member(CONTROLLER));
				const [created] = committed(
					yield* as.act('sites.create', [
						{
							location: { lat: 1.34, lng: 103.77 },
							address: 'Test Block #05-12, Singapore 598235'
						}
					])
				);
				const site = fixtureId('sites', created);
				yield* rows(t, 'UPDATE sites SET unit_number = NULL WHERE id = $1', [site]);
				committed(
					yield* as.act('sites.update', [
						{
							target: site,
							set: {
								location: { lat: 1.35, lng: 103.78 },
								address: 'Updated Test Block, Singapore 598235'
							}
						}
					])
				);
				expect(yield* siteRow(as, site)).toMatchObject({
					name: 'Updated Test Block, Singapore 598235',
					unit_number: '#05-12',
					site_key: '598235#05-12'
				});
				committed(
					yield* as.act('sites.update', [
						{
							target: site,
							set: {
								address: 'Updated Test Block #05-12, Singapore 598235'
							}
						}
					])
				);
				committed(yield* as.act('sites.update', [{ target: site, set: { unit_number: null } }]));
				expect(yield* siteRow(as, site)).toMatchObject({
					unit_number: null,
					site_key: '598235'
				});
				committed(
					yield* as.act('sites.update', [{ target: site, set: { client_name: 'Edited client' } }])
				);
				expect(yield* siteRow(as, site)).toMatchObject({
					unit_number: null,
					site_key: '598235'
				});
			})
	);
});
describe('job assignments', () => {
	it.live(
		'a contractor contact links the member and dispatches once, completing stamps once, and any change but the stamp makes the job unread',
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const { job } = yield* siteWithJob(t);
				const as = t.as(t.member(CONTROLLER));
				const read = Effect.fnUntraced(function* () {
					return present((yield* rows(t, `SELECT * FROM job_assignments WHERE id = $1`, [job]))[0]);
				});
				expect(yield* read()).toMatchObject({
					status: 'pending',
					assignee_user_id: null,
					dispatched_at: null
				});
				const [bob] = yield* rows(
					t,
					`INSERT INTO sys_user (id, email, name, kind, phone) VALUES (gen_random_uuid(), 'Bob@X.test', 'Bob', 'staff', '+6581234567') RETURNING id`
				);
				// a contact no member holds links nobody, and the job stays pending
				committed(
					yield* as.act('job_assignments.update', [
						{ target: job, set: { assignee_contact: 'nobody@x.test' } }
					])
				);
				expect(yield* read()).toMatchObject({
					status: 'pending',
					assignee_user_id: null,
					dispatched_at: null
				});
				// a local number names the member stored with +65
				committed(
					yield* as.act('job_assignments.update', [
						{ target: job, set: { assignee_contact: '8123 4567' } }
					])
				);
				expect(yield* read()).toMatchObject({ status: 'pending', assignee_user_id: bob?.id });
				const dispatched = (yield* read()).dispatched_at;
				expect(dispatched).not.toBeNull();
				// an email matches whatever its case
				const other = yield* siteWithJob(t, { assignee_contact: 'bob@x.test' });
				expect(
					present(
						(yield* rows(t, `SELECT assignee_user_id FROM job_assignments WHERE id = $1`, [
							other.job
						]))[0]
					)
				).toMatchObject({ assignee_user_id: bob?.id });
				committed(
					yield* as.act('job_assignments.update', [{ target: job, set: { status: 'completed' } }])
				);
				const completed = (yield* read()).completed_at;
				t.clock.advance('1h');
				committed(
					yield* as.act('job_assignments.update', [{ target: job, set: { summary: 'done' } }])
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
					model: 'job_assignments',
					verb: 'update',
					input: [{ target: job, set: { external_ref: 'IMP-2' } }]
				})
			).toMatchObject({ kind: 'refused' });
			expect(
				yield* Effect.flip(
					as.act('job_assignments.update', [
						{
							target: job,
							set: { suspicion_checked_at: '2026-09-25T10:00:00.000Z' }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
	);
	it.live('an assignment files messages but never rewrites or removes a filed one', () =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { job } = yield* siteWithJob(t);
			const as = t.as(t.member(CONTROLLER));
			committed(
				yield* as.act('job_assignments.update', [
					{
						target: job,
						set: {
							communication_logs: {
								create: [
									{
										message: 'done',
										sent_at: '2026-09-25T10:00:00.000Z',
										sender: 'bob',
										source_message_id: 'm-filed'
									}
								]
							}
						}
					}
				])
			);
			const filed = yield* rows(
				t,
				'SELECT id, message FROM communication_logs WHERE job_assignment_id = $1',
				[job]
			);
			const log = fixtureId('communication_logs', present(filed[0]).id);
			const rewrite = (
				communication_logs: NonNullable<Patch<'job_assignments'>['communication_logs']>
			) =>
				Effect.flip(
					as.act('job_assignments.update', [{ target: job, set: { communication_logs } }])
				);
			expect(yield* rewrite({ delete: [log] })).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* rewrite({ update: [{ target: log, set: { message: 'edited' } }] })
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* rows(t, 'SELECT id, message FROM communication_logs WHERE job_assignment_id = $1', [
					job
				])
			).toEqual(filed);
		})
	);
});
describe('photo evidence', () => {
	it.live(
		'a photo filed directly is an uninspected workspace upload whose provenance never changes',
		() =>
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
					yield* Effect.flip(as.act('photo_evidence.create', [{ photo: file }]))
				).toMatchObject({
					_tag: 'ActRefused'
				}); // no parent
				// a direct create cannot claim a message source: only an assignment's update files one
				expect(
					yield* wireAct(t, as.authority, {
						model: 'photo_evidence',
						verb: 'create',
						input: [
							{
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
							}
						]
					})
				).toMatchObject({ kind: 'refused', code: 'invalidInput' });
				const [createdPhoto] = committed(
					yield* as.act('photo_evidence.create', [{ job_assignment_id: job, photo: file }])
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
						model: 'photo_evidence',
						verb: 'update',
						input: [
							{
								target: photo,
								set: { job_assignment_id: other.job }
							}
						]
					})
				).toMatchObject({
					kind: 'refused',
					code: 'invalidInput',
					message: expect.stringContaining("'job_assignment_id' is not accepted here")
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
					yield* as.act('communication_logs.create', [
						{
							job_assignment_id: job,
							message: 'done',
							sent_at: '2026-09-25T10:00:00.000Z',
							sender: 'bob',
							source_message_id: 'm1'
						}
					])
				);
				const log = fixtureId('communication_logs', createdLog);
				expect(
					yield* wireAct(t, as.authority, {
						model: 'communication_logs',
						verb: 'update',
						input: [{ target: log, set: { message: 'edited' } }]
					})
				).toMatchObject({ kind: 'refused' });
				const [createdFinding] = committed(
					yield* as.act('suspicious_activity_logs.create', [
						{
							job_assignment_id: job,
							reason: 'Two sites in one set'
						}
					])
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
				const started = yield* as.start('suspicious_activity_logs_resolve', {
					finding,
					resolution: 'Same site, two doors'
				});
				expect(started.kind).toBe('committed');
				if (started.kind !== 'committed') throw new Error('The finding resolution did not start.');
				expect(yield* completedRun(t, started.output.id)).toMatchObject({
					state: 'succeeded',
					error: null
				});
				const resolved = yield* rows(
					t,
					'SELECT resolution, resolved_at, resolved_by FROM suspicious_activity_logs WHERE id = $1',
					[finding]
				);
				expect(resolved).toMatchObject([{ resolution: 'Same site, two doors' }]);
				const repeated = yield* as.start('suspicious_activity_logs_resolve', {
					finding,
					resolution: 'again'
				});
				expect(repeated.kind).toBe('committed');
				if (repeated.kind !== 'committed')
					throw new Error('The repeated resolution did not start.');
				expect(yield* completedRun(t, repeated.output.id)).toMatchObject({
					state: 'failed',
					error: { code: 'refused' }
				});
				expect(
					yield* rows(
						t,
						'SELECT resolution, resolved_at, resolved_by FROM suspicious_activity_logs WHERE id = $1',
						[finding]
					)
				).toEqual(resolved);
				expect(
					yield* Effect.flip(
						as.act('suspicious_activity_logs.create', [
							{
								job_assignment_id: job,
								origin: 'automation',
								reason: 'x'
							}
						])
					)
				).toMatchObject({
					_tag: 'ActRefused',
					message: 'An automated suspicion judgement must supply its reviewed evidence basis.'
				});
			})
	);
});
it.live("a job is found by its own words and by its site's, a renamed one by its new title", () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { job } = yield* siteWithJob(t);
		const found = Effect.fnUntraced(function* (text: string) {
			const { job_assignments } = yield* t
				.as(t.member(CONTROLLER))
				.query({ job_assignments: { where: { $search: text }, fields: ['title'] } });
			return job_assignments.rows.map((row) => row.id);
		});
		expect(yield* found('Installation')).toEqual([job]);
		// the site's address is in its own search text, never in the job's
		expect(yield* found('Avenue')).toEqual([job]);
		committed(
			yield* t
				.as(t.admin)
				.act('job_assignments.update', [{ target: job, set: { title: 'Renamed' } }])
		);
		expect(yield* found('renamed')).toEqual([job]);
		expect(yield* found('Installation')).toEqual([]);
		expect(yield* found('Kismis Avenue')).toEqual([job]);
	})
);
