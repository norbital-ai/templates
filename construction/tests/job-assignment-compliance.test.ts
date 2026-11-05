import { Effect } from 'effect';
/**
 * L-TPL-construction-008: an assignment is refused unless the worker's active, in-force permits cover every
 * certification some job at that site requires; it is re-checked when the site changes.
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import type { Insert } from '@norbital-ai/bolt';
const UNCERTIFIED = /Worker must satisfy at least one site-location job requirement/;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// seed/test: a job at the Tower needs certifications A and B; Dan's active permit covers only A, Eve's both
const SITE = uuid(3),
	BARE = uuid(4),
	DAN = uuid(6),
	EVE = uuid(13);
it.live('refuses an uncertified worker and admits a covered one, on create and on a move', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({
			root: fileURLToPath(new URL('..', import.meta.url)),
			now: '2026-06-01T00:00:00.000Z'
		});
		const admin = t.as(t.admin);
		const assign = (worker: string) =>
			({
				worker_id: fixtureId('workers', worker),
				site_location_id: fixtureId('site_locations', SITE),
				status: 'assigned'
			}) satisfies Insert<'job_assignments'>;
		// one of two required certifications is not enough
		expect(yield* Effect.flip(admin.act('job_assignments.create', [assign(DAN)]))).toMatchObject({
			_tag: 'ActRefused',
			message: expect.stringMatching(UNCERTIFIED)
		});
		const created = yield* admin.act('job_assignments.create', [assign(EVE)]);
		const assignment =
			created.kind === 'committed'
				? created.records.find((record) => record.model === 'job_assignments')
				: undefined;
		if (assignment === undefined) throw new Error(`job_assignments: ${JSON.stringify(created)}`);
		// a move to a site whose jobs require nothing is re-judged and refused
		expect(
			yield* Effect.flip(
				admin.act('job_assignments.update', [
					{
						target: fixtureId('job_assignments', assignment.id),
						set: { site_location_id: fixtureId('site_locations', BARE) }
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused', message: expect.stringMatching(UNCERTIFIED) });
	}).pipe(Effect.scoped)
);
