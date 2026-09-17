import {
	boolean,
	defineModel,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * A standing allowance a person is paid: Bob's $100 transport allowance, every period, from a day
 * until a day.
 *
 * The source, never the line. Every allowance recurs: it is a catalogue item, a monthly amount and
 * the window it is in force over, and each payroll run that touches the window materialises one
 * `allowance_entries` row under the payslip that priced it — the entry carries the proration and
 * the money. A bonus paid once is a window of one period. Nothing here is pinned: the entries are.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The allowance type, from the catalogue; its destination, bands and opt-ins price the line. */
		catalogue_id: uuid().notNull(),
		/** A positive monthly magnitude; a period that covers part of the month takes its share. */
		amount: numeric().notNull(),
		/** The first day the allowance is in force. */
		effective_from: instant({ precision: 'day' }).notNull(),
		/** The last day it is in force; null is open-ended. */
		effective_to: instant({ precision: 'day' }),
		/** Why it is paid: the decision, the agreement or the transaction it makes good. */
		reason: text().notNull().default(''),
		/** The receipt. Required when the catalogue row's `evidence` says so. */
		evidence_file: file(),
		/** Settle this one against the direction its catalogue declares, rather than with it. */
		as_adjustment_entry: boolean().notNull().default(false)
	},
	{
		description:
			'A standing allowance a person is paid every period between two days: the catalogue item, the monthly amount and the effective window. The payroll run materialises one allowance entry per period under the payslip that priced it.',
		recordLabel: ['amount'],
		icon: 'lucide:calendar-clock',
		indexes: [
			{ columns: ['catalogue_id'] },
			{ columns: ['employment_id'] },
			{ columns: ['effective_from'] }
		]
	}
);
