import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDate } from '../../lib/clock.js';
import model from './+model.js';
import type { CreateInput } from './$types.js';

const SITE_BATCH_LIMIT = 5_000;
const SOURCE_BATCH_LIMIT = 5_000;

/** Which values a batch claims more than once — the one thing a stored-row read cannot see. */
function repeatedWithin(values: ReadonlyArray<string>): ReadonlySet<string> {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return repeated;
}

const createColumns = {
	external_ref: true,
	site_id: true,
	title: true,
	nature: true,
	scheduled_for: true,
	description: true,
	assignee_user_id: true,
	dispatched_at: true,
	status: true,
	completed_at: true,
	amount_charged: true,
	location: true,
	summary: true,
	source_message_id: true
} as const;

/**
 * A work order names its site and its day and may carry the dispatch system's reference and the
 * channel message it came from. The update selection carries the dispatch itself plus progress:
 * this is the collection where naming a contractor *is* the dispatch, so `assignee_user_id` and
 * `dispatched_at` are writable, while the identity keys (`external_ref`, `source_message_id`) are
 * not — a redelivery or a re-import may not restate who a job is.
 */
export default defineCollection({
	model,
	create: { input: { columns: createColumns } },
	update: {
		input: {
			columns: {
				site_id: true,
				title: true,
				nature: true,
				scheduled_for: true,
				description: true,
				assignee_user_id: true,
				dispatched_at: true,
				status: true,
				completed_at: true,
				amount_charged: true,
				location: true,
				summary: true,
				suspicion_checked_at: true
			}
		}
	},
	delete: {},
	/**
	 * Refuses a job that names a site that does not exist, files it unassigned until a contractor
	 * holds it, stamps the dispatch when one is named and stamps completion when the work is moved
	 * to `completed`. The world one batch asks about — does the site exist, is the source message
	 * already used — is read once for the whole batch. Assignee existence is the database foreign
	 * key's to check: authored code holds no query over the private user table.
	 */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			// The create half of the batch: an input with no stored row is always the create payload.
			const creates = inputs.flatMap((input, index) =>
				existing[index] === undefined ? [input as CreateInput] : []
			);
			const siteIds = [
				...new Set(
					inputs.flatMap((input) => {
						const id = 'site_id' in input ? input.site_id : undefined;
						return typeof id === 'string' ? [id] : [];
					})
				)
			];
			const claimedSources = creates.flatMap((input) =>
				input.source_message_id ? [input.source_message_id] : []
			);
			const sourceMessageIds = [...new Set(claimedSources)];
			const [sites, sources] = yield* Effect.all(
				[
					siteIds.length === 0
						? Effect.succeed([])
						: db.sites.findMany({
								where: { id: { in: siteIds } },
								columns: { id: true, name: true, site_code: true },
								limit: SITE_BATCH_LIMIT
							}),
					sourceMessageIds.length === 0
						? Effect.succeed([])
						: db.job_assignments.findMany({
								where: { source_message_id: { in: sourceMessageIds } },
								columns: { source_message_id: true },
								limit: SOURCE_BATCH_LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			const siteById = new Map(sites.map((site) => [site.id, site]));
			const knownSites = new Set(siteById.keys());
			/** The searchable copy: the work's own words plus the site's name and code. */
			const searchTextFor = (title: string, siteId: string): string => {
				const site = siteById.get(siteId);
				return [title, site?.name, site?.site_code].filter((part) => part != null).join(', ');
			};
			const takenSourceMessageIds = new Set([
				...sources.flatMap((row) => (row.source_message_id ? [row.source_message_id] : [])),
				...repeatedWithin(claimedSources)
			]);
			const now = (yield* currentDate).toISOString();
			return inputs.map((input, index) => {
				const stored = existing[index];
				if (stored === undefined) {
					// The create half of the batch, typed: the union's create arm is the one carrying
					// the identity keys.
					const create = input as CreateInput;
					if (create.site_id === undefined || !knownSites.has(create.site_id)) {
						refuse('Referenced site does not exist.');
					}
					if (create.source_message_id && takenSourceMessageIds.has(create.source_message_id)) {
						refuse('A job assignment with this source_message_id already exists.');
					}
					const assignee = create.assignee_user_id ?? null;
					return {
						...create,
						status: create.status ?? (assignee === null ? 'unassigned' : 'assigned'),
						dispatched_at: create.dispatched_at ?? (assignee === null ? null : now),
						// Derived last so a caller cannot forge or stale the board's search copy.
						search_text: searchTextFor(create.title, create.site_id)
					};
				}
				const patch: Record<string, unknown> = { ...input };
				// Assigning names a contractor and stamps when; completing stamps when, both only once.
				if (
					input.assignee_user_id !== undefined &&
					input.assignee_user_id !== null &&
					stored.dispatched_at == null &&
					input.dispatched_at === undefined
				) {
					patch.dispatched_at = now;
				}
				if (
					input.status === 'completed' &&
					(input.completed_at ?? stored.completed_at) == null
				) {
					patch.completed_at = now;
				}
				// The search copy follows the words it copies: a corrected title or a moved site.
				if (input.title !== undefined || input.site_id !== undefined) {
					patch.search_text = searchTextFor(
						input.title ?? String(stored.title ?? ''),
						input.site_id ?? String(stored.site_id ?? '')
					);
				}
				return patch;
			});
		})
});
