import { model } from '@norbital-ai/bolt';
import { projectCustomerRows } from '../../../../../lib/customer.js';

/** Every column is the person's to set. */
const columns = [
	'title',
	'status',
	'severity',
	'raised_on',
	'resolved_on',
	'company',
	'project_id',
	'owner_id',
	'description'
] as const;

/** A raised issue on a submitted or in-flight project. */
export default model('issues', {
	description: 'An issue raised against a project.',
	icon: 'lucide:circle-alert',
	record_label: 'record.title',
	fields: {
		title: { kind: 'text' },
		status: {
			kind: 'enum',
			values: ['open', 'in_progress', 'blocked', 'resolved', 'closed'],
			optional: true
		},
		severity: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		raised_on: { kind: 'date', optional: true },
		resolved_on: { kind: 'date', optional: true },
		description: { kind: 'text', optional: true },
		company: { kind: 'ref', to: 'companies', inverse: 'issues', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'issues', optional: true },
		owner_id: { kind: 'ref', to: 'contacts', inverse: 'owned_issues', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			company: { fields: ['name'] },
			project_id: { fields: ['name'] },
			owner_id: { fields: ['full_name'] }
		}
	},
	create: {
		fields: columns,
		filled: { fields: ['company'] },
		transform: function* (changes, ctx) {
			return yield* projectCustomerRows(changes, ctx);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			return yield* projectCustomerRows(changes, ctx);
		}
	}
});
