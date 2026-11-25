import { DateTime, Effect } from 'effect';
import { model, type Id, type Instant, type WriteCtx } from '@norbital-ai/bolt';
import { alertProviders } from '../../../../lib/dispatch.js';
import { epochMs } from '../../../../lib/format.js';
import {
	closedSlot,
	DEFAULTS,
	lookups,
	normalizeSkill,
	refusal,
	type Point,
	type Refusal
} from '../../../../lib/matching.js';

const WHY = {
	inactive: 'errors.provider.inactive',
	skill: 'errors.provider.skill',
	day: 'errors.provider.day',
	hours: 'errors.provider.hours',
	time_off: 'errors.provider.time_off',
	booked: 'errors.provider.booked'
} as const satisfies { readonly [R in Refusal]: string };

type AppointmentStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

type CandidateRow = {
	readonly row: number;
	readonly id: Id<'appointments'>;
	readonly provider: Id<'providers'> | null;
	readonly slot: { readonly start: Instant; readonly end: Instant | null };
	readonly location: Point | null;
	readonly skill: string;
	readonly status: AppointmentStatus;
	readonly check: boolean;
};

/**
 * Enforce hard provider eligibility (active status, skill tag, working days/hours, time off, and
 * travel + turnaround buffers) across every assigned appointment in an act, reading `as_of: 'act'`.
 */
const verifyAssignments = Effect.fnUntraced(function* (
	rows: readonly CandidateRow[],
	ctx: WriteCtx<'appointments'>
) {
	const touched = rows.flatMap((r) =>
		r.check && r.provider !== null && r.status !== 'cancelled' ? [r.provider] : []
	);
	if (touched.length === 0) return;
	const ids = [...new Set(touched)];
	const starts = rows.map((r) => epochMs(r.slot.start));
	const from = DateTime.formatIso(
		DateTime.subtract(DateTime.makeUnsafe(Math.min(...starts)), { days: 2 })
	);
	const to = DateTime.formatIso(
		DateTime.add(DateTime.makeUnsafe(Math.max(...starts)), { days: 2 })
	);
	const {
		scheduling_settings,
		providers,
		appointments: stored,
		provider_time_off: off
	} = yield* ctx.query({
		scheduling_settings: { as_of: 'act', fields: ['buffer_minutes'], limit: 1 },
		providers: { as_of: 'act', where: { id: { in: ids } }, limit: ids.length + 1 },
		appointments: {
			as_of: 'act',
			where: {
				provider: { in: ids },
				status: { ne: 'cancelled' },
				slot: { overlaps: { start: from, end: to } }
			},
			fields: ['provider', 'slot', 'location', 'status'],
			limit: 2000
		},
		provider_time_off: {
			as_of: 'act',
			where: { provider: { in: ids } },
			limit: 1000
		}
	});
	const held = new Map(stored.rows.map((a) => [String(a.id), a]));
	for (const r of rows)
		held.set(String(r.id), {
			id: r.id,
			provider: r.provider,
			slot: r.slot,
			location: r.location,
			status: r.status
		});
	const holds = {
		providers: providers.rows,
		busy: [...held.values()].flatMap((a) => {
			const slot = closedSlot(a.slot);
			return a.provider === null || a.status === 'cancelled' || slot === null
				? []
				: [{ id: a.id, provider: a.provider, slot, location: a.location }];
		}),
		off: off.rows,
		bufferMinutes: scheduling_settings.rows[0]?.buffer_minutes ?? DEFAULTS.buffer_minutes
	};
	const legs = lookups(
		holds,
		rows.map((r) => r.location),
		ctx.tz
	);
	const drive =
		legs.length === 0
			? []
			: (yield* ctx.query({
					drive_times: {
						as_of: 'act',
						where: { leg: { in: legs } },
						fields: ['leg', 'minutes'],
						limit: legs.length + 1
					}
				})).drive_times.rows;
	const pool = { ...holds, drive: new Map(drive.map((d) => [d.leg, d.minutes])) };
	for (const r of rows) {
		if (!r.check || r.provider === null || r.status === 'cancelled') continue;
		const p = pool.providers.find((x) => x.id === r.provider);
		if (p === undefined)
			return yield* ctx.refuse(WHY.inactive, {
				field: 'provider',
				row: r.row,
				values: { name: String(r.provider) }
			});
		const slot = closedSlot(r.slot);
		if (slot === null)
			return yield* ctx.refuse('errors.appointment_open_ended', { field: 'slot', row: r.row });
		const no = refusal(
			p,
			{ skill: r.skill, slot, location: r.location, appointment: r.id },
			pool,
			ctx.tz
		);
		if (no !== null)
			return yield* ctx.refuse(WHY[no], {
				field: 'provider',
				row: r.row,
				values: { name: p.name }
			});
	}
});

/**
 * One scheduled service occurrence held by at most one provider. Every write naming a provider or
 * moving a slot enforces hard eligibility (skill, working hours, time off, and travel buffer) and
 * resets shift/ETA state when the assigned provider changes.
 */
