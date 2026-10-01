import { model } from '@norbital-ai/bolt';

/**
 * The evidence of one declared fact on one subject. A declaration's `evidence` makes the value count
 * only once this row exists; it replaces every per-jurisdiction `*_reference` / `*_file` column.
 */
export default model({
	description:
		'The recorded evidence for one declared fact of one subject (a fact revision, contract terms, a person-day, a payment, a worksite, a departure, a leave entry, a request, a registration, a history period or a duty): the reference, the file, or both, the document type and how long it counts, as the governing declaration demands.',
	icon: 'lucide:file-check',
	label: 'fact_key',
	fields: {
		fact_key: { kind: 'text' },
		reference: { kind: 'text', optional: true },
		file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		received_on: { kind: 'date', optional: true },
		/** A `DOCUMENT_TYPE` code: the one the declaration's evidence names, filled in from it. */
		document_type: { kind: 'text', optional: true },
		/** The last day the evidence counts: `received_on` + the declaration's `valid_days` − 1 unless stated. */
		expires_on: { kind: 'date', optional: true }
	},
	search: { text: ['fact_key', 'reference'] }
});
