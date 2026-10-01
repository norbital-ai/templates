import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it; departure closes its range once. Rehires create new contracts.',
	icon: 'lucide:briefcase',
	label: 'employee_number',
	fields: {
		employee_number: { kind: 'text' },
		/** The stint's rolling number for this person at this entity: 1 for the first contract, 2 for the rehire. */
		contract_number: { kind: 'seq', per: ['employee_id', 'company_id'] },
		bank: { kind: 'custom', of: 'bank_account', optional: true },
		/** The stint: first day of service to last day of work. A rehire is a new contract. */
		effective_range: { kind: 'period', of: 'date' },
		/** The signed fixed-term contract's last day; preserved when departure closes the stint early. */
		signed_contract_end: { kind: 'date', optional: true },
		/** Months worked for earlier employers before this stint; annual leave counts them (CN 企业职工带薪年休假实施办法 art.4). */
		prior_service_months: { kind: 'int', min: 0, optional: true },
		/**
		 * Why the stint ended: a `TERMINATION_GROUND` code (`reference_rows`) of the version governing the last
		 * working day (`employment.exit_ground`); every separation payment turns on it.
		 */
		exit_ground: { kind: 'text', optional: true },
		/** Jurisdiction-declared facts for this departure, governed by its last working day. */
		exit_facts: { kind: 'custom', of: 'entity_facts', optional: true },
		comments: { kind: 'text', optional: true },
		/** A deferred leave encashment on exit falls due on this day (written by `leave_encashment_on_exit`). */
		encashment_due_on: { kind: 'date', optional: true },
		/** Set when an automation raised the due encashment, so it is never raised twice. */
		encashment_raised_at: { kind: 'instant', optional: true }
	},
	index: [['encashment_due_on', 'encashment_raised_at']],
	noOverlap: [
		// one contract per person and entity on any date
		{
			key: ['company_id', 'employee_id'],
			period: 'effective_range',
			name: 'employments_no_overlap'
		},
		// an employee number names one person per entity on any date
		{
			key: ['company_id', 'employee_number'],
			period: 'effective_range',
			name: 'employments_number_no_overlap'
		}
	],
	search: { text: ['employee_number'] }
});
