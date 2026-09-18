import { custom, defineModel, enums, instant, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One person-day: what was PLANNED for it, and what ACTUALLY happened on it.
 *
 * `roster_entries` and `time_entries` were one row keyed the same way - an employment and a calendar
 * day - held in two tables, and every question worth asking needed both. Schedule variance, premium
 * work and overtime are all "the actual against the plan", so the overtime engine joined the two on
 * `(employment_id, work_date)` for every day of every run. That join is gone: the row is the join.
 *
 * ## Both sides are optional, and their absence means something
 *
 *   planned present, actual absent   - assume the scheduled hours without overtime
 *   actual present, planned absent   - an unrostered day somebody worked (call-back, ad hoc)
 *   both present                     - the ordinary case, and the one overtime is derived from
 *
 * The planned side is present when `shift_definition_id` is set: every explicit assignment names a
 * roster code, and that code is the polymorphic entity - WORK owns its clock window and break while
 * REST and OFF carry no meaningless time fields, so the day cannot drift into contradictory shapes.
 * The actual side is present when `worked_intervals` is non-NULL; an empty array is different, and
 * explicitly records AWOL.
 *
 * There is no `PUBLIC_HOLIDAY` roster code and no link to a holiday row. A holiday is a property
 * of the entity's calendar, overlaid on the date when the day is read; a payroll run snapshots the
 * calendar it priced against.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		work_date: instant({ precision: 'day' }).notNull(),
		/** The plan: a shift window, OFF or REST. Null is a day with no plan. */
		shift_definition_id: uuid(),
		/** The attendance: what was actually worked. Null is no punch; `[]` is a day read and found empty. */
		worked_intervals: custom('instant_range', { multiple: true }),
		/** Who asked for rest-day work, where the statute prices the two differently (SG s.37(2)/(3)); null is the employer. */
		requested_by: enums(['EMPLOYER', 'EMPLOYEE']),
		/** Set once a payslip has taken the day into account: the day is sealed. */
		payslip_id: uuid()
	},
	{
		description:
			'One person-day: the planned shift and the actual attendance side by side. Either may be absent. Holidays are overlaid from the entity’s published calendar by date, breaks are the gaps between the day’s intervals, and premium work and overtime are derived from plan, attendance, calendar and the statutory rules in force.',
		recordLabel: 'work_date',
		icon: 'lucide:calendar-clock',
		indexes: [
			/**
			 * One row per person-day, which is what this collection means.
			 *
			 * `roster_entries` already stated this. `time_entries` did not, so a day could carry two
			 * attendance rows; `worked_intervals` is already a list, so the second row was never
			 * needed and a day holding two of them had no defined plan to measure against.
			 */
			{ columns: ['employment_id', 'work_date'], unique: true },
			{ columns: ['work_date'] }
		]
	}
);
