/**
 * The matching rules, pure: which helpers may take a visit (the hard requirements) and in what order (the soft ones).
 *
 * Hard: the helper is active, has the service's skill, works that weekday and those hours, is not off that day, and has
 * no visit that overlaps this one once the drive between the two addresses is added on both sides.
 * Soft: less driving from where the helper will be, the customer's area, fewer visits already that week, and the helper
 * the customer's earlier visit had.
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
/** Door-to-door urban speed. ponytail: straight-line distance at a flat speed; use a routing provider when one is bound. */
const KMH = 25;
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
	readonly home_area: string;
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
	readonly area: string;
	/** The visit being re-matched: its own hold does not count against it. */
	readonly visit?: string;
};
export type Pool = {
	readonly helpers: readonly Helper[];
	readonly busy: readonly Busy[];
	readonly off: readonly Off[];
};
export type Candidate = {
	readonly helper: string;
	readonly name: string;
	readonly score: number;
	readonly drive_minutes: number;
	readonly same_area: boolean;
	readonly week_load: number;
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

/** Minutes to drive between two addresses, rounded up. */
export function driveMinutes(a: Point | null, b: Point | null): number {
	if (a === null || b === null) return UNKNOWN_DRIVE_MINUTES;
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
		const buffer = (driveMinutes(b.location, need.location) + SETTLE_MINUTES) * MINUTE;
		if (from < ms(b.slot.end) + buffer && ms(b.slot.start) < to + buffer) return 'booked';
	}
	return null;
}

/** Where the helper sets off from: their visit that ends last before this one that day, else home. */
function origin(helper: Helper, need: Need, pool: Pool, zone: string): Point | null {
	const day = local(need.slot.start, zone).date;
	const before = pool.busy
		.filter(
			(b) =>
				b.helper === helper.id &&
				b.id !== need.visit &&
				ms(b.slot.end) <= ms(need.slot.start) &&
				local(b.slot.start, zone).date === day
		)
		.sort((a, b) => ms(b.slot.end) - ms(a.slot.end))[0];
	return before?.location ?? helper.home_location;
}

/** Visits the helper holds in the Monday-started week of `need`. */
function weekLoad(helper: Helper, need: Need, pool: Pool, zone: string): number {
	const day = local(need.slot.start, zone).date;
	const monday = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
	const sunday = addDays(monday, 6);
	return pool.busy.filter((b) => {
		if (b.helper !== helper.id || b.id === need.visit) return false;
		const d = local(b.slot.start, zone).date;
		return monday <= d && d <= sunday;
	}).length;
}

/**
 * Every helper who meets the hard requirements, best first. `keep` is the helper the customer already has (an earlier
 * visit of the same booking): continuity outweighs everything soft.
 */
export function rank(
	need: Need,
	pool: Pool,
	zone: string,
	keep: string | null = null
): Candidate[] {
	return pool.helpers
		.filter((h) => refusal(h, need, pool, zone) === null)
		.map((h) => {
			const drive = driveMinutes(origin(h, need, pool, zone), need.location);
			const load = weekLoad(h, need, pool, zone);
			const same = h.home_area === need.area;
			return {
				helper: h.id,
				name: h.name,
				score: 100 - drive + (same ? 20 : 0) - load * 5 + (h.id === keep ? 100 : 0),
				drive_minutes: drive,
				same_area: same,
				week_load: load
			};
		})
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
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
