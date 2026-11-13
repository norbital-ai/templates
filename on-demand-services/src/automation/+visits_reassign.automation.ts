import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { planReassignment, visitsToMove } from '../lib/dispatch.js';

export default automation({
	description:
		'Gives the visit to the named helper, or to the best-matched one when none is named. A customer who asked for particular helpers is told.',
	input: {
		targets: { kind: 'rows', of: 'visits' },
		helper: { kind: 'ref', to: 'helpers', optional: true }
	},
	policies: ['operations'],
	run: function* ({ helper, targets }, ctx) {
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		for (const v of targets) {
			if (v.status !== 'scheduled') return yield* ctx.refuse('errors.reassign_not_scheduled');
			if (helper == null) {
				const [row] = (yield* ctx.query(visitsToMove({ id: { eq: v.id } }))).visits.rows;
				if (row === undefined || v.helper === null)
					return yield* ctx.refuse('errors.assigned_unreadable');
				const plan = yield* planReassignment(ctx, [row], v.helper);
				const { assigned } = plan;
				if (assigned === 0) return yield* ctx.refuse('errors.no_other_helper');
				updates.push(...plan.updates);
				notices.push(...plan.notices);
				continue;
			}
			updates.push({
				target: v,
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
					subject: `A new helper for your visit on ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.slot.start))}`,
					body: `${next?.name ?? 'Another helper'} will come for visit ${v.number} on ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.slot.start))} in place of your usual helper.`
				});
		}
		if (updates.length > 0)
			yield* ctx.act({
				'visits.update': updates,
				...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
			});
	}
});
