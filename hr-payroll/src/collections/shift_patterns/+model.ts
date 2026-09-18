import { custom, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A named shift pattern: the base every employment on it projects its days from.
 *
 * The pattern used to be embedded in each `employment_terms` row, so "2 mornings, 2 nights" was
 * repeated on every contract that followed it and had no name a roster could cite. It is one row
 * per jurisdiction lineage now, and the terms point at it: the board, the employee's calendar and
 * payroll all read the same day cycle through `employment_terms.shift_pattern_id`. A `work_days`
 * row is an override of what this row projects; a day with no row is the base, worked to plan.
 *
 * The value is a `work_pattern`: a repeating day cycle of roster codes from an anchor date, or a
 * declared week ("Rostered 6 days") that projects nothing and leaves the roster rows as the
 * schedule. The days a week a contract works are read from here — a cycle's WORK days, or the
 * declaration's figure — so a terms row carries no figure of its own.
 */
export default defineModel(
	{
		/** The entity the pattern belongs to, like its holidays. */
		company_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		pattern: custom('work_pattern').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A named shift pattern of one legal entity: the repeating day cycle of roster codes, or the declared week (days and paid minutes), that employment terms point at. The days a week a contract works are the pattern’s; a cycle projects every day an employment has no roster row for.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:repeat',
		indexes: [{ columns: ['company_id', 'code'], unique: true }]
	}
);
