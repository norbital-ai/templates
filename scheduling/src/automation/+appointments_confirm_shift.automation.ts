import { automation, type ActInput, type Id } from '@norbital-ai/bolt';
import { targetOf } from '../lib/dispatch.js';
import { ownAppointments, sameDay } from '../lib/appointment-recovery.js';

export default automation({
	description: 'The provider confirms they will work their scheduled appointments for the day.',
	input: {
		targets: { kind: 'ref', to: 'appointments', many: true, min_items: 1 }
	},
	policies: ['provider_shift'],
	run: function* ({ targets }, ctx) {
		yield* ownAppointments(ctx, targets);
		const { rows: targetsOf } = (yield* ctx.query({
			appointments: {
				output: 'provider',
				where: { id: { in: targets } },
				limit: targets.length + 1
			}
		})).appointments;
		if (targetsOf.length !== targets.length)
			return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
		const seen = new Set<Id<'appointments'>>();
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		for (const a of targetsOf) {
			const day = yield* sameDay(ctx, a);
			for (const row of day) {
				if (seen.has(row.id)) continue;
				seen.add(row.id);
				updates.push({ target: targetOf(row), set: { shift_check: 'confirmed' as const } });
			}
		}
		if (updates.length > 0) yield* ctx.act({ 'appointments.update': updates });
	}
});
