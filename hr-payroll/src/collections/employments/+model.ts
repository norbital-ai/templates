import { custom, defineModel, enums, integer, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		company_id: uuid().notNull(),
		employee_number: text({ search: true }).notNull(),
		/**
		 * The stint's own rolling number for this person at this entity: 1 for the first contract,
		 * 2 for the rehire. Assigned by the transform, never typed, and frozen with the contract.
		 */
		contract_number: integer().notNull().default(1),
		bank: custom('bank_account'),
		/**
		 * The stint itself: start is the first day of service, end the last day of work.
		 * Departure closes the range; a rehire is a new contract, never a reopened one.
		 */
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/**
		 * Why the stint ended. Every separation payment the law owes turns on it:
		 * separation pay by cause, retirement pay, notice in lieu. Written with the departure and
		 * correctable after; `employment.exit_reason` is how a catalogue band reads it.
		 */
		exit_reason: enums([
			'RESIGNATION',
			'DISMISSAL',
			'REDUNDANCY',
			// The employer's termination for an authorised cause that is not redundancy: PH art.298
			// retrenchment, closure or disease (half a month per year); VN art.36 unilateral termination
			// (art.46 severance), where the enum's own word is UNILATERAL.
			'RETRENCHMENT',
			'UNILATERAL',
			'RETIREMENT',
			'END_OF_CONTRACT',
			'MUTUAL',
			'DEATH'
		]),
		/** Free-text departure note, kept as the contract's comments; writable after the range closes. */
		comments: text()
	},
	{
		description:
			'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it; departure closes its range once. Rehires create new contracts.',
		recordLabel: ['employee_number', 'contract_number'],
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
