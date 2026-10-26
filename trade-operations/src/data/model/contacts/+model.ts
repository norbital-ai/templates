import { model } from '@norbital-ai/bolt';
export default model('contacts', {
	description: 'contacts',
	label: 'name',
	fields: {
		party: { kind: 'ref', to: 'parties', inverse: 'contacts' },
		name: {
			kind: 'text'
		},
		email: {
			kind: 'text',
			format: 'email',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		job_title: {
			kind: 'text',
			optional: true
		}
	},
	read: 'all',
	create: {
		columns: ['party', 'name', 'email', 'phone', 'job_title']
	},
	update: {
		columns: ['name', 'email', 'phone', 'job_title']
	}
});
