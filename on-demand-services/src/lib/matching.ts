/**
 * Pure scheduling and matching rules: which providers satisfy hard requirements and how feasible
 * candidates rank.
 *
 * Hard: provider is active, holds the service's skill, works that weekday and local hours, is not on
 * time off, and has no overlapping appointment once travel time plus turnaround buffer is added on
 * both sides.
 * Soft: added route travel plus marginal squared weekly utilization. Recurring continuity adds a small
 * preference bonus; ties preserve scarce skills. Existing appointments never move during matching.
 *
 * Drive times use cached Google Routes legs (~1 km grid squares) when available, else Haversine estimate.
 */
import type { Id, Instant, PlainDate, PlainTime } from '@norbital-ai/bolt';
import { BigDecimal, DateTime, Duration } from 'effect';
import { epochMs } from './format.js';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;

/** Default scheduling thresholds when no `scheduling_settings` row exists; model defaults match. */
export const DEFAULTS = {
	/** Spacing in minutes between offered booking start times. */
	slot_interval_minutes: 30,
	/** Arrival and turnaround buffer in minutes added on top of driving time. */
	buffer_minutes: 15,
	/** Number of calendar days ahead published on the self-service booking portal. */
	booking_horizon_days: 14,
	/** Live ETA threshold (minutes) above which dispatch is alerted, and check lead window. */
	eta_limit_minutes: 30,
	eta_check_lead_minutes: 60,
	/** Pre-shift confirmation lead time before a provider's first appointment and reply cutoff. */
	shift_check_lead_minutes: 120,
	shift_reply_minutes: 60,
	/** Rescheduling or cancelling inside this window before start is marked a late change. */
	free_change_hours: 24
};
export type Settings = typeof DEFAULTS;

/** Default number of recurring occurrences booked ahead. */
export const BOOKING_AHEAD = 8;
/** Fallback drive estimate when either endpoint lacks coordinates. */
const UNKNOWN_DRIVE_MINUTES = 30;
/** Average urban door-to-door speed (km/h) for Haversine fallback estimates. */
const KMH = 25;
/** Soft ranking weights in equivalent drive minutes. */
const LOAD_BALANCE = 180;
const CONTINUITY = 15;

/** Normalize a runtime skill tag so case and whitespace differences never split matching. */
export const normalizeSkill = (value: string): string =>
	value.trim().toLowerCase().replace(/\s+/g, '_');

export type Point = {
	readonly lat: number;
	readonly lng: number;
};

export type Slot = {
	readonly start: Instant;
	readonly end: Instant;
};

/** Closed appointment slot; open-ended slots have no duration to place and return `null`. */
export const closedSlot = (slot: {
	readonly start: Instant;
	readonly end: Instant | null;
}): Slot | null => (slot.end === null ? null : { start: slot.start, end: slot.end });

export type Provider = {
	readonly id: Id<'providers'>;
	readonly name: string;
	readonly skills: readonly string[];
	readonly home_location: Point | null;
	readonly work_days: readonly string[];
	readonly day_start: PlainTime;
	readonly day_end: PlainTime;
	readonly status: string;
};

/** A stored appointment a provider holds, or a provisional slot during booking planning. */
export type Busy = {
	readonly provider: Id<'providers'>;
	readonly slot: Slot;
	readonly location: Point | null;
} & (
	| {
			readonly planned?: false;
			readonly id: Id<'appointments'>;
	  }
	| {
			readonly planned: true;
			readonly id: string;
	  }
);

type Off = {
	readonly provider: Id<'providers'>;
	readonly period: {
		readonly from: string;
		readonly to: string | null;
	};
};

type Need = {
	readonly skill: string;
	readonly slot: Slot;
	readonly location: Point | null;
	/** Appointment being re-matched: its own hold does not block itself. */
	readonly appointment?: string;
};

export type Pool = {
	readonly providers: readonly Provider[];
	readonly busy: readonly Busy[];
	readonly off: readonly Off[];
	/** Cached Google Routes minutes keyed by `legOf`. */
	readonly drive?: ReadonlyMap<string, number>;
	/** Turnaround buffer in minutes on top of driving time; defaults to `DEFAULTS.buffer_minutes`. */
	readonly bufferMinutes?: number;
	/** Base start-time interval in minutes; defaults to `DEFAULTS.slot_interval_minutes`. */
	readonly slotIntervalMinutes?: number;
};

