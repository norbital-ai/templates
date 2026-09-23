import {
	boolean,
	custom,
	defineModel,
	enums,
	instant,
	numeric,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One person-day: what was PLANNED for it, and what ACTUALLY happened on it.
 *
 * `roster_entries` and `time_entries` were one row keyed the same way - an employment and a calendar
 * day - held in two tables, and every question worth asking needed both. Schedule variance and
 * premium work are "the actual against the plan", so the engine joined the two on
 * `(employment_id, work_date)` for every day of every run. That join is gone: the row is the join.
 *
 * ## The sides are optional, and their absence means something
 *
 *   planned present, actual absent   - assume the scheduled hours
 *   actual present, planned absent   - an unrostered day somebody worked (call-back, ad hoc)
 *   both present                     - the ordinary case
 *
 * The planned side is present when `shift_definition_id` is set: every explicit assignment names a
 * roster code, and that code is the polymorphic entity - WORK owns its clock window and break while
 * REST and OFF carry no meaningless time fields, so the day cannot drift into contradictory shapes.
 * The actual side is present when `worked_intervals` is non-NULL; an empty array is different, and
 * explicitly records AWOL. The planned overtime is keyed on the day beside them: the punches
 * measure what happened, the plan authorises what is paid, and they are two different facts.
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
		/**
		 * The planned overtime within the statutory limits: hours after the shift, breaks included,
		 * in half-hour steps. Payroll prices it at the day type's overtime band; attendance only
		 * confirms the day was worked. Null is none.
		 *
		 * WRITE CONTRACT: a create or update keys it directly, beside `incentive_hours`. The
		 * transform refuses a write that leaves any day of the employment's ceiling periods — a later
		 * stored day included — with more approved overtime than the headroom its statutory limits
		 * leave (`overtimeHeadroom`); it never moves hours between the two columns. Only the import
		 * splits a stated total (`splitPlannedOvertime`) before it writes both.
		 */
		approved_overtime_hours: numeric(),
		/**
		 * The planned overtime beyond the statutory overtime limits (daily, weekly, monthly,
		 * quarterly or yearly), in half-hour steps. Keyed by hand beside the approved hours, or
		 * written by the import's split; no limit bounds it. Priced on the INCENTIVE line at the band
		 * and multiple its hours fall in. Null is none.
		 */
		incentive_hours: numeric(),
		/** Who asked for rest-day work, where the statute prices the two differently (SG s.37(2)/(3)); null is the employer. */
		requested_by: enums(['EMPLOYER', 'EMPLOYEE']),
		/**
		 * The day's extra hours were forced by a natural disaster, an accident or an emergency: the
		 * version's bands may price them apart (TW 勞基法 §24(1)(3): double, under §32(4)), and the
		 * hours ceilings do not count them. Null is an ordinary day.
		 */
		emergency_cause: boolean(),
		/**
		 * The worker elected time off in lieu of the day's overtime pay, where the version's bands
		 * honour an election (TW 勞基法 §32-1: hour for hour, cashed at the day's rate on expiry or
		 * exit). Null is paid overtime.
		 */
		time_off_in_lieu: boolean(),
		/** Set once a payslip has taken the day into account: the day is sealed. */
		payslip_id: uuid()
	},
	{
		description:
			'One person-day: the planned shift and the actual attendance side by side. Either may be absent. Holidays are overlaid from the entity’s published calendar by date, breaks are the gaps between the day’s intervals, premium work is derived from plan, attendance, calendar and the statutory rules in force, and overtime is planned on the day: the hours within the limits and the incentive hours beyond them.',
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
