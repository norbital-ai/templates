import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { batchEntries } from '../../lib/lifecycle.js';
import model from './+model.js';

const columns = {
	external_code: true,
	code: true,
	name: true,
	contact: true,
	category: true,
	currency: true,
	payment_terms_days: true,
	phone: true,
	email: true,
	address: true,
	active: true
} as const;

function normalizeName(name: string): string {
	const normalized = name.trim();
	if (!normalized) refuse('Supplier name is required.');
	return normalized;
}

function validatePaymentTermsDays(value: number | null | undefined): void {
	if (value == null) return;
	if (!Number.isInteger(value) || value < 0 || value > 365) {
		refuse('Payment terms must be an integer between 0 and 365 days.');
	}
}

/**
 * Uppercases the supplier code and trims the name on creation, keeps payment terms within 0 to
 * 365 days, and refuses to change a supplier code once it is set.
 */
const create = { input: { columns } } as const;
const update = create;
type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;

export default defineCollection({
	model,
	create,
	update,
	transform: (inputs, { existing }) =>
		Effect.sync(() =>
			batchEntries<Create, Update, WorkspaceRow<'suppliers'>>(inputs, existing).map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					validatePaymentTermsDays(input.payment_terms_days);
					const code = input.code.trim().toUpperCase();
					if (!code) refuse('Supplier code is required.');
					return { ...input, code, name: normalizeName(input.name) };
				}
				const { input, stored } = entry;
				if (input.code != null && input.code !== stored.code) {
					refuse('Supplier code cannot be changed once set.');
				}
				if (input.name != null) normalizeName(input.name);
				validatePaymentTermsDays(input.payment_terms_days ?? stored.payment_terms_days);
				return input;
			})
		)
});
