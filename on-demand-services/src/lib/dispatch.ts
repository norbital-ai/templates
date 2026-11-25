import { DateTime, Effect } from 'effect';
import {
	instance_id,
	type ActInput,
	type AutomationCtx,
	type CreateInput,
	type EffectCtx,
	type Id,
	type Instant,
	type InstanceId,
	type Where
} from '@norbital-ai/bolt';
import { epochMs, formatInstant } from './format.js';
import {
	closedSlot,
	DEFAULTS,
	improve,
	legOf,
	lookups,
	rank,
	type Point,
	type Pool,
	type Provider,
	type Slot
} from './matching.js';

type Reads = Pick<AutomationCtx, 'query' | 'tz' | 'now'>;
type Writes = Reads & Pick<AutomationCtx, 'act' | 'notify'>;

/** Single active shared integration account of `definition`, else `null`. */
const accountOf = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'query'>,
	definition: string
) {
	const { rows } = (yield* ctx.query({
		sys_integration: {
			where: { integration: { eq: definition }, active: { eq: true }, owner: { is_null: true } },
			fields: ['integration'],
			limit: 2
		}
	})).sys_integration;
	const [only] = rows;
	if (rows.length !== 1 || only === undefined) {
		yield* Effect.logWarning(`No single active ${definition} account: skipping outbound call.`);
		return null;
	}
	return only;
});

/** Workspace WhatsApp account used for customer notices and provider alerts. */
export const whatsappAccount = (ctx: Pick<AutomationCtx, 'query'>) =>
	accountOf(ctx, 'whatsapp').pipe(
		Effect.map((row) => (row === null ? null : instance_id('whatsapp', row)))
	);

/** Workspace Google Routes account used to time driving legs and live ETAs. */
export const routesAccount = (ctx: Pick<AutomationCtx, 'query'>) =>
	accountOf(ctx, 'google_routes').pipe(
		Effect.map((row) => (row === null ? null : instance_id('google_routes', row)))
	);

/** Workspace scheduling thresholds, falling back to `DEFAULTS`. */
export const settingsOf = Effect.fnUntraced(function* (ctx: Pick<AutomationCtx, 'query'>) {
	const { rows } = (yield* ctx.query({ scheduling_settings: { limit: 1 } })).scheduling_settings;
	return rows[0] ?? DEFAULTS;
});

/** Local calendar day of `instant` expressed as a UTC half-open span. */
export function dayOf(instant: string, zone: string): Slot {
	const day = DateTime.startOf(DateTime.makeZonedUnsafe(instant, { timeZone: zone }), 'day');
	return {
		start: DateTime.formatIso(day),
		end: DateTime.formatIso(DateTime.add(day, { days: 1 }))
	};
}

/** Complete Monday-to-Sunday weeks covering `from` through `to`, with a one-day safety margin. */
function windowOf(from: string, to: string, zone: string) {
	const first = DateTime.subtract(
		DateTime.startOf(DateTime.makeZonedUnsafe(from, { timeZone: zone }), 'week', {
			weekStartsOn: 1
		}),
		{ days: 1 }
	);
	const last = DateTime.add(
		DateTime.startOf(DateTime.makeZonedUnsafe(to, { timeZone: zone }), 'week', { weekStartsOn: 1 }),
		{ days: 8 }
	);
	return {
		start: DateTime.formatIso(first),
		end: DateTime.formatIso(last),
		firstDay: DateTime.formatIsoDate(first),
		lastDay: DateTime.formatIsoDate(last)
	};
}

/**
 * Shared read shape for matching: active providers, occupied appointments plus pending replacement
 * proposals (so one provider is never double-proposed), time off, and scheduling settings.
 */
export const poolRequest = (from: string, to: string, zone: string) => {
	const { start, end, firstDay, lastDay } = windowOf(from, to, zone);
	return {
		scheduling_settings: {
			fields: ['buffer_minutes', 'slot_interval_minutes'],
			limit: 1
		},
		providers: {
			where: { status: { eq: 'active' } },
			fields: ['name', 'skills', 'home_location', 'work_days', 'day_start', 'day_end', 'status'],
			limit: 500
		},
		appointments: {
			where: {
				or: [
					{
						provider: { is_null: false },
						status: { ne: 'cancelled' },
						slot: { overlaps: { start, end } }
					},
					{
						attention: { eq: 'awaiting_approval' },
						proposed_provider: { is_null: false },
						proposed_slot: { overlaps: { start, end } }
					}
				]
			},
			fields: [
				'provider',
				'slot',
				'location',
				'status',
				'attention',
				'proposed_provider',
				'proposed_slot'
			],
			limit: 2000
		},
		provider_time_off: {
			where: { period: { overlaps: { from: firstDay, to: lastDay } } },
			fields: ['provider', 'period'],
			limit: 1000
		}
	} as const;
};

