import { model } from '@norbital-ai/bolt';
import { TRADE_SPECIALTIES } from '../../../../lib/trades.js';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'title',
	'kind',
	'trade_specialty',
	'project_id',
	'zone',
	'task_id',
	'contract_id',
	'bim_file_id',
	'bim_pin',
	'severity',
	'status',
	'reported_by',
	'assignee',
	'party',
	'reported_date',
	'due_date',
	'closed_date',
	'description',
	'resolution_notes',
	'photos',
	'attachments',
	'source_message_id'
] as const;

export default model('issues', {
	description:
		'Site defects, clashes, RFIs, safety observations, and snags tied to progression tasks, trade subcontractors, and 3D BIM IFC elements.',
	icon: 'lucide:triangle-alert',
	record_label:
		"record.issue_number != null ? record.issue_number + ' · ' + record.title : record.title",
	fields: {
		issue_number: { kind: 'seq', pattern: 'ISS-{yyyy}-{000}', per: ['project_id'] },
		title: { kind: 'text' },
		kind: {
			kind: 'enum',
			values: ['defect', 'rfi', 'clash', 'safety', 'snag'],
			default: 'defect'
		},
		trade_specialty: {
			kind: 'enum',
			values: [...TRADE_SPECIALTIES],
			default: 'general'
		},
		severity: {
			kind: 'enum',
			values: ['low', 'medium', 'high', 'critical'],
			default: 'medium'
		},
		status: {
			kind: 'state',
			initial: 'open',
			states: {
				open: { to: ['in_progress', 'ready_for_verification', 'closed'] },
				in_progress: { to: ['open', 'ready_for_verification', 'closed'] },
				ready_for_verification: { to: ['in_progress', 'closed'] },
				closed: { to: ['open'] }
			}
		},
		zone: { kind: 'text', optional: true },
		bim_pin: { kind: 'custom', of: 'bim_pin', optional: true },
		reported_by: { kind: 'text', optional: true },
		reported_date: { kind: 'date', optional: true, default: { var: 'today' } },
		due_date: { kind: 'date', optional: true },
		closed_date: { kind: 'date', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		resolution_notes: { kind: 'text', format: 'markdown', optional: true },
		photos: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png', 'image/webp'],
			max: '20MiB',
			many: true,
			optional: true
		},
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'issues', owned: true },
		task_id: {
			kind: 'ref',
			to: 'tasks',
			inverse: 'issues',
			optional: true,
			on_delete: 'set_null'
		},
		contract_id: {
			kind: 'ref',
			to: 'contracts',
			inverse: 'issues',
			optional: true,
			on_delete: 'set_null'
		},
		bim_file_id: {
			kind: 'ref',
			to: 'project_files',
			inverse: 'issues',
			optional: true,
			on_delete: 'set_null'
		},
		assignee: { kind: 'ref', to: 'sys_user', optional: true },
		party: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'issues',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'issues',
			optional: true,
			on_delete: 'set_null'
		}
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['issue_number', 'title', 'zone', 'description'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			task_id: { fields: ['task_code', 'title'] },
			contract_id: { fields: ['contract_number', 'title'] },
			bim_file_id: { fields: ['document_number', 'title'] },
			assignee: { fields: ['name'] },
			party: { fields: ['full_name', 'company_name', 'trade_specialty'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map((c) => ({
				...c.set,
				...(c.changed('status') && c.after.status === 'closed' && c.after.closed_date == null
					? { closed_date: ctx.today }
					: {})
			}));
		}
	}
});
