import type { PageContext } from '@norbital-ai/bolt/page';
import { confirm_action, notify_outcome, toast } from '@norbital-ai/ui';
import { Effect } from 'effect';
import { PAID_QUESTION } from '../payroll/paid_period.svelte.js';

/**
 * One save from a click: asks first when it reaches a paid period, shows its outcome or its failure, and answers
 * whether it committed.
 */
export const saved = (
	ctx: PageContext,
	reachesPaid: boolean,
	act: () => Effect.Effect<Parameters<typeof notify_outcome>[1], unknown>
): Effect.Effect<boolean> =>
	(reachesPaid ? confirm_action(PAID_QUESTION) : Effect.succeed(true)).pipe(
		Effect.flatMap((proceed) =>
			proceed
				? act().pipe(
						Effect.map((outcome) => {
							notify_outcome(ctx, outcome);
							return outcome.kind === 'committed';
						})
					)
				: Effect.succeed(false)
		),
		Effect.catch((error) =>
			Effect.sync(() => {
				toast.error(error instanceof Error ? error.message : ctx.t('component.error'));
				return false;
			})
		)
	);
