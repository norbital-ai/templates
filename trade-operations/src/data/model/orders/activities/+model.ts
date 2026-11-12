import { model } from '../../../../../.norbital/models/activities.ts';
export default model({
	description: 'activities',
	record_label: 'record.title',
	fields: {
		order: { kind: 'ref', to: 'orders', inverse: 'activities' },
		owner: { kind: 'ref', to: 'sys_user', default: { var: 'requestor.id' } },
		title: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['task', 'call', 'meeting', 'note'],
			default: 'task'
		},
		due_on: {
			kind: 'date',
			default: { var: 'today' }
		},
		done: {
			kind: 'bool',
			default: false
		},
		notes: {
			kind: 'text',
			optional: true
		}
	},
	outputs: { default: { fields: 'all' } },
	indexes: { search: { text: ['title', 'kind'] } },
	create: { columns: { fields: ['order', 'owner', 'title', 'kind', 'due_on', 'done', 'notes'] } },
	update: { columns: { fields: ['title', 'kind', 'due_on', 'done', 'notes'] } }
});
