import { collection } from '@norbital-ai/bolt';
export default collection('activities', {
	read: {
		fields: 'all'
	},
	create: {
		input: {
			columns: ['order', 'owner', 'title', 'kind', 'due_on', 'done', 'notes']
		}
	},
	update: {
		input: {
			columns: ['title', 'kind', 'due_on', 'done', 'notes']
		}
	}
});
