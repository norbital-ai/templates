import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { planReassignment, visitsToMove, when } from '../lib/dispatch.js';

export default automation('visits_reassign', {
	description:
		'Gives the visit to the named helper, or to the best-matched one when none is named. A customer who asked for particular helpers is told.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		helper: { kind: 'id', of: 'helpers', optional: true }
	},
	runAs: 'trigger',
	run: function* ({ helper, targets }, ctx) {
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
				return yield* new Refusal({ message: 'Only a scheduled visit can be reassigned.' });
			if (helper == null) {
				const [row] = (yield* ctx.query(visitsToMove({ id: { eq: v.id } }))).visits.rows;
				if (row === undefined || v.helper === null)
					return yield* new Refusal({ message: 'The assigned visit is not readable.' });
				const plan = yield* planReassignment(ctx, [row], v.helper);
				const { assigned } = plan;
				if (assigned === 0)
					return yield* new Refusal({
						message: 'No other helper is free for this visit. Reschedule it instead.'
					});
				updates.push(...plan.updates);
				notices.push(...plan.notices);
				continue;
			}
			updates.push({
				target: v.id,
				set: { helper, attention: 'none', proposed_helper: null, proposed_slot: null, mc: false }
			});
			const { bookings, helpers } = yield* ctx.query({
				bookings: {
					where: { id: { eq: v.booking } },
					fields: ['preference', 'customer'],
					limit: 1
				},
				helpers: { where: { id: { eq: helper } }, fields: ['name'], limit: 1 }
			});
			const booking = bookings.rows[0],
				next = helpers.rows[0];
			if (booking?.preference === 'preferred')
				notices.push({
					customer: booking.customer,
					visit: v.id,
					subject: `A new helper for your visit on ${when(v.slot.start, ctx.tz)}`,
					body: `${next?.name ?? 'Another helper'} will come for visit ${v.number} on ${when(v.slot.start, ctx.tz)} in place of your usual helper.`
				});
		}
		if (updates.length > 0)
			yield* ctx.act.many([
				{
					callable: 'visits.update',
					input: updates,
					observed: Object.fromEntries(targetsOf.map((v): [string, number] => [v.id, v.revision]))
				},
				...(notices.length > 0
					? [{ callable: 'customer_notices.create' as const, input: notices }]
					: [])
			]);
	}
});
