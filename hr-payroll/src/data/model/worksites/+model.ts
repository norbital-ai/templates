import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A dated revision of one establishment of a company: its address, the locality it sits in and the facts its lineage declares in `worksite_facts` (an industry classification, a project). Contract terms and work days name a worksite; the revision of that code in force on a date governs it.',
	icon: 'lucide:map-pin',
	label: 'name',
	fields: {
		/** The company's own code for the establishment; every revision of one worksite shares it. */
		code: { kind: 'text' },
		name: { kind: 'text' },
		address: { kind: 'text', optional: true },
		/** The locality the establishment sits in, as the lineage's tables key it; `worksite.region`. */
		region: { kind: 'text', optional: true },
		/** The inputs the lineage declares in `worksite_facts`; `{}` when none (set by the transform). `worksite.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		effective_range: { kind: 'period', of: 'date' }
	},
	// two revisions of one worksite never claim one day
	noOverlap: [
		{ key: ['company_id', 'code'], period: 'effective_range', name: 'worksites_no_overlap' }
	]
});
