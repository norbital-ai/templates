/**
 * The matching rules, pure: which helpers may take a visit (the hard requirements) and in what order (the soft ones).
 *
 * Hard: the helper is active, has the service's skill, works that weekday and those hours, is not off that day, and has
 * no visit that overlaps this one once the drive between the two addresses (plus settling in) is added on both sides.
 * Soft: added route travel plus the increase in squared weekly utilization. Recurring continuity is a small bonus;
 * otherwise-equal candidates preserve scarce skills. Existing appointments never move during matching.
 *
 * A drive is Google's time between the ~1 km squares the two addresses sit in, when the `drive_times` cache has it
 * (the `check_drives` run fetches every planned leg), else the straight-line estimate.
 */
import type { PlainTime } from '@norbital-ai/bolt';
import { addDays, addMonths, Instant, type PlainDate } from '@norbital-ai/std/date';
import { localOf, utcOf } from '@norbital-ai/std/zone';

export const SKILLS = [
	'home_cleaning',
	'deep_cleaning',
	'move_in_out',
	'post_renovation',
	'office_cleaning',
	'laundry_ironing',
	'handyman'
] as const;
export const AREAS = ['central', 'north', 'north_east', 'east', 'west'] as const;
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const REPEATS = ['once', 'weekly', 'fortnightly', 'monthly'] as const;

/** Time to park and carry the kit in, on top of the drive. */
export const SETTLE_MINUTES = 15;
/** A drive whose ends are not both known. */
export const UNKNOWN_DRIVE_MINUTES = 30;
/** Door-to-door urban speed for the straight-line estimate, used for a leg Google has not timed yet. */
const KMH = 25;
/** Soft weights, in minutes of driving. */
const LOAD_BALANCE = 180;
const CONTINUITY = 15;
export const BOOKING_AHEAD = 8;
/** The dispatch thresholds when the workspace has no `dispatch_settings` row; the row's defaults match. */
export const DEFAULTS = {
	/** The ETA above which dispatch calls the helper, and how long before a visit it is checked. */
	eta_limit_minutes: 30,
	eta_check_lead_minutes: 60,
	/** How far ahead of a helper's first visit of the day the shift is checked, and how long they have to answer. */
	shift_check_lead_minutes: 120,
	shift_reply_minutes: 60,
	/** Cancelling or moving a visit later than this before it starts is chargeable. */
	free_change_hours: 24
};
export type Settings = typeof DEFAULTS;

export type Point = { readonly lat: number; readonly lng: number };
export type Slot = { readonly start: Instant; readonly end: Instant };
export type Helper = {
	readonly id: string;
	readonly name: string;
	readonly skills: readonly string[];
	readonly home_area: string | null;
	readonly home_location: Point | null;
	readonly work_days: readonly string[];
	readonly day_start: PlainTime;
	readonly day_end: PlainTime;
	readonly status: string;
};
/** A visit a helper already holds. */
export type Busy = {
	readonly id: string;
	readonly helper: string;
	readonly slot: Slot;
	readonly location: Point | null;
};
export type Off = { readonly helper: string; readonly period: { from: string; to: string | null } };
export type Need = {
	readonly skill: string;
	readonly slot: Slot;
	readonly location: Point | null;
	readonly area: string | null;
	/** The visit being re-matched: its own hold does not count against it. */
	readonly visit?: string;
};
export type Pool = {
	readonly helpers: readonly Helper[];
	readonly busy: readonly Busy[];
	readonly off: readonly Off[];
	/** Google's drive minutes by `legOf` key; a leg not here is estimated. */
	readonly drive?: ReadonlyMap<string, number>;
};
export type Candidate = {
	readonly helper: string;
	readonly name: string;
	readonly score: number;
	/** The drive this visit adds to the helper's day: in from their last stop, on to their next, less the leg it replaces. */
	readonly drive_minutes: number;
	readonly same_area: boolean;
	/** Hours already booked for the helper that week. */
	readonly week_hours: number;
};
export type Refusal = 'left' | 'skill' | 'day' | 'hours' | 'time_off' | 'booked';

const MINUTE = 60_000;
const ms = Date.parse;
const iso = (t: number) => Instant(new Date(t).toISOString());
/** Minutes into the day of an `HH:mm` wall time. */
const minutesOf = (time: PlainTime) => {
	const [h = '0', m = '0'] = String(time).split(':');
	return parseInt(h, 10) * 60 + parseInt(m, 10);
};

