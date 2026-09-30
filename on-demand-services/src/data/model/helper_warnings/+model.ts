import { model } from '@norbital-ai/bolt';

/** A warning letter: a helper missed a shift without a medical certificate. Append-only. */
export default model({
	description: 'A warning letter issued to a helper, with the visit it concerns.',
	icon: 'lucide:file-warning',
	label: 'reason',
	fields: {
		reason: { kind: 'enum', values: ['no_response', 'declined_without_mc'] },
		issued_at: { kind: 'instant' },
		letter: { kind: 'file', accept: ['application/pdf'], max: '2MiB', optional: true },
		notes: { kind: 'text', optional: true }
	},
	index: ['issued_at']
});
