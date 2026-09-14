import {
	custom,
	defineModel,
	enums,
	integer,
	numeric,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/** A loan recovery is always a payroll deduction (`lib/payroll/loan.ts`); the row captures only what varies. */
export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The catalogue's stable code, and the display name beside it (RFC 0001 §4). */
		code: text({ search: true }).notNull(),
		name: text({ search: true }),
		/** Recoveries are net deductions: they take from pay after statutory charges, never gross. */
		destination: enums(['PAY', 'NET', 'EMPLOYER', 'DISPLAY']).notNull().default('NET'),
		direction: enums(['ADD', 'SUBTRACT']).default('SUBTRACT'),
		/** The ordered bands that price this catalogue's entries; see `datatypes/catalogue_band`. */
		bands: custom('catalogue_band')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * What kind of debt this recovers, because they are not collected alike.
		 *
		 * `GOVERNMENT` is a statutory scheme's own advance — the borrower owes the state, not the
		 * employer — so it is not settled out of a final salary: the balance survives the contract
		 * and is collected by the authority. `FESTIVE` is a dated advance (a Hari Raya loan) and
		 * `STAFF` is the ordinary employer loan; both are ordinary payroll deductions.
		 */
		loan_type: enums(['STAFF', 'GOVERNMENT', 'FESTIVE']).notNull().default('STAFF'),
		/**
		 * The least a month may recover before the shortfall is the operator's problem rather than
		 * the engine's.
		 *
		 * The net-pay guard already trims a recovery it cannot take, and what it could not take
		 * stays outstanding on the repayment. That is correct arithmetic and a silent one: a scheme
		 * with a statutory minimum instalment is in breach the month it under-recovers, and nobody
		 * is told. Stated here, a month that recovers less than this raises a blocking run issue.
		 * Empty where the scheme sets no floor.
		 */
		minimum_repayment: numeric(),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		/** Whether a repayment against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE')
	},
	{
		description:
			'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into, the minimum instalment and who may borrow. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
