/**
 * The reads and writes around the matching rules, shared by the collection actions and the shift watch: loading the
 * pool a match runs over, and handing visits to another helper.
 */
import type { ActionCtx, AutomationCtx, Id, QueryCtx } from '@norbital-ai/bolt';
import { addDays, Instant } from '@norbital-ai/std/date';
import { localOf, utcOf } from '@norbital-ai/std/zone';
import {
	DEFAULTS,
	improve,
	lookups,
	rank,
	type Point,
	type Pool,
	type Settings,
	type Slot
} from './matching.js';

type Reads = Pick<QueryCtx, 'read' | 'tz' | 'now'>;
type Writes = Reads & Pick<ActionCtx<'visits'>, 'act' | 'notify'>;

const iso = (t: number) => Instant(new Date(t).toISOString());

/** The dispatch thresholds: the workspace's row, else the defaults. */
export async function settingsOf(ctx: Pick<QueryCtx, 'read'>): Promise<Settings> {
	const { rows } = await ctx.read('dispatch_settings', { limit: 1 });
	return rows[0] ?? DEFAULTS;
}

/** The local day of an instant as a UTC span. */
export function dayOf(instant: string, zone: string): Slot {
	const { date } = localOf(Date.parse(instant), zone);
	return { start: iso(utcOf(date, 0, zone)), end: iso(utcOf(addDays(date, 1), 0, zone)) };
}

/**
 * Every active helper, visits and leave across the complete weeks covering `from` through `to` (plus day margins),
 * and the Google drive times cached
 * for the legs a match at `spots` may ask about.
 */
export async function loadPool(
	ctx: Reads,
	from: string,
	to: string,
	spots: readonly (Point | null)[] = []
): Promise<Pool> {
	const first = localOf(Date.parse(from), ctx.tz).date;
	const last = localOf(Date.parse(to), ctx.tz).date;
	const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
	const monday = addDays(first, -weekday(first));
	const nextMonday = addDays(last, 7 - weekday(last));
	const start = iso(utcOf(addDays(monday, -1), 0, ctx.tz)),
		end = iso(utcOf(addDays(nextMonday, 1), 0, ctx.tz));
	const [helpers, visits, proposed, off] = await Promise.all([
		ctx.read('helpers', {
			where: { status: { eq: 'active' } },
			select: {
				name: true,
				skills: true,
				home_area: true,
				home_location: true,
				work_days: true,
				day_start: true,
				day_end: true,
				status: true
			},
			all: true
		}),
		ctx.read('visits', {
			where: {
				helper: { isNull: false },
				status: { ne: 'cancelled' },
				slot: { overlaps: { start, end } }
			},
			select: { helper: true, slot: true, location: true },
			all: true
		}),
		// a replacement awaiting approval holds its cleaner, so one cleaner is not proposed twice for one time
		ctx.read('visits', {
			where: {
				attention: { eq: 'awaiting_approval' },
				proposed_helper: { isNull: false },
				proposed_slot: { overlaps: { start, end } }
			},
			select: { proposed_helper: true, proposed_slot: true, location: true },
			all: true
		}),
		ctx.read('helper_time_off', {
			where: {
				period: {
					overlaps: { from: addDays(monday, -1), to: addDays(nextMonday, 1) }
				}
			},
			select: { helper: true, period: true },
			all: true
		})
	]);
	const pool = {
		helpers: helpers.rows,
		busy: [
			...visits.rows.map((v) => ({
				id: v.id,
				helper: v.helper!,
				slot: { start: v.slot.start, end: v.slot.end! },
				location: v.location
			})),
			...proposed.rows.map((v) => ({
				id: v.id,
				helper: v.proposed_helper!,
				slot: { start: v.proposed_slot!.start, end: v.proposed_slot!.end! },
				location: v.location
			}))
		],
		off: off.rows
	};
	const legs = lookups(pool, spots, ctx.tz);
	const known =
		legs.length === 0
			? []
			: (
					await ctx.read('drive_times', {
						where: { leg: { in: legs } },
						select: { leg: true, minutes: true },
						all: true
					})
				).rows;
	return { ...pool, drive: new Map(known.map((d) => [d.leg, d.minutes])) };
}

