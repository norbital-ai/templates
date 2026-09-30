import { collection, type ActionCtx, type Id, type Instant } from '@norbital-ai/bolt';
import { Instant as instant } from '@norbital-ai/std/date';
import { dayOf, loadPool, reassign, settingsOf, VISIT, when } from '../../../lib/dispatch.js';
import { rank, refusal, slotOf, type Refusal } from '../../../lib/matching.js';

const HOUR = 3_600_000;
const WHY: { [R in Refusal]: string } = {
	left: 'has left',
	skill: 'does not have the skill this service needs',
	day: 'does not work that day',
	hours: 'is outside their working hours then',
	time_off: 'is off that day',
	booked: 'has another visit too close to this one, counting the drive between them'
};

/**
 * Visits are created with their booking. Every write that names a helper or moves a visit is held to the hard
 * requirements here, whoever makes it; a change of helper starts that helper's shift check afresh.
 */
const visits = collection('visits', {
	read: { fields: 'all', relations: 'all' },
	update: {
		input: {
			columns: [
				'helper',
				'slot',
				'status',
				'shift_check',
				'shift_asked_at',
				'mc',
				'eta_minutes',
				'eta_checked_at',
				'attention',
				'proposed_helper',
				'proposed_slot',
				'late_cancellation',
				'completion_notes'
			]
		}
	},
	queries: {
		candidates: {
			description: 'The helpers who could take this visit instead, best match first.',
			input: { visit: { kind: 'id', of: 'visits' } },
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						helper: { kind: 'id', of: 'helpers' },
						name: { kind: 'text' },
						drive_minutes: { kind: 'int' },
						same_area: { kind: 'bool' },
						week_load: { kind: 'int' }
					}
				}
			}
		}
	},
	actions: {
		confirm_shift: {
			description: 'The helper confirms they will work their visits that day.',
			target: 'record',
			input: {}
		},
		decline_shift: {
			description:
				'The helper says they cannot work their visits that day, with or without a medical certificate. Dispatch reassigns them.',
			target: 'record',
			input: { mc: { kind: 'bool' } }
		},
		reassign: {
			description:
				'Gives the visit to the named helper, or to the best-matched one when none is named. A customer who asked for particular helpers is told.',
			target: 'record',
			input: { helper: { kind: 'id', of: 'helpers', optional: true } }
		},
		reschedule: {
			description:
				'Moves the visit to a new start, keeping its helper when they are free then. Only outside the free-change window before the visit.',
			target: 'record',
			input: { start: { kind: 'instant' } }
		},
		cancel: {
			description:
				'Cancels the visit; inside the free-change window before its start it is a late, chargeable cancellation.',
			target: 'record',
			input: {}
		},
		accept_proposal: {
			description: 'Takes the helper and time proposed when the visit’s helper left.',
			target: 'record',
			input: {}
		}
	}
});
export default visits;

/** The start and the finish are stamped as the helper moves the visit through its day. */
const stamped = <I extends { readonly status?: string }>(input: I, now: Instant) =>
	input.status === 'in_progress'
		? { ...input, started_at: now }
		: input.status === 'done'
			? { ...input, completed_at: now }
			: input;

