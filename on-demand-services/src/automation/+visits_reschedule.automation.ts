import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { observedOf } from '../lib/dispatch.js';
import { loadPool, settingsOf, when } from '../lib/dispatch.js';
import { rank, slotOf } from '../lib/matching.js';
import { customerNotice } from '../lib/visit-recovery.js';
const HOUR = 3600000;

export default automation('visits_reschedule', {
	description:
		'Moves the visit to a new start, keeping its helper when they are free then. Only outside the free-change window before the visit.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		start: { kind: 'instant' }
	},
	policies: ['operations'],
	run: function* ({ start, targets }, ctx) {
		const { rows: targetsOf } = (yield* ctx.query({ visits: { where: { id: { in: targets } } } }))
			.visits;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateRow<'customer_notices'>[] = [];
		for (const v of targetsOf) {
			if (v.status !== 'scheduled')
				return yield* new Refusal({ message: 'Only a scheduled visit can be moved.' });
			const { free_change_hours } = yield* settingsOf(ctx);
			if (Date.parse(v.slot.start) - Date.parse(ctx.now) < free_change_hours * HOUR)
				return yield* new Refusal({
					message: `A visit can be moved only up to ${free_change_hours} hours before it starts.`
				});
			if (Date.parse(start) <= Date.parse(ctx.now))
				return yield* new Refusal({ message: 'Pick a time in the future.', field: 'start' });
			const slot = slotOf(start, (Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60000);
			const pool = yield* loadPool(ctx, slot.start, slot.start, [v.location]);
			const need = { skill: v.skill, slot, location: v.location, area: v.area, visit: v.id };
			const best = rank(need, pool, ctx.tz, v.helper)[0];
			if (best === undefined)
				return yield* new Refusal({ message: 'No helper is free at that time.', field: 'start' });
			updates.push({
				target: v.id,
				set: { slot, helper: best.helper, attention: 'none' }
			});
			const notice = yield* customerNotice(
				ctx,
				v,
				`Visit ${v.number} moved`,
				`Your visit ${v.number} is now on ${when(slot.start, ctx.tz)}.`
			);
			if (notice !== null) notices.push(notice);
		}
		if (updates.length > 0)
			yield* ctx.act.many([
				{ callable: 'visits.update', input: updates, observed: observedOf(targetsOf) },
				...(notices.length > 0
					? [{ callable: 'customer_notices.create' as const, input: notices }]
					: [])
			]);
	}
});
