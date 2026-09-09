import {
	custom,
	defineModel,
	enums,
	instant,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

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
 * There is no `PUBLIC_HOLIDAY` roster code. A holiday is a property of the calendar, not of one
 * person's day. The write captures its published jurisdiction calendar as immutable input evidence.
 * Subsequent publications preserve dates already linked to workdays or consumed by payroll.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		work_date: instant({ precision: 'day' }).notNull(),

		// ── planned ──────────────────────────────────────────────────────────────────────────────
		/** The assigned roster code (WORK, REST or OFF). NULL means the day carries no plan. */
		shift_definition_id: uuid(),
		/**
		 * The roster token shown to the operator in the source schedule, for example `AMRES` or
		 * `OFF/S`. Provenance only; schedule meaning always comes from the referenced roster code.
		 */
		assignment_code: text(),
		/**
		 * Where the plan came from. `IMPORT` lands from a workbook, and `MANUAL` is written on the
		 * board (an ad hoc assignment, planned overtime or a swap). A plan's meaning never depends
		 * on this — it is provenance and a board filter, nothing more.
		 */
		planned_origin: enums(['IMPORT', 'MANUAL']),
		/**
		 * A free-text reason for an ad hoc change, for example "swap with 03 Aug" or
		 * "call-back for stocktake". Purely explanatory; the schedule always comes from the code.
		 */
		planned_note: text(),

		// ── actual ───────────────────────────────────────────────────────────────────────────────
		/**
		 * The worked intervals. NULL means no attendance was recorded for this day at all; an empty
		 * array explicitly records AWOL. With NULL, payroll assumes the scheduled hours without overtime.
		 */
		worked_intervals: custom('instant_range', { multiple: true }),
		/**
		 * The unpaid break, in whole minutes.
		 *
		 * Minutes are the stored unit because they are exact - every break a rota actually uses is a
		 * whole number of them, and the overtime engine, the payroll export and the customer's
		 * workbook all measure in them. The operator enters and reads hours; that is presentation,
		 * and it never reinterprets what is stored.
		 */
		break_minutes: integer().notNull().default(0),
		/**
		 * The published holiday this day was classified as, pinned at the first write and kept while
		 * the date stands; null is a day that was no holiday when written. Payroll reads the pin back
		 * so a later publication or edit cannot retroactively change what this day was.
		 */
		holiday_id: uuid(),
		/**
		 * The payslip that settled this row, and the period it belongs to. Set by the payroll engine
		 * when a run captures the row, cleared when a draft run is deleted; while set, the row is
		 * frozen. The period is written beside the id so a refusal or a badge can name it without a
		 * `payroll_runs` read grant.
		 */
		settled_payslip_id: uuid(),
		settled_period: text()
	},
	{
		description:
			'One person-day, carrying the planned assignment and the actual attendance side by side. Either side may be absent. Schedule variance, premium work and overtime are derived from the two together with the jurisdiction calendar and the effective statutory rules.',
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
