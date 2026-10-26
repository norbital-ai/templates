import { Effect } from 'effect';
/**
 * The reads and writes around the matching rules, shared by the booking and recovery automations and the dispatch runs: loading the
 * pool a match runs over, and handing visits to another helper.
 */
import type {
	ActInput,
	AutomationCtx,
	CollectionName,
	CreateRow,
	Id,
	QueryCtx
} from '@norbital-ai/bolt';
import { addDays, Instant } from '@norbital-ai/std/date';
import { localOf, utcOf } from '@norbital-ai/std/zone';
import {
	DEFAULTS,
	improve,
	lookups,
	rank,
	legOf,
	type Point,
	type Pool,
	type Settings,
	type Slot
} from './matching.js';
type Reads = Pick<QueryCtx, 'query' | 'tz' | 'now'>;
type Writes = Reads & Pick<AutomationCtx, 'act' | 'notify'>;
const iso = (t: number) => Instant(new Date(t).toISOString());
/** The dispatch thresholds: the workspace's row, else the defaults. */
export const settingsOf = Effect.fnUntraced(function* (ctx: Pick<QueryCtx, 'query'>) {
	const { rows } = yield* ctx.query('dispatch_settings', { limit: 1 });
	return rows[0] ?? DEFAULTS;
});
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
export const loadPool = Effect.fnUntraced(function* (
	ctx: Reads,
	from: string,
	to: string,
	spots: readonly (Point | null)[] = []
) {
	const first = localOf(Date.parse(from), ctx.tz).date;
	const last = localOf(Date.parse(to), ctx.tz).date;
	const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
	const monday = addDays(first, -weekday(first));
	const nextMonday = addDays(last, 7 - weekday(last));
	const start = iso(utcOf(addDays(monday, -1), 0, ctx.tz)),
		end = iso(utcOf(addDays(nextMonday, 1), 0, ctx.tz));
	const { helpers, visits, proposed, off } = yield* ctx.query({
		helpers: {
			from: 'helpers',
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
		},
		visits: {
			from: 'visits',
			where: {
				helper: { isNull: false },
				status: { ne: 'cancelled' },
				slot: { overlaps: { start, end } }
			},
			select: { helper: true, slot: true, location: true },
			all: true
		},
		// a replacement awaiting approval holds its cleaner, so one cleaner is not proposed twice for one time
		proposed: {
			from: 'visits',
			where: {
				attention: { eq: 'awaiting_approval' },
				proposed_helper: { isNull: false },
				proposed_slot: { overlaps: { start, end } }
			},
			select: { proposed_helper: true, proposed_slot: true, location: true },
			all: true
		},
		off: {
			from: 'helper_time_off',
			where: {
				period: {
					overlaps: { from: addDays(monday, -1), to: addDays(nextMonday, 1) }
				}
			},
			select: { helper: true, period: true },
			all: true
		}
	});
	const pool = {
		helpers: helpers.rows,
		busy: [
			...visits.rows.flatMap((v) =>
				v.helper === null || v.slot.end === null
					? []
					: [
							{
								id: v.id,
								helper: v.helper,
								slot: { start: v.slot.start, end: v.slot.end },
								location: v.location
							}
						]
			),
			...proposed.rows.flatMap((v) =>
				v.proposed_helper === null || v.proposed_slot === null || v.proposed_slot.end === null
					? []
					: [
							{
								id: v.id,
								helper: v.proposed_helper,
								slot: { start: v.proposed_slot.start, end: v.proposed_slot.end },
								location: v.location
							}
						]
			)
		],
		off: off.rows
	};
	const legs = lookups(pool, spots, ctx.tz);
	const known =
		legs.length === 0
			? []
			: (yield* ctx.query('drive_times', {
					where: { leg: { in: legs } },
					select: { leg: true, minutes: true },
					all: true
				})).rows;
	return { ...pool, drive: new Map(known.map((d) => [d.leg, d.minutes])) };
});
/**
 * Google's drive minutes from `origin` to each of `destinations` (at most 625), `null` for one it could not route; `null`
 * altogether when the call fails (no API key, quota, outage), so the caller keeps its estimate. With `traffic`, live
 * traffic at this moment; without, the typical time.
 */