visits.transform(async (inputs, ctx) => {
	const touched = inputs.flatMap((input, i) => {
		const stored = ctx.existing[i]!;
		const helper = input.helper === undefined ? stored.helper : input.helper;
		const moved = input.helper !== undefined || input.slot !== undefined;
		const status = input.status ?? stored.status;
		return moved && helper != null && status !== 'cancelled' ? [String(helper)] : [];
	});
	if (touched.length === 0) return inputs.map((input) => stamped(input, ctx.now));
	const ids = [...new Set(touched)] as Id<'helpers'>[];
	const starts = inputs.map((input, i) => Date.parse((input.slot ?? ctx.existing[i]!.slot).start));
	const from = instant(new Date(Math.min(...starts) - 2 * 24 * HOUR).toISOString());
	const to = instant(new Date(Math.max(...starts) + 2 * 24 * HOUR).toISOString());
	const [helpers, stored, off] = await Promise.all([
		ctx.db.read('helpers', { where: { id: { in: ids } }, all: true }),
		ctx.db.read('visits', {
			where: {
				helper: { in: ids },
				status: { ne: 'cancelled' },
				slot: { overlaps: { start: from, end: to } }
			},
			select: { helper: true, slot: true, location: true, status: true },
			all: true
		}),
		ctx.db.read('helper_time_off', { where: { helper: { in: ids } }, all: true })
	]);
	// the stored holds with this batch laid over them, so two visits of one batch cannot collide either
	const held = new Map(stored.rows.map((v) => [String(v.id), v]));
	inputs.forEach((input, i) => {
		const v = ctx.existing[i]!;
		held.set(String(v.id), {
			id: v.id,
			helper: input.helper === undefined ? v.helper : (input.helper as typeof v.helper),
			slot:
				input.slot === undefined
					? v.slot
					: { start: instant(input.slot.start), end: instant(input.slot.end!) },
			location: v.location,
			status: input.status ?? v.status
		});
	});
	const pool = {
		helpers: helpers.rows,
		busy: [...held.values()].flatMap((v) =>
			v.helper === null || v.status === 'cancelled'
				? []
				: [
						{
							id: v.id,
							helper: v.helper,
							slot: { start: v.slot.start, end: v.slot.end! },
							location: v.location
						}
					]
		),
		off: off.rows
	};
	return inputs.map((input, i) => {
		const stored = ctx.existing[i]!;
		const helper = input.helper === undefined ? stored.helper : input.helper;
		const changed = input.helper !== undefined && input.helper !== stored.helper;
		if (
			(input.helper !== undefined || input.slot !== undefined) &&
			helper != null &&
			(input.status ?? stored.status) !== 'cancelled'
		) {
			const h = pool.helpers.find((x) => x.id === helper)!;
			const slot = input.slot ?? stored.slot;
			const no = refusal(
				h,
				{
					skill: stored.skill,
					slot: { start: instant(slot.start), end: instant(slot.end!) },
					location: stored.location,
					area: stored.area,
					visit: stored.id
				},
				pool,
				ctx.tz
			);
			if (no !== null) ctx.refuse(`${h.name} ${WHY[no]}.`, { field: 'helper' });
		}
		return stamped(
			changed
				? {
						shift_check: 'not_due' as const,
						shift_asked_at: null,
						eta_minutes: null,
						eta_checked_at: null,
						...input
					}
				: input,
			ctx.now
		);
	});
});

visits.query('candidates', async ({ visit }, ctx) => {
	const v = await ctx.get('visits', visit);
	if (v === null) return ctx.refuse('This visit is not visible to you.');
	const pool = await loadPool(ctx, v.slot.start, v.slot.start);
	const need = {
		skill: v.skill,
		slot: { start: v.slot.start, end: v.slot.end! },
		location: v.location,
		area: v.area,
		visit: v.id
	};
	return rank(
		need,
		{ ...pool, helpers: pool.helpers.filter((h) => h.id !== v.helper) },
		ctx.tz
	).map((c) => ({
		helper: c.helper as Id<'helpers'>,
		name: c.name,
		drive_minutes: c.drive_minutes,
		same_area: c.same_area,
		week_load: c.week_load
	}));
});

/** Files a notice to the customer of the visit's booking. */
async function tellCustomer(
	ctx: Pick<ActionCtx<'visits'>, 'get' | 'act'>,
	v: { readonly id: Id<'visits'>; readonly booking: Id<'bookings'> },
	subject: string,
	body: string
) {
	const booking = await ctx.get('bookings', v.booking, { select: { customer: true } });
	if (booking !== null)
		await ctx.act('customer_notices.create', {
			customer: booking.customer,
			visit: v.id,
			subject,
			body
		});
}

/** The helper's scheduled visits on the day of `v`. */
async function sameDay(
	ctx: Pick<ActionCtx<'visits'>, 'read' | 'tz' | 'refuse'>,
	v: {
		readonly helper: Id<'helpers'> | null;
		readonly status: string;
		readonly slot: { readonly start: Instant };
	}
) {
	if (v.helper === null || v.status !== 'scheduled')
		return ctx.refuse('This visit has no shift to answer for.');
	const { rows } = await ctx.read('visits', {
		where: {
			helper: { eq: v.helper },
			status: { eq: 'scheduled' },
			slot: { overlaps: dayOf(v.slot.start, ctx.tz) }
		},
		select: { shift_check: true },
		all: true
	});
	return rows;
}

