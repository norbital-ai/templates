import {
	boolean,
	custom,
	defineModel,
	enums,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One revision of a leave definition.
 *
 * The shared catalogue spine: availability and entitlement are computed on demand. Leave carries
 * no pricing: an unpaid day is priced at the ordinary day wage as `NO_PAY_LEAVE`, and an encashed
 * day at the same rate as `ENCASHMENT`, by the engine. Which schemes read either is each scheme's
 * own `assessed_on` formula. Leave adds its own facts: whether a day is unpaid and after how many
 * days evidence is owed, and whether the row may be encashed at all.
 */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/** The section of law the row transcribes; a row that cites one is statutory and the drift automation watches it. */
		authority: text(),
		/**
		 * One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`), evaluated
		 * on the leave year's rule date. `''` is everyone. A row an employee is not eligible for
		 * has no computed entitlement while ineligible, and an unpaid day of it is not deducted.
		 */
		eligibility: text().notNull().default(''),
		/** Whether an entry against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/** An unpaid day is deducted at the ordinary day wage as `NO_PAY_LEAVE`. */
		is_npl: boolean().notNull().default(false),
		/**
		 * Whether the remaining balance of this row may be encashed. A statute that makes a row
		 * non-convertible says so here; an `is_npl` row is never encashable.
		 */
		can_encash: boolean().notNull().default(true),
		/** From this many charged days a certificate is required and checked by the entry transform. */
		evidence_after_days: integer(),
		entitlement: custom('leave_entitlement').notNull()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, whether a day is unpaid, whether it may be encashed and the evidence it demands. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
