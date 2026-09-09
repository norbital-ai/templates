import { custom, defineModel, enums, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The one label of a pay item. Code and description are the same field; nothing else names it. */
		code: text({ search: true }).notNull(),
		/** Which way the line settles: adds to pay, takes from it, costs the employer alone, or is information only. */
		nature: enums([
			'EARNING',
			'NON_WAGE_PAYMENT',
			'DEDUCTION',
			'EMPLOYER_COST',
			'INFORMATION',
			'ABSENCE'
		]).notNull(),
		/**
		 * How each statutory scheme, by code, charges this component. A scheme the map does not name
		 * is undecided and the run refuses at ACCUMULATE naming the component and the scheme.
		 */
		contribution_treatments: custom('contribution_treatments').notNull(),
		/** Formula/dependency and deduction-reduction order, across every catalogue at once. */
		sequence: integer().notNull(),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		/** Whether a request against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/** Whether payroll pays the line or the company pays it directly and payroll only records it. */
		settlement: enums(['PAYROLL', 'COMPANY_DIRECT']).notNull().default('PAYROLL'),
		/** The entitlement matrix: the first band whose predicate holds is the ceiling per period; null is no ceiling. */
		cap: custom('entitlement_cap')
	},
	{
		description:
			'The claim catalogue of one jurisdiction settings version: code, nature, the treatment every statutory scheme gives it, eligibility, evidence, settlement route and the entitlement ceiling of the claim raised against it. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:receipt-text',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
