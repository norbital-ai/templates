import { automation } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { getErrorMessage } from '../lib/payroll_engine/foundation.js';
import {
	post,
	raiseFailure,
	retire,
	syncBalances,
	syncEntitlements
} from '../lib/ledger/service.js';

const ATTEMPTS = 8;

/**
 * The one writer of the ledger and the balance, one run at a time. With `post`, it posts those records as they stand.
 * Without, it syncs entitlements: for `employees` when a contract changed, or for everyone when the law, the year or an
 * entity did. It writes only what differs, so running it again changes nothing.
 */
export default automation('ledger', {
	description: 'Post records to the ledger and sync entitlements; safe to run at any time.',
	input: {
		post: { kind: 'list', of: { kind: 'text' }, optional: true },
		employees: { kind: 'list', of: { kind: 'id', of: 'employee_profile' }, optional: true }
	},
	on: { cron: '0 0 1 1 *' },
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	retry: { attempts: ATTEMPTS, backoff: '10s' },
	run: function* ({ post: sources, employees }, ctx) {
		const work = Effect.gen(function* () {
			if (sources != null) {
				const stale = yield* post(ctx, sources);
				if (stale.length > 0) yield* syncBalances(ctx, stale);
				return;
			}
			const { boundary } = yield* syncEntitlements(ctx, employees ?? undefined);
			if (employees != null) return;
			yield* retire(ctx);
			// the next day anyone's window turns over, so a reset lands on its day and nothing wakes before it
			if (boundary !== undefined)
				yield* ctx.schedule(
					'ledger',
					{},
					{ at: Instant(`${boundary}T00:00:00Z`), key: `ledger:${boundary}` }
				);
		});
		yield* work.pipe(
			// what can pass waits out its retries, which outlast an outage; a refusal will not change
			Effect.tapError((error) =>
				ctx.attempt < ATTEMPTS && error._tag !== 'Refusal'
					? Effect.void
					: raiseFailure(ctx, sources?.[0] ?? 'entitlement sync', getErrorMessage(error))
			)
		);
	}
});
