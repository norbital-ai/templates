import type { EffectCtx, StartInput } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { stableJson } from './foundation.js';

type Tap = StartInput<'behaviour_taps'>;
type Event = Tap['event'];

/**
 * A model effect's schedule of `behaviour_taps` for the rows it wrote; the run records the effect as its trigger.
 * One start per effect run: a retried effect replaces its queued start.
 */
export const tap = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	action: Tap['action'],
	event: Event
) {
	if (event.ids.length > 0)
		yield* ctx.schedule(
			'behaviour_taps',
			{ action, event },
			{ key: `behaviour_taps:${ctx.invocationId}` }
		);
});

/** The rows an update moved on any of `fields` (a duty keyed to them; other columns are no duty's change). */
export const moved = <R extends { readonly id: unknown }>(
	changes: readonly { readonly before: R; readonly after: R }[],
	fields: readonly (keyof R)[]
): R['id'][] =>
	changes.flatMap(({ before, after }) =>
		fields.some((field) => stableJson(before[field]) !== stableJson(after[field])) ? [after.id] : []
	);
