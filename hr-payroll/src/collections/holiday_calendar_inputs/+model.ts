import { defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_code: text().notNull(),
		date: instant({ precision: 'day' }).notNull(),
		calendar_id: uuid().notNull(),
		// Historical consumer identifiers deliberately survive consumer deletion. These audit
		// links are writable many edges, not foreign keys or cascade ownership.
		work_day_id: uuid(),
		payroll_run_id: uuid(),
		leave_entry_id: uuid()
	},
	{
		description:
			'Immutable calendar evidence for dates linked to a workday or consumed by payroll, including non-holidays. Retained after its consumer is removed.',
		recordLabel: 'date',
		icon: 'lucide:calendar-check',
		indexes: [
			{ columns: ['jurisdiction_code', 'date'] },
			{ columns: ['work_day_id', 'jurisdiction_code', 'date'], unique: true },
			{ columns: ['payroll_run_id', 'jurisdiction_code', 'date'], unique: true },
			{ columns: ['leave_entry_id', 'jurisdiction_code', 'date'], unique: true }
		]
	}
);
