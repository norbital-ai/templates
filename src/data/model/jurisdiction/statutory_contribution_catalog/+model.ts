import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One statutory_contribution_catalog record.',
	icon: 'lucide:file-text',
	label: 'settings_id',
	fields: {
		settings_id: { kind: 'text', optional: true },
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		rules: { kind: 'text', optional: true }
	}
});
