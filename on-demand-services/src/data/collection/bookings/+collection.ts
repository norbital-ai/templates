import { collection, type Id } from '@norbital-ai/bolt';
import { loadPool, settingsOf, when } from '../../../lib/dispatch.js';
import { occurrences, rank, REPEATS, slotOf, type Busy } from '../../../lib/matching.js';

const HOUR = 3_600_000;
/** How many visits a recurring booking schedules ahead when the desk does not say. */
const AHEAD = 8;

/**
 * A booking is made by `book`, which matches every visit before anything is written. With a preference the visits go to
 * the customer's helpers in their order; without one, to the best-matched helper, kept from visit to visit while they
 * stay free.
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
	actions: {
		book: {
			description:
				'Books a service for a customer at their address, once or recurring. With preferred helpers every visit goes to the first of them who is free; without, to the best-matched helper. The first visit must find a helper; a later one nobody can take waits for dispatch.',
			input: {
				customer: { kind: 'id', of: 'customers' },
				service: { kind: 'id', of: 'services', where: { active: { eq: true } } },
				preference: { kind: 'enum', values: ['any', 'preferred'] },
				helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, max: 5, optional: true },
				start: { kind: 'instant' },
				repeat: { kind: 'enum', values: REPEATS },
				visits: { kind: 'int', min: 1, max: 26, optional: true },
				notes: { kind: 'text', optional: true }
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
				'Cancels the booking and every visit still to come. A visit starting within a day is marked a late cancellation.',
			target: 'record',
			input: {},
			output: { kind: 'object', fields: { cancelled: { kind: 'int' }, late: { kind: 'int' } } }
		}
	}
});
export default bookings;

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
	if (customer === null || service === null) return ctx.refuse('Pick a customer and a service.');
	const starts = occurrences(input.start, input.repeat, input.visits ?? AHEAD, ctx.tz);
	const pool = await loadPool(ctx, starts[0]!, starts.at(-1)!);
	const helpers =
		preferred.length === 0
			? pool.helpers
			: preferred.flatMap((id) => pool.helpers.filter((h) => h.id === id));
	const order = new Map(preferred.map((id, i) => [id, i]));
	const busy: Busy[] = [...pool.busy];
	let keep: string | null = null;
	const visits = starts.map((start, i) => {
		const slot = slotOf(start, service.duration_minutes);
		const need = { skill: service.skill, slot, location: customer.location, area: customer.area };
		const found = rank(need, { helpers, busy, off: pool.off }, ctx.tz, keep);
		// a preference is an order, not a score: the first preferred helper free takes it
		const best =
			preferred.length === 0
				? found[0]
				: [...found].sort(
						(a, b) => order.get(a.helper as Id<'helpers'>)! - order.get(b.helper as Id<'helpers'>)!
					)[0];
		if (best === undefined && i === 0)
			ctx.refuse(
				preferred.length === 0
					? 'No helper with this skill is free at that time. Pick another time.'
					: 'None of the preferred helpers is free at that time. Pick one of their open times.',
				{ field: 'start' }
			);
		if (best !== undefined) {
			keep = best.helper;
			busy.push({ id: `new-${i}`, helper: best.helper, slot, location: customer.location });
		}
		return {
			slot,
			address: customer.address,
			location: customer.location,
			area: customer.area,
			skill: service.skill,
			helper: (best?.helper ?? null) as Id<'helpers'> | null,
			attention: best === undefined ? ('unassigned' as const) : ('none' as const)
		};
	});
	const { records } = await ctx.act('bookings.create', {
		customer: customer.id,
		service: service.id,
		address: customer.address,
		location: customer.location,
		area: customer.area,
		preference: input.preference,
		repeat: input.repeat,
		...(input.notes === undefined ? {} : { notes: input.notes }),
		preferred_helpers: { create: preferred.map((helper, i) => ({ helper, rank: i + 1 })) },
		visits: { create: visits }
	});
	const unassigned = visits.filter((v) => v.helper === null).length;
	const repeats =
		input.repeat === 'once' ? '' : ` (${input.repeat}, ${visits.length} visits booked ahead)`;
	await ctx.act('customer_notices.create', {
		customer: customer.id,
		subject: `Booking confirmed: ${service.name}, ${when(visits[0]!.slot.start, ctx.tz)}`,
		body: `Your ${service.name} is booked for ${when(visits[0]!.slot.start, ctx.tz)}${repeats} at ${customer.address}. We will message you if anything changes.`
	});
	return {
		booking: records.find((r) => r.collection === 'bookings')!.id as Id<'bookings'>,
		assigned: visits.length - unassigned,
		unassigned
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
