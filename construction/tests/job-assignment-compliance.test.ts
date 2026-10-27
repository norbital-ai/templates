import { Effect } from 'effect';
/**
 * L-TPL-construction-008: an assignment is refused unless the worker's active, in-force permits cover every
 * certification some job at that site requires; it is re-checked when the worker or the site changes.
 */
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import type { ModelName, Insert, Committed, PendingApproval } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
const UNCERTIFIED = /Worker must satisfy at least one site-location job requirement/;
it.live('refuses an uncertified worker and admits a covered one, on create and on a move', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root: fileURLToPath(new URL('..', import.meta.url)) });
		const admin = t.as(t.admin);
		const id = <A, N extends string, const C extends ModelName>(
			model: C,
			outcome: Committed<A, N> | PendingApproval<N>
		) => {
			if (outcome.kind !== 'committed') throw new Error(`${model}: ${JSON.stringify(outcome)}`);
			const record = outcome.records.find((record) => record.model === model);
			if (record === undefined) throw new Error(`${model}: no record committed`);
			return fixtureId(model, record.id);
		};
		const certA = id(
			'certification_types',
			yield* admin.act('certification_types.create', [{ certification_name: 'A' }])
		);
		const certB = id(
			'certification_types',
			yield* admin.act('certification_types.create', [{ certification_name: 'B' }])
		);
		const site = id(
			'site_locations',
			yield* admin.act('site_locations.create', [{ location_name: 'Tower' }])
		);
		const bare = id(
			'site_locations',
			yield* admin.act('site_locations.create', [{ location_name: 'Yard' }])
		);
		const job = id('jobs', yield* admin.act('jobs.create', [{ job_title: 'Steel' }]));
		const jobSite = id(
			'jobs_site_locations',
			yield* admin.act('jobs_site_locations.create', [{ job_id: job, site_location_id: site }])
		);
		id(
			'jobs_certification_types',
			yield* admin.act('jobs_certification_types.create', [
				{
					job_id: job,
					certification_type_id: certA
				}
			])
		);
		id(
			'jobs_certification_types',
			yield* admin.act('jobs_certification_types.create', [
				{
					job_id: job,
					certification_type_id: certB
				}
			])
		);
		const worker = id('workers', yield* admin.act('workers.create', [{ worker_name: 'Dan' }]));
		const permit = id(
			'permits_to_work',
			yield* admin.act('permits_to_work.create', [
				{
					permit_number: 'PTW-1',
					status: 'active',
					validity_range: { from: PlainDate('2026-01-01'), to: PlainDate('2026-12-31') }
				}
			])
		);
		const permitWorker = id(
			'permits_to_work_workers',
			yield* admin.act('permits_to_work_workers.create', [
				{
					permits_to_work_id: permit,
					worker_id: worker
				}
			])
		);
		id(
			'permits_to_work_certification_types',
			yield* admin.act('permits_to_work_certification_types.create', [
				{
					permits_to_work_id: permit,
					certification_type_id: certA
				}
			])
		);
		// a join row is named by its two sides: a label is never a foreign key
		const sorted = <R extends { readonly name: unknown }>(rows: readonly R[]) =>
			rows.map((r) => r.name).sort();
		const names = Effect.fnUntraced(function* () {
			const read = yield* admin.query({
				jobs_site_locations: { fields: ['name'] },
				jobs_certification_types: { fields: ['name'] },
				permits_to_work_workers: { fields: ['name'] },
				permits_to_work_certification_types: { fields: ['name'] }
			});
			return {
				jobs_site_locations: sorted(read.jobs_site_locations.rows),
				jobs_certification_types: sorted(read.jobs_certification_types.rows),
				permits_to_work_workers: sorted(read.permits_to_work_workers.rows),
				permits_to_work_certification_types: sorted(read.permits_to_work_certification_types.rows)
			};
		});
		expect((yield* names()).jobs_site_locations).toEqual(['Steel · Tower']);
		expect(
			yield* admin.act('jobs_site_locations.update', [
				{
					target: jobSite,
					set: { site_location_id: bare }
				}
			])
		).toMatchObject({ kind: 'committed' });
		expect((yield* names()).jobs_site_locations).toEqual(['Steel · Yard']);
		expect(
			yield* admin.act('jobs_site_locations.update', [
				{
					target: jobSite,
					set: { site_location_id: site }
				}
			])
		).toMatchObject({ kind: 'committed' });
		expect(
			yield* admin.act('permits_to_work_workers.update', [{ target: permitWorker, set: {} }])
		).toMatchObject({ kind: 'committed' });
		expect((yield* names()).jobs_certification_types).toEqual(['Steel · A', 'Steel · B']);
		expect((yield* names()).permits_to_work_workers).toEqual(['PTW-1 · Dan']);
		expect((yield* names()).permits_to_work_certification_types).toEqual(['PTW-1 · A']);
		const assign = {
			worker_id: worker,
			site_location_id: site,
			status: 'assigned'
		} satisfies Insert<'job_assignments'>;
		expect(yield* Effect.flip(admin.act('job_assignments.create', [assign]))).toMatchObject({
			_tag: 'ActRefused',
			message: expect.stringMatching(UNCERTIFIED)
		});
		id(
			'permits_to_work_certification_types',
			yield* admin.act('permits_to_work_certification_types.create', [
				{
					permits_to_work_id: permit,
					certification_type_id: certB
				}
			])
		);
		const uncoveredWorker = id(
			'workers',
			yield* admin.act('workers.create', [{ worker_name: 'Uncovered' }])
		);
		expect(
			yield* Effect.flip(
				admin.act('job_assignments.create', [assign, { ...assign, worker_id: uncoveredWorker }])
			)
		).toMatchObject({ _tag: 'ActRefused', message: expect.stringMatching(UNCERTIFIED) });
		expect((yield* admin.query({ job_assignments: {} })).job_assignments.rows).toHaveLength(0);
		const assignment = id('job_assignments', yield* admin.act('job_assignments.create', [assign]));
		// a move to a site whose jobs require nothing is refused; an edit that leaves worker and site alone is not re-judged
		expect(
			yield* Effect.flip(
				admin.act('job_assignments.update', [
					{
						target: assignment,
						set: { site_location_id: bare }
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused', message: expect.stringMatching(UNCERTIFIED) });
		t.clock.set('2027-02-01T00:00:00.000Z');
		expect(
			yield* admin.act('job_assignments.update', [
				{
					target: assignment,
					set: { status: 'completed' }
				}
			])
		).toMatchObject({
			kind: 'committed'
		});
		// once the permit has lapsed, a new assignment is refused
		expect(yield* Effect.flip(admin.act('job_assignments.create', [assign]))).toMatchObject({
			_tag: 'ActRefused'
		});
	}).pipe(Effect.scoped)
);
