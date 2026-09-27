import { model } from '@norbital-ai/bolt';

/**
 * A suspicion judgement against one assignment. The judgement and its basis are written once; a controller closes it
 * by saying what was concluded (`resolve`), and that sentence is the record.
 */
export default model({
	description:
		'An AI or authorized-human suspicion judgement against one job assignment, with immutable evidence basis and an explicit controller resolution.',
	icon: 'lucide:shield-alert',
	label: 'reason',
	fields: {
		/** `<origin>:<assignment>:<sha256(basis)>`, derived: one log per judged basis. */
		source_key: { kind: 'text', unique: true, hidden: true },
		origin: { kind: 'enum', values: ['automation', 'human'], default: 'human' },
		/** The facts the judgement was made on; a human judgement's is composed from its reason. */
		basis: { kind: 'text', optional: true },
		reason: { kind: 'text' },
		resolution: { kind: 'text', optional: true },
		resolved_at: { kind: 'instant', optional: true }
	},
	index: ['resolved_at'],
	search: { text: ['reason', 'resolution'] }
});
