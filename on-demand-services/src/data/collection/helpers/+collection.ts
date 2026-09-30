import { collection, type Id } from '@norbital-ai/bolt';
import { addDays, Instant } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool, when } from '../../../lib/dispatch.js';
import { openSlots, proposal } from '../../../lib/matching.js';

const columns = [
	'name',
	'phone',
	'user',
	'skills',
	'home_area',
	'home_location',
	'work_days',
	'day_start',
	'day_end',
	'status',
	'left_on',
	'last_location'
] as const;

/**
 * A helper's app reports their position into `last_location`; the transform stamps when. `open_slots` lays out when
 * each of a customer's preferred helpers could come; `offboard` is how a helper leaves.
 */
const helpers = collection('helpers', {
	read: { fields: 'all', relations: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	queries: {
		open_slots: {
			description:
				'The half-hour starts at which each named helper could take the service at the customer’s address, day by day.',
			input: {
				helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, min: 1, max: 5 },
				customer: { kind: 'id', of: 'customers' },
				service: { kind: 'id', of: 'services' },
				from: { kind: 'date' },
				days: { kind: 'int', min: 1, max: 14 }
			},
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						helper: { kind: 'id', of: 'helpers' },
						name: { kind: 'text' },
						days: {
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
				}
			}
		}
	},
	actions: {
		offboard: {
			description:
				'Marks the helper as left after their last day and proposes, for each of their later visits, the helper with the closest skills at the same time or the nearest time anyone is free.',
			target: 'record',
			input: { last_day: { kind: 'date' } },
			output: { kind: 'object', fields: { proposed: { kind: 'int' }, open: { kind: 'int' } } }
		}
	}
});
export default helpers;

helpers.transform(async (inputs, ctx) =>
	inputs.map((input, i) =>
		input.last_location !== undefined &&
		JSON.stringify(input.last_location) !== JSON.stringify(ctx.existing[i]?.last_location ?? null)
			? { ...input, last_location_at: ctx.now }
			: input
	)
);

helpers.query('open_slots', async (input, ctx) => {
	const [customer, service] = await Promise.all([
		ctx.get('customers', input.customer),
		ctx.get('services', input.service)
	]);
	if (customer === null || service === null) return ctx.refuse('Pick a customer and a service.');
	const days = Array.from({ length: input.days }, (_, i) => addDays(input.from, i));
	const pool = await loadPool(
		ctx,
		new Date(utcOf(days[0]!, 0, ctx.tz)).toISOString(),
		new Date(utcOf(days.at(-1)!, 0, ctx.tz)).toISOString()
	);
	const need = {
		skill: service.skill,
		location: customer.location,
		area: customer.area,
		minutes: service.duration_minutes
	};
	return input.helpers.flatMap((id) => {
		const helper = pool.helpers.find((h) => h.id === id);
		return helper === undefined
			? []
			: [
					{
						helper: id,
						name: helper.name,
						days: openSlots(helper, need, days, pool, ctx.tz, ctx.now)
					}
				];
	});
});

helpers.action('offboard', async ({ last_day }, ctx) => {
	const helper = ctx.target;
	if (helper.status !== 'active') return ctx.refuse(`${helper.name} has already left.`);
	const after = Instant(new Date(utcOf(addDays(last_day, 1), 0, ctx.tz)).toISOString());
	const { rows: later } = await ctx.read('visits', {
		where: {
			helper: { eq: helper.id },
			status: { eq: 'scheduled' },
			slot: { overlaps: { start: after, end: null } }
		},
		select: {
			number: true,
			slot: true,
			location: true,
			area: true,
			skill: true,
			booking: { select: { customer: true } }
		},
		all: true
	});
	const starts = later.map((v) => v.slot.start).sort();
	const pool = later.length === 0 ? null : await loadPool(ctx, starts[0]!, starts.at(-1)!);
	const others = { ...pool!, helpers: (pool?.helpers ?? []).filter((h) => h.id !== helper.id) };
	const busy = [...(pool?.busy ?? [])];
	const names = new Map(others.helpers.map((h) => [h.id, h.name]));
	const updates = [];
	const notices = [];
	let open = 0;
	for (const v of later) {
		const need = {
			skill: v.skill,
			slot: { start: v.slot.start, end: v.slot.end! },
			location: v.location,
			area: v.area,
			visit: v.id
		};
		const found = proposal(need, helper.skills, { ...others, busy }, ctx.tz);
		if (found === null) open += 1;
		else busy.push({ id: v.id, helper: found.helper, slot: found.slot, location: v.location });
		updates.push({
			target: v.id,
			set: {
				helper: null,
				proposed_helper: (found?.helper ?? null) as Id<'helpers'> | null,
				proposed_slot: found?.slot ?? null,
				shift_check: 'not_due' as const,
				attention: 'helper_left' as const
			}
		});
		if (found !== null)
			notices.push({
				customer: v.booking.customer,
				visit: v.id,
				subject: `A change to your visit on ${when(v.slot.start, ctx.tz)}`,
				body: `${helper.name} is no longer with us. For visit ${v.number} we propose ${names.get(found.helper)} on ${when(found.slot.start, ctx.tz)}. Reply to this email to accept or to ask for another time.`
			});
	}
	await ctx.act('helpers.update', {
		target: helper.id,
		set: { status: 'left', left_on: last_day }
	});
	if (updates.length > 0) await ctx.act('visits.update', updates);
	if (notices.length > 0) await ctx.act('customer_notices.create', notices);
	return { proposed: later.length - open, open };
});
