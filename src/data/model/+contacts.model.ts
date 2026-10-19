import { model } from '@norbital-ai/bolt';
export default model({
	description: 'contacts',
	label: 'name',
	fields: {
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
	}
});
