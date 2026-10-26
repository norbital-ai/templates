import { model, type Instant, type UpdateSet } from '@norbital-ai/bolt';
import { addDays, Instant as instant } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool } from '../../../lib/dispatch.js';
import {
	AREAS,
	lookups,
	openSlots,
	rank,
	refusal,
	SKILLS,
	slotOf,
	type Refusal
} from '../../../lib/matching.js';
const HOUR = 3600000;
const WHY: {
	[R in Refusal]: string;
} = {
	left: 'has left',
	skill: 'does not have the skill this service needs',
	day: 'does not work that day',
	hours: 'is outside their working hours then',
	time_off: 'is off that day',
	booked: 'has another visit too close to this one, counting the drive between them'
};
/** The start and the finish are stamped as the helper moves the visit through its day. */
const stamped = <
	I extends {
		readonly status?: string;
	}
>(
	set: I,
	now: Instant
) =>
	set.status === 'in_progress'
		? { ...set, started_at: now }
		: set.status === 'done'
			? { ...set, completed_at: now }
			: set;
/**
 * One occurrence of a booking at one time, held by one helper. The address and skill are the booking's, copied so a
 * match reads one row. `shift_check` is the pre-shift confirmation; `attention` is why dispatch must act on it.
 *
 * Visits are created with their booking. Every write that names a helper or moves a visit is held to the hard
 * requirements here, whoever makes it; a change of helper starts that helper's shift check afresh.
 */