/** The ~1 km square (0.01°) a point sits in. ponytail: one cached time per square pair; finer squares cost more lookups. */
export const cellOf = (p: Point) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
/** The cache key of the drive from `a` to `b`, or `null` when an end is unknown or both share a square. */
export function legOf(a: Point | null, b: Point | null): string | null {
	if (a === null || b === null) return null;
	const from = cellOf(a),
		to = cellOf(b);
	return from === to ? null : `${from}>${to}`;
}

/** Minutes to drive from `a` to `b`: Google's time from `drive` when it has the leg, else the straight-line estimate. */
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

/** The local day and minutes into it of an instant. */
function local(instant: string, zone: string) {
	const { date, msOfDay } = localOf(ms(instant), zone);
	return { date, minutes: msOfDay / MINUTE };
}

/** The first hard requirement `helper` fails for `need`, or `null` when they may take it. */
export function refusal(helper: Helper, need: Need, pool: Pool, zone: string): Refusal | null {
	if (helper.status !== 'active') return 'left';
	if (!helper.skills.includes(need.skill)) return 'skill';
	const start = local(need.slot.start, zone);
	const length = (ms(need.slot.end) - ms(need.slot.start)) / MINUTE;
	const weekday = DAYS[new Date(`${start.date}T00:00:00Z`).getUTCDay()]!;
	if (!helper.work_days.includes(weekday)) return 'day';
	if (
		start.minutes < minutesOf(helper.day_start) ||
		start.minutes + length > minutesOf(helper.day_end)
	)
		return 'hours';
	if (
		pool.off.some(
			(o) =>
				o.helper === helper.id &&
				o.period.from <= start.date &&
				(o.period.to === null || start.date <= o.period.to)
		)
	)
		return 'time_off';
	const from = ms(need.slot.start),
		to = ms(need.slot.end);
	for (const b of pool.busy) {
		if (b.helper !== helper.id || b.id === need.visit) continue;
		// the drive that matters is the one out of whichever visit comes first
		const [first, second] =
			ms(b.slot.start) < from ? [b.location, need.location] : [need.location, b.location];
		const buffer = (driveMinutes(first, second, pool.drive) + SETTLE_MINUTES) * MINUTE;
		if (from < ms(b.slot.end) + buffer && ms(b.slot.start) < to + buffer) return 'booked';
	}
	return null;
}

/** The helper's own visits on the local day of `need`, other than `need` itself. */
function sameDay(helper: Helper, need: Need, pool: Pool, zone: string): Busy[] {
	const day = local(need.slot.start, zone).date;
	return pool.busy.filter(
		(b) => b.helper === helper.id && b.id !== need.visit && local(b.slot.start, zone).date === day
	);
}

/**
 * The drive `need` adds to the helper's day: from their last stop before it (a visit, else home) to it, on to their next
 * visit that day, less the drive from that stop straight to the next one that it replaces.
 */
function detour(helper: Helper, need: Need, pool: Pool, zone: string): number {
	const day = sameDay(helper, need, pool, zone);
	const before = day
		.filter((b) => ms(b.slot.end) <= ms(need.slot.start))
		.sort((a, b) => ms(b.slot.end) - ms(a.slot.end))[0];
	const after = day
		.filter((b) => ms(b.slot.start) >= ms(need.slot.end))
		.sort((a, b) => ms(a.slot.start) - ms(b.slot.start))[0];
	const from = before === undefined ? helper.home_location : before.location;
	const drive = (a: Point | null, b: Point | null) => driveMinutes(a, b, pool.drive);
	if (after === undefined) return drive(from, need.location);
	return Math.max(
		0,
		drive(from, need.location) + drive(need.location, after.location) - drive(from, after.location)
	);
}

