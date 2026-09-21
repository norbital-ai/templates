import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import model from './+model.js';

const SITE_BATCH_LIMIT = 5000;

const columns = {
	external_ref: true,
	site_id: true,
	title: true,
	nature: true,
	scheduled_for: true,
	status: true,
	description: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	/**
	 * Refuses a job that names a site that does not exist, and files a new job as unassigned until a
	 * contractor is dispatched. The sites the batch names are read once: a dispatch import covering
	 * a handful of sites asks once, not once per job.
	 */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const siteIds = [
				...new Set(inputs.flatMap((input) => (input.site_id ? [input.site_id] : [])))
			];
			const sites =
				siteIds.length === 0
					? []
					: yield* db.sites.findMany({
							where: { id: { in: siteIds } },
							columns: { id: true },
							limit: SITE_BATCH_LIMIT
						});
			const known = new Set(sites.map((site) => site.id));
			return inputs.map((input, index) => {
				if (input.site_id !== undefined && !known.has(input.site_id)) {
					refuse('Referenced site does not exist.');
				}
				return existing[index] === undefined
					? { ...input, status: input.status ?? 'unassigned' }
					: input;
			});
		})
});