/**
 * Google's drive minutes from `origin` to each of `destinations` (at most 625), `null` for one it could not route; `null`
 * altogether when the call fails (no API key, quota, outage), so the caller keeps its estimate. With `traffic`, live
 * traffic at this moment; without, the typical time.
 */
export async function googleMinutes(
	ctx: Pick<AutomationCtx, 'http'>,
	origin: Point,
	destinations: readonly Point[],
	traffic: boolean
): Promise<(number | null)[] | null> {
	const at = (p: Point) => ({
		waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
	});
	const answer = await ctx.http('google_routes').post.try('distanceMatrix/v2:computeRouteMatrix', {
		query: { fields: 'originIndex,destinationIndex,duration,condition' },
		body: {
			origins: [at(origin)],
			destinations: destinations.map(at),
			travelMode: 'DRIVE',
			routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE'
		},
		output: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					originIndex: { kind: 'int', optional: true },
					destinationIndex: { kind: 'int', optional: true },
					duration: { kind: 'text', optional: true },
					condition: { kind: 'text', optional: true }
				}
			}
		}
	});
	if (!Array.isArray(answer)) return null;
	const out: (number | null)[] = destinations.map(() => null);
	for (const e of answer)
		// a zero index is left out of Google's JSON; a duration is seconds, as "123s"
		if (e.condition === 'ROUTE_EXISTS' && e.duration != null)
			out[e.destinationIndex ?? 0] = Math.ceil(parseFloat(e.duration) / 60);
	return out;
}

/** What a reassignment reads of each visit. */
export const VISIT = {
	number: true,
	slot: true,
	location: true,
	area: true,
	skill: true,
	booking: { select: { preference: true, customer: true } }
} as const;
type Visit = {
	readonly id: Id<'visits'>;
	readonly number: string;
	readonly slot: { readonly start: Instant; readonly end: Instant | null };
	readonly location: { readonly lat: number; readonly lng: number } | null;
	readonly area: string | null;
	readonly skill: string;
	readonly booking: {
		readonly id: Id<'bookings'>;
		readonly preference: string;
		readonly customer: Id<'customers'>;
	};
};

/** The WhatsApp address of a phone number. */
export const whatsapp = (phone: string) => `${phone.replace(/\D/g, '')}@s.whatsapp.net`;

