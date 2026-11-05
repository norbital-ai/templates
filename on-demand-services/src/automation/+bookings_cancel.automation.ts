import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateRow } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { settingsOf, observedOf } from '../lib/dispatch.js';
const HOUR = 3600000;

export default automation('bookings_cancel', {
	description:
		'Cancels the booking and every visit still to come. Each visit inside the configured free-change cutoff is marked late.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'bookings' }, min: 1 }
	},
	output: { kind: 'object', fields: { cancelled: { kind: 'int' }, late: { kind: 'int' } } },
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const { rows: targetsOf } = (yield* ctx.query({ bookings: { where: { id: { in: targets } } } }))
			.bookings;
		if (targetsOf.length !== targets.length)
			return yield* new Refusal({
				message: 'The selected record does not exist or is not readable.',
				field: 'targets'
			});
		const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateRow<'customer_notices'>[] = [];
		const bookingUpdates: Extract<ActInput<'bookings.update'>, readonly unknown[]>[number][] = [];
		const visitRevisions = new Map<string, number>();
		let cancelled = 0,
			lateCount = 0;
		for (const booking of targetsOf) {
			if (booking.status === 'cancelled')
				return yield* new Refusal({ message: 'This booking is already cancelled.' });
			const { rows } = (yield* ctx.query({
				visits: {
					where: { booking: { eq: booking.id }, status: { eq: 'scheduled' } },
					fields: ['slot', 'revision']
				}
			})).visits;
			for (const row of rows) visitRevisions.set(row.id, row.revision);
			const { free_change_hours } = yield* settingsOf(ctx);
			const late = (start: string) =>
				Date.parse(start) - Date.parse(ctx.now) < free_change_hours * HOUR;
			updates.push(
				...rows.map((v) => ({
					target: v.id,
					set: {
						status: 'cancelled' as const,
						late_cancellation: late(v.slot.start),
						attention: 'none' as const
					}
				}))
			);
			bookingUpdates.push({ target: booking.id, set: { status: 'cancelled' } });
			notices.push({
				customer: booking.customer,
				subject: `Booking ${booking.number} cancelled`,
				body: `Your booking ${booking.number} and its ${rows.length} upcoming visit(s) are cancelled.`
			});
			cancelled += rows.length;
			lateCount += rows.filter((v) => late(v.slot.start)).length;
		}
		yield* ctx.act.many([
			{ callable: 'bookings.update', input: bookingUpdates, observed: observedOf(targetsOf) },
			...(updates.length > 0
				? [
						{
							callable: 'visits.update' as const,
							input: updates,
							observed: Object.fromEntries(visitRevisions)
						}
					]
				: []),
			{ callable: 'customer_notices.create', input: notices }
		]);
		return { cancelled, late: lateCount };
	}
});
