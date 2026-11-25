import { automation, type ActInput, type CreateInput } from '@norbital-ai/bolt';
import { DateTime } from 'effect';
import { settingsOf, targetOf } from '../lib/dispatch.js';

export default automation({
	description:
		'Cancels the booking and every upcoming scheduled appointment, marking appointments inside the free-change cutoff as late cancellations.',
	input: {
		targets: { kind: 'rows', of: 'bookings' }
	},
	output: { kind: 'object', fields: { cancelled: { kind: 'int' }, late: { kind: 'int' } } },
	policies: ['operations'],
	run: function* ({ targets }, ctx) {
		const { free_change_hours } = yield* settingsOf(ctx);
		const cutoff = DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours });
		const isLate = (start: string) => DateTime.isLessThan(DateTime.makeUnsafe(start), cutoff);
		const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
		const notices: CreateInput<'customer_notices'>[] = [];
		const bookingUpdates: Extract<ActInput<'bookings.update'>, readonly unknown[]>[number][] = [];
		let cancelled = 0;
		let lateCount = 0;
		for (const booking of targets) {
			if (booking.status === 'cancelled') return yield* ctx.refuse('errors.booking_cancelled');
			const { rows } = (yield* ctx.query({
				appointments: {
					where: { booking: { eq: booking.id }, status: { eq: 'scheduled' } },
					fields: ['slot', 'revision'],
					limit: 500
				}
			})).appointments;
			updates.push(
				...rows.map((a) => ({
					target: targetOf(a),
					set: {
						status: 'cancelled' as const,
						late_cancellation: isLate(a.slot.start),
						attention: 'none' as const
					}
				}))
			);
			bookingUpdates.push({ target: booking, set: { status: 'cancelled' } });
			notices.push({
				customer: booking.customer,
				subject: `Booking ${booking.number} cancelled`,
				body: `Your booking ${booking.number} and its ${rows.length} upcoming appointment(s) have been cancelled.`
			});
			cancelled += rows.length;
			lateCount += rows.filter((a) => isLate(a.slot.start)).length;
		}
		const bookingKey = bookingUpdates
			.map((b) => `${b.target.id}:${b.target.revision}`)
			.sort()
			.join(',');
		yield* ctx.act(
			{
				...(updates.length > 0 ? { 'appointments.update': updates } : {}),
				'bookings.update': bookingUpdates,
				'customer_notices.create': notices
			},
			{ key: `cancel-bookings:${bookingKey}` }
		);
		return { cancelled, late: lateCount };
	}
});
