/**
 * The job-assignment compliance rule, run through the collection's own `transform` against a
 * stub read surface: a worker whose active permit covers every certification a site job requires
 * passes; one whose permit misses a certification is refused with the authored sentence.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Exit } from 'effect';
import collection from '../src/collections/job_assignments/+collection.ts';

type Transform = NonNullable<typeof collection.transform>;
type Context = Parameters<Transform>[1];

const WORKER = 'worker-1';
const SITE = 'site-1';
const PERMIT = 'permit-1';
const JOB = 'job-1';

const rows: Record<string, ReadonlyArray<Record<string, unknown>>> = {
	permits_to_work_workers: [{ permits_to_work_id: PERMIT, worker_id: WORKER }],
	jobs_site_locations: [{ job_id: JOB, site_location_id: SITE }],
	permits_to_work: [{ id: PERMIT, status: 'active', validity_range: null }],
	permits_to_work_certification_types: [
		{ permits_to_work_id: PERMIT, certification_type_id: 'cert-a' }
	],
	jobs_certification_types: [
		{ job_id: JOB, certification_type_id: 'cert-a' },
		{ job_id: JOB, certification_type_id: 'cert-b' }
	]
};

/** Every collection answers its whole fixture; the transform filters by id itself. */
const db = new Proxy(
	{},
	{
		get: (_, collectionName: string) => ({
			findMany: () => Effect.succeed(rows[collectionName] ?? [])
		})
	}
) as Context['db'];

const run = (transform: Transform) =>
	Effect.runPromiseExit(
		transform([{ worker_id: WORKER, site_location_id: SITE }], { existing: [undefined], db })
	);

test('refuses a worker whose permits miss a required certification', async () => {
	assert.ok(collection.transform);
	const exit = await run(collection.transform);
	assert.ok(Exit.isFailure(exit));
	assert.match(JSON.stringify(exit), /Worker must satisfy at least one site-location job/);
});

test('admits a worker whose active permit covers every required certification', async () => {
	assert.ok(collection.transform);
	rows['permits_to_work_certification_types'] = [
		{ permits_to_work_id: PERMIT, certification_type_id: 'cert-a' },
		{ permits_to_work_id: PERMIT, certification_type_id: 'cert-b' }
	];
	const exit = await run(collection.transform);
	assert.ok(Exit.isSuccess(exit));
	assert.deepEqual(exit.value, [{ worker_id: WORKER, site_location_id: SITE }]);
});