/** Service and travel minutes in the local Monday-started week, normalized by hours actually available. */
function weeklyLoad(helper: Helper, need: Need, pool: Pool, zone: string) {
	const day = local(need.slot.start, zone).date;
	const monday = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
	const sunday = addDays(monday, 6);
	const busy = pool.busy.filter((b) => {
		const d = local(b.slot.start, zone).date;
		return b.helper === helper.id && b.id !== need.visit && monday <= d && d <= sunday;
	});
	const service = busy.reduce((sum, b) => sum + (ms(b.slot.end) - ms(b.slot.start)) / MINUTE, 0);
	const travel = routes({ ...pool, busy }, zone).reduce(
		(sum, day) =>
			sum +
			legsOf(day, helper.home_location).reduce(
				(total, [a, b]) => total + driveMinutes(a, b, pool.drive),
				0
			),
		0
	);
	const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(
		(d) =>
			helper.work_days.includes(DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!) &&
			!pool.off.some(
				(o) =>
					o.helper === helper.id && o.period.from <= d && (o.period.to === null || d <= o.period.to)
			)
	);
	return {
		service,
		minutes: service + travel,
		capacity: days.length * (minutesOf(helper.day_end) - minutesOf(helper.day_start))
	};
}

/** Feasible helpers ranked by route insertion and marginal utilization; continuity never overrides feasibility. */
export function rank(
	need: Need,
	pool: Pool,
	zone: string,
	keep: string | null = null
): Candidate[] {
	const scarcity = (h: Helper) =>
		h.skills
			.filter((s) => s !== need.skill)
			.reduce(
				(sum, skill) =>
					sum +
					1 /
						Math.max(
							1,
							pool.helpers.filter(
								(other) => other.status === 'active' && other.skills.includes(skill)
							).length
						),
				0
			);
	const extras = new Map(pool.helpers.map((h) => [h.id, scarcity(h)]));
	return pool.helpers
		.filter((h) => refusal(h, need, pool, zone) === null)
		.map((h) => {
			const drive = detour(h, need, pool, zone);
			const load = weeklyLoad(h, need, pool, zone);
			const added = (ms(need.slot.end) - ms(need.slot.start)) / MINUTE + drive;
			const balance =
				(LOAD_BALANCE * ((load.minutes + added) ** 2 - load.minutes ** 2)) /
				Math.max(1, load.capacity) ** 2;
			return {
				helper: h.id,
				name: h.name,
				score: -drive - balance + (h.id === keep ? CONTINUITY : 0),
				drive_minutes: drive,
				same_area: need.area !== null && h.home_area === need.area,
				week_hours: Math.round(load.service / 6) / 10
			};
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				extras.get(a.helper)! - extras.get(b.helper)! ||
				a.name.localeCompare(b.name) ||
				a.helper.localeCompare(b.helper)
		);
}

/** One shared plan for availability and confirmation. No rows are written by planning. */
export function planBooking(
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	starts: readonly Instant[],
	pool: Pool,
	zone: string,
	preferred: readonly string[] = []
) {
	const helpers =
		preferred.length === 0
			? pool.helpers
			: preferred.flatMap((id) => pool.helpers.filter((h) => h.id === id));
	const busy = [...pool.busy];
	const visits: { slot: Slot; helper: string }[] = [];
	let keep: string | null = null;
	for (const [i, start] of starts.entries()) {
		const slot = slotOf(start, need.minutes);
		const found = rank({ ...need, slot }, { ...pool, helpers, busy }, zone, keep);
		const best =
			preferred.length === 0
				? found[0]
				: preferred.flatMap((id) => found.filter((c) => c.helper === id))[0];
		if (best === undefined) return { visits, missing: i };
		visits.push({ slot, helper: best.helper });
		busy.push({ id: `planned-${i}`, helper: best.helper, slot, location: need.location });
		keep = best.helper;
	}
	return { visits, missing: null };
}

/** Union of feasible starts, scoped before matching; recurring starts must cover the whole finite horizon. */
export function availableSlots(
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string,
	repeat = 'once',
	count = BOOKING_AHEAD,
	preferred: readonly string[] = []
) {
	const helpers = pool.helpers.filter((h) => preferred.length === 0 || preferred.includes(h.id));
	return days.map((day) => {
		const possible = [
			...new Set(helpers.flatMap((h) => openSlots(h, need, [day], pool, zone, now)[0]!.starts))
		].sort();
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

/** Each helper's visits grouped by local day, in order: the day as it will be driven. */
export function routes(pool: Pool, zone: string): Busy[][] {
	const by = new Map<string, Busy[]>();
	for (const b of pool.busy) {
		const key = `${b.helper}|${local(b.slot.start, zone).date}`;
		by.set(key, [...(by.get(key) ?? []), b]);
	}
	return [...by.values()].map((day) => day.sort((a, b) => ms(a.slot.start) - ms(b.slot.start)));
}

/** The legs driven on a day: home to the first visit, then visit to visit. */
export function legsOf(day: readonly Busy[], home: Point | null): [Point | null, Point | null][] {
	return day.map((b, i) => [i === 0 ? home : day[i - 1]!.location, b.location]);
}

/** Every leg a match over `spots` may ask about: each planned leg, and each spot to and from every visit and home. */
export function lookups(pool: Pool, spots: readonly (Point | null)[], zone: string): string[] {
	const homes = new Map(pool.helpers.map((h) => [h.id, h.home_location]));
	const legs = routes(pool, zone).flatMap((day) => legsOf(day, homes.get(day[0]!.helper) ?? null));
	for (const s of spots) {
		for (const b of pool.busy) legs.push([b.location, s], [s, b.location]);
		for (const h of pool.helpers) legs.push([h.home_location, s]);
	}
	return [...new Set(legs.flatMap(([a, b]) => legOf(a, b) ?? []))];
}

/** Shared skills over all skills of either: how closely `b` can stand in for `a`. */
export function skillSimilarity(a: readonly string[], b: readonly string[]): number {
	const all = new Set([...a, ...b]);
	return all.size === 0 ? 0 : a.filter((s) => b.includes(s)).length / all.size;
}

/** The start of every occurrence: the same local wall time each week, fortnight or month. */
export function occurrences(start: string, repeat: string, count: number, zone: string): Instant[] {
	const first = localOf(ms(start), zone);
	const n = repeat === 'once' ? 1 : count;
	return Array.from({ length: n }, (_, i) => {
		const date =
			repeat === 'monthly'
				? addMonths(first.date, i)
				: addDays(first.date, i * (repeat === 'fortnightly' ? 14 : 7));
		return iso(utcOf(date, first.msOfDay, zone));
	});
}

/** A slot of `minutes` from `start`. */
export const slotOf = (start: string, minutes: number): Slot => ({
	start: iso(ms(start)),
	end: iso(ms(start) + minutes * MINUTE)
});

/**
 * The starts, every half hour inside the helper's hours, at which they could take `need`'s service on each of `days`,
 * later than `now`. The customer picks one of these when they asked for this helper.
 */
export function openSlots(
	helper: Helper,
	need: Omit<Need, 'slot'> & { readonly minutes: number },
	days: readonly PlainDate[],
	pool: Pool,
	zone: string,
	now: string
): { day: PlainDate; starts: Instant[] }[] {
	return days.map((day) => {
		const starts: Instant[] = [];
		for (
			let m = minutesOf(helper.day_start);
			m + need.minutes <= minutesOf(helper.day_end);
			m += 30
		) {
			const slot = slotOf(iso(utcOf(day, m * MINUTE, zone)), need.minutes);
			if (ms(slot.start) > ms(now) && refusal(helper, { ...need, slot }, pool, zone) === null)
				starts.push(slot.start);
		}
		return { day, starts };
	});
}

/**
 * An alternative for a visit whose helper left: the same time with the helper whose skills are closest to the one who
 * left, else the nearest time (an hour or two either side, then the next days) at which anyone can take it.
 */
export function proposal(
	need: Need,
	leaving: readonly string[],
	pool: Pool,
	zone: string
): { helper: string; slot: Slot } | null {
	const minutes = (ms(need.slot.end) - ms(need.slot.start)) / MINUTE;
	for (const shift of [0, -60, 60, -120, 120, 1440, 2880, 4320, 5760, 7200, 8640, 10080]) {
		const slot = slotOf(iso(ms(need.slot.start) + shift * MINUTE), minutes);
		const found = rank({ ...need, slot }, pool, zone);
		if (found.length === 0) continue;
		const skills = new Map(pool.helpers.map((h) => [h.id, h.skills]));
		const best = [...found].sort(
			(a, b) =>
				skillSimilarity(leaving, skills.get(b.helper)!) -
					skillSimilarity(leaving, skills.get(a.helper)!) || b.score - a.score
		)[0]!;
		return { helper: best.helper, slot };
	}
	return null;
}
