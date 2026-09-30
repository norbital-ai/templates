import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A period of a person’s history outside this payroll: a prior employer’s year to date, insured or contribution periods, service, a prior contract. `kind` is a code the lineage declares in `history_kinds`, and `facts` are that kind’s declared facts. Opening pay is not here: it stays in `employment_wage_periods`.',
	icon: 'lucide:briefcase-business',
	label: 'summary',
	fields: {
		/** A `history_kinds` code of the person’s lineage. */
		kind: { kind: 'text' },
		effective_range: { kind: 'period', of: 'date' },
		/** The kind's declared facts; `{}` when none. `history.external(kind, window)` reads them. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		/** `<kind> · <from> – <to>`: derived by the transform. */
		summary: { kind: 'text' }
	},
	search: { text: ['summary'] }
});
