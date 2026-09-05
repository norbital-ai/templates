import { refuse, type MutatePrepareContext } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { rowsById } from '../../lib/batch-reads.js';
import type { Hooks } from './$types.js';

const ACCOUNT_BATCH_LIMIT = 5000;

/**
 * The accounts this batch of contacts names, read once.
 *
 * One existence check per contact was one round trip per contact; an import of a thousand contacts
 * belonging to a handful of accounts now asks once. `prepare` decides nothing — the refusal is
 * still written once, for one contact.
 */
interface ContactBatch {
	readonly accountIds: ReadonlySet<string>;
}

type PrepareApi = MutatePrepareContext<Hooks<ContactBatch>>['api'];

/** The accounts a batch of contacts names, by id. */
const accountsByIds = (api: PrepareApi) => (ids: readonly string[]) =>
	api.db.accounts.findMany({
		where: { id: { in: ids } },
		columns: { id: true },
		limit: ACCOUNT_BATCH_LIMIT
	});

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.map(
				rowsById(inputs, (input) => input.account_id, accountsByIds(api)),
				(accounts) => ({
					accountIds: new Set(accounts.keys())
				})
			),
		perRecord: {
			before: {
				description: 'Refuses a contact that is not attached to an account on file.',
				handler: ({ input, existing, prepared }) => {
					if (existing !== undefined && input.account_id === undefined) return input;
					if (!input.account_id) refuse('A contact must reference an account.');
					if (!prepared.accountIds.has(input.account_id)) {
						refuse('Referenced account does not exist.');
					}
					return input;
				}
			}
		}
	}
} satisfies Hooks<ContactBatch>;
