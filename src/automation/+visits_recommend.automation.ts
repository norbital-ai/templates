import { automation } from '@norbital-ai/bolt';
import { type ActInput } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { observedOf } from '../lib/dispatch.js';
import { loadPool } from '../lib/dispatch.js';
import { rank } from '../lib/matching.js';

export default automation('visits_recommend', {
	description: 'Prepares a replacement recommendation; the controller must approve it.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 }
	},
	runAs: 'trigger',
	run: function* ({ targets }, ctx) {
		const { rows: targetsOf } = (yield* ctx.query({ visits: { where: { id: { in: targets } } } }))
			.visits;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		for (const v of targetsOf) {
			if (v.status !== 'scheduled')
				return yield* new Refusal({ message: 'Only a scheduled visit can have a replacement.' });
			if (Date.parse(v.slot.start) <= Date.parse(ctx.now))
				return yield* new Refusal({
					message: 'This visit has already started. Choose a new future time.'
				});
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
				target: v.id,
				set: {
					proposed_helper: best?.helper ?? null,
					proposed_slot: best === undefined ? null : v.slot,
					attention: best === undefined ? 'unassigned' : 'awaiting_approval'
				}
			});
		}
		if (updates.length > 0)
			yield* ctx.act('visits.update', updates, { observed: observedOf(targetsOf) });
	}
});
