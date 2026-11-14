import { model } from '@norbital-ai/bolt';
export default model('contacts', {
	description: 'contacts',
	record_label: 'record.name',
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
	outputs: { default: { fields: 'all', party: { fields: ['name'] } } },
	indexes: { search: { text: ['name', 'email', 'phone'] } },
	create: { fields: ['party', 'name', 'email', 'phone', 'job_title'] },
	update: { fields: ['name', 'email', 'phone', 'job_title'] }
});