export default model('visits', {
	description:
		'A visit: when, where, which helper, and where its shift confirmation and ETA check stand.',
	icon: 'lucide:calendar-clock',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'V-{yyyy}-{00000}' },
		booking: { kind: 'ref', to: 'bookings', inverse: 'visits', owned: true },
		/** Optional: a visit nobody can take waits unassigned for dispatch. */
		helper: { kind: 'ref', to: 'helpers', inverse: 'visits', optional: true, onDelete: 'setNull' },
		unavailable_helper: { kind: 'ref', to: 'helpers', optional: true, onDelete: 'setNull' },
		proposed_helper: { kind: 'ref', to: 'helpers', optional: true, onDelete: 'setNull' },
		slot: { kind: 'period', of: 'instant' },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		skill: { kind: 'enum', values: SKILLS },
		status: {
			kind: 'state',
			initial: 'scheduled',
			states: {
				scheduled: { to: ['in_progress', 'cancelled'] },
				in_progress: {
					to: ['done'],
					edit: ['status', 'completion_notes', 'completed_at', 'attention']
				},
				done: { edit: 'none' },
				cancelled: { edit: 'none' }
			}
		},
		shift_check: {
			kind: 'enum',
			values: ['not_due', 'asked', 'confirmed', 'no_response', 'declined'],
			default: 'not_due'
		},
		shift_asked_at: { kind: 'instant', optional: true },
		/** The helper declined with a medical certificate: excused, no warning. */
		mc: { kind: 'bool', default: false },
		eta_minutes: { kind: 'int', optional: true },
		eta_checked_at: { kind: 'instant', optional: true },
		attention: {
			kind: 'enum',
			values: ['none', 'unassigned', 'eta_risk', 'helper_left', 'awaiting_approval'],
			default: 'none'
		},
		proposed_slot: { kind: 'period', of: 'instant', optional: true },
		/** Stamped when the helper starts and finishes. */
		started_at: { kind: 'instant', optional: true },
		completed_at: { kind: 'instant', optional: true },
		completion_notes: { kind: 'text', max: 2000, optional: true },
		/** Cancelled less than a day before the start: chargeable. */
		late_cancellation: { kind: 'bool', default: false }
	},
	index: ['attention', 'shift_check'],
	noOverlap: [
		{
			key: ['helper'],
			period: 'slot',
			// unassigned visits (helper null) may overlap: Bolt counts null as a key value
			where: { status: { ne: 'cancelled' }, helper: { isNull: false } }
		}
	],
	read: 'all',
	update: {
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
			'unavailable_helper',
			'proposed_slot',
			'late_cancellation',
			'completion_notes'
		],
		transform: function* (changes, ctx) {
			const touched = changes.flatMap(({ before, set }) => {
				const helper = set.helper === undefined ? before.helper : set.helper;
				const moved = set.helper !== undefined || set.slot !== undefined;
				const status = set.status ?? before.status;
				return moved && helper != null && status !== 'cancelled' ? [helper] : [];
			});
			if (touched.length === 0) return changes.map(({ set }) => stamped(set, ctx.now));
			const ids = [...new Set(touched)];
			const starts = changes.map(({ before, set }) => Date.parse((set.slot ?? before.slot).start));
			const from = instant(new Date(Math.min(...starts) - 2 * 24 * HOUR).toISOString());
			const to = instant(new Date(Math.max(...starts) + 2 * 24 * HOUR).toISOString());
			const { helpers, stored, off } = yield* ctx.db.query({
				helpers: { from: 'helpers', where: { id: { in: ids } }, all: true },
				stored: {
					from: 'visits',
					where: {
						helper: { in: ids },
						status: { ne: 'cancelled' },
						slot: { overlaps: { start: from, end: to } }
					},
					select: { helper: true, slot: true, location: true, status: true },
					all: true
				},
				off: { from: 'helper_time_off', where: { helper: { in: ids } }, all: true }
			});
			// the stored holds with this batch laid over them, so two visits of one batch cannot collide either
			const held = new Map(stored.rows.map((v) => [String(v.id), v]));
			for (const { before: v, set } of changes)
				held.set(String(v.id), {
					id: v.id,
					helper: set.helper === undefined ? v.helper : set.helper,
					slot:
						set.slot === undefined
							? v.slot
							: { start: instant(set.slot.start), end: instant(set.slot.end!) },
					location: v.location,
					status: set.status ?? v.status
				});
			const holds = {
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
			const legs = lookups(
				holds,
				changes.map(({ before }) => before.location),
				ctx.tz
			);
			const drive =
				legs.length === 0
					? []
					: (yield* ctx.db.query('drive_times', {
							where: { leg: { in: legs } },
							select: { leg: true, minutes: true },
							all: true
						})).rows;
			const pool = { ...holds, drive: new Map(drive.map((d) => [d.leg, d.minutes])) };
			const out: UpdateSet<'visits'>[] = [];
			for (const [row, { before, set }] of changes.entries()) {
				const helper = set.helper === undefined ? before.helper : set.helper;
				const changed = set.helper !== undefined && set.helper !== before.helper;
				if (
					(set.helper !== undefined || set.slot !== undefined) &&
					helper != null &&
					(set.status ?? before.status) !== 'cancelled'
				) {
					const h = pool.helpers.find((x) => x.id === helper)!;
					const slot = set.slot ?? before.slot;
					const no = refusal(
						h,
						{
							skill: before.skill,
							slot: { start: instant(slot.start), end: instant(slot.end!) },
							location: before.location,
							area: before.area,
							visit: before.id
						},
						pool,
						ctx.tz
					);
					if (no !== null)
						return yield* ctx.refuse(`${h.name} ${WHY[no]}.`, { field: 'helper', row });
				}
				out.push(
					stamped(
						changed
							? {
									shift_check: 'not_due' as const,
									shift_asked_at: null,
									eta_minutes: null,
									eta_checked_at: null,
									...set
								}
							: set,
						ctx.now
					)
				);
			}
			return out;
		}
	},
	queries: {
		rebooking_slots: {
			description: 'Feasible replacement starts for this occurrence, including adjacent travel.',
			input: {
				visit: { kind: 'id', of: 'visits' },
				from: { kind: 'date' },
				days: { kind: 'int', min: 1, max: 14 }
			},
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: { day: { kind: 'date' }, starts: { kind: 'list', of: { kind: 'instant' } } }
				}
			},
			run: function* ({ visit, from, days }, ctx) {
				const v = yield* ctx.query('visits', { id: visit });
				if (v === null || v.status !== 'scheduled')
					return yield* ctx.refuse('Choose a scheduled visit.');
				const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
				const pool = yield* loadPool(
					ctx,
					new Date(utcOf(from, 0, ctx.tz)).toISOString(),
					new Date(utcOf(dates.at(-1)!, 0, ctx.tz)).toISOString(),
					[v.location]
				);
				const freed = {
					...pool,
					busy: pool.busy.filter((b) => b.id !== v.id),
					helpers: pool.helpers.filter((h) => h.id !== v.unavailable_helper)
				};
				const need = {
					skill: v.skill,
					location: v.location,
					area: v.area,
					minutes: (Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60000
				};
				const starts = new Map(dates.map((d) => [d, new Set<Instant>()]));
				for (const h of freed.helpers)
					for (const d of openSlots(h, need, dates, freed, ctx.tz, ctx.now))
						for (const start of d.starts) starts.get(d.day)!.add(start);
				return dates.map((day) => ({ day, starts: [...starts.get(day)!].sort() }));
			}
		},
		candidates: {
			description: 'The helpers who could take this visit instead, best match first.',
			input: { visit: { kind: 'id', of: 'visits' }, start: { kind: 'instant', optional: true } },
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						helper: { kind: 'id', of: 'helpers' },
						name: { kind: 'text' },
						drive_minutes: { kind: 'int' },
						same_area: { kind: 'bool' },
						week_hours: { kind: 'number' }
					}
				}
			},
			run: function* ({ visit, start }, ctx) {
				const v = yield* ctx.query('visits', { id: visit });
				if (v === null) return yield* ctx.refuse('This visit is not visible to you.');
				const at = start ?? v.slot.start;
				const pool = yield* loadPool(ctx, at, at, [v.location]);
				const need = {
					skill: v.skill,
					slot: slotOf(at, (Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60000),
					location: v.location,
					area: v.area,
					visit: v.id
				};
				return rank(
					need,
					{
						...pool,
						helpers: pool.helpers.filter(
							(h) => (start !== undefined || h.id !== v.helper) && h.id !== v.unavailable_helper
						)
					},
					ctx.tz
				).map((c) => ({
					helper: c.helper,
					name: c.name,
					drive_minutes: c.drive_minutes,
					same_area: c.same_area,
					week_hours: c.week_hours
				}));
			}
		}
	}
});
