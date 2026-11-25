import { DateTime, Effect } from 'effect';
import type { ActInput, AutomationCtx, Id, StartInput } from '@norbital-ai/bolt';
import { loadPool } from './dispatch.js';
import { formatInstant } from './format.js';
import { BOOKING_AHEAD, normalizeSkill, occurrences, planBooking } from './matching.js';

/**
 * Plan every occurrence before committing the booking, preferred providers, appointments, and
 * confirmation notice atomically. Portal intake attaches `also.request` so the request settles
 * inside the same commit.
 */
export const bookService = Effect.fnUntraced(function* (
	input: StartInput<'bookings_book'>,
	ctx: Pick<AutomationCtx, 'query' | 'act' | 'now' | 'tz' | 'refuse'>,
	also: {
		readonly id?: Id<'bookings'>;
		readonly request?: ActInput<'booking_requests.update'>;
	} = {}
) {
	const preferred = input.preference === 'preferred' ? (input.providers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		return yield* ctx.refuse('errors.preferred_provider_required', { field: 'providers' });
	if (DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(input.start), DateTime.makeUnsafe(ctx.now)))
		return yield* ctx.refuse('errors.start_in_past', { field: 'start' });
	const { customers, services } = yield* ctx.query({
		customers: { where: { id: { eq: input.customer } }, limit: 1 },
		services: { where: { id: { eq: input.service } }, limit: 1 }
	});
	const customer = customers.rows[0] ?? null;
	const service = services.rows[0] ?? null;
	if (customer === null || service === null || !service.active)
		return yield* ctx.refuse('errors.customer_service_required');
	const starts = occurrences(
		input.start,
		input.repeat,
		input.appointments ?? BOOKING_AHEAD,
		ctx.tz
	);
	const address = input.address ?? customer.address;
	const location = input.address === undefined ? customer.location : (input.location ?? null);
	const firstStart = starts.at(0);
	const lastStart = starts.at(-1);
	if (firstStart === undefined || lastStart === undefined)
		return yield* ctx.refuse('errors.no_provider_for_occurrence', {
			field: 'start',
			values: { occurrence: 1 }
		});
	const pool = yield* loadPool(ctx, firstStart, lastStart, [location]);
	const wantSkill = normalizeSkill(service.skill);
	for (const id of preferred) {
		const p = pool.providers.find((row) => row.id === id);
		if (p === undefined)
			return yield* ctx.refuse('errors.provider_unavailable', { field: 'providers' });
		if (!p.skills.some((s) => normalizeSkill(s) === wantSkill))
			return yield* ctx.refuse('errors.provider_lacks_skill', {
				field: 'providers',
				values: { name: p.name }
			});
	}
	const plan = planBooking(
		{ skill: service.skill, minutes: service.duration_minutes, location },
		starts,
		pool,
		ctx.tz,
		preferred
	);
	if (plan.missing !== null)
		return yield* ctx.refuse('errors.no_provider_for_occurrence', {
			field: 'start',
			values: { occurrence: plan.missing + 1 }
		});
	const appointments = plan.appointments.map((a) => ({
		...a,
		provider: a.provider,
		address,
		location,
		skill: service.skill,
		attention: 'none' as const
	}));
	const firstAppointment = appointments.at(0);
	if (firstAppointment === undefined) return yield* ctx.refuse('errors.booking_not_created');
	const repeats =
		input.repeat === 'once'
			? ''
			: ` (${input.repeat}, ${appointments.length} appointments scheduled ahead)`;
	const when = formatInstant(firstAppointment.slot.start, ctx.tz);
	const firstRequest = also.request?.at(0);
	const requestId =
		firstRequest === undefined
			? undefined
			: typeof firstRequest.target === 'string'
				? firstRequest.target
				: firstRequest.target.id;
	const actKey =
		requestId !== undefined
			? `book:request:${requestId}`
			: `book:${customer.id}:${service.id}:${firstAppointment.slot.start}:${input.repeat}`;
	const { records } = yield* ctx.act(
		{
			'bookings.create': [
				{
					...(also.id === undefined ? {} : { id: also.id }),
					customer: customer.id,
					service: service.id,
					address,
					location,
					preference: input.preference,
					repeat: input.repeat,
					...(input.notes === undefined ? {} : { notes: input.notes }),
					preferred_providers: preferred.map((provider, i) => ({ provider, rank: i + 1 })),
					appointments
				}
			],
			'customer_notices.create': [
				{
					customer: customer.id,
					subject: `Booking confirmed: ${service.name}, ${when}`,
					body: `Your ${service.name} is booked for ${when}${repeats} at ${address}. We will notify you if anything changes.`
				}
			],
			...(also.request === undefined ? {} : { 'booking_requests.update': also.request })
		},
		{ key: actKey }
	);
	const booking = records.find((record) => record.model === 'bookings');
	if (booking === undefined) return yield* ctx.refuse('errors.booking_not_created');
	return {
		booking: booking.id,
		assigned: appointments.length,
		unassigned: 0
	};
});
