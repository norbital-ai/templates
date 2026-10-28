import { model } from '@norbital-ai/bolt';
const columns = [
	'job_title',
	'job_number',
	'project_id',
	'job_type',
	'status',
	'schedule_range',
	'currency',
	'budget',
	'bim_reference_id',
	'site_location_id',
	'description',
	'priority'
] as const;
export default model('jobs', {
	description: 'Project work packages configured by site location and BIM reference context.',
	icon: 'lucide:briefcase-business',
	label: 'job_title',
	fields: {
		job_title: { kind: 'text' },
		job_number: { kind: 'text', optional: true, unique: true },
		job_type: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['planned', 'ready', 'in_progress', 'completed', 'blocked', 'cancelled'],
			optional: true
		},
		schedule_range: { kind: 'period', of: 'date', optional: true },
		currency: { kind: 'currency', optional: true },
		budget: { kind: 'money', currency: 'currency', optional: true },
		description: { kind: 'text', optional: true },
		priority: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'jobs', optional: true },
		site_location_id: {
			kind: 'ref',
			to: 'site_locations',
			inverse: 'jobs',
			optional: true,
			onDelete: 'setNull'
		},
		bim_reference_id: {
			kind: 'ref',
			to: 'bim_reference_matrix',
			inverse: 'jobs',
			optional: true,
			onDelete: 'setNull'
		}
	},
	search: { text: ['job_title', 'job_number', 'project_id'] },
	read: {
		jobs: { fields: 'all' },
		'jobs.project_id': { fields: ['project_name', 'project_number'] }
	},
	create: { columns: { jobs: columns } },
	update: { columns: { jobs: columns } }
});
