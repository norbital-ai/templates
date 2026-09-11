import { custom, defineModel, text } from '@norbital-ai/bolt/authoring';

/**
 * A named shift pattern: the base every employment on it projects its days from.
 *
 * The pattern used to be embedded in each `employment_terms` row, so "2 mornings, 2 nights" was
 * repeated on every contract that followed it and had no name a roster could cite. It is one row
 * per jurisdiction lineage now, and the terms point at it: the board, the employee's calendar and
 * payroll all read the same day cycle through `employment_terms.shift_pattern_id`. A `work_days`
 * row is an override of what this row projects; a day with no row is the base, worked to plan.
 *
 * The value is the same `work_pattern` type the terms carried: PATTERNED repeats one or more day
 * cycles of roster codes from an anchor date, and ROSTERED states the expectation a company wants
 * named for people whose days are assigned roster by roster. Terms with no pattern at all are
 * rostered as assigned, with nothing to project and nothing to guarantee.
 */
export default defineModel(
	{
		settings_code: text({ search: true }).notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		pattern: custom('work_pattern').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A named shift pattern of one jurisdiction lineage: the repeating day cycle of roster codes (or the rostered expectation) that employment terms point at. Every day an employment has no roster row for is projected from its pattern.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:repeat',
		indexes: [{ columns: ['settings_code', 'code'], unique: true }]
	}
);
