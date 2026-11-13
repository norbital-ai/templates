import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { loadPool, when, targetOf } from '../lib/dispatch.js';
import { add_days, proposal, utc_of } from '../lib/matching.js';

export default automation({
	description:
		'Marks the helper as left after their last day and proposes, for each of their later visits, the helper with the closest skills at the same time or the nearest time anyone is free.',
	input: {
		targets: { kind: 'rows', of: 'helpers' },
		last_day: { kind: 'date' }
	},
	output: { kind: 'object', fields: { proposed: { kind: 'int' }, open: { kind: 'int' } } },
	policies: ['operations'],
	run: function* ({ last_day, targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		const helperUpdates: Extract<ActInput<'helpers.update'>, readonly unknown[]>[number][] = [];
		let proposed = 0,
			openCount = 0;
		for (const helper of targets) {
			if (helper.status !== 'active')
				return yield* ctx.refuse('errors.helper_already_left', { values: { name: helper.name } });
			const after = new Date(utc_of(add_days(last_day, 1), 0, ctx.tz)).toISOString();
			const { rows: later } = (yield* ctx.query({
				visits: {
					where: {
						helper: { eq: helper.id },
						status: { eq: 'scheduled' },
						slot: { overlaps: { start: after, end: null } }
					},
					fields: ['revision', 'number', 'slot', 'location', 'area', 'skill', 'booking'],
					booking: { fields: ['customer'] }
				}
			})).visits;
			const starts = later.map((v) => v.slot.start).sort();
			const pool =
				later.length === 0
					? null
					: yield* loadPool(
							ctx,
							starts[0]!,
							starts.at(-1)!,
							later.map((v) => v.location)
						);
			const others = {
				...pool!,
				helpers: (pool?.helpers ?? []).filter((h) => h.id !== helper.id)
			};
			const busy = [...(pool?.busy ?? [])];
			const names = new Map(others.helpers.map((h) => [h.id, h.name]));
			let open = 0;
			for (const v of later) {
				const need = {
					skill: v.skill,
					slot: { start: v.slot.start, end: v.slot.end! },
					location: v.location,
					area: v.area,
					visit: v.id
				};
				const found = proposal(need, helper.skills, { ...others, busy }, ctx.tz);
				if (found === null) open += 1;
				else busy.push({ id: v.id, helper: found.helper, slot: found.slot, location: v.location });
				updates.push({
					target: targetOf(v),
					set: {
						helper: null,
						proposed_helper: found?.helper ?? null,
						proposed_slot: found?.slot ?? null,
						shift_check: 'not_due' as const,
						attention: 'helper_left' as const
					}
				});
				if (found !== null && v.booking !== null)
					notices.push({
						customer: v.booking.customer,
						visit: v.id,
						subject: `A change to your visit on ${when(v.slot.start, ctx.tz)}`,
						body: `${helper.name} is no longer with us. For visit ${v.number} we propose ${names.get(found.helper)} on ${when(found.slot.start, ctx.tz)}. Reply to this email to accept or to ask for another time.`
					});
			}
			helperUpdates.push({
				target: helper,
				set: { status: 'left', left_on: last_day }
			});
			proposed += later.length - open;
			openCount += open;
		}
		yield* ctx.act({
			'helpers.update': helperUpdates,
			...(updates.length > 0 ? { 'visits.update': updates } : {}),
			...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
		});
		return { proposed, open: openCount };
	}
});
