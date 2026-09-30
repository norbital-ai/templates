import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A statutory benefit application of one leave code and its dated event. The case type the lineage declares (`payroll.benefit_cases`) names its facts; the actual award is evidenced here, and employee payments and scheme refunds are separate movements.',
	icon: 'lucide:file-heart',
	label: 'case_reference',
	fields: {
		/** The leave catalogue code whose case type governs this case. */
		case_type: { kind: 'text' },
		case_reference: { kind: 'text' },
		application_on: { kind: 'date' },
		/** An expected event lets the case and its advance clock exist before the event itself. */
		expected_event_on: { kind: 'date', optional: true },
		/** The actual event; kind and day are recorded together. */
		event_kind: { kind: 'text', optional: true },
		event_on: { kind: 'date', optional: true },
		/** The planned continuous leave span, not a substitute for approved cutoff-split leave entries. */
		leave_from: { kind: 'date', optional: true },
		leave_through: { kind: 'date', optional: true },
		/** The case type's declared facts; their files are `fact_evidence` rows. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		notified_on: { kind: 'date', optional: true },
		notification_reference: { kind: 'text', optional: true },
		/** The scheme's actual determination, which may differ from the local candidate calculation. */
		award_amount: { kind: 'decimal', scale: 2, optional: true },
		awarded_on: { kind: 'date', optional: true },
		award_reference: { kind: 'text', optional: true },
		award_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [
		{ fields: ['employee_id', 'case_reference'] },
		{ fields: ['employee_id', 'case_type', 'event_kind', 'event_on'] }
	],
	index: [
		['employee_id', 'event_on'],
		['employment_id', 'application_on']
	],
	search: { text: ['case_reference', 'award_reference'] }
});
