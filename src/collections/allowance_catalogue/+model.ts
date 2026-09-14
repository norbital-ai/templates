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

export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The catalogue's stable code, and the display name beside it (RFC 0001 §4). */
		code: text({ search: true }).notNull(),
		name: text({ search: true }),
		/**
		 * Where the line settles: `PAY` earns or reduces gross, `NET` pays or deducts outside it,
		 * `EMPLOYER` costs the employer alone, `DISPLAY` is printed without money.
		 */
		destination: enums(['PAY', 'NET', 'EMPLOYER', 'DISPLAY']).notNull(),
		/** `ADD` adds, `SUBTRACT` takes; null where destination is `EMPLOYER` or `DISPLAY`. */
		direction: enums(['ADD', 'SUBTRACT']),
		/** The ordered bands that price this catalogue's entries; see `datatypes/catalogue_band`. */
		bands: custom('catalogue_band')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		/** Whether a request against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/**
		 * Whether the allowance is a standing one: its entries carry a window and settle once per
		 * period it covers, and may be drawn on in more than one payroll. A one-off settles once.
		 */
		recurring: boolean().notNull().default(false),
		/** Whether a partial period reduces an entry by the days actually employed. */
		prorates: boolean().notNull().default(false),
		/** Day of the month a recurring instalment is incurred on; null leaves the window to decide. */
		on_day: integer()
	},
	{
		description:
			'The allowance catalogue of one jurisdiction settings version: code, destination and direction, the bands that price, cap and opt the allowance into statutory schemes, the evidence it demands and its recurrence facts. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:calendar-clock',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
