import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

const columns = {
	account_id: true,
	first_name: true,
	last_name: true,
	email: true,
	title: true,
	department: true,
	active: true
} as const;

const create = { input: { columns } } as const;
const update = create;

export default defineCollection({
	model,
	create,
	update,
	/** Refuses a contact that is not attached to an account on file — one read for the batch. */
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const accountIds = uniqueIds(inputs.map((input) => input.account_id));
			const accounts = accountIds.length
				? yield* db.accounts.findMany({
						where: { id: { in: accountIds } },
						columns: { id: true },
						limit: 5000
					})
				: [];
			const known = new Set(accounts.map((account) => account.id));
			return inputs.map((input, i) => {
				if (existing[i] !== undefined && input.account_id === undefined) return input;
				if (!input.account_id) refuse('A contact must reference an account.');
				if (!known.has(input.account_id)) refuse('Referenced account does not exist.');
				return input;
			});
		})
});
