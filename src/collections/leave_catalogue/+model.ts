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
 * One revision of a leave definition (RFC 0001 §4, §9).
 *
 * The shared catalogue spine: availability and entitlement are computed on demand, and
 * destination/direction say how a money line settles. An unpaid day is priced by the Work rules'
 * proration; which schemes it reduces and which charge an encashment is each scheme's own
 * declaration (RFC 0003). Leave adds its own facts: whether a day is paid and after how many days
 * evidence is owed.
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
		/**
		 * Where the line settles: `PAY` with `SUBTRACT` is the unpaid day that reduces gross,
		 * `PAY` with `ADD` the encashment that earns. The engine settles per entry as §9 states.
		 */
		destination: enums(['PAY', 'NET', 'EMPLOYER', 'DISPLAY']).notNull().default('PAY'),
		direction: enums(['ADD', 'SUBTRACT']),
		/** Whether an entry against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/** An unpaid day is deducted under this leave's code. */
		paid: boolean().notNull().default(true),
		/** From this many charged days a certificate is required and checked by the entry hook. */
		evidence_after_days: integer(),
		entitlement: custom('leave_entitlement').notNull()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, whether a day is paid and the evidence it demands. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
