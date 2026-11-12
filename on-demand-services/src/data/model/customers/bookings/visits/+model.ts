import type { Instant } from '@norbital-ai/bolt';
import { model } from '../../../../../../.norbital/models/visits.ts';
import { alertHelpers } from '../../../../../lib/dispatch.js';
import { Instant as instant } from '@norbital-ai/std/date';
import { AREAS, lookups, refusal, SKILLS, type Refusal } from '../../../../../lib/matching.js';
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
export default model({
	description:
		'A visit: when, where, which helper, and where its shift confirmation and ETA check stand.',
	icon: 'lucide:calendar-clock',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'V-{yyyy}-{00000}' },
		booking: { kind: 'ref', to: 'bookings', inverse: 'visits', owned: true },
		/** Optional: a visit nobody can take waits unassigned for dispatch. */
		helper: {
			kind: 'ref',
			to: 'helpers',
			inverse: 'visits',
			optional: true,
			on_delete: 'set_null'
		},
		unavailable_helper: { kind: 'ref', to: 'helpers', optional: true, on_delete: 'set_null' },
		proposed_helper: { kind: 'ref', to: 'helpers', optional: true, on_delete: 'set_null' },
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
				in_progress: { to: ['done'] },
				done: {},
				cancelled: {}
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
	constraints: {
		under_way: {
			locked: { status: { eq: 'in_progress' } },
			except: ['status', 'completion_notes', 'completed_at', 'attention']
		},
		finished: { locked: { status: { in: ['done', 'cancelled'] } } },
		one_visit_at_a_time: {
			no_overlap: 'slot',
			per: ['helper'],
			// unassigned visits (helper null) may overlap: Bolt counts null as a key value
			where: { status: { ne: 'cancelled' }, helper: { is_null: false } }
		}
	},
	indexes: {
		attention: { on: ['attention', 'shift_check'] },
		find: { text: ['number', 'address', 'helper', 'booking'] }
	},
	outputs: {
		// the layers the desk shows beside a visit; the helper's day and the portal read their own outputs
		default: {
			fields: 'all',
			helper: { fields: 'all' },
			unavailable_helper: { fields: 'all' },
			booking: { fields: 'all', customer: { fields: 'all' }, service: { fields: 'all' } },
			proposed_helper: { fields: ['name'] }
		},
		// when, where, who comes (by name) and how far away; who could not come is the desk's
		customer: {
			fields: [
				'number',
				'booking',
				'helper',
				'slot',
				'address',
				'status',
				'eta_minutes',
				'completed_at'
			],
			helper: { fields: ['name'] },
			booking: {
				fields: ['number', 'customer', 'service', 'repeat', 'status', 'visit_count'],
				customer: { fields: ['name'] },
				service: { fields: ['name', 'duration_minutes', 'description'] }
			}
		},
		helper: {
			fields: [
				'number',
				'booking',
				'helper',
				'slot',
				'address',
				'location',
				'skill',
				'status',
				'shift_check',
				'mc',
				'started_at',
				'completed_at',
				'completion_notes'
			],
			helper: { fields: ['name', 'phone'] },
			unavailable_helper: { fields: ['name'] },
			booking: {
				fields: ['number', 'service', 'customer', 'notes'],
				customer: { fields: ['name', 'email', 'phone', 'address'] },
				service: { fields: ['name', 'duration_minutes', 'description'] }
			}
		}
	},
	// visits are created with their booking (its `visits` layer); the effect tells each helper of their new visits
	create: {
		columns: { fields: ['slot', 'address', 'location', 'area', 'skill', 'helper', 'attention'] },
		effect: function* (changes, ctx) {
			yield* alertHelpers(
				changes.flatMap(({ after }) => (after.helper === null ? [] : [after.id])),
				ctx
			);
		}
	},
	update: {
		columns: {
			fields: [
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
			} = yield* ctx.query({
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
					: (yield* ctx.query({
							drive_times: { where: { leg: { in: legs } }, fields: ['leg', 'minutes'] }
						})).drive_times.rows;
			const pool = { ...holds, drive: new Map(drive.map((d) => [d.leg, d.minutes])) };
			const out: (typeof changes)[number]['set'][] = [];
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
		},
		// runs as the writer: the desk or a dispatch run assigns and moves visits, a helper only answers and works them
		effect: function* (changes, ctx) {
			yield* alertHelpers(
				changes.flatMap((c) =>
					c.changed('helper', 'slot') && c.after.helper !== null ? [c.after.id] : []
				),
				ctx
			);
			if (changes.some((c) => c.changed('helper', 'slot', 'status'))) {
				yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
				yield* ctx.schedule('check_drives', {}, { key: 'check_drives' });
			}
			if (
				changes.some(
					({ before, after }) =>
						before.shift_check !== after.shift_check && after.shift_check === 'declined'
				)
			)
				yield* ctx.schedule('shift_watch', {}, { key: 'shift_watch' });
		}
	}
});