type Period = { readonly start: Instant; readonly end: Instant | null };

type PoolAnswer = {
	readonly scheduling_settings?: {
		readonly rows: readonly {
			readonly buffer_minutes: number;
			readonly slot_interval_minutes: number;
		}[];
	};
	readonly providers: { readonly rows: readonly Provider[] };
	readonly appointments: {
		readonly rows: readonly {
			readonly id: Id<'appointments'>;
			readonly provider: Id<'providers'> | null;
			readonly slot: Period;
			readonly location: Point | null;
			readonly status: string;
			readonly attention: string;
			readonly proposed_provider: Id<'providers'> | null;
			readonly proposed_slot: Period | null;
		}[];
	};
	readonly provider_time_off: { readonly rows: Pool['off'] };
};

const overlaps = (slot: Period, w: { readonly start: string; readonly end: string }): boolean =>
	epochMs(slot.start) < epochMs(w.end) &&
	(slot.end === null || epochMs(slot.end) > epochMs(w.start));

/** Convert a `poolRequest` answer into a pure matching `Pool` (before cached drive times). */
export function poolOf(answer: PoolAnswer, from: string, to: string, zone: string): Pool {
	const w = windowOf(from, to, zone);
	const settings = answer.scheduling_settings?.rows[0];
	return {
		providers: answer.providers.rows,
		busy: answer.appointments.rows.flatMap((a) => [
			...(a.provider === null ||
			a.status === 'cancelled' ||
			a.slot.end === null ||
			!overlaps(a.slot, w)
				? []
				: [
						{
							id: a.id,
							provider: a.provider,
							slot: { start: a.slot.start, end: a.slot.end },
							location: a.location
						}
					]),
			...(a.attention !== 'awaiting_approval' ||
			a.proposed_provider === null ||
			a.proposed_slot === null ||
			a.proposed_slot.end === null ||
			!overlaps(a.proposed_slot, w)
				? []
				: [
						{
							id: a.id,
							provider: a.proposed_provider,
							slot: { start: a.proposed_slot.start, end: a.proposed_slot.end },
							location: a.location
						}
					])
		]),
		off: answer.provider_time_off.rows,
		bufferMinutes: settings?.buffer_minutes ?? DEFAULTS.buffer_minutes,
		slotIntervalMinutes: settings?.slot_interval_minutes ?? DEFAULTS.slot_interval_minutes
	};
}

/** Query shape for cached Google Routes legs. */
export const driveRequest = (legs: readonly string[]) =>
	({
		drive_times: { where: { leg: { in: legs } }, fields: ['leg', 'minutes'], limit: 2000 }
	}) as const;

/** Attach cached drive times to `pool`. */
export const withDrive = (
	pool: Pool,
	known: readonly { readonly leg: string; readonly minutes: number }[]
): Pool => ({ ...pool, drive: new Map(known.map((d) => [d.leg, d.minutes])) });

/** Load providers, appointments, time off, settings, and cached drive times across `from`..`to`. */
export const loadPool = Effect.fnUntraced(function* (
	ctx: Reads,
	from: string,
	to: string,
	spots: readonly (Point | null)[] = []
) {
	const pool = poolOf(yield* ctx.query(poolRequest(from, to, ctx.tz)), from, to, ctx.tz);
	const legs = lookups(pool, spots, ctx.tz);
	return withDrive(
		pool,
		legs.length === 0 ? [] : (yield* ctx.query(driveRequest(legs))).drive_times.rows
	);
});

/**
 * Google Routes drive minutes from `origin` to `destinations` (max 625). Returns `null` when no
 * account is connected or the API call fails so callers fall back cleanly to estimates.
 */
