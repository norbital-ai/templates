import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A dated revision of a person’s declared facts: the keys the lineage declares in `person_facts` (a standing, a status, a declaration). A row naming an employment overrides the personal row, key by key, for that employment; the revision in force on a date governs it.',
	icon: 'lucide:user-round-check',
	label: 'summary',
	fields: {
		/** The declared person facts in force from the range's start; `{}` when none. `employee.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		effective_range: { kind: 'period', of: 'date' },
		/** Who recorded it: HR, the employee through self-service, or an import. */
		source: { kind: 'enum', values: ['HR', 'EMPLOYEE', 'IMPORT'], default: 'HR' },
		/** `<keys> · from <day>`: derived by the transform. */
		summary: { kind: 'text' }
	},
	// person and employment (null is the personal row, a value of its own): one revision a day
	noOverlap: [
		{
			key: ['employee_id', 'employment_id'],
			period: 'effective_range',
			name: 'person_facts_no_overlap'
		}
	],
	search: { text: ['summary'] }
});
