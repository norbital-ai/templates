import { model } from '@norbital-ai/bolt';
export default model('activities', {
	description: 'activities',
	label: 'title',
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
	search: { text: ['title', 'kind'] },
	read: 'all',
	create: {
		columns: { activities: ['order', 'owner', 'title', 'kind', 'due_on', 'done', 'notes'] }
	},
	update: {
		columns: { activities: ['title', 'kind', 'due_on', 'done', 'notes'] }
	}
});