export const googleMinutes = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'request'>,
	account: InstanceId<'google_routes'> | null,
	origin: Point,
	destinations: readonly Point[],
	traffic: boolean
) {
	const at = (p: Point) => ({
		waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
	});
	if (account === null) return null;
	const answer = yield* ctx
		.request(account, {
			method: 'POST',
			path: 'distanceMatrix/v2:computeRouteMatrix',
			query: { fields: 'originIndex,destinationIndex,duration,condition' },
			body: {
				origins: [at(origin)],
				destinations: destinations.map(at),
				travelMode: 'DRIVE',
				routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE'
			},
			output: {
				kind: 'object',
				many: true,
				fields: {
					originIndex: { kind: 'int', optional: true },
					destinationIndex: { kind: 'int', optional: true },
					duration: { kind: 'text', optional: true },
					condition: { kind: 'text', optional: true }
				}
			}
		})
		.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(null))));
	if (answer === null) return null;
	const out: (number | null)[] = destinations.map(() => null);
	for (const e of answer)
		if (e.condition === 'ROUTE_EXISTS' && e.duration != null) {
			const seconds = parseFloat(e.duration);
			if (Number.isFinite(seconds)) out[e.destinationIndex ?? 0] = Math.ceil(seconds / 60);
		}
	return out;
});

/** Batch uncached route matrix requests and return newly timed legs. */
export const learnLegs = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'request' | 'query'>,
	groups: readonly { readonly from: Point; readonly to: readonly Point[] }[],
	known: ReadonlyMap<string, number>
) {
	if (groups.length === 0) return [];
	const account = yield* routesAccount(ctx);
	const answers = yield* Effect.forEach(
		groups,
		(group) => googleMinutes(ctx, account, group.from, group.to, false),
		{ concurrency: 'unbounded' }
	);
	const learned = new Map<string, number>();
	for (const [index, group] of groups.entries())
		for (const [destination, point] of group.to.entries()) {
			const key = legOf(group.from, point);
			const minutes = answers[index]?.[destination];
			if (key !== null && minutes != null && !known.has(key)) learned.set(key, minutes);
		}
	return [...learned].map(([leg, minutes]) => ({ leg, minutes }));
});

/** Projection read when reassigning or proposing coverage for appointments. */
export const appointmentsToMove = (where: Where<'appointments'>) =>
	({
		appointments: {
			where,
			fields: ['revision', 'number', 'slot', 'location', 'skill', 'booking'],
			limit: 500,
			booking: { fields: ['preference', 'customer'] }
		}
	}) as const;

type AppointmentMove = {
	readonly id: Id<'appointments'>;
	readonly revision: number;
	readonly number: string;
	readonly slot: {
		readonly start: Instant;
		readonly end: Instant | null;
	};
	readonly location: Point | null;
	readonly skill: string;
	readonly booking: {
		readonly id: Id<'bookings'>;
		readonly preference: string;
		readonly customer: Id<'customers'>;
	} | null;
};

/** Shift states still actively held by the provider (declined/lapsed days belong to recovery). */
export const HELD_SHIFT = { in: ['not_due', 'asked', 'confirmed'] } as const;

/** Optimistic concurrency target for updates and deletes. */
export const targetOf = <C extends string>(row: {
	readonly id: Id<C>;
	readonly revision: number;
}) => ({ id: row.id, revision: row.revision });

/** WhatsApp JID derived from a phone number. */
export const whatsapp = (phone: string): string => `${phone.replace(/\D/g, '')}@s.whatsapp.net`;

/** Plan automatic reassignment of appointments away from `away`. */
export const planReassignment = Effect.fnUntraced(function* (
	ctx: Reads,
	appointments: readonly AppointmentMove[],
	away: Id<'providers'>
) {
	const starts = appointments.map((a) => a.slot.start).sort((a, b) => epochMs(a) - epochMs(b));
	const first = starts.at(0);
	const last = starts.at(-1);
	if (first === undefined || last === undefined)
		return { updates: [], notices: [], assigned: 0, unassigned: 0 };
	const pool = yield* loadPool(
		ctx,
		first,
		last,
		appointments.map((a) => a.location)
	);
	const providers = pool.providers.filter((p) => p.id !== away);
	const busy = [...pool.busy];
	const names = new Map(pool.providers.map((p) => [p.id, p.name]));
	const updates: Extract<ActInput<'appointments.update'>, readonly unknown[]>[number][] = [];
	const notices: CreateInput<'customer_notices'>[] = [];
	let unassigned = 0;
	for (const a of appointments) {
		const slot = closedSlot(a.slot);
		if (slot === null) continue;
		const need = { skill: a.skill, slot, location: a.location, appointment: a.id };
		const best = rank(need, { ...pool, providers, busy }, ctx.tz)[0];
		if (best === undefined) unassigned += 1;
		else busy.push({ id: a.id, provider: best.provider, slot, location: a.location });
		updates.push({
			target: targetOf(a),
			set: {
				provider: best?.provider ?? null,
				shift_check: 'not_due' as const,
				shift_asked_at: null,
				eta_minutes: null,
				eta_checked_at: null,
				attention: best === undefined ? ('unassigned' as const) : ('none' as const)
			}
		});
		if (best !== undefined && a.booking !== null && a.booking.preference === 'preferred') {
			const when = formatInstant(a.slot.start, ctx.tz);
			notices.push({
				customer: a.booking.customer,
				appointment: a.id,
				subject: `Updated provider for your appointment on ${when}`,
				body: `Your requested provider is unavailable for appointment ${a.number} on ${when}. ${names.get(best.provider) ?? 'A qualified provider'} is scheduled at the same time instead. Reply to this message if you would like to adjust.`
			});
		}
	}
	return { updates, notices, assigned: appointments.length - unassigned, unassigned };
});

