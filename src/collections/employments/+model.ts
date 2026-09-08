import { custom, defineModel, enums, instant, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employee_id: uuid().notNull(),
		company_id: uuid().notNull(),
		employee_number: text({ search: true }).notNull(),
		hire_date: instant({ precision: 'day' }).notNull(),
		bank: custom('bank_account'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/**
		 * The actual end of the stint. Recorded once, after which the three departure columns are
		 * immutable; setting them never edits the signed contract terms or creates a payment.
		 */
		exit_date: instant({ precision: 'day' }),
		exit_reason: enums([
			'RESIGNATION',
			'END_OF_CONTRACT',
			'TERMINATION',
			'RETRENCHMENT',
			'MISCONDUCT',
			'RETIREMENT',
			'DEATH',
			'OTHER'
		]),
		exit_note: text(),
		/** Append-only child facts; what `children.under(age)` counts in leave eligibility. */
		children: custom('employee_children')
			.notNull()
			.default(sql`'[]'::jsonb`)
	},
	{
		description:
			'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it; departure is recorded once on the contract. Rehires create new contracts.',
		recordLabel: 'employee_number',
		icon: 'lucide:briefcase',
		indexes: [{ columns: ['company_id', 'employee_number', 'hire_date'], unique: true }]
	}
);
