import { model } from '../../../../.norbital/models/projects.ts';
const columns = [
	'project_name',
	'project_number',
	'client',
	'main_contractor',
	'status',
	'schedule_range',
	'currency',
	'contract_value',
	'project_type',
	'address',
	'project_manager',
	'description'
] as const;
export default model({
	description: 'Construction projects and their operating context.',
	icon: 'lucide:building-2',
	record_label:
		"[record.project_number != null ? string(record.project_number) : '', record.project_name != null ? string(record.project_name) : ''].filter(part, part != '').join(' · ')",
	fields: {
		project_name: { kind: 'text' },
		project_number: { kind: 'text', optional: true },
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
	constraints: { project_number: { unique: ['project_number'] } },
	indexes: { find: { text: ['project_name', 'project_number'] } },
	outputs: { default: { fields: 'all' } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
