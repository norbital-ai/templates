import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentDate } from '../../lib/clock.js';
import { photoSourceKey, uninspectedPhotoFacts } from '../photo_evidence/photo-integrity.js';
import type { Row as PhotoEvidenceRow } from '../photo_evidence/$types.js';
import model from './+model.js';
import type { CreateInput, Row, UpdateInput } from './$types.js';

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

type FiledPhoto = Pick<PhotoEvidenceRow, 'photo'> & Partial<Pick<PhotoEvidenceRow, 'source'>>;
type FiledMessage = {
	readonly message: string;
	readonly sender: string;
	readonly source_message_id: string;
};

/**
 * A photo filed through its assignment is born uninspected, exactly as a direct upload is: an empty
 * hash and a zero vector until the suspicion review reads the bytes. A nested create does not run
 * `photo_evidence`'s own transform, so the facts it would stamp are stamped here.
 */
function filedPhoto(photo: FiledPhoto) {
	const source = photo.source ?? { kind: 'workspace_upload' as const };
	return {
		...photo,
		source,
		source_key: photoSourceKey(source, photo.photo.storage_key),
		...uninspectedPhotoFacts()
	};
}

function assertFiledMessage(message: FiledMessage): void {
	if (message.message.trim() === '') refuse('Communication log message cannot be empty.');
	if (message.sender.trim() === '') refuse('Communication log sender cannot be empty.');
	if (message.source_message_id.trim() === '') {
		refuse('Communication log source_message_id cannot be empty.');
	}
}

/**
 * A work order names its site and its day and may carry the dispatch system's reference and the
 * channel message it came from. The update selection carries the dispatch itself plus progress:
 * this is the collection where naming a contractor *is* the dispatch, so `assignee_user_id` and
 * `dispatched_at` are writable, while the identity keys (`external_ref`, `source_message_id`) are
 * not — a re-import may not restate who a job is.
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
			},
			/**
			 * A channel report lands on the work it is about as one write: the photos it carried, the
			 * messages that are its slice of the conversation, and the progress it reports.
			 */
			with: {
				job_assignment_photo_evidence: { create: { columns: { photo: true, source: true } } },
				job_assignment_communications: {
					create: {
						columns: { message: true, sent_at: true, sender: true, source_message_id: true }
					}
				}
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
			const siteIds = [
				...new Set(
					inputs.flatMap((input) => (typeof input.site_id === 'string' ? [input.site_id] : []))
				)
			];
			// A create may carry the channel message it came from; an update cannot name one.
			const claimedSources = inputs.flatMap((input) =>
				'source_message_id' in input && input.source_message_id ? [input.source_message_id] : []
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
			const takenSourceMessageIds = new Set([
				...sources.flatMap((row) => (row.source_message_id ? [row.source_message_id] : [])),
				...repeatedWithin(claimedSources)
			]);
			const now = (yield* currentDate).toISOString();

			/** The searchable copy: the work's own words plus the site's name and code. */
			const searchTextFor = (title: string, siteId: string): string => {
				const site = siteById.get(siteId);
				return [title, site?.name, site?.site_code].filter((part) => part != null).join(', ');
			};

			/** A filed work order: unassigned until a contractor is named, dispatched the moment one is. */
			const fileDispatch = (create: CreateInput) => {
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
			};

			/**
			 * Progress: assigning stamps the dispatch and completing stamps the completion, once each.
			 *
			 * Any change other than the review's own stamp makes the assignment unread again, so the
			 * suspicion review judges it afresh on its next run: new photos, a new status or a new
			 * message are new evidence. The review's stamp is the one write that names nothing else.
			 */
			const recordProgress = (input: UpdateInput, stored: Row) => {
				const reviewStamp = Object.entries(input).every(
					([key, value]) => key === 'suspicion_checked_at' || key === 'id' || value === undefined
				);
				const photos = input.job_assignment_photo_evidence?.create ?? [];
				const messages = input.job_assignment_communications?.create ?? [];
				messages.forEach(assertFiledMessage);
				const dispatchedAt =
					input.assignee_user_id != null &&
					stored.dispatched_at == null &&
					input.dispatched_at === undefined
						? now
						: undefined;
				const completedAt =
					input.status === 'completed' && (input.completed_at ?? stored.completed_at) == null
						? now
						: undefined;
				// The search copy follows the words it copies: a corrected title or a moved site.
				const searchText =
					input.title !== undefined || input.site_id !== undefined
						? searchTextFor(input.title ?? stored.title, input.site_id ?? stored.site_id)
						: undefined;
				return {
					...input,
					...(dispatchedAt === undefined ? {} : { dispatched_at: dispatchedAt }),
					...(completedAt === undefined ? {} : { completed_at: completedAt }),
					...(searchText === undefined ? {} : { search_text: searchText }),
					...(reviewStamp ? {} : { suspicion_checked_at: null }),
					...(photos.length === 0
						? {}
						: { job_assignment_photo_evidence: { create: photos.map(filedPhoto) } })
				};
			};

			/**
			 * One input per row the batch writes, paired positionally by the engine: an input with no
			 * stored row is the create arm. The declaration is a positional union rather than a
			 * discriminated one, so the pairing is stated here once and each arm then works in its own
			 * declared type — a create names its site and title, an update patches progress.
			 */
			return inputs.map((input, index) => {
				const stored = existing[index];
				return stored === undefined
					? fileDispatch(input as CreateInput)
					: recordProgress(input as UpdateInput, stored);
			});
		})
});
