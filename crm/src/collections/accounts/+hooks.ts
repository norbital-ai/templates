import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Keeps the external customer identity immutable while allowing the mirrored account state and details to be refreshed.',
				handler: ({ input, existing }) => {
					// Only an edit can change a code that is already set; a create is stating it for the
					// first time, and `existing` is undefined there.
					if (
						existing !== undefined &&
						input.external_code != null &&
						input.external_code !== existing.external_code
					) {
						throw new Error('External customer code cannot be changed once set.');
					}
					return input;
				}
			}
		}
	}
} satisfies Hooks;
