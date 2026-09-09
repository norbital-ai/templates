import { custom, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

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