type Candidate = {
	readonly provider: Id<'providers'>;
	readonly name: string;
	readonly score: number;
	/** Net drive minutes added to the provider's day by inserting this appointment. */
	readonly drive_minutes: number;
	/** Hours of service already scheduled for the provider in that week. */
	readonly week_hours: number;
};

export type Refusal = 'inactive' | 'skill' | 'day' | 'hours' | 'time_off' | 'booked';

const bufferOf = (pool: Pool): number => pool.bufferMinutes ?? DEFAULTS.buffer_minutes;
const intervalOf = (pool: Pool): number =>
	pool.slotIntervalMinutes ?? DEFAULTS.slot_interval_minutes;

/** The ~1 km square (0.01 deg) containing `p`. */
export const cellOf = (p: Point): string => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;

/** Cache key for the directed leg from `a` to `b`, or `null` when unknown or same square. */
export function legOf(a: Point | null, b: Point | null): string | null {
	if (a === null || b === null) return null;
	const from = cellOf(a);
	const to = cellOf(b);
	return from === to ? null : `${from}>${to}`;
}

/** Drive minutes from `a` to `b`: cached Google Routes value when present, else Haversine estimate. */
export function driveMinutes(
	a: Point | null,
	b: Point | null,
	drive?: ReadonlyMap<string, number>
): number {
	if (a === null || b === null) return UNKNOWN_DRIVE_MINUTES;
	const known = drive?.get(legOf(a, b) ?? '');
	if (known !== undefined) return known;
	const rad = Math.PI / 180;
	const h =
		Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
	const km = 2 * 6371 * Math.asin(Math.sqrt(h));
	return Math.ceil((km / KMH) * 60);
}

const wallMinutes = (time: PlainTime): number =>
	Duration.toMinutes(DateTime.toEpochMillis(DateTime.makeUnsafe(`1970-01-01T${time}Z`)));

/** First hard requirement `provider` fails for `need`, or `null` when eligible. */
export function refusal(provider: Provider, need: Need, pool: Pool, zone: string): Refusal | null {
	if (provider.status !== 'active') return 'inactive';
	const wantSkill = normalizeSkill(need.skill);
	if (!provider.skills.some((s) => normalizeSkill(s) === wantSkill)) return 'skill';
	const local = DateTime.makeZonedUnsafe(need.slot.start, { timeZone: zone });
	const parts = DateTime.toParts(local);
	const date = DateTime.formatIsoDate(local);
	const minutes = Duration.toMinutes({
		hours: parts.hour,
		minutes: parts.minute,
		seconds: parts.second,
		milliseconds: parts.millisecond
	});
	const length = Duration.toMinutes(
		DateTime.distance(DateTime.makeUnsafe(need.slot.start), DateTime.makeUnsafe(need.slot.end))
	);
	if (!provider.work_days.some((d) => d === DAYS.at(parts.weekDay))) return 'day';
	if (minutes < wallMinutes(provider.day_start) || minutes + length > wallMinutes(provider.day_end))
		return 'hours';
	if (
		pool.off.some(
			(o) =>
				o.provider === provider.id &&
				o.period.from <= date &&
				(o.period.to === null || date <= o.period.to)
		)
	)
		return 'time_off';
	const from = DateTime.makeUnsafe(need.slot.start);
	const to = DateTime.makeUnsafe(need.slot.end);
	const settle = bufferOf(pool);
	for (const b of pool.busy) {
		if (b.provider !== provider.id || b.id === need.appointment) continue;
		const start = DateTime.makeUnsafe(b.slot.start);
		const [first, second] = DateTime.isLessThan(start, from)
			? [b.location, need.location]
			: [need.location, b.location];
		const buffer = { minutes: driveMinutes(first, second, pool.drive) + settle };
		if (
			DateTime.isLessThan(from, DateTime.add(DateTime.makeUnsafe(b.slot.end), buffer)) &&
			DateTime.isLessThan(start, DateTime.add(to, buffer))
		)
			return 'booked';
	}
	return null;
}

