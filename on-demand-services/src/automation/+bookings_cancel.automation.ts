import { automation } from '@norbital-ai/bolt';
import { type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { settingsOf, targetOf } from '../lib/dispatch.js';
const HOUR = 3600000;

export default automation({
	description:
		'Cancels the booking and every visit still to come. Each visit inside the configured free-change cutoff is marked late.',
	input: {
		targets: { kind: 'ref', to: 'bookings', many: true, min_items: 1 }
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
		const notices: CreateInput<'customer_notices'>[] = [];
		const bookingUpdates: Extract<ActInput<'bookings.update'>, readonly unknown[]>[number][] = [];
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
			const { free_change_hours } = yield* settingsOf(ctx);
			const late = (start: string) =>
				Date.parse(start) - Date.parse(ctx.now) < free_change_hours * HOUR;
			updates.push(
				...rows.map((v) => ({
					target: targetOf(v),
					set: {
						status: 'cancelled' as const,
						late_cancellation: late(v.slot.start),
						attention: 'none' as const
					}
				}))
			);
			bookingUpdates.push({ target: targetOf(booking), set: { status: 'cancelled' } });
			notices.push({
				customer: booking.customer,
				subject: `Booking ${booking.number} cancelled`,
				body: `Your booking ${booking.number} and its ${rows.length} upcoming visit(s) are cancelled.`
			});
			cancelled += rows.length;
			lateCount += rows.filter((v) => late(v.slot.start)).length;
		}
		yield* ctx.act({
			'bookings.update': bookingUpdates,
			...(updates.length > 0 ? { 'visits.update': updates } : {}),
			'customer_notices.create': notices
		});
		return { cancelled, late: lateCount };
	}
});
