import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One work_catalog record.',
	icon: 'lucide:file-text',
	label: 'code',
	fields: {
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		rules: { kind: 'text', optional: true }
	}
});
