import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One roster record.',
	icon: 'lucide:file-text',
	label: 'period',
	fields: {
		period: { kind: 'text', optional: true }
	}
});
