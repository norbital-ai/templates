import { Effect, Result } from 'effect';
import { automation, new_id } from '@norbital-ai/bolt';
import { bookService } from '../lib/booking.js';
import { targetOf } from '../lib/dispatch.js';
import { formatInstant } from '../lib/format.js';

/**
 * Books verified customer portal requests automatically when a qualified provider is free;
 * otherwise moves the request to `follow_up` and notifies operations and the customer.
 */
export default automation({
	description:
		'Books each portal request automatically when a provider is free, or routes it to operations for follow-up.',
	input: { ids: { kind: 'ref', to: 'booking_requests', many: true, min_items: 1 } },
	policies: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			booking_requests: {
				where: { id: { in: ids }, status: { eq: 'received' } },
				limit: ids.length + 1
			}
		})).booking_requests;
		for (const r of rows) {
			const known = (yield* ctx.query({
				customers: { where: { phone: { eq: r.phone } }, limit: 1 }
			})).customers.rows[0];
			let customer = known?.id;
			if (customer === undefined) {
				const hits = yield* ctx.geo
					.search(r.address)
					.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as([]))));
				const point = hits[0]?.point;
				const { records } = yield* ctx.act(
					{
						'customers.create': [
							{
								name: r.name,
								address: r.address,
								phone: r.phone,
								...(r.email === null ? {} : { email: r.email }),
								...(point === undefined ? {} : { location: point })
							}
						]
					},
					{ key: `intake-customer:${r.id}` }
				);
				const created = records.find((record) => record.model === 'customers');
				if (created === undefined) return yield* ctx.refuse('errors.customer_not_created');
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
				availability?.preference === 'preferred' && availability.provider !== null
					? [availability.provider]
					: [];
			const booking = new_id('bookings');
			const booked = yield* Effect.result(
				bookService(
					{
						customer,
						service: r.service,
						preference: preferred.length > 0 ? 'preferred' : 'any',
						...(preferred.length === 0 ? {} : { providers: preferred }),
						address: r.address,
						...(destination == null ? {} : { location: destination }),
						start: r.start,
						repeat: r.repeat,
						...(r.notes === null ? {} : { notes: r.notes })
					},
					ctx,
					{
						id: booking,
						request: [{ target: targetOf(r), set: { status: 'booked', booking } }]
					}
				)
			);
			if (Result.isSuccess(booked)) continue;
			const why = Result.isFailure(booked)
				? booked.failure.message
				: 'The booking could not be confirmed automatically.';
			const when = formatInstant(r.start, ctx.tz);
			yield* ctx.act(
				{
					'booking_requests.update': [
						{ target: targetOf(r), set: { status: 'follow_up', outcome: why } }
					],
					'customer_notices.create': [
						{
							customer,
							subject: `We received your booking request ${r.number}`,
							body: `Thank you, ${r.name}. No provider is available at ${when}, so our scheduling team will reach out shortly with the nearest open times.`
						}
					]
				},
				{ key: `intake-followup:${r.id}:${r.revision}` }
			);
			yield* ctx.notify({
				title: `Portal request ${r.number} needs follow-up`,
				description: why,
				to: [{ policy: 'operations' }],
				link: { model: 'booking_requests', id: r.id },
				once: `intake-${r.id}`
			});
		}
	}
});
