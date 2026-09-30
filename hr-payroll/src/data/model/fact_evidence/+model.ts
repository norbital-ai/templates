import { model } from '@norbital-ai/bolt';

/**
 * The evidence of one declared fact on one subject. A declaration's `evidence` makes the value count
 * only once this row exists; it replaces every per-jurisdiction `*_reference` / `*_file` column.
 */
export default model({
	description:
		'The recorded evidence for one declared fact of one subject (an entity’s dated fact revision, contract terms, a person-day or a payment): the reference, the file, or both, as the governing settings version demands.',
	icon: 'lucide:file-check',
	label: 'fact_key',
	fields: {
		fact_key: { kind: 'text' },
		reference: { kind: 'text', optional: true },
		file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		received_on: { kind: 'date', optional: true }
	},
	search: { text: ['fact_key', 'reference'] }
});
