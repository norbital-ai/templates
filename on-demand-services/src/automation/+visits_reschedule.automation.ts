import { automation } from '@norbital-ai/bolt';
import { DateTime, Duration } from 'effect';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { loadPool, settingsOf } from '../lib/dispatch.js';
import { rank, slotOf } from '../lib/matching.js';
import { customerNotice } from '../lib/visit-recovery.js';

export default automation({
	description:
		'Moves the visit to a new start, keeping its helper when they are free then. Only outside the free-change window before the visit.',
	input: {
		targets: { kind: 'rows', of: 'visits' },
		start: { kind: 'instant' }
	},
	policies: ['operations'],
	run: function* ({ start, targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targets) {
			if (v.status !== 'scheduled') return yield* ctx.refuse('errors.move_not_scheduled');
			const { free_change_hours } = yield* settingsOf(ctx);
			if (
				DateTime.isLessThan(
					DateTime.makeUnsafe(v.slot.start),
					DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours })
				)
			)
				return yield* ctx.refuse('errors.move_window', { values: { hours: free_change_hours } });
			if (Date.parse(start) <= Date.parse(ctx.now))
				return yield* ctx.refuse('errors.start_in_past', { field: 'start' });
			const slot = slotOf(
				start,
				Duration.toMinutes(
					DateTime.distance(DateTime.makeUnsafe(v.slot.start), DateTime.makeUnsafe(v.slot.end!))
				)
			);
			const pool = yield* loadPool(ctx, slot.start, slot.start, [v.location]);
			const need = { skill: v.skill, slot, location: v.location, area: v.area, visit: v.id };
			const best = rank(need, pool, ctx.tz, v.helper)[0];
			if (best === undefined) return yield* ctx.refuse('errors.no_helper_free', { field: 'start' });
			updates.push({
				target: v,
				set: { slot, helper: best.helper, attention: 'none' }
			});
			const notice = yield* customerNotice(
				ctx,
				v,
				`Visit ${v.number} moved`,
				`Your visit ${v.number} is now on ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(slot.start))}.`
			);
			if (notice !== null) notices.push(notice);
		}
		if (updates.length > 0)
			yield* ctx.act({
				'visits.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
