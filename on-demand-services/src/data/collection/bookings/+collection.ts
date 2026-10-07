import { collection } from '@norbital-ai/bolt';
import { loadPool, settingsOf, when } from '../../../lib/dispatch.js';
import { addDays } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import {
	AREAS,
	availableSlots,
	BOOKING_AHEAD,
	occurrences,
	planBooking,
	REPEATS
} from '../../../lib/matching.js';

const HOUR = 3_600_000;

/**
 * A booking is made by `book`, which matches every visit before anything is written. With a preference the visits go to
 * the customer's helpers in their order; without one, ranking balances added travel and weekly load, with a small
 * continuity bonus for the previous recurring cleaner.
 */
const bookings = collection('bookings', {
	read: { fields: 'all', relations: 'all' },
	create: {
		input: {
			columns: [
				'customer',
				'service',
				'address',
				'location',
				'area',
				'preference',
				'repeat',
				'notes'
			],
			with: {
				preferred_helpers: { create: { columns: ['helper', 'rank'] } },
				visits: {
					create: {
						columns: ['slot', 'address', 'location', 'area', 'skill', 'helper', 'attention']
					}
				}
			}
		}
	},
	update: { input: { columns: ['notes', 'status'] } },
	queries: {
		open_slots: {
			description:
				'Destination-specific starts after skills, preference, travel and the full recurring horizon are checked.',
			input: {
				customer: { kind: 'id', of: 'customers' },
				service: { kind: 'id', of: 'services' },
				preference: { kind: 'enum', values: ['any', 'preferred'] },
				helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, max: 5, optional: true },
				repeat: { kind: 'enum', values: REPEATS },
				visits: { kind: 'int', min: 1, max: 26, optional: true },
				from: { kind: 'date' },
				days: { kind: 'int', min: 1, max: 14 }
			},
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						day: { kind: 'date' },
						starts: { kind: 'list', of: { kind: 'instant' } }
					}
				}
			}
		}
	},
	actions: {
		book: {
			description:
				'Books a service for a customer at their address, once or recurring. With preferred helpers every visit goes to the first of them who is free; without, to the best-matched helper. Every occurrence in the requested horizon must find a helper; otherwise nothing is booked.',
			input: {
				customer: { kind: 'id', of: 'customers' },
				service: { kind: 'id', of: 'services', where: { active: { eq: true } } },
				preference: { kind: 'enum', values: ['any', 'preferred'] },
				helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, max: 5, optional: true },
				start: { kind: 'instant' },
				repeat: { kind: 'enum', values: REPEATS },
				visits: { kind: 'int', min: 1, max: 26, optional: true },
				notes: { kind: 'text', optional: true },
				address: { kind: 'text', max: 500, optional: true },
				area: { kind: 'enum', values: AREAS, optional: true },
				location: { kind: 'point', optional: true }
			},
			output: {
				kind: 'object',
				fields: {
					booking: { kind: 'id', of: 'bookings' },
					assigned: { kind: 'int' },
					unassigned: { kind: 'int' }
				}
			}
		},
		cancel: {
			description:
				'Cancels the booking and every visit still to come. Each visit inside the configured free-change cutoff is marked late.',
			target: 'record',
			input: {},
			output: { kind: 'object', fields: { cancelled: { kind: 'int' }, late: { kind: 'int' } } }
		}
	}
});
export default bookings;

bookings.query('open_slots', async (input, ctx) => {
	const [customer, service] = await Promise.all([
		ctx.get('customers', input.customer),
		ctx.get('services', input.service)
	]);
	if (customer === null || service === null || !service.active)
		return ctx.refuse('Pick a customer and an active service.');
	const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		ctx.refuse('Name at least one preferred helper.');
	const days = Array.from({ length: input.days }, (_, i) => addDays(input.from, i));
	const from = new Date(utcOf(days[0]!, 0, ctx.tz)).toISOString();
	const last = new Date(utcOf(days.at(-1)!, 0, ctx.tz)).toISOString();
	const end = occurrences(last, input.repeat, input.visits ?? BOOKING_AHEAD, ctx.tz).at(-1)!;
	const pool = await loadPool(ctx, from, end, [customer.location]);
	for (const id of preferred) {
		const h = pool.helpers.find((h) => h.id === id);
		if (h === undefined) return ctx.refuse('The selected helper is not available.');
		if (!h.skills.includes(service.skill))
			return ctx.refuse(`${h.name} cannot perform the selected service.`);
	}
	return availableSlots(
		{
			skill: service.skill,
			minutes: service.duration_minutes,
			location: customer.location,
			area: customer.area
		},
		days,
		pool,
		ctx.tz,
		ctx.now,
		input.repeat,
		input.visits ?? BOOKING_AHEAD,
		preferred
	);
});

