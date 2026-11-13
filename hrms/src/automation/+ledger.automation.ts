import { automation } from '@norbital-ai/bolt';
import { DateTime, Effect } from 'effect';
import { raiseFindings } from '../lib/integrity.js';
import { getErrorMessage } from '../lib/payroll_engine/foundation.js';
import { raiseFailure, retire, syncEntitlements } from '../lib/ledger/service.js';

const ATTEMPTS = 8;

/**
 * The ledger's sync, one run at a time: entitlements for `employees` when a contract changed or a late posting moved
 * what carried, or for everyone when the law, the year or an entity did. Posting is no part of it: a record's own write
 * carries what it posts. It writes only what differs, so running it again changes nothing.
 */
export default automation({
	description: 'Sync entitlements to the ledger; safe to run at any time.',
	input: {
		employees: { kind: 'ref', to: 'employee_profile', many: true, optional: true }
	},
	on: [{ cron: '0 0 1 1 *' }],
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	retry: { attempts: ATTEMPTS, backoff: '10s' },
	run: function* ({ employees }, ctx) {
		const work = Effect.gen(function* () {
			const { boundary } = yield* syncEntitlements(ctx, employees ?? undefined);
			if (employees != null) return;
			yield* retire(ctx);
			// the next day anyone's window turns over, so a reset lands on its day and nothing wakes before it
			if (boundary !== undefined)
				yield* ctx.schedule(
					'ledger',
					{},
					{ at: DateTime.formatIso(DateTime.makeUnsafe(boundary)), key: `ledger:${boundary}` }
				);
			// the whole pass ends by checking the ledger against what it stands for
			yield* raiseFindings(ctx);
		});
		yield* work.pipe(
			// what can pass waits out its retries, which outlast an outage; a refusal will not change
			Effect.tapError((error) =>
				ctx.attempt < ATTEMPTS && error._tag !== 'ActRefused'
					? Effect.void
					: raiseFailure(ctx, 'entitlement sync', getErrorMessage(error))
			)
		);
	}
});
