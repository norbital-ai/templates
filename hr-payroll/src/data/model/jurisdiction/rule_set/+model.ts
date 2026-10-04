import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One rule_set record.',
	icon: 'lucide:file-text',
	label: 'settings_id',
	fields: {
		settings_id: { kind: 'text', optional: true },
		scope: { kind: 'text', optional: true },
		family: { kind: 'text', optional: true },
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		content_hash: { kind: 'text', optional: true },
		source_identity: { kind: 'text', optional: true },
		rules: { kind: 'text', optional: true }
	}
});
