import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDate } from '../../lib/clock.js';
import { siteKey } from '../../lib/site-key.mjs';
import { dispatchFacts, searchTextFor } from '../job_assignments/dispatch.js';
import model from './+model.js';
import type { CreateInput, Row, UpdateInput } from './$types.js';

const SITE_BATCH_LIMIT = 5_000;

const columns = {
	site_code: true,
	name: true,
	location: true,
	client_name: true,
	house_type: true,
	floor_area_sqm: true
} as const;

/**
 * Work filed at an address, from the job's side: a job created under the site, or an existing job
 * moved to it. Written through the site because a job cannot create the site it points at — only a
 * parent's `with` carries relation actions.
 */
const siteAssignments = {
	create: {
		columns: {
			external_ref: true,
			title: true,
			nature: true,
			scheduled_for: true,
			description: true,
			assignee_user_id: true
		}
	},
	link: {}
} as const;

type Jobs = NonNullable<CreateInput['site_assignments']>;
/** A stored site or a create naming one: a create may omit `site_code`. */
type SiteWords = Pick<Row, 'name'> & Partial<Pick<Row, 'site_code'>>;

/**
 * A site is identified by its address (`site_key`, generated from `name` and `location`), so
 * creating one is an upsert. A create that files work at an address a site already carries puts the
 * work on that site; a bare create of an address already filed is refused with the site's name,
 * because the person asked to add a site that exists. An update may not move a site onto another
 * site's address.
 *
 * Jobs arriving through `site_assignments` skip `job_assignments`' own transform, so the facts it
 * stamps on a filed job are stamped here from the same `dispatchFacts`.
 */
export default defineCollection({
	model,
	create: { input: { columns, with: { site_assignments: siteAssignments } } },
	update: { input: { columns, with: { site_assignments: siteAssignments } } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const keys = inputs.map((input, index) => {
				const stored = existing[index];
				const location = input.location !== undefined ? input.location : stored?.location;
				return siteKey(input.name ?? stored?.name ?? '', location?.formatted_address);
			});
			if (keys.some((key) => key === '')) refuse('A site needs an address.');
			if (new Set(keys).size < keys.length) refuse('Two sites in this batch have one address.');
			const linkedIds = inputs.flatMap(
				(input) => input.site_assignments?.link?.map((link) => link.id) ?? []
			);
			const [holders, linked] = yield* Effect.all(
				[
					db.sites.findMany({
						where: { site_key: { in: keys } },
						columns: { id: true, name: true, site_code: true, site_key: true },
						limit: SITE_BATCH_LIMIT
					}),
					linkedIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { id: { in: linkedIds } },
								columns: { id: true, title: true },
								limit: SITE_BATCH_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			const holderByKey = new Map(holders.map((site) => [site.site_key, site]));
			const titleById = new Map(linked.map((job) => [job.id, job.title]));
			const now = (yield* currentDate).toISOString();

			const fileJobs = (jobs: Jobs | undefined, site: SiteWords) =>
				jobs === undefined
					? {}
					: {
							site_assignments: {
								...(jobs.create === undefined
									? {}
									: {
											create: jobs.create.map((job) => ({
												...job,
												...dispatchFacts(job, site, now)
											}))
										}),
								...(jobs.link === undefined
									? {}
									: {
											link: jobs.link.map((link) => ({
												...link,
												set: {
													...link.set,
													search_text: searchTextFor(titleById.get(link.id) ?? '', site)
												}
											}))
										})
							}
						};

			return inputs.map((input, index) => {
				const stored = existing[index];
				const holder = holderByKey.get(keys[index]!);
				if (stored === undefined) {
					const create = input as CreateInput;
					if (holder === undefined)
						return { ...create, ...fileJobs(create.site_assignments, create) };
					if (create.site_assignments === undefined)
						refuse(`A site at this address already exists: ${holder.name}.`);
					// Naming the stored row turns this create into an update of it.
					return { id: holder.id, ...fileJobs(create.site_assignments, holder) };
				}
				const update = input as UpdateInput;
				if (holder !== undefined && holder.id !== stored.id)
					refuse(`Another site already has this address: ${holder.name}.`);
				return {
					...update,
					...fileJobs(update.site_assignments, {
						name: update.name ?? stored.name,
						site_code: update.site_code !== undefined ? update.site_code : stored.site_code
					})
				};
			});
		})
});
