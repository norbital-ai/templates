import { Effect, Result } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { when } from '../lib/dispatch.js';
import { bookService } from '../lib/booking.js';
/**
 * A portal request becomes a booking on its own when a helper is free at the time asked. The customer is found by their
 * mobile number, or filed (placed on the map when the host geocodes); the booking goes through `bookings_book`, the same
 * matching the desk uses, which confirms it to them. Otherwise they are told the desk will propose a time.
 */
export default automation('portal_intake', {
	description:
		'Books each portal request when a helper is free at the time asked; otherwise hands it to the desk and tells the customer a time will be proposed.',
	on: { created: 'booking_requests' },
	runAs: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			booking_requests: { where: { id: { in: ids }, status: { eq: 'received' } } }
		})).booking_requests;
		for (const r of rows) {
			// the mobile number is the customer's identity
			const known = (yield* ctx.query({
				customers: { where: { phone: { eq: r.phone } }, limit: 1 }
			})).customers.rows[0];
			let customer = known?.id;
			if (customer === undefined) {
				const hits = yield* ctx.geo
					.search(r.address)
					.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as([]))));
				const point = hits[0]?.point;
				const { records } = yield* ctx.act('customers.create', [
					{
						name: r.name,
						address: r.address,
						area: r.area,
						phone: r.phone,
						...(r.email === null ? {} : { email: r.email }),
						...(point === undefined ? {} : { location: point })
					}
				]);
				const created = records.find((record) => record.model === 'customers');
				if (created === undefined)
					return yield* new Refusal({
						message: 'The customer creation did not return a customer record.'
					});
				customer = created.id;
			}
			const availability =
				r.availability === null
					? null
					: ((yield* ctx.query({
							availability_requests: { where: { id: { eq: r.availability } }, limit: 1 }
						})).availability_requests.rows[0] ?? null);
			const profile =
				known ??
				(yield* ctx.query({
					customers: { where: { id: { eq: customer } }, fields: ['address', 'location'], limit: 1 }
				})).customers.rows[0] ??
				null;
			const destination =
				availability?.location ?? (profile?.address === r.address ? profile.location : null);
			const preferred =
				availability?.preference === 'preferred' && availability.helper !== null
					? [availability.helper]
					: [];
			const booked = yield* Effect.result(
				bookService(
					{
						customer,
						service: r.service,
						preference: preferred.length > 0 ? 'preferred' : 'any',
						...(preferred.length === 0 ? {} : { helpers: preferred }),
						address: r.address,
						area: r.area,
						...(destination == null ? {} : { location: destination }),
						start: r.start,
						repeat: r.repeat,
						...(r.notes === null ? {} : { notes: r.notes })
					},
					ctx
				)
			);
			if (Result.isSuccess(booked)) {
				yield* ctx.act('booking_requests.update', [
					{ target: r.id, set: { status: 'booked', booking: booked.success.booking } }
				]);
				// `bookings_book` files the confirmation notice
				continue;
			}
			const why = Result.isFailure(booked)
				? booked.failure.message
				: 'The booking could not be made.';
			yield* ctx.act('booking_requests.update', [
				{ target: r.id, set: { status: 'follow_up', outcome: why } }
			]);
			yield* ctx.act('customer_notices.create', [
				{
					customer,
					subject: `We received your booking request ${r.number}`,
					body: `Thank you, ${r.name}. No helper is free at exactly ${when(r.start, ctx.tz)}, so our team will contact you shortly with the nearest available times.`
				}
			]);
			yield* ctx.notify({
				title: `Portal request ${r.number} needs a time`,
				description: why,
				to: [{ team: 'operations' }],
				link: { model: 'booking_requests', id: r.id },
				once: `intake-${r.id}`
			});
		}
	}
});
