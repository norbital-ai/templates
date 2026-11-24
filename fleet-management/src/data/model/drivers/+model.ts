import { model } from '@norbital-ai/bolt';

const columns = [
	'employee_code',
	'full_name',
	'license_number',
	'license_class',
	'license_expiry',
	'phone',
	'email',
	'status',
	'notes'
] as const;

export default model('drivers', {
	description:
		'Fleet drivers assigned to vehicles and dispatched routes, including license class, expiry, and contact details.',
	icon: 'lucide:user-round',
	record_label: "record.employee_code + ' · ' + record.full_name",
	fields: {
		employee_code: { kind: 'text' },
		full_name: { kind: 'text' },
		license_number: { kind: 'text', optional: true },
		license_class: {
			kind: 'enum',
			values: ['class_3', 'class_4', 'class_5', 'hazmat', 'crane'],
			default: 'class_4'
		},
		license_expiry: { kind: 'date', optional: true },
		phone: { kind: 'text', format: 'phone', optional: true },
		email: { kind: 'text', format: 'email', optional: true },
		status: {
			kind: 'enum',
			values: ['active', 'on_leave', 'suspended', 'inactive'],
			default: 'active'
		},
		notes: { kind: 'text', format: 'markdown', optional: true }
	},
	constraints: {
		employee_code: { unique: ['employee_code'], import_key: true }
	},
	indexes: {
		by_status: { on: ['status'] },
		find: { text: ['employee_code', 'full_name', 'license_number', 'phone', 'email'] }
	},
	outputs: {
		default: { fields: 'all' }
	},
	create: { fields: [...columns] },
	update: { fields: [...columns] },
	delete: {}
});