export const googleMinutes = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'request'>,
	origin: Point,
	destinations: readonly Point[],
	traffic: boolean
) {
	const at = (p: Point) => ({
		waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
	});
	const answer = yield* ctx
		.request('google_routes', {
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
		})
		.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(null))));
	if (answer === null) return null;
	const out: (number | null)[] = destinations.map(() => null);
	for (const e of answer)
		// a zero index is left out of Google's JSON; a duration is seconds, as "123s"
		if (e.condition === 'ROUTE_EXISTS' && e.duration != null)
			out[e.destinationIndex ?? 0] = Math.ceil(parseFloat(e.duration) / 60);
	return out;
});
/** Batch every route request in one guest crossing; absent routes keep their estimate. */
export const learnLegs = Effect.fnUntraced(function* (
	ctx: Pick<AutomationCtx, 'request'>,
	groups: readonly {
		from: Point;
		to: readonly Point[];
	}[],
	known: ReadonlyMap<string, number>
) {
	const answers = yield* Effect.forEach(
		groups,
		(group) => googleMinutes(ctx, group.from, group.to, false),
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
/** What a reassignment reads of each visit; its write is guarded by the revision read. */
export const VISIT = {
	revision: true,
	number: true,
	slot: true,
	location: true,
	area: true,
	skill: true,
	booking: { select: { preference: true, customer: true } }
} as const;
type Visit = {
	readonly id: Id<'visits'>;
	readonly revision: number;
	readonly number: string;
	readonly slot: {
		readonly start: Instant;
		readonly end: Instant | null;
	};
	readonly location: {
		readonly lat: number;
		readonly lng: number;
	} | null;
	readonly area: string | null;
	readonly skill: string;
	readonly booking: {
		readonly id: Id<'bookings'>;
		readonly preference: string;
		readonly customer: Id<'customers'>;
	};
};
/** A shift its cleaner still holds: a declined or lapsed day is `shift_watch`'s to recover, never moved by dispatch. */
export const HELD_SHIFT = { in: ['not_due', 'asked', 'confirmed'] } as const;
/** The revisions a write read its records at: a newer write to any of them is a conflict, not overwritten. */
export const observedOf = <C extends CollectionName>(
	rows: readonly { readonly id: Id<C>; readonly revision: number }[]
) => Object.fromEntries(rows.map((row): [Id<C>, number] => [row.id, row.revision]));
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
 * who comes instead; one who did not is not. A visit nobody can take is left unassigned for dispatch. A visit written
 * since it was read fails the write with `ActConflict`, and nobody is told.
 */
export const planReassignment = Effect.fnUntraced(function* (
	ctx: Reads,
	visits: readonly Visit[],
	away: Id<'helpers'>
) {
	const starts = visits.map((v) => v.slot.start).sort();
	const pool = yield* loadPool(
		ctx,
		starts[0]!,
		starts.at(-1)!,
		visits.map((v) => v.location)
	);
	const helpers = pool.helpers.filter((h) => h.id !== away);
	const busy = [...pool.busy];
	const names = new Map(pool.helpers.map((h) => [h.id, h.name]));
	const updates: Extract<ActInput<'visits.update'>, readonly unknown[]>[number][] = [];
	const notices: CreateRow<'customer_notices'>[] = [];
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
	return { updates, notices, assigned: visits.length - unassigned, unassigned };
});
export const reassign = Effect.fnUntraced(function* (
	ctx: Writes,
	visits: readonly Visit[],
	away: Id<'helpers'>
) {
	if (visits.length === 0) return { assigned: 0, unassigned: 0 };
	const { updates, notices, assigned, unassigned } = yield* planReassignment(ctx, visits, away);
	yield* ctx.act.many([
		{ callable: 'visits.update', input: updates, observed: observedOf(visits) },
		...(notices.length > 0
			? [{ callable: 'customer_notices.create' as const, input: notices }]
			: [])
	]);
	if (unassigned > 0)
		yield* ctx.notify({
			title: `${unassigned} visit${unassigned === 1 ? '' : 's'} need a helper`,
			description: visits.map((v) => v.number).join(', '),
			to: [{ team: 'operations' }]
		});
	return { assigned, unassigned };
});
/**
 * Plan recovery in appointment order, reserving each recommendation only in this provisional plan; a `lapsed` day (no
 * answer in time) is marked `no_response` in the same write. A visit written since it was read fails the plan with
 * `ActConflict`.
 */
export const recommend = Effect.fnUntraced(function* (
	ctx: Writes,
	visits: readonly Visit[],
	away: Id<'helpers'>,
	lapsed: boolean
) {
	if (visits.length === 0) return;
	const ordered = [...visits].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
	const pool = yield* loadPool(
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
				...(lapsed ? { shift_check: 'no_response' as const } : {}),
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
	yield* ctx.act('visits.update', updates, { observed: observedOf(visits) });
	yield* ctx.notify({
		title: 'Approve replacement cleaners',
		description: `${visits.length} visit${visits.length === 1 ? '' : 's'} need your decision. Recommendations include travel and workload; no replacement is assigned until approval.`,
		to: [{ team: 'operations' }],
		link: { collection: 'visits', id: ordered[0]!.id }
	});
});
/**
 * Keeps the committed schedule at a local optimum: every visit of the next two weeks that may still move (outside the
 * free-change window, its customer named no cleaner, nothing pending on it) is relocated between cleaners while a single
 * move lowers the matching objective (load balance, then added drive) by more than the continuity bonus. Hard
 * requirements hold for every move, on visits whose shift is still held (`HELD_SHIFT`). The desk is told what changed; each cleaner is told by `helper_alerts`. A moved visit written since it was read fails
 * the moves with `ActConflict`.
 */
export const optimise = Effect.fnUntraced(function* (ctx: Writes) {
	const HOUR = 3600000;
	const { free_change_hours } = yield* settingsOf(ctx);
	const from = iso(Date.parse(ctx.now) + free_change_hours * HOUR);
	const to = iso(Date.parse(ctx.now) + 14 * 24 * HOUR);
	const { rows } = yield* ctx.query('visits', {
		where: {
			status: { eq: 'scheduled' },
			helper: { isNull: false },
			attention: { eq: 'none' },
			shift_check: HELD_SHIFT,
			slot: { overlaps: { start: from, end: to } }
		},
		select: {
			revision: true,
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
	const pool = yield* loadPool(
		ctx,
		from,
		to,
		movable.map((m) => m.location)
	);
	const result = improve(pool, movable, ctx.tz);
	if (result.moves.length === 0) return;
	const moved = new Set(result.moves.map((m) => m.visit));
	yield* ctx.act(
		'visits.update',
		result.moves.map((m) => ({ target: m.visit, set: { helper: m.to } })),
		{ observed: observedOf(rows.filter((v) => moved.has(v.id))) }
	);
	yield* ctx.notify({
		title: `Schedule optimised: ${result.moves.length} reassignment${result.moves.length === 1 ? '' : 's'}`,
		to: [{ team: 'operations' }],
		description: `Planned driving over the next two weeks is ${result.after} minutes, down from ${result.before}. Workload is spread more evenly; every move kept skills, hours, leave and travel buffers.`,
		once: `optimise-${ctx.now}`
	});
});
