import { custom, defineModel, enums, integer, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The catalogue's stable code, and the display name beside it. */
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
		 * Where this row's entries come from. ENTRY is a request somebody keyed;
		 * SCHEDULE is an occurrence the run materialises itself on the row's calendar, priced by
		 * the band over the year axis — a 13th month, a THR, an AWS nobody has to remember.
		 */
		source: enums(['ENTRY', 'SCHEDULE']).notNull().default('ENTRY'),
		schedule: custom('catalogue_schedule')
	},
	{
		description:
			'The payment catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap the payment, the evidence it demands, and whether its entries are keyed or fall due on a schedule the run materialises. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:wallet',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
