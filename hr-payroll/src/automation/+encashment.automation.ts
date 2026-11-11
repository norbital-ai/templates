import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { reconcile } from '../lib/dependants.js';
import { raiseFailure } from '../lib/ledger/service.js';
import { getErrorMessage } from '../lib/payroll_engine/foundation.js';

const ATTEMPTS = 8;

/**
 * What an exit leaves behind, for the contracts whose exit was raised, moved or cancelled (`src/lib/dependants.ts`). An
 * exit that stands gets one cash-out request a leave row with a `payout`, held for the HR controller; one that no longer
 * stands has its open tasks waived, its unpaid cash-outs withdrawn (a request still waiting included) and, for one a paid run took, a task asking HR to
 * reverse it. The `ledger` automation starts it once the exit's sync has settled, so a cash-out is sized after the
 * proration. It runs under `payroll_execution`, whoever ended the contract. Running it again changes nothing.
 */
export default automation('encashment', {
	description:
		'Settle what an exit raised, moved or cancelled leaves behind; safe to run at any time.',
	input: {
		employments: { kind: 'list', of: { kind: 'id', of: 'employee_contract' } },
		// the step of one follow-up: each run takes one step and starts the next, to a bound
		step: { kind: 'number', optional: true }
	},
	policies: ['payroll_execution'],
	concurrency: { max: 1 },
	retry: { attempts: ATTEMPTS, backoff: '10s' },
	run: function* ({ employments, step }, ctx) {
		const taken = step ?? 0;
		const more = yield* reconcile(ctx, employments).pipe(
			// a write that lost a race passes on the next attempt; the last failure raises a task
			Effect.tapError((error) =>
				ctx.attempt < ATTEMPTS
					? Effect.void
					: raiseFailure(ctx, 'exit follow-up', getErrorMessage(error), 'Exit follow-up failed')
			)
		);
		// a withdrawal, a request a contract and the tasks, with room to spare: the bound only stops a follow-up that
		// would never settle
		if (more !== false && taken < employments.length * 4 + 8)
			yield* ctx.schedule('encashment', { employments, step: taken + 1 });
	}
});
