import { Effect } from 'effect';
import type { EffectCtx } from '@norbital-ai/bolt';
import { applyRegisteredEffects } from './registrations.js';

/** Post-commit dispatch: every registered effect for this collection and operation runs here. */
export const tap = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	name: 'create' | 'update' | 'delete',
	event: { readonly collection: string; readonly ids: readonly string[] },
	changes: readonly { readonly before?: object; readonly after?: object }[]
) {
	void event;
	yield* applyRegisteredEffects(ctx, name, event.collection, changes);
});
