import { defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		/** `YYYY-MM`. A roster is drafted and published one calendar month at a time. */
		month: text({ search: true }).notNull(),
		/**
		 * When the month was published. `null` is a draft: incomplete, unvalidated and freely
		 * editable. Setting it runs the statutory checks and freezes the month's entries, so the
		 * roster the payroll engine reads is one somebody signed off rather than one still in flux.
		 */
		published_at: instant()
	},
	{
		description:
			'One company-wide month of operational schedule. Patterned employments are projected automatically; entries record explicit overrides and assignments before validation and publication.',
		recordLabel: 'month',
		icon: 'lucide:calendar-check',
		indexes: [{ columns: ['company_id', 'month'], unique: true }]
	}
);