export const when = (instant: string, zone: string) =>
	new Intl.DateTimeFormat('en-SG', {
		timeZone: zone,
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(instant));

/**
 * Hands each visit to the best helper free for it other than `away`, whose shift is then checked afresh. A customer who asked for particular helpers is told
 * who comes instead; one who did not is not. A visit nobody can take is left unassigned for dispatch.
 */
export async function reassign(
	ctx: Writes,
	visits: readonly Visit[],
	away: Id<'helpers'>
): Promise<{ assigned: number; unassigned: number }> {
	if (visits.length === 0) return { assigned: 0, unassigned: 0 };
	const starts = visits.map((v) => v.slot.start).sort();
	const pool = await loadPool(
		ctx,
		starts[0]!,
		starts.at(-1)!,
		visits.map((v) => v.location)
	);
	const helpers = pool.helpers.filter((h) => h.id !== away);
	const busy = [...pool.busy];
	const names = new Map(pool.helpers.map((h) => [h.id, h.name]));
	const updates = [];
	const notices = [];
	let unassigned = 0;
	for (const v of visits) {
		const slot = { start: v.slot.start, end: v.slot.end! };
		const need = { skill: v.skill, slot, location: v.location, area: v.area, visit: v.id };
		const best = rank(need, { ...pool, helpers, busy }, ctx.tz)[0];
		if (best === undefined) unassigned += 1;
		else busy.push({ id: v.id, helper: best.helper, slot, location: v.location });
		updates.push({
			target: v.id,
			set: {
				helper: best?.helper ?? null,
				shift_check: 'not_due' as const,
				shift_asked_at: null,
				eta_minutes: null,
				eta_checked_at: null,
				attention: best === undefined ? ('unassigned' as const) : ('none' as const)
			}
		});
		if (best !== undefined && v.booking.preference === 'preferred')
			notices.push({
				customer: v.booking.customer,
				visit: v.id,
				subject: `A new helper for your visit on ${when(v.slot.start, ctx.tz)}`,
				body: `Your usual helper cannot make visit ${v.number} on ${when(v.slot.start, ctx.tz)}. ${names.get(best.helper)} will come instead at the same time. Reply to this email if that does not suit you.`
			});
	}
	await ctx.act('visits.update', updates);
	if (notices.length > 0) await ctx.act('customer_notices.create', notices);
	if (unassigned > 0)
		await ctx.notify({
			to: { team: 'Operations' },
			title: `${unassigned} visit${unassigned === 1 ? '' : 's'} need a helper`,
			body: visits.map((v) => v.number).join(', ')
		});
	return { assigned: visits.length - unassigned, unassigned };
}

/** Plan recovery in appointment order, reserving each recommendation only in this provisional plan. */
export async function recommend(ctx: Writes, visits: readonly Visit[], away: Id<'helpers'>) {
	if (visits.length === 0) return;
	const ordered = [...visits].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
	const pool = await loadPool(
		ctx,
		ordered[0]!.slot.start,
		ordered.at(-1)!.slot.start,
		ordered.map((v) => v.location)
	);
	const helpers = pool.helpers.filter((h) => h.id !== away);
	const busy = pool.busy.filter((b) => !visits.some((v) => v.id === b.id));
	const updates = ordered.map((v) => {
		const slot = { start: v.slot.start, end: v.slot.end! };
		const best = rank(
			{ skill: v.skill, slot, location: v.location, area: v.area, visit: v.id },
			{ ...pool, helpers, busy },
			ctx.tz
		)[0];
		if (best !== undefined)
			busy.push({ id: v.id, helper: best.helper, slot, location: v.location });
		return {
			target: v.id,
			set: {
				helper: null,
				unavailable_helper: away,
				proposed_helper: best?.helper ?? null,
				proposed_slot: best === undefined ? null : slot,
				attention: best === undefined ? ('unassigned' as const) : ('awaiting_approval' as const),
				eta_minutes: null,
				eta_checked_at: null
			}
		};
	});
	await ctx.act('visits.update', updates);
	await ctx.notify({
		to: { team: 'Operations' },
		title: 'Approve replacement cleaners',
		body: `${visits.length} visit${visits.length === 1 ? '' : 's'} need your decision. Recommendations include travel and workload; no replacement is assigned until approval.`,
		link: { collection: 'visits', id: ordered[0]!.id }
	});
}

/**
 * Keeps the committed schedule at a local optimum: every visit of the next two weeks that may still move (outside the
 * free-change window, its customer named no cleaner, nothing pending on it) is relocated between cleaners while a single
 * move lowers the matching objective (load balance, then added drive) by more than the continuity bonus. Hard
 * requirements hold for every move. The desk is told what changed; each cleaner is told by `helper_alerts`.
 */
export async function optimise(ctx: Writes) {
	const HOUR = 3_600_000;
	const { free_change_hours } = await settingsOf(ctx);
	const from = iso(Date.parse(ctx.now) + free_change_hours * HOUR);
	const to = iso(Date.parse(ctx.now) + 14 * 24 * HOUR);
	const { rows } = await ctx.read('visits', {
		where: {
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			attention: { eq: 'none' },
			slot: { overlaps: { start: from, end: to } }
		},
		select: {
			slot: true,
			location: true,
			area: true,
			skill: true,
			booking: { select: { preference: true } }
		},
		all: true
	});
	const movable = rows
		.filter((v) => v.booking.preference === 'any' && v.slot.start >= from)
		.map((v) => ({
			visit: v.id,
			skill: v.skill,
			slot: { start: v.slot.start, end: v.slot.end! },
			location: v.location,
			area: v.area
		}));
	if (movable.length === 0) return;
	const pool = await loadPool(
		ctx,
		from,
		to,
		movable.map((m) => m.location)
	);
	const result = improve(pool, movable, ctx.tz);
	if (result.moves.length === 0) return;
	await ctx.act(
		'visits.update',
		result.moves.map((m) => ({ target: m.visit as Id<'visits'>, set: { helper: m.to } }))
	);
	await ctx.notify({
		to: { team: 'Operations' },
		title: `Schedule optimised: ${result.moves.length} reassignment${result.moves.length === 1 ? '' : 's'}`,
		body: `Planned driving over the next two weeks is ${result.after} minutes, down from ${result.before}. Workload is spread more evenly; every move kept skills, hours, leave and travel buffers.`,
		once: `optimise-${ctx.now}`
	});
}
