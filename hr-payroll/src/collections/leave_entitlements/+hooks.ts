import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/** Entitlements are the reconciler's own writes; the only change a person sees is a close. */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'A generated entitlement is sealed: it moves from OPEN to CLOSED and changes in no other way. Post an entry instead.',
				handler: ({ input, existing }) => {
					if (existing == null) return input;
					const changed = Object.keys(input).filter(
						(field) => field !== 'id' && field !== 'status' && field !== 'row_version'
					);
					if (changed.length > 0)
						refuse('A leave entitlement is sealed. Post an adjustment entry instead.');
					if (input.status != null && !(existing.status === 'OPEN' && input.status === 'CLOSED'))
						refuse('A leave entitlement may only move from OPEN to CLOSED.');
					return input;
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Generated entitlements are permanent audit evidence.',
				handler: () => refuse('Leave entitlements cannot be deleted.')
			}
		}
	}
} satisfies Hooks;
