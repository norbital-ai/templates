import {
	boolean,
	custom,
	defineModel,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The leave type, from the catalogue; its bands and opt-ins price what the entry produces. */
		catalogue_id: uuid().notNull(),
		/** Stable leave identity, resolved from the catalogue and retained across its revisions. */
		leave_code: text().notNull(),
		reference: text().notNull(),
		certificate_file: file(),
		/** Approval evidence; callers cannot supply quantities or substitute calendar inputs. */
		charges: custom('leave_charges').notNull(),
		allocations: custom('leave_allocations').notNull(),
		/**
		 * The reversal marker: `true` means this entry reverses the entry named by `reversal_of_id`.
		 *
		 * A reversal carries no entered money. It negates the paid outputs of its source exactly.
		 */
		as_adjustment_entry: boolean().notNull().default(false),
		/** Time off: the range start. Encashment and adjustment: the valuation day. */
		from_date: instant({ precision: 'day' }),
		/** Time off: the range end. Encashment: the source window end. */
		to_date: instant({ precision: 'day' }),
		/** Time off: the start half is the second. */
		half_day_start: boolean(),
		/** Time off: the end half is the first. */
		half_day_end: boolean(),
		/**
		 * Time off: the chargeable total approval computed from the range. Encashment: mirrors
		 * `encash_days`. Adjustment: signed and non-zero — positive credits, negative debits.
		 * Reversal: the days of the source entry, nullable.
		 */
		days: numeric(),
		/**
		 * The days an encashment entry converts to money; null on every other activity. The engine
		 * prices them at the ordinary day wage as `ENCASHMENT`.
		 */
		encash_days: numeric(),
		/** The approved entry this reversal cancels; unique, so a source reverses once. */
		reversal_of_id: uuid(),
		/** The day the activity is valued on. */
		effective_on: instant({ precision: 'day' }),
		/** The day a monetary entry is due; null when nothing is owed. */
		due_on: instant({ precision: 'day' }),
		/** Carry-forward: the window the days land in. */
		destination_from: instant({ precision: 'day' }),
		destination_to: instant({ precision: 'day' }),
		/** Carry-forward: the first day the carried days are spendable. */
		available_from: instant({ precision: 'day' }),
		/** Carry-forward: the last day they remain valid. */
		expires_on: instant({ precision: 'day' }),
		reason: text(),
		/** The activity and the day it turns on, composed by the planner; the ledger's record label. */
		summary: text({ search: true }),
		/**
		 * The payslip that settled this row. Set by the payroll engine when a run captures the row,
		 * cleared when the draft run is deleted; while set, the row is frozen.
		 */
		payslip_id: uuid()
	},
	{
		description:
			'An approved manual Leave activity: time off with dated charges, an encashment, a carry-forward, a signed adjustment, or a reversal that negates its source. Entitlement is computed; approval never creates a second usage movement. Payroll links the entry that settled it through `payslip_id`.',
		recordLabel: 'summary',
		icon: 'lucide:calendar-days',
		indexes: [
			{ columns: ['employment_id', 'leave_code', 'effective_on'] },
			{ columns: ['employment_id', 'reference'], unique: true },
			{ columns: ['reversal_of_id'], unique: true },
			{ columns: ['payslip_id'] }
		]
	}
);
