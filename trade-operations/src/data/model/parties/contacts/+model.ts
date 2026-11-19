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
		},
		// the contact on the party's Kingdee master, written only by its sync; it is listed first
		primary: { kind: 'bool', default: false }
	},
	outputs: { default: { fields: 'all', party: { fields: ['name'] } } },
	indexes: { search: { text: ['name', 'email', 'phone'] } },
	create: { fields: ['party', 'name', 'email', 'phone', 'job_title', 'primary'] },
	update: { fields: ['name', 'email', 'phone', 'job_title', 'primary'] },
	delete: {}
});
