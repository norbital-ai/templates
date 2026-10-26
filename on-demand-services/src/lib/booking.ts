import { Effect } from 'effect';
import type { AutomationCtx, StartInput } from '@norbital-ai/bolt';
import { loadPool, when } from './dispatch.js';
import { BOOKING_AHEAD, occurrences, planBooking } from './matching.js';
import { Refusal } from '@norbital-ai/bolt/errors';

/** Plan every occurrence before the booking, its children and its notice commit together. */
export const bookService = Effect.fnUntraced(function* (
	input: StartInput<'bookings_book'>,
	ctx: Pick<AutomationCtx<{ runAs: 'trigger' }>, 'query' | 'act' | 'now' | 'tz'>
) {
	const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		return yield* new Refusal({ message: 'Name at least one preferred helper.', field: 'helpers' });
	if (Date.parse(input.start) <= Date.parse(ctx.now))
		return yield* new Refusal({ message: 'Pick a time in the future.', field: 'start' });
	const { customer, service } = yield* ctx.query({
		customer: { from: 'customers', id: input.customer },
		service: { from: 'services', id: input.service }
	});
	if (customer === null || service === null || !service.active)
		return yield* new Refusal({ message: 'Pick a customer and an active service.' });
	const starts = occurrences(input.start, input.repeat, input.visits ?? BOOKING_AHEAD, ctx.tz);
	const address = input.address ?? customer.address;
	const location = input.address === undefined ? customer.location : (input.location ?? null);
	const area = input.address === undefined ? (input.area ?? customer.area) : (input.area ?? null);
	const pool = yield* loadPool(ctx, starts[0]!, starts.at(-1)!, [location]);
	for (const id of preferred) {
		const h = pool.helpers.find((h) => h.id === id);
		if (h === undefined)
			return yield* new Refusal({
				message: 'The selected helper is not available.',
				field: 'helpers'
			});
		if (!h.skills.includes(service.skill))
			return yield* new Refusal({
				message: `${h.name} cannot perform the selected service.`,
				field: 'helpers'
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
		return yield* new Refusal({
			message: `No eligible helper is free for occurrence ${plan.missing + 1}. Pick another time.`,
			field: 'start'
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
	const { records } = yield* ctx.act.many([
		{
			callable: 'bookings.create',
			input: {
				customer: customer.id,
				service: service.id,
				address,
				location,
				area,
				preference: input.preference,
				repeat: input.repeat,
				...(input.notes === undefined ? {} : { notes: input.notes }),
				preferred_helpers: { create: preferred.map((helper, i) => ({ helper, rank: i + 1 })) },
				visits: { create: visits }
			}
		},
		{
			callable: 'customer_notices.create',
			input: {
				customer: customer.id,
				subject: `Booking confirmed: ${service.name}, ${when(visits[0]!.slot.start, ctx.tz)}`,
				body: `Your ${service.name} is booked for ${when(visits[0]!.slot.start, ctx.tz)}${repeats} at ${address}. We will message you if anything changes.`
			}
		}
	]);
	const booking = records.find((record) => record.collection === 'bookings');
	if (booking === undefined)
		return yield* new Refusal({ message: 'The booking creation did not return a booking record.' });
	return {
		booking: booking.id,
		assigned: visits.length,
		unassigned: 0
	};
});
