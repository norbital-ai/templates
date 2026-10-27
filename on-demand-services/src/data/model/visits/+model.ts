import { model, type Instant, type UpdateSet } from '@norbital-ai/bolt';
import { Instant as instant } from '@norbital-ai/std/date';
import { AREAS, lookups, refusal, SKILLS, type Refusal } from '../../../lib/matching.js';
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
	// the layers the desk, the helper's day and the portal show beside a visit; each policy narrows them for its holders
	read: {
		visits: { fields: 'all' },
		'visits.helper': { fields: 'all' },
		'visits.unavailable_helper': { fields: 'all' },
		'visits.booking': { fields: 'all' },
		'visits.booking.customer': { fields: 'all' },
		'visits.booking.service': { fields: 'all' }
	},
	update: {
		columns: {
			visits: [
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
			]
		},
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
			const {
				helpers,
				visits: stored,
				helper_time_off: off
			} = yield* ctx.db.query({
				helpers: { where: { id: { in: ids } } },
				visits: {
					where: {
						helper: { in: ids },
						status: { ne: 'cancelled' },
						slot: { overlaps: { start: from, end: to } }
					},
					fields: ['helper', 'slot', 'location', 'status']
				},
				helper_time_off: { where: { helper: { in: ids } } }
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
					: (yield* ctx.db.query({
							drive_times: { where: { leg: { in: legs } }, fields: ['leg', 'minutes'] }
						})).drive_times.rows;
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
	}
});
