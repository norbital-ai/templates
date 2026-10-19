import { collection } from '@norbital-ai/bolt';
export default collection('contacts', {
	read: {
		fields: 'all'
	},
	create: {
		input: {
			columns: ['party', 'name', 'email', 'phone', 'job_title']
		}
	},
	update: {
		input: {
			columns: ['name', 'email', 'phone', 'job_title']
		}
	}
});
