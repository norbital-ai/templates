import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A dated revision of an entity’s declared jurisdiction facts. The revision in force on a calculation date governs historical valuation; the company row itself stays the current record.',
	icon: 'lucide:history',
	label: 'company_id',
	fields: {
		/** The entity facts in force from the range's start; `{}` when none (set by the transform). */
		facts: { kind: 'custom', of: 'entity_facts' },
		effective_range: { kind: 'period', of: 'date' },
		/** PH single-establishment and worker-count evidence for reduced regional wage classes. */
		ph_wage_class_source_reference: { kind: 'text', optional: true },
		ph_wage_class_source_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	// two revisions of one entity never claim one day
	noOverlap: [{ key: ['company_id'], period: 'effective_range', name: 'company_facts_no_overlap' }]
});
