import { DateTime, Duration, Effect } from 'effect';
import type { ActInput, AutomationCtx, Id, Instant, Row, StartInput } from '@norbital-ai/bolt';
import { dayOf, loadPool, settingsOf, targetOf } from './dispatch.js';
import { rank, slotOf } from './matching.js';
/**
 * A helper answers only for their own visits: the run is the system identity, so the member who started it (its
 * trigger) must be the helper of every target.
 */
export const ownVisits = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query' | 'run' | 'refuse'>,
	targets: readonly Id<'visits'>[]
) {
	const by = ctx.run.trigger;
	const user = by.kind === 'person' && by.actor.kind === 'member' ? by.actor.id : null;
	if (user === null) return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
	const { visits, helpers } = yield* ctx.query({
		visits: { output: 'helper', where: { id: { in: targets } }, fields: ['helper'] },
		helpers: { where: { user: { eq: user } }, fields: ['id'] }
	});
	const mine = new Set(helpers.rows.map((h) => h.id));
	if (
		visits.rows.length !== new Set(targets).size ||
		visits.rows.some((v) => v.helper === null || !mine.has(v.helper))
	)
		return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
});
/** The helper and controller report the same unavailable day through their own grants. */
export function* declineShift(
	{ mc, targets }: { readonly mc: boolean; readonly targets: readonly Id<'visits'>[] },
	ctx: Pick<AutomationCtx, 'query' | 'act' | 'tz' | 'refuse'>
) {
	const { rows: targetsOf } = (yield* ctx.query({
		visits: { output: 'helper', where: { id: { in: targets } } }
	})).visits;
	if (targetsOf.length !== targets.length)
		return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
	const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
	for (const v of targetsOf) {
		const day = yield* sameDay(ctx, v);
		updates.push(
			...day.map((v) => ({ target: targetOf(v), set: { shift_check: 'declined' as const, mc } }))
		);
	}
	if (updates.length > 0) yield* ctx.act({ 'visits.update': updates });
}

export const customerNotice = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query'>,
	v: {
		readonly id: Id<'visits'>;
		readonly booking: Id<'bookings'>;
	},
	subject: string,
	body: string
) {
	const booking =
		(yield* ctx.query({
			bookings: { where: { id: { eq: v.booking } }, fields: ['customer'], limit: 1 }
		})).bookings.rows[0] ?? null;
	if (booking !== null)
		return {
			customer: booking.customer,
			visit: v.id,
			subject,
			body
		};
	return null;
});
export const sameDay = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query' | 'tz' | 'refuse'>,
	v: {
		readonly helper: Id<'helpers'> | null;
		readonly status: string;
		readonly slot: {
			readonly start: Instant;
		};
	}
) {
	if (v.helper === null || v.status !== 'scheduled') return yield* ctx.refuse('errors.no_shift');
	const { rows } = (yield* ctx.query({
		visits: {
			output: 'helper',
			where: {
				helper: { eq: v.helper },
				status: { eq: 'scheduled' },
				slot: { overlaps: dayOf(v.slot.start, ctx.tz) }
			},
			fields: ['shift_check', 'revision']
		}
	})).visits;
	return rows;
});

/** Recheck the live visit and return the whole update/notice plan before any write. */
export const planRebooking = Effect.fnUntraced(function* (
	v: Row<'visits'>,
	{ start, helper }: Pick<StartInput<'visits_rebook'>, 'start' | 'helper'>,
	ctx: Pick<AutomationCtx, 'query' | 'tz' | 'now' | 'refuse'>
) {
	if (v.status !== 'scheduled') return yield* ctx.refuse('errors.rebook_not_scheduled');
	if (Date.parse(start) <= Date.parse(ctx.now))
		return yield* ctx.refuse('errors.start_in_past', { field: 'start' });
	const sameTime = start === v.slot.start;
	const recovery =
		(v.unavailable_helper !== null && v.helper === null) ||
		v.attention === 'helper_left' ||
		v.helper === null;
	const { free_change_hours } = yield* settingsOf(ctx);
	if (
		!sameTime &&
		!recovery &&
		DateTime.isLessThan(
			DateTime.makeUnsafe(v.slot.start),
			DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours })
		)
	)
		return yield* ctx.refuse('errors.customer_change_window', {
			values: { hours: free_change_hours }
		});
	const slot = slotOf(
		start,
		Duration.toMinutes(
			DateTime.distance(DateTime.makeUnsafe(v.slot.start), DateTime.makeUnsafe(v.slot.end!))
		)
	);
	const pool = yield* loadPool(ctx, start, start, [v.location]);
	const eligible = pool.helpers.filter(
		(h) => h.id !== v.unavailable_helper && (helper === undefined || h.id === helper)
	);
	const best = rank(
		{ skill: v.skill, slot, location: v.location, area: v.area, visit: v.id },
		{ ...pool, helpers: eligible },
		ctx.tz,
		v.helper
	)[0];
	if (best === undefined) return yield* ctx.refuse('errors.rebook_unavailable');
	const update: Extract<ActInput<'visits.update'>, readonly unknown[]>[number] = {
		target: targetOf(v),
		set: {
			helper: best.helper,
			slot,
			attention: 'none',
			proposed_helper: null,
			proposed_slot: null,
			mc: false
		}
	};
	const notice = yield* customerNotice(
		ctx,
		v,
		sameTime
			? `A new helper for your visit on ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(start))}`
			: `Visit ${v.number} moved`,
		`${best.name} will come for your visit ${v.number} on ${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(start))}. Please contact us if this does not suit you.`
	);
	return { update, notice };
});
