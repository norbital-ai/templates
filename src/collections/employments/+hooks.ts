import { Effect } from 'effect';
import type { Hooks } from './$types.js';

/**
 * An employment's leave entitlements follow the employment.
 *
 * Once a hire or a change commits, the leave reconciler runs for that employment under its own
 * policy and writes the accounts and ledger as one nested graph under formula ids. A hook's own
 * reads carry the caller's authority, so a kiosk enrolling a worker or an employee editing a fact
 * could never read the plans, laws and ledgers the arithmetic needs; the reconciler can, and it is
 * the same run the first of the month and the seed start.
 */
export default {
	mutate: {
		perRecord: {
			after: {
				description:
					"Regenerates this employment's leave accounts and entitlement ledger from the company plan and the sealed statutory profile.",
				handler: ({ record, changes, api }) =>
					Effect.gen(function* () {
						// The reconciler's own write restates the employment with nothing changed; only a
						// person's hire or edit is a fact the ledger has to follow.
						if (Object.keys(changes).length === 0) return;
						yield* api.automations.run('leave_ledger_refresh', { employment_ids: [record.id] });
					})
			}
		}
	}
} satisfies Hooks;