bookings.action('book', async (input, ctx) => {
	const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
	if (input.preference === 'preferred' && preferred.length === 0)
		ctx.refuse('Name at least one preferred helper.', { field: 'helpers' });
	if (Date.parse(input.start) <= Date.parse(ctx.now))
		ctx.refuse('Pick a time in the future.', { field: 'start' });
	const [customer, service] = await Promise.all([
		ctx.get('customers', input.customer),
		ctx.get('services', input.service)
	]);
	if (customer === null || service === null || !service.active)
		return ctx.refuse('Pick a customer and an active service.');
	const starts = occurrences(input.start, input.repeat, input.visits ?? BOOKING_AHEAD, ctx.tz);
	const address = input.address ?? customer.address;
	const location = input.address === undefined ? customer.location : (input.location ?? null);
	const area = input.address === undefined ? (input.area ?? customer.area) : (input.area ?? null);
	const pool = await loadPool(ctx, starts[0]!, starts.at(-1)!, [location]);
	for (const id of preferred) {
		const h = pool.helpers.find((h) => h.id === id);
		if (h === undefined)
			return ctx.refuse('The selected helper is not available.', { field: 'helpers' });
		if (!h.skills.includes(service.skill))
			ctx.refuse(`${h.name} cannot perform the selected service.`, { field: 'helpers' });
	}
	const plan = planBooking(
		{ skill: service.skill, minutes: service.duration_minutes, location, area },
		starts,
		pool,
		ctx.tz,
		preferred
	);
	if (plan.missing !== null)
		ctx.refuse(
			`No eligible helper is free for occurrence ${plan.missing + 1}. Pick another time.`,
			{ field: 'start' }
		);
	const visits = plan.visits.map((v) => ({
		...v,
		helper: v.helper,
		address,
		location,
		area,
		skill: service.skill,
		attention: 'none' as const
	}));
	const { records } = await ctx.act('bookings.create', {
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
	});
	const repeats =
		input.repeat === 'once' ? '' : ` (${input.repeat}, ${visits.length} visits booked ahead)`;
	await ctx.act('customer_notices.create', {
		customer: customer.id,
		subject: `Booking confirmed: ${service.name}, ${when(visits[0]!.slot.start, ctx.tz)}`,
		body: `Your ${service.name} is booked for ${when(visits[0]!.slot.start, ctx.tz)}${repeats} at ${address}. We will message you if anything changes.`
	});
	return {
		booking: records.find((r) => r.collection === 'bookings')!.id,
		assigned: visits.length,
		unassigned: 0
	};
});

bookings.action('cancel', async (_, ctx) => {
	if (ctx.target.status === 'cancelled') ctx.refuse('This booking is already cancelled.');
	const { rows } = await ctx.read('visits', {
		where: { booking: { eq: ctx.target.id }, status: { eq: 'scheduled' } },
		select: { slot: true },
		all: true
	});
	const { free_change_hours } = await settingsOf(ctx);
	const late = (start: string) =>
		Date.parse(start) - Date.parse(ctx.now) < free_change_hours * HOUR;
	if (rows.length > 0)
		await ctx.act(
			'visits.update',
			rows.map((v) => ({
				target: v.id,
				set: {
					status: 'cancelled' as const,
					late_cancellation: late(v.slot.start),
					attention: 'none' as const
				}
			}))
		);
	await ctx.act('bookings.update', { target: ctx.target.id, set: { status: 'cancelled' } });
	await ctx.act('customer_notices.create', {
		customer: ctx.target.customer,
		subject: `Booking ${ctx.target.number} cancelled`,
		body: `Your booking ${ctx.target.number} and its ${rows.length} upcoming visit(s) are cancelled.`
	});
	return { cancelled: rows.length, late: rows.filter((v) => late(v.slot.start)).length };
});
