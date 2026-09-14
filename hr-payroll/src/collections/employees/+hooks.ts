import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Child facts are append-only. Close a wrong fact with its effective period and append the correction.',
				handler: ({ input, existing }) =>
					Effect.gen(function* () {
						if (existing != null && input.children != null) {
							const prior = existing.children ?? [];
							if (
								input.children.length < prior.length ||
								prior.some((row, index) => stableJson(row) !== stableJson(input.children![index]))
							)
								refuse(
									'Child facts are append-only. Close a wrong fact with its effective period and append the correction.'
								);
						}
						return input;
					})
			}
		}
	}
} satisfies Hooks;
