import { model } from '@norbital-ai/bolt';

const createColumns = [
	'vehicle_id',
	'route_id',
	'geofence_id',
	'alert_type',
	'severity',
	'recorded_at',
	'location',
	'measured_speed_kmh',
	'limit_kmh',
	'summary',
	'resolution_notes'
] as const;

export default model('fleet_alerts', {
	description:
		'Operational telemetry alerts for overspeeding, geofence entry/exit breaches, offline transponders, and route ETA delays.',
	icon: 'lucide:siren',
	record_label:
		"record.alert_number != null ? record.alert_number + ' · ' + record.summary : record.summary",
	fields: {
		alert_number: { kind: 'seq', pattern: 'ALT-{yyyy}-{000}' },
		alert_type: {
			kind: 'enum',
			values: ['overspeed', 'geofence_enter', 'geofence_exit', 'offline', 'route_delay']
		},
		severity: {
			kind: 'enum',
			values: ['info', 'warning', 'critical'],
			default: 'warning'
		},
		status: {
			kind: 'state',
			initial: 'open',
			states: {
				open: { to: ['acknowledged', 'resolved'] },
				acknowledged: { to: ['resolved', 'open'] },
				resolved: { to: [], stamp: 'resolved_at' }
			}
		},
		recorded_at: { kind: 'instant' },
		location: { kind: 'point', optional: true },
		measured_speed_kmh: { kind: 'decimal', scale: 1, optional: true },
		limit_kmh: { kind: 'decimal', scale: 1, optional: true },
		summary: { kind: 'text' },
		resolution_notes: { kind: 'text', format: 'markdown', optional: true },
		resolved_at: { kind: 'instant', optional: true },
		vehicle_id: {
			kind: 'ref',
			to: 'vehicles',
			inverse: 'fleet_alerts',
			on_delete: 'cascade'
		},
		route_id: {
			kind: 'ref',
			to: 'routes',
			inverse: 'fleet_alerts',
			optional: true,
			on_delete: 'set_null'
		},
		geofence_id: {
			kind: 'ref',
			to: 'geofences',
			inverse: 'fleet_alerts',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		resolved_locked: {
			locked: { status: { eq: 'resolved' } },
			except: ['resolution_notes']
		}
	},
	indexes: {
		by_status_severity: { on: ['status', 'severity', 'recorded_at'] },
		by_vehicle: { on: ['vehicle_id', 'status'] },
		find: { text: ['alert_number', 'summary', 'resolution_notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			vehicle_id: { fields: ['registration_no', 'vehicle_name'] },
			route_id: { fields: ['route_number', 'title'] },
			geofence_id: { fields: ['code', 'name'] }
		}
	},
	create: { fields: [...createColumns] },
	update: {
		fields: ['status', 'severity', 'resolution_notes']
	}
});