/** Provider's appointments on the local day of `need`, excluding `need` itself. */
function sameDay(provider: Provider, need: Need, pool: Pool, zone: string): Busy[] {
	const day = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(need.slot.start, { timeZone: zone }));
	return pool.busy.filter(
		(b) =>
			b.provider === provider.id &&
			b.id !== need.appointment &&
			DateTime.formatIsoDate(DateTime.makeZonedUnsafe(b.slot.start, { timeZone: zone })) === day
	);
}

/** Net drive minutes added to `provider`'s day by inserting `need`. */
function detour(provider: Provider, need: Need, pool: Pool, zone: string): number {
	const day = sameDay(provider, need, pool, zone);
	const needStart = epochMs(need.slot.start);
	const needEnd = epochMs(need.slot.end);
	const before = day
		.filter((b) => epochMs(b.slot.end) <= needStart)
		.sort((a, b) => epochMs(b.slot.end) - epochMs(a.slot.end))[0];
	const after = day
		.filter((b) => epochMs(b.slot.start) >= needEnd)
		.sort((a, b) => epochMs(a.slot.start) - epochMs(b.slot.start))[0];
	const from = before === undefined ? provider.home_location : before.location;
	const drive = (a: Point | null, b: Point | null) => driveMinutes(a, b, pool.drive);
	if (after === undefined) return drive(from, need.location);
	return Math.max(
		0,
		drive(from, need.location) + drive(need.location, after.location) - drive(from, after.location)
	);
}

/** Service and travel minutes in the local Monday-started week, normalized by available capacity. */
function weeklyLoad(provider: Provider, need: Need, pool: Pool, zone: string) {
	const monday = DateTime.startOf(
		DateTime.makeZonedUnsafe(need.slot.start, { timeZone: zone }),
		'week',
		{ weekStartsOn: 1 }
	);
	const mondayIso = DateTime.formatIsoDate(monday);
	const sundayIso = DateTime.formatIsoDate(DateTime.add(monday, { days: 6 }));
	const busy = pool.busy.filter((b) => {
		const d = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(b.slot.start, { timeZone: zone }));
		return (
			b.provider === provider.id && b.id !== need.appointment && mondayIso <= d && d <= sundayIso
		);
	});
	const service = busy.reduce(
		(sum, b) =>
			sum +
			Duration.toMinutes(
				DateTime.distance(DateTime.makeUnsafe(b.slot.start), DateTime.makeUnsafe(b.slot.end))
			),
		0
	);
	const travel = routes({ ...pool, busy }, zone).reduce(
		(sum, day) =>
			sum +
			legsOf(day, provider.home_location).reduce(
				(total, [a, b]) => total + driveMinutes(a, b, pool.drive),
				0
			),
		0
	);
	const days = Array.from({ length: 7 }, (_, i) => DateTime.add(monday, { days: i })).filter(
		(day) => {
			const d = DateTime.formatIsoDate(day);
			return (
				provider.work_days.some((wd) => wd === DAYS.at(DateTime.toParts(day).weekDay)) &&
				!pool.off.some(
					(o) =>
						o.provider === provider.id &&
						o.period.from <= d &&
						(o.period.to === null || d <= o.period.to)
				)
			);
		}
	);
	return {
		service,
		minutes: service + travel,
		capacity:
			days.length *
			Duration.toMinutes(
				DateTime.distance(
					DateTime.makeUnsafe(`1970-01-01T${provider.day_start}Z`),
					DateTime.makeUnsafe(`1970-01-01T${provider.day_end}Z`)
				)
			)
	};
}

