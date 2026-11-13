import { Effect } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { applyRegisteredEffects, type Operation } from './registrations.js';

/** Post-commit dispatch: every registered effect for this collection and operation runs here. */
export const tap = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	name: Operation,
	collection: string,
	changes: readonly { readonly before?: object; readonly after?: object }[]
) {
	yield* applyRegisteredEffects(ctx, name, collection, changes);
});
