import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A dated revision of an entity’s declared jurisdiction facts; a fact whose declaration demands evidence carries it as `fact_evidence` on the revision. The revision in force on a calculation date governs historical valuation; the company row itself stays the current record.',
	icon: 'lucide:history',
	label: 'effective_range',
	fields: {
		/** The entity facts in force from the range's start; `{}` when none (set by the transform). */
		facts: { kind: 'custom', of: 'entity_facts' },
		effective_range: { kind: 'period', of: 'date' }
	},
	// two revisions of one entity never claim one day
	noOverlap: [{ key: ['company_id'], period: 'effective_range', name: 'company_facts_no_overlap' }]
});
