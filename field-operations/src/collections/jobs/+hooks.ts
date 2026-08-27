import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';

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

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type JobHooks = CollectionHooks<WorkspaceSchema, 'jobs', JobBatch>;

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
						throw new Error('Job must reference a site.');
					}
					if (!prepared.siteIds.has(input.site_id)) {
						throw new Error('Referenced site does not exist.');
					}

					return {
						...input,
						status: input.status ?? 'unassigned'
					};
				}
			}
		}
	}
} satisfies JobHooks;
