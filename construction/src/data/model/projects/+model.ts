import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Construction projects and their operating context.',
	icon: 'lucide:building-2',
	label: 'project_name',
	fields: {
		project_name: { kind: 'text' },
		project_number: { kind: 'text', optional: true, unique: true },
		client: { kind: 'text', optional: true },
		main_contractor: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['planned', 'active', 'on_hold', 'complete', 'cancelled'],
			optional: true
		},
		schedule_range: { kind: 'period', of: 'date', optional: true },
		currency: { kind: 'currency', optional: true },
		contract_value: { kind: 'money', currency: 'currency', optional: true },
		project_type: { kind: 'text', optional: true },
		address: { kind: 'custom', of: 'project_address', optional: true },
		project_manager: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true }
	},
	search: { text: ['project_name'] }
});
