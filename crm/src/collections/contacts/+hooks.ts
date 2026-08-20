import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';

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

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type ContactHooks = CollectionHooks<WorkspaceSchema, 'contacts', ContactBatch>;

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const accountIds = [
					...new Set(inputs.flatMap((input) => (input.account_id ? [input.account_id] : [])))
				];
				const accounts = accountIds.length
					? yield* api.db.query.accounts.findMany({
							where: { norbital_id: { in: accountIds } },
							columns: { norbital_id: true },
							limit: ACCOUNT_BATCH_LIMIT
						})
					: [];
				return { accountIds: new Set(accounts.map((account) => account.norbital_id)) };
			}),
		perRecord: {
			before: {
				description: 'Refuses a contact that is not attached to an account on file.',
				handler: ({ input, prepared }) => {
					if (!input.account_id) throw new Error('A contact must reference an account.');
					if (!prepared.accountIds.has(input.account_id)) {
						throw new Error('Referenced account does not exist.');
					}
					return input;
				}
			}
		}
	}
} satisfies ContactHooks;