visits.action('confirm_shift', async (_, ctx) => {
	const day = await sameDay(ctx, ctx.target);
	await ctx.act(
		'visits.update',
		day.map((v) => ({ target: v.id, set: { shift_check: 'confirmed' as const } }))
	);
});

visits.action('decline_shift', async ({ mc }, ctx) => {
	const day = await sameDay(ctx, ctx.target);
	await ctx.act(
		'visits.update',
		day.map((v) => ({ target: v.id, set: { shift_check: 'declined' as const, mc } }))
	);
});

visits.action('reassign', async ({ helper }, ctx) => {
	const v = ctx.target;
	if (v.status !== 'scheduled') ctx.refuse('Only a scheduled visit can be reassigned.');
	if (helper == null) {
		const [row] = (
			await ctx.read('visits', { where: { id: { eq: v.id } }, select: VISIT, limit: 1 })
		).rows;
		const { assigned } = await reassign(ctx, [row!], String(v.helper));
		if (assigned === 0)
			ctx.refuse('No other helper is free for this visit. Reschedule it instead.');
		return;
	}
	await ctx.act('visits.update', { target: v.id, set: { helper, attention: 'none' } });
	const [booking, next] = await Promise.all([
		ctx.get('bookings', v.booking, {
			select: { preference: true, customer: true }
		}),
		ctx.get('helpers', helper)
	]);
	if (booking?.preference === 'preferred')
		await ctx.act('customer_notices.create', {
			customer: booking.customer,
			visit: v.id,
			subject: `A new helper for your visit on ${when(v.slot.start, ctx.tz)}`,
			body: `${next?.name ?? 'Another helper'} will come for visit ${v.number} on ${when(v.slot.start, ctx.tz)} in place of your usual helper.`
		});
});

visits.action('reschedule', async ({ start }, ctx) => {
	const v = ctx.target;
	if (v.status !== 'scheduled') ctx.refuse('Only a scheduled visit can be moved.');
	const { free_change_hours } = await settingsOf(ctx);
	if (Date.parse(v.slot.start) - Date.parse(ctx.now) < free_change_hours * HOUR)
		ctx.refuse(`A visit can be moved only up to ${free_change_hours} hours before it starts.`);
	if (Date.parse(start) <= Date.parse(ctx.now))
		ctx.refuse('Pick a time in the future.', { field: 'start' });
	const slot = slotOf(start, (Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60_000);
	const pool = await loadPool(ctx, slot.start, slot.start);
	const need = { skill: v.skill, slot, location: v.location, area: v.area, visit: v.id };
	const best = rank(need, pool, ctx.tz, v.helper)[0];
	if (best === undefined) return ctx.refuse('No helper is free at that time.', { field: 'start' });
	await ctx.act('visits.update', {
		target: v.id,
		set: { slot, helper: best.helper as Id<'helpers'>, attention: 'none' }
	});
	await tellCustomer(
		ctx,
		v,
		`Visit ${v.number} moved`,
		`Your visit ${v.number} is now on ${when(slot.start, ctx.tz)}.`
	);
});

visits.action('cancel', async (_, ctx) => {
	const v = ctx.target;
	if (v.status !== 'scheduled') ctx.refuse('Only a scheduled visit can be cancelled.');
	const { free_change_hours } = await settingsOf(ctx);
	await ctx.act('visits.update', {
		target: v.id,
		set: {
			status: 'cancelled',
			attention: 'none',
			late_cancellation: Date.parse(v.slot.start) - Date.parse(ctx.now) < free_change_hours * HOUR
		}
	});
	await tellCustomer(
		ctx,
		v,
		`Visit ${v.number} cancelled`,
		`Your visit on ${when(v.slot.start, ctx.tz)} is cancelled.`
	);
});

visits.action('accept_proposal', async (_, ctx) => {
	const v = ctx.target;
	if (v.proposed_helper === null || v.proposed_slot === null)
		return ctx.refuse('This visit has no proposal.');
	await ctx.act('visits.update', {
		target: v.id,
		set: {
			helper: v.proposed_helper,
			slot: v.proposed_slot,
			proposed_helper: null,
			proposed_slot: null,
			attention: 'none'
		}
	});
});
