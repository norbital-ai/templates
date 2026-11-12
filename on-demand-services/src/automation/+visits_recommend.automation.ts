import { automation } from '@norbital-ai/bolt';
import { type ActInput } from '@norbital-ai/bolt';
import { loadPool } from '../lib/dispatch.js';
import { rank } from '../lib/matching.js';

export default automation({
	description: 'Prepares a replacement recommendation; the controller must approve it.',
	input: {
		targets: { kind: 'rows', of: 'visits' }
	},
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		for (const v of targets) {
			if (v.status !== 'scheduled') return yield* ctx.refuse('errors.recommend_not_scheduled');
			if (Date.parse(v.slot.start) <= Date.parse(ctx.now))
				return yield* ctx.refuse('errors.visit_started');
			const pool = yield* loadPool(ctx, v.slot.start, v.slot.start, [v.location]);
			const best = rank(
				{
					skill: v.skill,
					slot: { start: v.slot.start, end: v.slot.end! },
					location: v.location,
					area: v.area,
					visit: v.id
				},
				{
					...pool,
					helpers: pool.helpers.filter((h) => h.id !== v.helper && h.id !== v.unavailable_helper)
				},
				ctx.tz
			)[0];
			updates.push({
				target: v,
				set: {
					proposed_helper: best?.helper ?? null,
					proposed_slot: best === undefined ? null : v.slot,
					attention: best === undefined ? 'unassigned' : 'awaiting_approval'
				}
			});
		}
		if (updates.length > 0) yield* ctx.act({ 'visits.update': updates });
	}
});
