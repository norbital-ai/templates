import { Effect } from 'effect';
import type { AutomationCtx, StartInput } from '@norbital-ai/bolt';
import { loadPool } from './dispatch.js';
import { BOOKING_AHEAD, occurrences, planBooking } from './matching.js';

/** Plan every occurrence before the booking, its children and its notice commit together. */
export const bookService = Effect.fnUntraced(function* (
	input: StartInput<'bookings_book'>,
	ctx: Pick<AutomationCtx, 'query' | 'act' | 'now' | 'tz' | 'refuse'>
) {
	const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		return yield* ctx.refuse('errors.preferred_helper_required', { field: 'helpers' });
	if (Date.parse(input.start) <= Date.parse(ctx.now))
		return yield* ctx.refuse('errors.start_in_past', { field: 'start' });
	const { customers, services } = yield* ctx.query({
		customers: { where: { id: { eq: input.customer } }, limit: 1 },
		services: { where: { id: { eq: input.service } }, limit: 1 }
	});
	const customer = customers.rows[0] ?? null,
		service = services.rows[0] ?? null;
	if (customer === null || service === null || !service.active)
		return yield* ctx.refuse('errors.customer_service_required');
	const starts = occurrences(input.start, input.repeat, input.visits ?? BOOKING_AHEAD, ctx.tz);
	const address = input.address ?? customer.address;
	const location = input.address === undefined ? customer.location : (input.location ?? null);
	const area = input.address === undefined ? (input.area ?? customer.area) : (input.area ?? null);
	const pool = yield* loadPool(ctx, starts[0]!, starts.at(-1)!, [location]);
	for (const id of preferred) {
		const h = pool.helpers.find((h) => h.id === id);
		if (h === undefined)
			return yield* ctx.refuse('errors.helper_unavailable', { field: 'helpers' });
		if (!h.skills.includes(service.skill))
			return yield* ctx.refuse('errors.helper_lacks_skill', {
				field: 'helpers',
				values: { name: h.name }
			});
	}
	const plan = planBooking(
		{ skill: service.skill, minutes: service.duration_minutes, location, area },
		starts,
		pool,
		ctx.tz,
		preferred
	);
	if (plan.missing !== null)
		return yield* ctx.refuse('errors.no_helper_for_occurrence', {
			field: 'start',
			values: { occurrence: plan.missing + 1 }
		});
	const visits = plan.visits.map((v) => ({
		...v,
		helper: v.helper,
		address,
		location,
		area,
		skill: service.skill,
		attention: 'none' as const
	}));

	const repeats =
		input.repeat === 'once' ? '' : ` (${input.repeat}, ${visits.length} visits booked ahead)`;
	const { records } = yield* ctx.act({
		'bookings.create': [
			{
				customer: customer.id,
				service: service.id,
				address,
				location,
				area,
				preference: input.preference,
				repeat: input.repeat,
				...(input.notes === undefined ? {} : { notes: input.notes }),
				preferred_helpers: preferred.map((helper, i) => ({ helper, rank: i + 1 })),
				visits
			}
		],
		'customer_notices.create': [
			{
				customer: customer.id,
				subject: `Booking confirmed: ${service.name}, ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(visits[0]!.slot.start))}`,
				body: `Your ${service.name} is booked for ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(visits[0]!.slot.start))}${repeats} at ${address}. We will message you if anything changes.`
			}
		]
	});
	const booking = records.find((record) => record.model === 'bookings');
	if (booking === undefined) return yield* ctx.refuse('errors.booking_not_created');
	return {
		booking: booking.id,
		assigned: visits.length,
		unassigned: 0
	};
});
