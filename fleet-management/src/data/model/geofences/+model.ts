import { model } from '@norbital-ai/bolt';

const columns = [
	'code',
	'name',
	'zone_type',
	'center',
	'radius_m',
	'speed_limit_kmh',
	'alert_on_enter',
	'alert_on_exit',
	'active',
	'notes'
] as const;

export default model('geofences', {
	description:
		'Circular GPS geofences (depots, job sites, corridors, restricted zones, customer hubs) with optional zone speed limits and entry/exit alert triggers.',
	icon: 'lucide:radar',
	record_label: "record.code + ' · ' + record.name",
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		zone_type: {
			kind: 'enum',
			values: ['depot', 'job_site', 'customer', 'corridor', 'restricted'],
			default: 'depot'
		},
		center: { kind: 'point' },
		radius_m: { kind: 'int', min: 25, default: 250 },
		speed_limit_kmh: { kind: 'decimal', scale: 1, optional: true },
		alert_on_enter: { kind: 'bool', default: false },
		alert_on_exit: { kind: 'bool', default: false },
		active: { kind: 'bool', default: true },
		notes: { kind: 'text', format: 'markdown', optional: true }
	},
	constraints: {
		code: { unique: ['code'], import_key: true },
		positive_speed_limit: {
			check: {
				or: [{ speed_limit_kmh: { is_null: true } }, { speed_limit_kmh: { gt: 0 } }]
			}
		}
	},
	indexes: {
		by_active: { on: ['active', 'zone_type'] },
		find: { text: ['code', 'name', 'notes'] }
	},
	outputs: {
		default: { fields: 'all' }
	},
	create: { fields: [...columns] },
	update: { fields: [...columns] },
	delete: {}
});
