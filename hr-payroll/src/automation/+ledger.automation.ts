import { automation } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { raiseFindings } from '../lib/integrity.js';
import { getErrorMessage } from '../lib/payroll_engine/foundation.js';
import { raiseFailure, retire, syncEntitlements } from '../lib/ledger/service.js';

const ATTEMPTS = 8;

/**
 * The ledger's sync, one run at a time: entitlements for `employees` when a contract changed or a late posting moved
 * what carried, or for everyone when the law, the year or an entity did. Posting is no part of it: a record's own write
 * carries what it posts. It writes only what differs, so running it again changes nothing.
 */
export default automation('ledger', {
	description: 'Sync entitlements to the ledger; safe to run at any time.',
	input: {
		employees: { kind: 'list', of: { kind: 'id', of: 'employee_profile' }, optional: true },
		// contracts whose exit moved: their dependants follow once the sync has settled
		employments: { kind: 'list', of: { kind: 'id', of: 'employee_contract' }, optional: true }
	},
	on: { cron: '0 0 1 1 *' },
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	retry: { attempts: ATTEMPTS, backoff: '10s' },
	run: function* ({ employees, employments }, ctx) {
		const work = Effect.gen(function* () {
			const { boundary } = yield* syncEntitlements(ctx, employees ?? undefined);
			if (employments != null && employments.length > 0)
				yield* ctx.schedule('encashment', { employments });
			if (employees != null) return;
			yield* retire(ctx);
			// the next day anyone's window turns over, so a reset lands on its day and nothing wakes before it
			if (boundary !== undefined)
				yield* ctx.schedule(
					'ledger',
					{},
					{ at: Instant(`${boundary}T00:00:00Z`), key: `ledger:${boundary}` }
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
