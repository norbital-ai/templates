import { custom, defineModel, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		company_id: uuid().notNull(),
		employee_number: text({ search: true }).notNull(),
		bank: custom('bank_account'),
		/**
		 * The stint itself: start is the first day of service, end the last day of work.
		 * Departure closes the range; a rehire is a new contract, never a reopened one.
		 */
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/** Free-text departure note, kept as the contract's comments; the only field that stays writable after the range closes. */
		comments: text()
	},
	{
		description:
			'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it; departure closes its range once. Rehires create new contracts.',
		recordLabel: 'employee_number',
		icon: 'lucide:briefcase',
		// One person holds at most one contract per entity on any date; the stint, not a hire
		// date, is the identity. Sequential rehires with one employee number are distinct rows.
		// Employee numbers are likewise unique per entity on any date: a duplicate number for a
		// different person on an overlapping stint is refused (kiosk double-enrollment included).
		exclusions: [
			{
				name: 'employments_no_overlap',
				elements: [
					{ expr: 'company_id', with: '=' },
					{ expr: 'employee_id', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(effective_range - 'end')), upper(bolt_daterange(effective_range - 'start')), '[]')",
						with: '&&'
					}
				]
			},
			{
				name: 'employments_number_no_overlap',
				elements: [
					{ expr: 'company_id', with: '=' },
					{ expr: 'employee_number', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(effective_range - 'end')), upper(bolt_daterange(effective_range - 'start')), '[]')",
						with: '&&'
					}
				]
			}
		]
	}
);
