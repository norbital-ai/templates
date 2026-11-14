import { model } from '@norbital-ai/bolt';
const columns = [
	'permit_number',
	'permit_type',
	'project_id',
	'site_location_id',
	'job_id',
	'worker_id',
	'status',
	'requested_date',
	'validity_range',
	'approved_by',
	'hazards_identified',
	'control_measures',
	'signatures'
] as const;
export default model('permits_to_work', {
	description: 'Evidence-backed permit and competency validity records.',
	icon: 'lucide:shield-check',
	record_label: 'record.permit_number',
	fields: {
		permit_number: { kind: 'text' },
		permit_type: {
			kind: 'enum',
			values: [
				'work_at_height',
				'site_supervision',
				'electrical',
				'confined_space',
				'hot_work',
				'lifting',
				'excavation'
			],
			optional: true
		},
		status: {
			kind: 'enum',
			values: ['draft', 'pending', 'active', 'expiring_soon', 'expired', 'suspended', 'closed'],
			optional: true
		},
		requested_date: { kind: 'date', optional: true },
		validity_range: { kind: 'period', of: 'date', optional: true },
		approved_by: { kind: 'text', optional: true },
		hazards_identified: { kind: 'text', many: true, optional: true },
		control_measures: { kind: 'text', many: true, optional: true },
		signatures: { kind: 'custom', of: 'permit_signatures', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'permits_to_work', optional: true },
		site_location_id: {
			kind: 'ref',
			to: 'site_locations',
			inverse: 'permits_to_work',
			optional: true,
			on_delete: 'set_null'
		},
		job_id: {
			kind: 'ref',
			to: 'jobs',
			inverse: 'permits_to_work',
			optional: true,
			on_delete: 'set_null'
		},
		worker_id: {
			kind: 'ref',
			to: 'workers',
			inverse: 'permits_to_work',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: { permit_number: { unique: ['permit_number'] } },
	indexes: { find: { text: ['permit_number'] } },
	outputs: { default: { fields: 'all', job_id: { fields: ['job_title'] } } },
	create: { fields: columns },
	update: { fields: columns }
});
