import { model } from '@norbital-ai/bolt';
const columns = [
	'eta_limit_minutes',
	'eta_check_lead_minutes',
	'shift_check_lead_minutes',
	'shift_reply_minutes',
	'free_change_hours'
] as const;
/** The dispatch thresholds, one row. A missing row means the defaults in `lib/matching.ts`. */
export default model('dispatch_settings', {
	description:
		'Dispatch thresholds: the ETA limit, the shift check timing and the free-change window.',
	icon: 'lucide:sliders-horizontal',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text', default: 'Dispatch' },
		eta_limit_minutes: {
			kind: 'int',
			min: 5,
			max: 240,
			default: 30
		},
		eta_check_lead_minutes: {
			kind: 'int',
			min: 15,
			max: 240,
			default: 60
		},
		shift_check_lead_minutes: {
			kind: 'int',
			min: 30,
			max: 720,
			default: 120
		},
		shift_reply_minutes: {
			kind: 'int',
			min: 10,
			max: 240,
			default: 60
		},
		free_change_hours: {
			kind: 'int',
			min: 0,
			max: 168,
			default: 24
		}
	},
	constraints: {
		name: { unique: ['name'] },
		reply_inside_lead: {
			check: { shift_reply_minutes: { lt: { field: 'shift_check_lead_minutes' } } }
		}
	},
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns }
});
