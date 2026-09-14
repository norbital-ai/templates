import { boolean, custom, defineModel, file, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A standing allowance a person is paid: Bob's $100 transport allowance, monthly.
 *
 * The only one of the five entry families that is not a single moment in time, and the whole
 * reason it needs a family of its own. The catalogue decides whether the allowance is recurring
 * (`recurring`), whether a partial period prorates it (`prorates`) and the day each recurring
 * instalment is incurred on (`on_day`); the entry states the amount and the window or day it
 * covers. An entry consumed in more than one period materialises as one entry per period.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The allowance type, from the catalogue; its destination, bands and opt-ins price the line. */
		catalogue_id: uuid().notNull(),
		/** A positive magnitude, paid whole in every period the recurrence covers. */
		amount: numeric().notNull(),
		/**
		 * Paid once on one stated day, or across a window. A one-off's day decides the run that
		 * settles it; there is no separate override column.
		 */
		recurrence: custom('allowance_recurrence').notNull(),
		/** The receipt. Required when the catalogue row's `evidence` says so. */
		evidence_file: file(),
		/** Settle this one against the direction its catalogue declares, rather than with it. */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * Set when the payroll engine materialised this row from a standing source for one period.
		 * A materialised row is one line of one payslip; deleting the draft deletes it, and the
		 * source becomes due again for a later run.
		 */
		derived_from_id: uuid(),
		/**
		 * The payslip that settled this row. Set by the payroll engine when a run captures the row,
		 * cleared when the draft run is deleted; while set, the row is frozen.
		 */
		payslip_id: uuid()
	},
	{
		description:
			'A standing allowance a person is paid, either once on one stated day or across a window. The catalogue row states whether it recurs, prorates and which day of the month it is incurred on.',
		recordLabel: ['amount'],
		icon: 'lucide:calendar-clock',
		indexes: [
			{ columns: ['catalogue_id'] },
			{ columns: ['employment_id'] },
			{ columns: ['payslip_id'] },
			{ columns: ['derived_from_id'] }
		]
	}
);
