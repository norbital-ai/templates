import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A person’s statutory registration or a declaration for one employment. An employment-specific row overrides the personal row for the same scheme and date. An absent row means registered with nothing captured.',
	icon: 'lucide:badge-check',
	label: 'summary',
	fields: {
		status: { kind: 'custom', of: 'statutory_fact_status' },
		effective_range: { kind: 'period', of: 'date' },
		/** `Registered · <ref>` or `Not registered · <reason>`, `· from <day>`: derived by the transform. */
		summary: { kind: 'text' }
	},
	// person, scheme and employment (null is the personal row, a value of its own): one standing a day
	noOverlap: [
		{
			key: ['employee_id', 'statutory_contribution_id', 'employment_id'],
			period: 'effective_range',
			name: 'employment_statutory_facts_no_overlap'
		}
	],
	search: { text: ['summary'] }
});
