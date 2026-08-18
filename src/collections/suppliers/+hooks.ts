import type { Hooks, WorkspaceRow } from './$types.js';

function normalizeCode(code: string): string {
	const normalized = code.trim().toUpperCase();
	if (!normalized) throw new Error('Supplier code is required.');
	return normalized;
}

function normalizeName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new Error('Supplier name is required.');
	return normalized;
}

function validatePaymentTermsDays(value: number | null | undefined): void {
	if (value == null) return;
	if (!Number.isInteger(value) || value < 0 || value > 365) {
		throw new Error('Payment terms must be an integer between 0 and 365 days.');
	}
}

export default {
	create: {
		before: {
			description:
				'Uppercases the supplier code, trims the name, defaults the supplier to active, and rejects payment terms outside 0 to 365 days.',
			handler: ({ input }) => {
				validatePaymentTermsDays(input.payment_terms_days);
				return {
					...input,
					code: normalizeCode(input.code),
					name: normalizeName(input.name),
					active: input.active ?? true
				};
			}
		}
	},
	update: {
		before: {
			description:
				'Refuses to change a supplier code once it is set and keeps the name and payment terms within range.',
			handler: ({ input, existing }) => {
				if (input.code != null && input.code !== existing.code) {
					throw new Error('Supplier code cannot be changed once set.');
				}
				if (input.name != null) normalizeName(input.name);
				validatePaymentTermsDays(input.payment_terms_days ?? existing.payment_terms_days);
				return input;
			}
		}
	}
} satisfies Hooks;