export const reassign = Effect.fnUntraced(function* (
	ctx: Writes,
	appointments: readonly AppointmentMove[],
	away: Id<'providers'>
) {
	if (appointments.length === 0) return { assigned: 0, unassigned: 0 };
	const { updates, notices, assigned, unassigned } = yield* planReassignment(
		ctx,
		appointments,
		away
	);
	yield* ctx.act({
		'appointments.update': updates,
		...(notices.length > 0 ? { 'customer_notices.create': notices } : {})
	});
	if (unassigned > 0)
		yield* ctx.notify({
			title: `${unassigned} appointment${unassigned === 1 ? '' : 's'} need a provider`,
			description: appointments.map((a) => a.number).join(', '),
			to: [{ team: 'operations' }],
			once: `unassigned-${appointments
				.map((a) => `${a.id}:${a.revision}`)
				.sort()
				.join(',')}`
		});
	return { assigned, unassigned };
});

/** Prepare replacement proposals in chronological order for dispatcher approval. */
export const recommend = Effect.fnUntraced(function* (
	ctx: Writes,
	appointments: readonly AppointmentMove[],
	away: Id<'providers'>,
	lapsed: boolean
) {
	const ordered = [...appointments].sort((a, b) => epochMs(a.slot.start) - epochMs(b.slot.start));
	const first = ordered.at(0);
	const last = ordered.at(-1);
	if (first === undefined || last === undefined) return;
	const pool = yield* loadPool(
		ctx,
		first.slot.start,
		last.slot.start,
		ordered.map((a) => a.location)
	);
	const providers = pool.providers.filter((p) => p.id !== away);
	const busy = pool.busy.filter((b) => !appointments.some((a) => a.id === b.id));
	const updates = ordered.flatMap((a) => {
		const slot = closedSlot(a.slot);
		if (slot === null) return [];
		const best = rank(
			{ skill: a.skill, slot, location: a.location, appointment: a.id },
			{ ...pool, providers, busy },
			ctx.tz
		)[0];
		if (best !== undefined)
			busy.push({ id: a.id, provider: best.provider, slot, location: a.location });
		return [
			{
				target: targetOf(a),
				set: {
					...(lapsed ? { shift_check: 'no_response' as const } : {}),
					provider: null,
					unavailable_provider: away,
					proposed_provider: best?.provider ?? null,
					proposed_slot: best === undefined ? null : slot,
					attention: best === undefined ? ('unassigned' as const) : ('awaiting_approval' as const),
					eta_minutes: null,
					eta_checked_at: null
				}
			}
		];
	});
	yield* ctx.act({ 'appointments.update': updates });
	yield* ctx.notify({
		title: 'Approve replacement providers',
		description: `${appointments.length} appointment${appointments.length === 1 ? '' : 's'} need your review. Recommendations factor in travel and workload; nothing is assigned until approved.`,
		to: [{ team: 'operations' }],
		link: { model: 'appointments', id: first.id },
		once: `recommend-${ordered.map((a) => `${a.id}:${a.revision}`).join(',')}`
	});
});