/** Feasible providers ranked by route insertion cost and marginal utilization. */
export function rank(
	need: Need,
	pool: Pool,
	zone: string,
	keep: Id<'providers'> | null = null
): Candidate[] {
	const wantSkill = normalizeSkill(need.skill);
	const scarcity = (p: Provider) =>
		p.skills
			.map(normalizeSkill)
			.filter((s) => s !== wantSkill)
			.reduce(
				(sum, skill) =>
					sum +
					1 /
						Math.max(
							1,
							pool.providers.filter(
								(other) =>
									other.status === 'active' &&
									other.skills.some((os) => normalizeSkill(os) === skill)
							).length
						),
				0
			);
	return pool.providers
		.filter((p) => refusal(p, need, pool, zone) === null)
		.map((p) => {
			const drive = detour(p, need, pool, zone);
			const load = weeklyLoad(p, need, pool, zone);
			const added =
				Duration.toMinutes(
					DateTime.distance(
						DateTime.makeUnsafe(need.slot.start),
						DateTime.makeUnsafe(need.slot.end)
					)
				) + drive;
			const balance =
				(LOAD_BALANCE * ((load.minutes + added) ** 2 - load.minutes ** 2)) /
				Math.max(1, load.capacity) ** 2;
			return {
				extra: scarcity(p),
				candidate: {
					provider: p.id,
					name: p.name,
					score: -drive - balance + (p.id === keep ? CONTINUITY : 0),
					drive_minutes: drive,
					week_hours: BigDecimal.toNumberUnsafe(
						BigDecimal.round(
							BigDecimal.fromNumberUnsafe(Duration.toHours(Duration.minutes(load.service))),
							{ scale: 1, mode: 'half-ceil' }
						)
					)
				}
			};
		})
		.sort(
			(a, b) =>
				b.candidate.score - a.candidate.score ||
				a.extra - b.extra ||
				a.candidate.name.localeCompare(b.candidate.name) ||
				a.candidate.provider.localeCompare(b.candidate.provider)
		)
		.map(({ candidate }) => candidate);
}

/** Shared planner for availability and confirmation. Writes nothing. */
export function planBooking(
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	starts: readonly Instant[],
	pool: Pool,
	zone: string,
	preferred: readonly Id<'providers'>[] = []
) {
	const providers =
		preferred.length === 0
			? pool.providers
			: preferred.flatMap((id) => pool.providers.filter((p) => p.id === id));
	const busy = [...pool.busy];
	const appointments: { slot: Slot; provider: Id<'providers'> }[] = [];
	let keep: Id<'providers'> | null = null;
	for (const [i, start] of starts.entries()) {
		const slot = slotOf(start, need.minutes);
		const found = rank({ ...need, slot }, { ...pool, providers, busy }, zone, keep);
		const best =
			preferred.length === 0
				? found[0]
				: preferred.flatMap((id) => found.filter((c) => c.provider === id))[0];
		if (best === undefined) return { appointments, missing: i };
		appointments.push({ slot, provider: best.provider });
		busy.push({
			planned: true,
			id: `planned-${i}`,
			provider: best.provider,
			slot,
			location: need.location
		});
		keep = best.provider;
	}
	return { appointments, missing: null };
}

/** Union of feasible starts across `days`; recurring starts must satisfy the full horizon. */
export function availableSlots(
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string,
	repeat = 'once',
	count = BOOKING_AHEAD,
	preferred: readonly Id<'providers'>[] = []
) {
	const providers = pool.providers.filter(
		(p) => preferred.length === 0 || preferred.includes(p.id)
	);
	return days.map((day) => {
		const possible = [
			...new Set(
				providers.flatMap((p) =>
					openSlots(p, need, [day], pool, zone, now).flatMap((open) => open.starts)
				)
			)
		].sort((a, b) => epochMs(a) - epochMs(b));
		return {
			day,
			starts: possible.filter(
				(start) =>
					planBooking(need, occurrences(start, repeat, count, zone), pool, zone, preferred)
						.missing === null
			)
		};
	});
}

/** Each provider's appointments grouped by local day, chronologically ordered. */
export function routes(pool: Pool, zone: string): [Busy, ...Busy[]][] {
	const by = new Map<string, [Busy, ...Busy[]]>();
	for (const b of pool.busy) {
		const key = `${b.provider}|${DateTime.formatIsoDate(DateTime.makeZonedUnsafe(b.slot.start, { timeZone: zone }))}`;
		const held = by.get(key);
		if (held === undefined) by.set(key, [b]);
		else held.push(b);
	}
	return [...by.values()].map((day) =>
		day.sort((a, b) => epochMs(a.slot.start) - epochMs(b.slot.start))
	);
}

