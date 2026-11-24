import { model } from '@norbital-ai/bolt';

const columns = [
	'registration_no',
	'vehicle_name',
	'vehicle_type',
	'transponder_id',
	'status',
	'driver_id',
	'last_location',
	'current_speed_kmh',
	'speed_limit_kmh',
	'heading_deg',
	'ignition_on',
	'odometer_km',
	'fuel_pct',
	'destination_label',
	'destination_location',
	'last_ping_at',
	'notes'
] as const;

export default model('vehicles', {
	description:
		'Fleet vehicles equipped with GPS transponders, tracking live coordinates, speed, heading, ignition, odometer, fuel, current destination, and driver assignment.',
	icon: 'lucide:truck',
	record_label: "record.registration_no + ' · ' + record.vehicle_name",
	fields: {
		registration_no: { kind: 'text' },
		vehicle_name: { kind: 'text' },
		vehicle_type: {
			kind: 'enum',
			values: ['van', 'lorry', 'tipper', 'crane_truck', 'trailer', 'pickup', 'tanker', 'car'],
			default: 'lorry'
		},
		transponder_id: { kind: 'text' },
		status: {
			kind: 'enum',
			values: ['available', 'en_route', 'idle', 'stopped', 'maintenance', 'offline'],
			default: 'available'
		},
		driver_id: {
			kind: 'ref',
			to: 'drivers',
			inverse: 'vehicles',
			optional: true,
			on_delete: 'set_null'
		},
		last_location: { kind: 'point', optional: true },
		current_speed_kmh: { kind: 'decimal', scale: 1, default: 0 },
		speed_limit_kmh: { kind: 'decimal', scale: 1, default: 70 },
		heading_deg: { kind: 'decimal', scale: 1, optional: true },
		ignition_on: { kind: 'bool', default: false },
		odometer_km: { kind: 'decimal', scale: 1, default: 0 },
		fuel_pct: { kind: 'decimal', scale: 1, optional: true },
		destination_label: { kind: 'text', optional: true },
		destination_location: { kind: 'point', optional: true },
		last_ping_at: { kind: 'instant', optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		is_overspeed: {
			kind: 'bool',
			computed: 'current_speed_kmh > speed_limit_kmh'
		}
	},
	constraints: {
		registration_no: { unique: ['registration_no'], import_key: true },
		transponder_id: { unique: ['transponder_id'] },
		valid_speed: { check: { current_speed_kmh: { gte: 0 }, speed_limit_kmh: { gt: 0 } } },
		valid_odometer: { check: { odometer_km: { gte: 0 } } },
		valid_fuel: {
			check: {
				or: [{ fuel_pct: { is_null: true } }, { fuel_pct: { gte: 0, lte: 100 } }]
			}
		}
	},
	indexes: {
		by_status: { on: ['status'] },
		find: { text: ['registration_no', 'vehicle_name', 'transponder_id', 'destination_label'] }
	},
	outputs: {
		default: {
			fields: 'all',
			driver_id: { fields: ['employee_code', 'full_name', 'phone'] }
		}
	},
	create: { fields: [...columns] },
	update: { fields: [...columns] },
	delete: {}
});
