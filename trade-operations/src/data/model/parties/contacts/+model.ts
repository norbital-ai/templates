import { model } from '../../../../../.norbital/models/contacts.ts';
export default model({
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
	create: { columns: { fields: ['party', 'name', 'email', 'phone', 'job_title'] } },
	update: { columns: { fields: ['name', 'email', 'phone', 'job_title'] } }
});