/** Directed legs driven on a day: home to first appointment, then appointment to appointment. */
export function legsOf(day: readonly Busy[], home: Point | null): [Point | null, Point | null][] {
	let from = home;
	return day.map((b): [Point | null, Point | null] => {
		const leg: [Point | null, Point | null] = [from, b.location];
		from = b.location;
		return leg;
	});
}

/** Unique cache keys queried when matching over `spots`. */
export function lookups(pool: Pool, spots: readonly (Point | null)[], zone: string): string[] {
	const homes = new Map(pool.providers.map((p) => [p.id, p.home_location]));
	const legs = routes(pool, zone).flatMap((day) => legsOf(day, homes.get(day[0].provider) ?? null));
	for (const s of spots) {
		for (const b of pool.busy) legs.push([b.location, s], [s, b.location]);
		for (const p of pool.providers) legs.push([p.home_location, s]);
	}
	return [...new Set(legs.flatMap(([a, b]) => legOf(a, b) ?? []))];
}

/** Total planned drive minutes across every provider-day in `pool`. */
function travelMinutes(pool: Pool, zone: string): number {
	const homes = new Map(pool.providers.map((p) => [p.id, p.home_location]));
	return routes(pool, zone).reduce(
		(sum, day) =>
			sum +
			legsOf(day, homes.get(day[0].provider) ?? null).reduce(
				(total, [a, b]) => total + driveMinutes(a, b, pool.drive),
				0
			),
		0
	);
}

/** Relocate-neighborhood local search lowering combined drive and squared weekly utilization. */
export function improve<A extends string>(
	pool: Pool,
	movable: readonly (Omit<Need, 'appointment'> & { readonly appointment: A })[],
	zone: string,
	sweeps = 20
) {
	let busy = [...pool.busy];
	const moves = new Map<A, { from: Id<'providers'>; to: Id<'providers'> }>();
	for (let sweep = 0; sweep < sweeps; sweep++) {
		let moved = false;
		for (const need of movable) {
			const held = busy.find((b) => b.id === need.appointment);
			if (held === undefined) continue;
			const best = rank(need, { ...pool, busy }, zone, held.provider)[0];
			if (best === undefined || best.provider === held.provider) continue;
			busy = busy.map((b) => (b.id === need.appointment ? { ...b, provider: best.provider } : b));
			const from = moves.get(need.appointment)?.from ?? held.provider;
			if (from === best.provider) moves.delete(need.appointment);
			else moves.set(need.appointment, { from, to: best.provider });
			moved = true;
		}
		if (!moved) break;
	}
	return {
		moves: [...moves].map(([appointment, m]) => ({ appointment, ...m })),
		before: travelMinutes(pool, zone),
		after: travelMinutes({ ...pool, busy }, zone),
		busy
	};
}

/** Jaccard skill overlap between two providers for replacement similarity. */
function skillSimilarity(a: readonly string[], b: readonly string[]): number {
	const setA = new Set(a.map(normalizeSkill));
	const setB = new Set(b.map(normalizeSkill));
	const all = new Set([...setA, ...setB]);
	if (all.size === 0) return 0;
	let shared = 0;
	for (const s of setA) if (setB.has(s)) shared += 1;
	return shared / all.size;
}

/** Start instants of each occurrence at the same local wall time each week, fortnight or month. */
export function occurrences(start: string, repeat: string, count: number, zone: string): Instant[] {
	const first = DateTime.makeZonedUnsafe(start, { timeZone: zone });
	const n = repeat === 'once' ? 1 : count;
	return Array.from({ length: n }, (_, i) =>
		DateTime.formatIso(
			DateTime.makeZonedUnsafe(
				DateTime.toEpochMillis(
					DateTime.add(
						DateTime.makeUnsafe(DateTime.toParts(first)),
						repeat === 'monthly' ? { months: i } : { days: i * (repeat === 'fortnightly' ? 14 : 7) }
					)
				),
				{ timeZone: zone, adjustForTimeZone: true }
			)
		)
	);
}

