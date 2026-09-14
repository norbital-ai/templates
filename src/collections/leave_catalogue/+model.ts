import {
	boolean,
	custom,
	defineModel,
	enums,
	integer,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One revision of a leave definition (RFC 0001 §4, §9).
 *
 * The shared catalogue spine: availability and entitlement are computed on demand, entries are
 * priced through `bands` over the entry context, and destination/direction say how a money line
 * settles. Leave adds its own facts: whether a day is paid, after how many days evidence is owed,
 * and the convertor that turns days and a rate into an encashment amount.
 */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		is_statutory: boolean().notNull().default(false),
		/** Required when `is_statutory`: the section of law the row transcribes. */
		authority: text(),
		/**
		 * One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`), evaluated
		 * on the leave year's rule date. `''` is everyone. A row an employee is not eligible for
		 * has no computed entitlement while ineligible, and an unpaid day of it is not deducted.
		 */
		eligibility: text().notNull().default(''),
		/** Formula/dependency and deduction-reduction order, across every catalogue at once. */
		sequence: integer().notNull(),
		/**
		 * Where the line settles: `PAY` with `SUBTRACT` is the unpaid day that reduces gross,
		 * `PAY` with `ADD` the encashment that earns. The engine settles per entry as §9 states.
		 */
		destination: enums(['PAY', 'NET', 'EMPLOYER', 'DISPLAY']).notNull().default('PAY'),
		direction: enums(['ADD', 'SUBTRACT']),
		/** The ordered bands that price this leave's entries; see `datatypes/catalogue_band`. */
		bands: custom('catalogue_band')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** Whether an entry against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/** An unpaid day is deducted under this leave's code. */
		paid: boolean().notNull().default(true),
		/** From this many charged days a certificate is required and checked by the entry hook. */
		evidence_after_days: integer(),
		/**
		 * CEL over the entry context turning days and a rate into an encashment amount; `''` uses
		 * the entered gross. Compiled at write time like every other expression.
		 */
		convertor: text().notNull().default(''),
		entitlement: custom('leave_entitlement').notNull()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, whether a day is paid, the evidence it demands, its encashment convertor and the bands that carry its statutory opt-ins. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
