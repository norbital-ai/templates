import type { Hooks } from './$types.js';

export default {
	update: {
		perRecord: {
			before: {
				description:
					'Keeps the external customer identity immutable while allowing the mirrored account state and details to be refreshed.',
				handler: ({ input, existing }) => {
					if (input.external_code != null && input.external_code !== existing.external_code) {
						throw new Error('External customer code cannot be changed once set.');
					}
					return input;
				}
			}
		}
	}
} satisfies Hooks;
