import { custom, defineModel, enums, integer, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/** A loan recovery is always a payroll deduction (`lib/payroll/loan.ts`); the row captures only what varies. */
export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The one label of a pay item. Code and description are the same field; nothing else names it. */
		code: text({ search: true }).notNull(),
		/**
		 * How each statutory scheme, by code, charges this recovery. A scheme the map does not name
		 * is undecided and the run refuses at ACCUMULATE naming the component and the scheme.
		 */
		contribution_treatments: custom('contribution_treatments').notNull(),
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
		/** Where the recovery sits in the reduction order, across every catalogue at once. */
		sequence: integer().notNull(),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default('')
	},
	{
		description:
			'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the treatment every statutory scheme gives them and who may borrow. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
