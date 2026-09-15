import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/**
 * A loan is recovered: its line takes money from the person, never gives it. A row that landed as
 * `PAY · ADD` once paid every instalment *to* the borrower on top of their wage — the seed
 * converter's default — so the landing is checked where the row is written.
 */
const assertRecovers = (row: {
	readonly code?: unknown;
	readonly destination?: unknown;
	readonly direction?: unknown;
}): void => {
	const lands = row.destination === 'PAY' || row.destination === 'NET';
	if (!lands || row.direction !== 'SUBTRACT')
		refuse(
			`Loan ${String(row.code ?? '')} must be recovered from pay or net (destination PAY or NET, direction SUBTRACT); it cannot be paid out.`
		);
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Preserve Loan catalogue rows belonging to sealed settings versions; compile the eligibility expression; refuse a loan that would pay out instead of recover.',
				handler: ({ input, existing, api }) =>
					Effect.tap(admitCatalogueRow(api, input, existing, 'Loan'), () =>
						Effect.sync(() => assertRecovers({ ...existing, ...input }))
					)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuse deleting Loan catalogue rows belonging to sealed settings versions.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Loan ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
