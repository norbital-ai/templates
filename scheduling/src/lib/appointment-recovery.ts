import { DateTime, Duration, Effect } from 'effect';
import type { ActInput, AutomationCtx, Id, Instant, Row, StartInput } from '@norbital-ai/bolt';
import { dayOf, loadPool, settingsOf, targetOf } from './dispatch.js';
import { formatInstant } from './format.js';
import { rank, slotOf } from './matching.js';

/**
 * Verify that the member who triggered a provider shift automation owns every target appointment.
 */
export const ownAppointments = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query' | 'trigger' | 'refuse'>,
	targets: readonly Id<'appointments'>[]
) {
	const by = ctx.trigger;
	const user = by.kind === 'person' && by.actor.kind === 'member' ? by.actor.id : null;
	if (user === null) return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
	const { appointments, providers } = yield* ctx.query({
		appointments: {
			output: 'provider',
			where: { id: { in: targets } },
			fields: ['provider'],
			limit: targets.length + 1
		},
		providers: { where: { user: { eq: user } }, fields: ['id'], limit: 1 }
	});
	const mine = new Set(providers.rows.map((p) => p.id));
	if (
		appointments.rows.length !== new Set(targets).size ||
		appointments.rows.some((a) => a.provider === null || !mine.has(a.provider))
	)
		return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
});

/** Mark a provider's scheduled appointments on the affected day(s) as declined so recovery runs. */
export function* declineShift(
	{ targets }: { readonly targets: readonly Id<'appointments'>[] },
	ctx: Pick<AutomationCtx, 'query' | 'act' | 'tz' | 'refuse'>
) {
	const { rows: targetsOf } = (yield* ctx.query({
		appointments: {
			output: 'provider',
			where: { id: { in: targets } },
			limit: targets.length + 1
		}
	})).appointments;
	if (targetsOf.length !== targets.length)
		return yield* ctx.refuse('errors.unreadable', { field: 'targets' });
	const seen = new Set<Id<'appointments'>>();
	const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
	for (const a of targetsOf) {
		const day = yield* sameDay(ctx, a);
		for (const row of day) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			updates.push({ target: targetOf(row), set: { shift_check: 'declined' as const } });
		}
	}
	if (updates.length > 0) yield* ctx.act({ 'appointments.update': updates });
}

export const customerNotice = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query'>,
	a: { readonly id: Id<'appointments'>; readonly booking: Id<'bookings'> },
	subject: string,
	body: string
) {
	const booking =
		(yield* ctx.query({
			bookings: { where: { id: { eq: a.booking } }, fields: ['customer'], limit: 1 }
		})).bookings.rows[0] ?? null;
	if (booking === null) return null;
	return {
		customer: booking.customer,
		appointment: a.id,
		subject,
		body
	};
});

export const sameDay = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query' | 'tz' | 'refuse'>,
	a: {
		readonly provider: Id<'providers'> | null;
		readonly status: string;
		readonly slot: { readonly start: Instant };
	}
) {
	if (a.provider === null || a.status !== 'scheduled') return yield* ctx.refuse('errors.no_shift');
	const { rows } = (yield* ctx.query({
		appointments: {
			output: 'provider',
			where: {
				provider: { eq: a.provider },
				status: { eq: 'scheduled' },
				slot: { overlaps: dayOf(a.slot.start, ctx.tz) }
			},
			fields: ['shift_check', 'revision'],
			limit: 50
		}
	})).appointments;
	return rows;
});

/** Recheck availability and travel before planning a reassignment or reschedule. */
export const planRebooking = Effect.fnUntraced(function* (
	a: Row<'appointments'>,
	{
		start,
		provider
	}: {
		readonly start?: Instant | undefined;
		readonly provider?: StartInput<'appointments_rebook'>['provider'];
	},
	ctx: Pick<AutomationCtx, 'query' | 'tz' | 'now' | 'refuse'>
) {
	if (a.status !== 'scheduled') return yield* ctx.refuse('errors.rebook_not_scheduled');
	const targetStart = start ?? a.slot.start;
	if (DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(targetStart), DateTime.makeUnsafe(ctx.now)))
		return yield* ctx.refuse('errors.start_in_past', { field: 'start' });
	const sameTime = targetStart === a.slot.start;
	const recovery =
		(a.unavailable_provider !== null && a.provider === null) ||
		a.attention === 'provider_inactive' ||
		a.provider === null;
	const { free_change_hours } = yield* settingsOf(ctx);
	if (
		!sameTime &&
		!recovery &&
		DateTime.isLessThan(
			DateTime.makeUnsafe(a.slot.start),
			DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours })
		)
	)
		return yield* ctx.refuse('errors.customer_change_window', {
			values: { hours: free_change_hours }
		});
	if (a.slot.end === null) return yield* ctx.refuse('errors.appointment_open_ended');
	const slot = slotOf(
		targetStart,
		Duration.toMinutes(
			DateTime.distance(DateTime.makeUnsafe(a.slot.start), DateTime.makeUnsafe(a.slot.end))
		)
	);
	const pool = yield* loadPool(ctx, targetStart, targetStart, [a.location]);
	const eligible = pool.providers.filter(
		(p) =>
			p.id !== a.unavailable_provider &&
			(provider === undefined ? !sameTime || p.id !== a.provider : p.id === provider)
	);
	const best = rank(
		{ skill: a.skill, slot, location: a.location, appointment: a.id },
		{ ...pool, providers: eligible },
		ctx.tz,
		a.provider
	)[0];
	if (best === undefined) return yield* ctx.refuse('errors.rebook_unavailable');
	const update: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number] = {
		target: targetOf(a),
		set: {
			provider: best.provider,
			slot,
			attention: 'none',
			proposed_provider: null,
			proposed_slot: null
		}
	};
	const when = formatInstant(targetStart, ctx.tz);
	const notice = yield* customerNotice(
		ctx,
		a,
		sameTime
			? `Updated provider for your appointment on ${when}`
			: `Appointment ${a.number} rescheduled`,
		`${best.name} is scheduled for appointment ${a.number} on ${when}. Contact us if you need another time.`
	);
	return { update, notice };
});
