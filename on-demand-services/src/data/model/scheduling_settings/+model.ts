import { model } from '@norbital-ai/bolt';

const columns = [
	'slot_interval_minutes',
	'buffer_minutes',
	'booking_horizon_days',
	'eta_limit_minutes',
	'eta_check_lead_minutes',
	'shift_check_lead_minutes',
	'shift_reply_minutes',
	'free_change_hours'
] as const;

/** Singleton scheduling and dispatch rules. Missing row falls back to `DEFAULTS` in `lib/matching.ts`. */
export default model('scheduling_settings', {
	was: 'dispatch_settings',
	description:
		'Scheduling rules: slot interval, travel buffer, booking horizon, ETA limits, shift checks, and change cutoff.',
	icon: 'lucide:sliders-horizontal',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', default: 'Scheduling' },
		slot_interval_minutes: { kind: 'int', min: 15, max: 60, default: 30 },
		buffer_minutes: { kind: 'int', min: 0, max: 120, default: 15 },
		booking_horizon_days: { kind: 'int', min: 7, max: 60, default: 14 },
		eta_limit_minutes: { kind: 'int', min: 5, max: 240, default: 30 },
		eta_check_lead_minutes: { kind: 'int', min: 15, max: 240, default: 60 },
		shift_check_lead_minutes: { kind: 'int', min: 30, max: 720, default: 120 },
		shift_reply_minutes: { kind: 'int', min: 10, max: 240, default: 60 },
		free_change_hours: { kind: 'int', min: 0, max: 168, default: 24 }
	},
	constraints: {
		name: { unique: ['name'] },
		reply_inside_lead: {
			check: { shift_reply_minutes: { lt: { field: 'shift_check_lead_minutes' } } }
		}
	},
	outputs: { default: { fields: 'all' } },
	create: {
		fields: columns,
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	update: {
		fields: columns,
		effect: function* (changes, ctx) {
			if (
				changes.some((c) =>
					c.changed('slot_interval_minutes', 'buffer_minutes', 'booking_horizon_days')
				)
			)
				yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	}
});
