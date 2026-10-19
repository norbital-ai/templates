import { model } from '@norbital-ai/bolt';
export default model({
	description: 'activities',
	label: 'title',
	fields: {
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
			default: {
				today: ''
			}
		},
		done: {
			kind: 'bool',
			default: false
		},
		notes: {
			kind: 'text',
			optional: true
		}
	}
});