export default model('appointments', {
	was: 'visits',
	description:
		'A scheduled appointment: time slot, location, assigned provider, shift confirmation, and ETA.',
	icon: 'lucide:calendar-clock',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'AP-{yyyy}-{00000}' },
		booking: { kind: 'ref', to: 'bookings', inverse: 'appointments', owned: true },
		provider: {
			kind: 'ref',
			to: 'providers',
			inverse: 'appointments',
			optional: true,
			on_delete: 'set_null'
		},
		unavailable_provider: {
			kind: 'ref',
			to: 'providers',
			optional: true,
			on_delete: 'set_null'
		},
		proposed_provider: {
			kind: 'ref',
			to: 'providers',
			optional: true,
			on_delete: 'set_null'
		},
		slot: { kind: 'period', of: 'instant' },
		address: { kind: 'text', max: 500 },
		location: { kind: 'point', optional: true },
		skill: { kind: 'text', max: 80 },
		status: {
			kind: 'state',
			initial: 'scheduled',
			states: {
				scheduled: { to: ['in_progress', 'cancelled'] },
				in_progress: { to: ['completed'], stamp: 'started_at' },
				completed: { stamp: 'completed_at' },
				cancelled: {}
			}
		},
		shift_check: {
			kind: 'enum',
			values: ['not_due', 'asked', 'confirmed', 'no_response', 'declined'],
			default: 'not_due'
		},
		shift_asked_at: { kind: 'instant', optional: true },
		eta_minutes: { kind: 'int', optional: true },
		eta_checked_at: { kind: 'instant', optional: true },
		attention: {
			kind: 'enum',
			values: ['none', 'unassigned', 'eta_risk', 'provider_inactive', 'awaiting_approval'],
			default: 'none'
		},
		proposed_slot: { kind: 'period', of: 'instant', optional: true },
		started_at: { kind: 'instant', optional: true },
		completed_at: { kind: 'instant', optional: true },
		completion_notes: { kind: 'text', max: 2000, optional: true },
		late_cancellation: { kind: 'bool', default: false }
	},
	constraints: {
		under_way: {
			locked: { status: { eq: 'in_progress' } },
			except: ['status', 'completion_notes', 'completed_at', 'attention']
		},
		finished: { locked: { status: { in: ['completed', 'cancelled'] } } },
		one_appointment_at_a_time: {
			no_overlap: 'slot',
			per: ['provider'],
			where: { status: { ne: 'cancelled' }, provider: { is_null: false } }
		}
	},
	indexes: {
		attention: { on: ['attention', 'shift_check'] },
		find: { text: ['number', 'address', 'provider', 'booking'] }
	},
	outputs: {
		default: {
			fields: 'all',
			provider: { fields: 'all' },
			unavailable_provider: { fields: 'all' },
			booking: { fields: 'all', customer: { fields: 'all' }, service: { fields: 'all' } },
			proposed_provider: { fields: ['name'] }
		},
		customer: {
			fields: [
				'number',
				'booking',
				'provider',
				'slot',
				'address',
				'status',
				'eta_minutes',
				'completed_at'
			],
			provider: { fields: ['name'] },
			booking: {
				fields: ['number', 'customer', 'service', 'repeat', 'status', 'appointment_count'],
				customer: { fields: ['name'] },
				service: { fields: ['name', 'duration_minutes', 'description'] }
			}
		},
		provider: {
			fields: [
				'number',
				'booking',
				'provider',
				'slot',
				'address',
				'location',
				'skill',
				'status',
				'shift_check',
				'started_at',
				'completed_at',
				'completion_notes'
			],
			provider: { fields: ['name', 'phone'] },
			unavailable_provider: { fields: ['name'] },
			booking: {
				fields: ['number', 'service', 'customer', 'notes'],
				customer: { fields: ['name', 'email', 'phone', 'address'] },
				service: { fields: ['name', 'duration_minutes', 'description'] }
			}
		}
	},
	create: {
		fields: ['slot', 'address', 'location', 'skill', 'provider', 'attention'],
		transform: function* (changes, ctx) {
			const normalized = changes.map(({ set, after }) => ({
				...set,
				skill: normalizeSkill(after.skill)
			}));
			yield* verifyAssignments(
				changes.map(({ after }, row) => ({
					row,
					id: after.id,
					provider: after.provider ?? null,
					slot: after.slot,
					location: after.location ?? null,
					skill: normalized[row]?.skill ?? normalizeSkill(after.skill),
					status: after.status ?? 'scheduled',
					check: after.provider != null
				})),
				ctx
			);
			return normalized;
		},
		effect: function* (changes, ctx) {
			yield* alertProviders(
				changes.flatMap(({ after }) => (after.provider === null ? [] : [after.id])),
				ctx
			);
		}
	},
	update: {
		fields: [
			'provider',
			'slot',
			'status',
			'shift_check',
			'shift_asked_at',
			'eta_minutes',
			'eta_checked_at',
			'attention',
			'proposed_provider',
			'unavailable_provider',
			'proposed_slot',
			'late_cancellation',
			'completion_notes'
		],
		transform: function* (changes, ctx) {
			yield* verifyAssignments(
				changes.map(({ set, after }, row) => ({
					row,
					id: after.id,
					provider: after.provider ?? null,
					slot: after.slot,
					location: after.location ?? null,
					skill: after.skill,
					status: after.status,
					check: set.provider !== undefined || set.slot !== undefined
				})),
				ctx
			);
			return changes.map(({ before, set }) =>
				set.provider !== undefined && set.provider !== before.provider
					? {
							shift_check: 'not_due' as const,
							shift_asked_at: null,
							eta_minutes: null,
							eta_checked_at: null,
							...set
						}
					: set
			);
		},
		effect: function* (changes, ctx) {
			yield* alertProviders(
				changes.flatMap((c) =>
					c.changed('provider', 'slot') && c.after.provider !== null ? [c.after.id] : []
				),
				ctx
			);
			if (changes.some((c) => c.changed('provider', 'slot', 'status'))) {
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
