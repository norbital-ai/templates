import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import collection from '../src/collections/sites/+collection.js';
import pipelines from '../src/collections/job_assignments/+pipelines.js';
import { siteKey } from '../src/lib/site-key.mjs';

type Input = Readonly<Record<string, unknown>>;
type Transform = (
	inputs: ReadonlyArray<Input>,
	context: { readonly existing: ReadonlyArray<Input | undefined>; readonly db: unknown }
) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, unknown>;
const transform = collection.transform as unknown as Transform;

const KISMIS = {
	id: '10000000-0000-4000-8000-000000000001',
	name: '58 Kismis Avenue, Singapore 598235'
};
const MOVED_JOB = { id: '30000000-0000-4000-8000-000000000001', title: 'Survey — Kismis' };
const assignee = '20000000-0000-4000-8000-000000000001';
const job = {
	title: 'Installation — 58 Kismis Ave',
	scheduled_for: '2026-10-01T00:00:00.000Z',
	description: 'Grab bars'
} as const;

type Stored = { readonly id: string; readonly name: string; readonly location?: unknown };

/** The sites transform's reads: sites by key, and the jobs a batch moves. */
const db = (stored: ReadonlyArray<Stored>) => ({
	sites: {
		findMany: (query: { where: { site_key: { in: ReadonlyArray<string> } } }) =>
			Effect.succeed(
				stored
					.map((site) => ({ ...site, site_code: null, site_key: siteKey(site.name) }))
					.filter((site) => query.where.site_key.in.includes(site.site_key))
			)
	},
	job_assignments: { findMany: () => Effect.succeed([MOVED_JOB]) }
});

const run = (
	inputs: ReadonlyArray<Input>,
	existing: ReadonlyArray<Input | undefined>,
	stored = [KISMIS]
) => Effect.runPromise(transform(inputs, { existing, db: db(stored) }));

test('work filed at an address a site carries lands on that site', async () => {
	const [payload] = await run(
		[
			{
				name: '58 Kismis Ave, S598235',
				site_assignments: { create: [{ ...job, assignee_user_id: assignee }] }
			}
		],
		[undefined]
	);
	// The stored id turns the create into an update of the site; its own fields are left alone.
	assert.equal(payload?.id, KISMIS.id);
	assert.equal('name' in (payload ?? {}), false);
	const [filed] = (payload?.site_assignments as { create: Array<Record<string, unknown>> }).create;
	assert.equal(filed?.status, 'assigned');
	assert.equal(typeof filed?.dispatched_at, 'string');
	assert.equal(filed?.search_text, `${job.title}, ${KISMIS.name}`);
});

test('work filed at a new address creates the site with it', async () => {
	const [payload] = await run(
		[{ name: '6 Sunset Vale, Singapore 597232', site_assignments: { create: [job] } }],
		[undefined]
	);
	assert.equal(payload?.id, undefined);
	assert.equal(payload?.name, '6 Sunset Vale, Singapore 597232');
	const [filed] = (payload?.site_assignments as { create: Array<Record<string, unknown>> }).create;
	assert.equal(filed?.status, 'unassigned');
	assert.equal(filed?.dispatched_at, null);
	assert.equal(filed?.search_text, `${job.title}, 6 Sunset Vale, Singapore 597232`);
});

test('a job moved to an address keeps its search copy in step with the site', async () => {
	const [payload] = await run(
		[
			{
				name: '58 Kismis Avenue, Singapore 598235',
				site_assignments: { link: [{ id: MOVED_JOB.id }] }
			}
		],
		[undefined]
	);
	assert.equal(payload?.id, KISMIS.id);
	assert.deepEqual((payload?.site_assignments as { link: unknown }).link, [
		{ id: MOVED_JOB.id, set: { search_text: `${MOVED_JOB.title}, ${KISMIS.name}` } }
	]);
});

test('adding a site that is already filed names the site that carries the address', async () => {
	await assert.rejects(
		run([{ name: '58  KISMIS AVE , Singapore 598235' }], [undefined]),
		/A site at this address already exists: 58 Kismis Avenue, Singapore 598235/
	);
	await assert.rejects(
		run(
			[{ name: '6 Sunset Vale 597232' }, { name: '6 Sunset Vale, Singapore 597232' }],
			[undefined, undefined]
		),
		/Two sites in this batch have one address/
	);
	await assert.rejects(run([{ name: ' , ' }], [undefined]), /A site needs an address/);
});

test('a site may be edited but not moved onto another site’s address', async () => {
	const sunset = {
		id: '10000000-0000-4000-8000-000000000002',
		name: '6 Sunset Vale, Singapore 597232'
	};
	const [renamed] = await run([{ client_name: 'Owner' }], [sunset], [KISMIS, sunset]);
	assert.equal(renamed?.client_name, 'Owner');
	await assert.rejects(
		run([{ name: '58 Kismis Avenue 598235' }], [sunset], [KISMIS, sunset]),
		/Another site already has this address/
	);
});

type Filed = { site_id: string; scheduled_for: string; title: string; external_ref?: string };
const importHandler = pipelines.import.handler as unknown as (
	args: { readonly input: unknown },
	api: unknown
) => Effect.Effect<ReadonlyArray<Filed>>;

/** An in-memory workspace for the import pipeline: what it reads, and what it files. */
const workspace = () => {
	const sites: Array<{ id: string; name: string; site_code: string | null }> = [
		{ ...KISMIS, site_code: null }
	];
	const jobs: Array<Filed> = [];
	const api = {
		db: {
			sites: {
				findMany: () =>
					Effect.succeed(sites.map((site) => ({ ...site, site_key: siteKey(site.name) })))
			},
			job_assignments: { findMany: () => Effect.succeed([...jobs]) }
		},
		collection: {
			sites: {
				createMany: (inputs: ReadonlyArray<{ name: string }>) =>
					Effect.sync(() =>
						inputs.map(({ name }) => {
							const site = { id: `site-${sites.length + 1}`, name, site_code: null };
							sites.push(site);
							return site;
						})
					)
			}
		}
	};
	/** The engine writes what the pipeline returns as job_assignments creates. */
	const importSheet = async (rows: ReadonlyArray<Record<string, string>>) => {
		const payloads = await Effect.runPromise(importHandler({ input: { rows } }, api));
		jobs.push(...payloads);
		return payloads;
	};
	return { sites, jobs, importSheet };
};

test('importing the same sheet twice files no site and no job twice', async () => {
	const { sites, jobs, importSheet } = workspace();
	const sheet = [
		// An existing site, spelled differently, with its postal code in its own column.
		{ site: '58 Kismis Ave', postal_code: '598235', scheduled_for: '2026-10-01', title: 'Survey' },
		{
			site: '6 Sunset Vale',
			postal_code: '597232',
			scheduled_for: '2026-10-02',
			title: 'Install',
			external_ref: 'D-1'
		},
		{ site: '6 Sunset Vale, Singapore 597232', scheduled_for: '2026-10-03', title: 'Handover' }
	];

	const first = await importSheet(sheet);
	assert.equal(first.length, 3);
	assert.equal(sites.length, 2, 'one new site for the one new address');
	assert.equal(first[0]?.site_id, KISMIS.id);
	assert.equal(first[1]?.site_id, first[2]?.site_id);

	const second = await importSheet(sheet);
	assert.deepEqual(second, []);
	assert.equal(sites.length, 2);
	assert.equal(jobs.length, 3);
});
