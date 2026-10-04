import { automation, type Id } from '@norbital-ai/bolt';
import { when } from '../lib/dispatch.js';

/**
 * A portal request becomes a booking on its own when a helper is free at the time asked. The customer is found by their
 * mobile number, or filed (placed on the map when the host geocodes); the booking goes through `bookings.book`, the same
 * matching the desk uses, which confirms it to them. Otherwise they are told the desk will propose a time.
 */
const portal_intake = automation({
	description:
		'Books each portal request when a helper is free at the time asked; otherwise hands it to the desk and tells the customer a time will be proposed.',
	on: { created: 'booking_requests' },
	runAs: ['dispatch_automation']
});
export default portal_intake;

portal_intake.run(async ({ ids }, ctx) => {
	const { rows } = await ctx.read('booking_requests', {
		where: { id: { in: ids }, status: { eq: 'received' } },
		all: true
	});
	for (const r of rows) {
		// the mobile number is the customer's identity
		const known = (await ctx.read('customers', { where: { phone: { eq: r.phone } }, limit: 1 }))
			.rows[0];
		let customer = known?.id;
		if (customer === undefined) {
			const hits = await ctx.geo.search(r.address);
			const point = Array.isArray(hits) ? hits[0]?.point : undefined;
			const { records } = await ctx.act('customers.create', {
				name: r.name,
				address: r.address,
				area: r.area,
				phone: r.phone,
				...(r.email === null ? {} : { email: r.email }),
				...(point === undefined ? {} : { location: point })
			});
			customer = records[0]!.id as Id<'customers'>;
		}
		const availability =
			r.availability === null ? null : await ctx.get('availability_requests', r.availability);
		const profile =
			known ??
			(await ctx.get('customers', customer, { select: { address: true, location: true } }));
		const destination =
			availability?.location ?? (profile?.address === r.address ? profile.location : null);
		const preferred =
			availability?.preference === 'preferred' && availability.helper !== null
				? [availability.helper]
				: [];
		const booked = await ctx.act.try('bookings.book', {
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
		});
		if (booked.kind === 'committed') {
			await ctx.act('booking_requests.update', {
				target: r.id,
				set: { status: 'booked', booking: booked.output.booking }
			});
			// `bookings.book` files the confirmation notice
			continue;
		}
		const why = booked.kind === 'refused' ? booked.message : 'The booking could not be made.';
		await ctx.act('booking_requests.update', {
			target: r.id,
			set: { status: 'follow_up', outcome: why }
		});
		await ctx.act('customer_notices.create', {
			customer,
			subject: `We received your booking request ${r.number}`,
			body: `Thank you, ${r.name}. No helper is free at exactly ${when(r.start, ctx.tz)}, so our team will contact you shortly with the nearest available times.`
		});
		await ctx.notify({
			to: { team: 'Operations' },
			title: `Portal request ${r.number} needs a time`,
			body: why,
			link: { collection: 'booking_requests', id: r.id },
			once: `intake-${r.id}`
		});
	}
});
