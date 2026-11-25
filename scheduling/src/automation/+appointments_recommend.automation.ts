import { automation, type ActInput } from '@norbital-ai/bolt';
import { DateTime } from 'effect';
import { loadPool } from '../lib/dispatch.js';
import { closedSlot, rank } from '../lib/matching.js';

export default automation({
	description: 'Prepares a replacement provider recommendation for dispatcher approval.',
	input: {
		targets: { kind: 'rows', of: 'appointments' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const now = DateTime.makeUnsafe(ctx.now);
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		for (const a of targets) {
			if (a.status !== 'scheduled') return yield* ctx.refuse('errors.recommend_not_scheduled');
			if (DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(a.slot.start), now))
				return yield* ctx.refuse('errors.appointment_started');
			const slot = closedSlot(a.slot);
			if (slot === null) return yield* ctx.refuse('errors.appointment_open_ended');
			const pool = yield* loadPool(ctx, a.slot.start, a.slot.start, [a.location]);
			const best = rank(
				{ skill: a.skill, slot, location: a.location, appointment: a.id },
				{
					...pool,
					providers: pool.providers.filter(
						(p) => p.id !== a.provider && p.id !== a.unavailable_provider
					)
				},
				ctx.tz
			)[0];
			updates.push({
				target: a,
				set: {
					proposed_provider: best?.provider ?? null,
					proposed_slot: best === undefined ? null : a.slot,
					attention: best === undefined ? 'unassigned' : 'awaiting_approval'
				}
			});
		}
		if (updates.length > 0) yield* ctx.act({ 'appointments.update': updates });
	}
});
