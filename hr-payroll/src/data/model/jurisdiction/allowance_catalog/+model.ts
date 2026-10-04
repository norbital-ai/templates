import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One allowance_catalog record.',
	icon: 'lucide:file-text',
	label: 'code',
	fields: {
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		pricing: { kind: 'text', optional: true },
		eligibility: { kind: 'text', optional: true },
		schedule: { kind: 'text', optional: true }
	}
});
