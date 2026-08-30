import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Hooks } from './$types.js';

const SITE_BATCH_LIMIT = 5000;

/**
 * The sites this batch of jobs names, read once.
 *
 * One existence check per job was one round trip per job; a dispatch import covering a handful of
 * sites now asks once. `prepare` decides nothing — the refusal is still written once, for one job.
 */
interface JobBatch {
	readonly siteIds: ReadonlySet<string>;
}

export default {
	mutate: {
		prepare: ({ inputs, api }) => {
			const siteIds = [
				...new Set(inputs.flatMap((input) => (input.site_id ? [input.site_id] : [])))
			];
			if (siteIds.length === 0) return Effect.succeed({ siteIds: new Set<string>() });
			return Effect.map(
				api.db.sites.findMany({
					where: { id: { in: siteIds } },
					columns: { id: true },
					limit: SITE_BATCH_LIMIT
				}),
				(sites) => ({ siteIds: new Set(sites.map((site) => site.id)) })
			);
		},
		perRecord: {
			before: {
				description:
					'Refuses a job that names no site or a site that does not exist, and files a new job as unassigned until a contractor is dispatched.',
				handler: ({ input, prepared }) => {
					if (input.site_id == null || input.site_id === '') {
						refuse('Job must reference a site.');
					}
					if (!prepared.siteIds.has(input.site_id)) {
						refuse('Referenced site does not exist.');
					}

					return {
						...input,
						status: input.status ?? 'unassigned'
					};
				}
			}
		}
	}
} satisfies Hooks<JobBatch>;
