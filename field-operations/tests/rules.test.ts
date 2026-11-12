import { present } from './test-runtime.js';
import type { Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Caller } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
/**
 * The data rules, one light check each: site identity and its location, dispatch stamps and the review reset, and a
 * human finding composed and resolved once. Photo provenance is `review.test.ts`.
 */
import { expect, it, layer } from '@effect/vitest';
import { siteKey } from '../src/lib/site-key.ts';
import { fixtureId } from './test-runtime.js';
import {
	committed,
	completedRun,
	CONTRACTOR,
	CONTROLLER,
	person,
	rootRows,
	rows,
	shared,
	siteWithJob,
	target
} from './kit.ts';
/** One site as the caller reads it, or `null`. */
const siteRow = Effect.fnUntraced(function* (as: Caller, site: Id<'sites'>) {
	return (
		rootRows(yield* as.query({ sites: { where: { id: { eq: site } }, limit: 1 } }), 'sites')[0] ??
		null
	);
});
it('a Singapore address is its postal code plus its unit, spelled one way', () => {
	expect(siteKey('58 Kismis Avenue, Singapore 598235')).toBe('598235');
	expect(siteKey('Blk 460133 #5-12')).toBe('460133#05-12');
	expect(siteKey('Blk 460133 #5-12', null)).toBe('460133');
	expect(siteKey('Edelweiss 119 #02-06, Singapore')).toBe('EDELWEISS 119#02-06');
	expect(siteKey('12  Block  Road Street Drive Avenue')).toBe('12 BLK RD ST DR AVE');
	expect(siteKey('3 RIDGEWOOD CLOSE SINGAPORE 276694', '16-03')).toBe('276694#16-03');
});
layer(shared())('field-operations rules', (it) => {
	it.effect('an address already filed is refused at its location', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const as = yield* t.as(t.member(CONTROLLER));
			committed(
				yield* as.act({
					'sites.create': [
						{ location: { lat: 1.34, lng: 103.77 }, address: '58 Kismis Ave, S598235' }
					]
				})
			);
			expect(
				yield* Effect.flip(
					as.act({
						'sites.create': [
							{
								location: { lat: 1.34, lng: 103.77 },
								address: '58 Kismis Avenue, Singapore 598235'
							}
						]
					})
				)
			).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.site_address_exists',
				message: expect.stringMatching(/^A site at this address already exists: .+\.$/),
				field: 'location'
			});
		})
	);
	it.effect('requires a location on writes and derives the title, keeping the unit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const as = yield* t.as(t.member(CONTROLLER));
			expect(
				yield* Effect.flip(as.act({ 'sites.create': [{ address: 'Unresolved address' }] }))
			).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.site_location_required',
				field: 'location'
			});
			const [created] = committed(
				yield* as.act({
					'sites.create': [{ location: { lat: 1.34, lng: 103.77 }, unit_number: '05-12' }]
				})
			);
			const site = fixtureId('sites', created);
			expect(yield* siteRow(as, site)).toMatchObject({
				name: '1.34, 103.77',
				unit_number: '05-12'
			});
			committed(
				yield* as.act({
					'sites.update': [
						{
							target: yield* target(t, 'sites', site),
							set: {
								location: { lat: 1.35, lng: 103.78 },
								address: 'Resolved map address, Singapore 598236'
							}
						}
					]
				})
			);
			expect(yield* siteRow(as, site)).toMatchObject({
				name: 'Resolved map address, Singapore 598236',
				unit_number: '05-12'
			});
		})
	);
	it.effect(
		'a local contractor number links the member and dispatches; completing stamps once, and any change but the stamp makes the job unread',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const { job } = yield* siteWithJob(t);
				const as = yield* t.as(t.member(CONTROLLER));
				const read = Effect.fnUntraced(function* () {
					return present((yield* rows(t, `SELECT * FROM job_assignments WHERE id = $1`, [job]))[0]);
				});
				const bob = yield* person(t, CONTRACTOR, '+6581234567');
				// a local number names the member stored with +65
				committed(
					yield* as.act({
						'job_assignments.update': [
							{
								target: yield* target(t, 'job_assignments', job),
								set: { assignee_contact: '8123 4567' }
							}
						]
					})
				);
				expect(yield* read()).toMatchObject({ status: 'pending', assignee_user_id: bob.id });
				const dispatched = (yield* read()).dispatched_at;
				expect(dispatched).not.toBeNull();
				committed(
					yield* as.act({
						'job_assignments.update': [
							{ target: yield* target(t, 'job_assignments', job), set: { status: 'completed' } }
						]
					})
				);
				const completed = (yield* read()).completed_at;
				t.clock.advance('1h');
				committed(
					yield* as.act({
						'job_assignments.update': [
							{ target: yield* target(t, 'job_assignments', job), set: { summary: 'done' } }
						]
					})
				);
				expect(yield* read()).toMatchObject({
					dispatched_at: dispatched,
					completed_at: completed,
					suspicion_checked_at: null
				});
			})
	);
	it.effect('a human finding composes its basis and is resolved once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { job } = yield* siteWithJob(t);
			const controller = yield* person(t, CONTROLLER);
			const as = yield* t.as(controller);
			const [createdFinding] = committed(
				yield* as.act({
					'suspicious_activity_logs.create': [
						{ job_assignment_id: job, reason: 'Two sites in one set' }
					]
				})
			);
			const finding = fixtureId('suspicious_activity_logs', createdFinding);
			const stored = present(
				(yield* rows(t, `SELECT basis, source_key FROM suspicious_activity_logs WHERE id = $1`, [
					finding
				]))[0]
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
			const resolve = Effect.fnUntraced(function* (resolution: string) {
				const started = yield* as.run(
					'suspicious_activity_logs_resolve',
					{ finding: [finding], resolution },
					JobResult
				);
				if (started.kind !== 'committed') throw new Error('The finding resolution did not start.');
				return yield* completedRun(t, started.output.id);
			});
			expect(yield* resolve('Same site, two doors')).toMatchObject({ state: 'succeeded' });
			const resolved = yield* rows(
				t,
				'SELECT resolution, resolved_at, resolved_by FROM suspicious_activity_logs WHERE id = $1',
				[finding]
			);
			// the run's trigger is the controller who started it
			expect(resolved).toMatchObject([
				{ resolution: 'Same site, two doors', resolved_by: controller.id }
			]);
			expect(yield* resolve('again')).toMatchObject({
				state: 'failed',
				error: { code: 'refused' }
			});
			expect(
				yield* Effect.flip(
					as.act({
						'suspicious_activity_logs.create': [
							{ job_assignment_id: job, origin: 'automation', reason: 'x' }
						]
					})
				)
			).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.finding_basis_required'
			});
		})
	);
});
