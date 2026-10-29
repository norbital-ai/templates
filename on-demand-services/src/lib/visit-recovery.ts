import { Effect } from 'effect';
import type { ActInput, AutomationCtx, Id, Instant, Row, StartInput } from '@norbital-ai/bolt';
import { dayOf, loadPool, settingsOf, when } from './dispatch.js';
import { rank, slotOf } from './matching.js';
import { Refusal } from '@norbital-ai/bolt/errors';
const UNREADABLE = 'The selected record does not exist or is not readable.';
/**
 * A helper answers only for their own visits: the run is the system identity, so the member who started it (its
 * trigger) must be the helper of every target.
 */
export const ownVisits = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query' | 'run'>,
	targets: readonly Id<'visits'>[]
) {
	const by = ctx.run.trigger;
	const user = by.kind === 'person' && by.actor.kind === 'member' ? by.actor.id : null;
	if (user === null) return yield* new Refusal({ message: UNREADABLE, field: 'targets' });
	const { visits, helpers } = yield* ctx.query({
		visits: { output: 'helper', where: { id: { in: targets } }, fields: ['helper'] },
		helpers: { where: { user: { eq: user } }, fields: ['id'] }
	});
	const mine = new Set(helpers.rows.map((h) => h.id));
	if (
		visits.rows.length !== new Set(targets).size ||
		visits.rows.some((v) => v.helper === null || !mine.has(v.helper))
	)
		return yield* new Refusal({ message: UNREADABLE, field: 'targets' });
});
/** The helper and controller report the same unavailable day through their own grants. */
export function* declineShift(
	{ mc, targets }: { readonly mc: boolean; readonly targets: readonly Id<'visits'>[] },
	ctx: Pick<AutomationCtx, 'query' | 'act' | 'tz'>
) {
	const { rows: targetsOf } = (yield* ctx.query({
		visits: { output: 'helper', where: { id: { in: targets } } }
	})).visits;
	if (targetsOf.length !== targets.length)
		return yield* new Refusal({ message: UNREADABLE, field: 'targets' });
	const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
	const revisions = new Map<string, number>();
	for (const v of targetsOf) {
		const day = yield* sameDay(ctx, v);
		for (const row of day) revisions.set(row.id, row.revision);
		updates.push(
			...day.map((v) => ({ target: v.id, set: { shift_check: 'declined' as const, mc } }))
		);
	}
	if (updates.length > 0)
		yield* ctx.act('visits.update', updates, { observed: Object.fromEntries(revisions) });
}

const HOUR = 3600000;
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
	ctx: Pick<AutomationCtx, 'query' | 'tz'>,
	v: {
		readonly helper: Id<'helpers'> | null;
		readonly status: string;
		readonly slot: {
			readonly start: Instant;
		};
	}
) {
	if (v.helper === null || v.status !== 'scheduled')
		return yield* new Refusal({ message: 'This visit has no shift to answer for.' });
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
	ctx: Pick<AutomationCtx, 'query' | 'tz' | 'now'>
) {
	if (v.status !== 'scheduled')
		return yield* new Refusal({ message: 'Only a scheduled visit can be rebooked.' });
	if (Date.parse(start) <= Date.parse(ctx.now))
		return yield* new Refusal({ message: 'Choose a start in the future.', field: 'start' });
	const sameTime = start === v.slot.start;
	const recovery =
		(v.unavailable_helper !== null && v.helper === null) ||
		v.attention === 'helper_left' ||
		v.helper === null;
	const { free_change_hours } = yield* settingsOf(ctx);
	if (
		!sameTime &&
		!recovery &&
		Date.parse(v.slot.start) - Date.parse(ctx.now) < free_change_hours * HOUR
	)
		return yield* new Refusal({
			message: `A customer time change must be at least ${free_change_hours} hours before the visit. Confirm the cleaner is unavailable before using service recovery.`
		});
	const slot = slotOf(start, (Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60000);
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
	if (best === undefined)
		return yield* new Refusal({
			message:
				'That cleaner or time is no longer available. Refresh the recommendation or choose another start.'
		});
	const update: Extract<ActInput<'visits.update'>, readonly unknown[]>[number] = {
		target: v.id,
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
		sameTime ? `A new helper for your visit on ${when(start, ctx.tz)}` : `Visit ${v.number} moved`,
		`${best.name} will come for your visit ${v.number} on ${when(start, ctx.tz)}. Please contact us if this does not suit you.`
	);
	return { update, notice };
});