/** Closed slot of `minutes` starting at `start`. */
export const slotOf = (start: string, minutes: number): Slot => ({
	start: DateTime.formatIso(DateTime.makeUnsafe(start)),
	end: DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(start), { minutes }))
});

/**
 * Feasible start times for `provider` on each day in `days`, strictly after `now`: regular grid
 * intervals inside working hours plus exact gap edges derived from adjacent appointments and travel.
 */
export function openSlots(
	provider: Provider,
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
): { day: PlainDate; starts: Instant[] }[] {
	const QUARTER = 15;
	const step = intervalOf(pool);
	const settle = bufferOf(pool);
	const from = wallMinutes(provider.day_start);
	const to = wallMinutes(provider.day_end) - need.minutes;
	const nowMs = epochMs(now);
	return days.map((day) => {
		const candidates = new Set<number>();
		for (let m = from; m <= to; m += step) candidates.add(m);
		for (const b of pool.busy) {
			if (b.provider !== provider.id || b.id === need.appointment) continue;
			const start = DateTime.makeZonedUnsafe(b.slot.start, { timeZone: zone });
			const end = DateTime.makeZonedUnsafe(b.slot.end, { timeZone: zone });
			if (DateTime.formatIsoDate(end) === day) {
				const parts = DateTime.toParts(end);
				const arrive =
					Duration.toMinutes({
						hours: parts.hour,
						minutes: parts.minute,
						seconds: parts.second,
						milliseconds: parts.millisecond
					}) +
					driveMinutes(b.location, need.location, pool.drive) +
					settle;
				candidates.add(Math.ceil(arrive / QUARTER) * QUARTER);
			}
			if (DateTime.formatIsoDate(start) === day) {
				const parts = DateTime.toParts(start);
				const leave =
					Duration.toMinutes({
						hours: parts.hour,
						minutes: parts.minute,
						seconds: parts.second,
						milliseconds: parts.millisecond
					}) -
					driveMinutes(need.location, b.location, pool.drive) -
					settle -
					need.minutes;
				candidates.add(Math.floor(leave / QUARTER) * QUARTER);
			}
		}
		const starts: Instant[] = [];
		for (const m of [...candidates].sort((a, b) => a - b)) {
			if (m < from || m > to) continue;
			const slot = slotOf(
				DateTime.formatIso(
					DateTime.makeZonedUnsafe(DateTime.add(DateTime.makeUnsafe(day), { minutes: m }), {
						timeZone: zone,
						adjustForTimeZone: true
					})
				),
				need.minutes
			);
			if (epochMs(slot.start) > nowMs && refusal(provider, { ...need, slot }, pool, zone) === null)
				starts.push(slot.start);
		}
		return { day, starts };
	});
}

/**
 * Replacement proposal for an appointment whose provider became inactive: same time with the closest
 * skill match, else nearest feasible time over the coming week.
 */
export function proposal(
	need: Need,
	departingSkills: readonly string[],
	pool: Pool,
	zone: string
): { provider: Id<'providers'>; slot: Slot } | null {
	const minutes = Duration.toMinutes(
		DateTime.distance(DateTime.makeUnsafe(need.slot.start), DateTime.makeUnsafe(need.slot.end))
	);
	for (const shift of [0, -60, 60, -120, 120, 1440, 2880, 4320, 5760, 7200, 8640, 10080]) {
		const slot = slotOf(
			DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(need.slot.start), { minutes: shift })),
			minutes
		);
		const found = rank({ ...need, slot }, pool, zone);
		if (found.length === 0) continue;
		const [best] = found
			.flatMap((c) => {
				const provider = pool.providers.find((p) => p.id === c.provider);
				return provider === undefined
					? []
					: [{ candidate: c, similarity: skillSimilarity(departingSkills, provider.skills) }];
			})
			.sort((a, b) => b.similarity - a.similarity || b.candidate.score - a.candidate.score);
		if (best === undefined) continue;
		return { provider: best.candidate.provider, slot };
	}
	return null;
}