/** Rebalance movable upcoming appointments to reduce driving and balance weekly utilization. */
export const optimise = Effect.fnUntraced(function* (ctx: Writes, loaded?: Pool) {
	const { free_change_hours, booking_horizon_days } = yield* settingsOf(ctx);
	const fromInstant = DateTime.add(DateTime.makeUnsafe(ctx.now), { hours: free_change_hours });
	const from = DateTime.formatIso(fromInstant);
	const to = DateTime.formatIso(
		DateTime.add(DateTime.makeUnsafe(ctx.now), { days: booking_horizon_days })
	);
	const { rows } = (yield* ctx.query({
		appointments: {
			where: {
				status: { eq: 'scheduled' },
				provider: { is_null: false },
				attention: { eq: 'none' },
				shift_check: HELD_SHIFT,
				slot: { overlaps: { start: from, end: to } }
			},
			fields: ['revision', 'slot', 'location', 'skill', 'booking'],
			limit: 500,
			booking: { fields: ['preference'] }
		}
	})).appointments;
	const movable = rows
		.filter(
			(a) =>
				a.booking?.preference === 'any' &&
				DateTime.isGreaterThanOrEqualTo(DateTime.makeUnsafe(a.slot.start), fromInstant)
		)
		.flatMap((a) => {
			const slot = closedSlot(a.slot);
			return slot === null
				? []
				: [{ appointment: a.id, skill: a.skill, slot, location: a.location }];
		});
	if (movable.length === 0) return;
	const pool =
		loaded ??
		(yield* loadPool(
			ctx,
			from,
			to,
			movable.map((m) => m.location)
		));
	const result = improve(pool, movable, ctx.tz);
	if (result.moves.length === 0) return;
	const read = new Map(rows.map((a) => [a.id, a]));
	yield* ctx.act({
		'appointments.update': result.moves.flatMap((m) => {
			const row = read.get(m.appointment);
			return row === undefined ? [] : [{ target: targetOf(row), set: { provider: m.to } }];
		})
	});
	yield* ctx.notify({
		title: `Schedule optimised: ${result.moves.length} reassignment${result.moves.length === 1 ? '' : 's'}`,
		to: [{ team: 'operations' }],
		description: `Planned driving over the next ${booking_horizon_days} days is ${result.after} minutes, down from ${result.before}. Every move preserved skills, hours, time off, and travel buffers.`,
		once: `optimise-${result.moves
			.map((m) => `${m.appointment}:${m.to}`)
			.sort()
			.join(',')}`
	});
});

/** Notify assigned providers in-app and via WhatsApp when upcoming appointments are assigned. */
export const alertProviders = Effect.fnUntraced(function* (
	ids: readonly Id<'appointments'>[],
	ctx: EffectCtx
) {
	if (ids.length === 0) return;
	const { rows } = (yield* ctx.query({
		appointments: {
			where: {
				id: { in: ids },
				status: { eq: 'scheduled' },
				provider: { is_null: false },
				slot: { overlaps: { start: ctx.now, end: null } }
			},
			fields: ['number', 'slot', 'address', 'provider'],
			limit: 200,
			provider: { fields: ['phone', 'user'] }
		}
	})).appointments;
	yield* ctx.notify(
		rows.flatMap((a) =>
			a.provider === null || a.provider.user === null
				? []
				: [
						{
							title: 'New appointment assigned',
							description: `${a.number}: ${formatInstant(a.slot.start, ctx.tz)}, ${a.address}. Open My Day to review your schedule.`,
							to: [{ user: a.provider.user }],
							link: { model: 'appointments', id: a.id },
							once: `assigned-${a.id}-${a.provider.id}-${a.slot.start}`
						}
					]
		)
	);
	const byProvider = new Map<Id<'providers'>, { phone: string; lines: string[] }>();
	for (const a of [...rows].sort((x, y) => epochMs(x.slot.start) - epochMs(y.slot.start))) {
		const p = a.provider;
		if (p === null) continue;
		const entry = byProvider.get(p.id) ?? { phone: p.phone, lines: [] };
		entry.lines.push(`• ${a.number}: ${formatInstant(a.slot.start, ctx.tz)}, ${a.address}`);
		byProvider.set(p.id, entry);
	}
	const account = byProvider.size === 0 ? null : yield* whatsappAccount(ctx);
	if (account !== null)
		for (const [, { phone, lines }] of byProvider)
			yield* ctx.send(account, {
				to: whatsapp(phone),
				text: `New appointment${lines.length === 1 ? '' : 's'} assigned:\n${lines.join('\n')}`
			});
});
