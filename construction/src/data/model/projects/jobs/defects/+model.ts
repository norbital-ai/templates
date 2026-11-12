import { model } from '../../../../../../.norbital/models/defects.ts';
const columns = [
	'title',
	'defect_number',
	'project_id',
	'site_location_id',
	'job_id',
	'reported_by',
	'assigned_to',
	'category',
	'severity',
	'status',
	'description',
	'reported_date',
	'due_date',
	'closed_date',
	'photos',
	'resolution_notes'
] as const;
export default model({
	description: 'Quality issues and closeout items tracked in project context.',
	icon: 'lucide:triangle-alert',
	record_label: 'record.title',
	fields: {
		title: { kind: 'text' },
		defect_number: { kind: 'text', optional: true, unique: true },
		reported_by: { kind: 'text', optional: true },
		assigned_to: { kind: 'text', optional: true },
		category: { kind: 'text', optional: true },
		severity: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		status: {
			kind: 'enum',
			values: ['open', 'in_review', 'ready_for_closeout', 'closed'],
			optional: true
		},
		description: { kind: 'text', optional: true },
		reported_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		closed_date: { kind: 'date', optional: true },
		photos: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png'],
			max: '20MiB',
			many: true,
			optional: true
		},
		resolution_notes: { kind: 'text', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'defects', optional: true },
		site_location_id: {
			kind: 'ref',
			to: 'site_locations',
			inverse: 'defects',
			optional: true,
			on_delete: 'set_null'
		},
		job_id: { kind: 'ref', to: 'jobs', inverse: 'defects', optional: true, on_delete: 'set_null' }
	},
	indexes: { find: { text: ['title'] } },
	outputs: { default: { fields: 'all', job_id: { fields: ['job_title'] } } },
	create: { columns: { fields: columns } },
	update: { columns: { fields: columns } }
});
