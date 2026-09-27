import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Evidence-backed permit and competency validity records.',
	icon: 'lucide:shield-check',
	label: 'permit_number',
	fields: {
		permit_number: { kind: 'text', unique: true },
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
		signatures: { kind: 'custom', of: 'permit_signatures', optional: true }
	},
	search: { text: ['permit_number'] }
});
