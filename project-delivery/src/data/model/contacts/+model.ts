import { model } from '@norbital-ai/bolt';

/** A person at a client company. */
export default model({
	description: 'A person working at a client company.',
	icon: 'lucide:user-round',
	label: 'full_name',
	fields: {
		full_name: { kind: 'text' },
		job_title: { kind: 'text', optional: true },
		email: { kind: 'text', optional: true },
		phone: { kind: 'text', optional: true },
		is_primary: { kind: 'bool', optional: true },
		notes: { kind: 'text', optional: true }
	}
});
