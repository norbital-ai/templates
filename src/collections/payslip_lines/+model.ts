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

export default defineModel(
	{
		payslip_id: uuid().notNull(),
		component: custom('payslip_line_component').notNull(),
		/** Indexed physical projections of the component union. */
		pay_component_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN component ? 'pay_component_id' THEN (component ->> 'pay_component_id')::uuid END`
		),
		component_entry_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN component ->> 'kind' IN ('COMPONENT_ENTRY_ONCE', 'COMPONENT_ENTRY_RECURRING') THEN (component ->> 'component_entry_id')::uuid END`
		),
		component_entry_usage: text().generatedAlwaysAs(
			sql`CASE WHEN component ->> 'kind' = 'COMPONENT_ENTRY_ONCE' THEN 'SINGLE_USE' WHEN component ->> 'kind' = 'COMPONENT_ENTRY_RECURRING' THEN 'RECURRING' END`
		),
		statutory_contribution_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN component ->> 'kind' IN ('STATUTORY_EMPLOYEE', 'STATUTORY_EMPLOYER') THEN (component ->> 'statutory_contribution_id')::uuid END`
		),
		repayment_agreement_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'agreement_id')::uuid END`
		),
		repayment_sequence: integer().generatedAlwaysAs(
			sql`CASE WHEN component ->> 'kind' = 'LOAN_INSTALMENT' THEN (component ->> 'sequence')::integer END`
		),
		bucket: enums([
			'EARNING',
			'ABSENCE',
			'DEDUCTION',
			'NON_WAGE_PAYMENT',
			'EMPLOYER_COST'
		]).notNull(),
		amount: numeric().notNull(),
		quantity: numeric(),
		rate: numeric(),
		sequence: integer().notNull()
	},
	{
		description:
			'One settled component on a payslip and the only junction table. Its strict union links directly to a configured pay component, an entered component event, a loan agreement instalment, unpaid leave requests, or a statutory scheme.',
		recordLabel: ['bucket', 'amount'],
		icon: 'lucide:list',
		indexes: [
			{ columns: ['payslip_id'] },
			{ columns: ['pay_component_id'] },
			{ columns: ['statutory_contribution_id'], where: '"statutory_contribution_id" IS NOT NULL' },
			{
				columns: ['component_entry_id', 'payslip_id'],
				unique: true,
				where: '"component_entry_id" IS NOT NULL'
			},
			{
				columns: ['component_entry_id'],
				unique: true,
				where: '"component_entry_usage" = \'SINGLE_USE\''
			},
			/**
			 * One line per instalment **per payslip**, not one globally.
			 *
			 * Global uniqueness said an instalment is consumed exactly once, and that was true only
			 * while a shortfall was copied into a fresh `component_entries` row for the next period.
			 * Nothing is copied now: an instalment the negative-net guard could only part-pay stays
			 * outstanding on its own agreement, and the next run recovers the remainder against the
			 * same sequence — which the global constraint refused outright.
			 *
			 * What has to remain impossible is deducting one instalment twice inside one payslip, and
			 * that is what this states. The cross-run ceiling is arithmetic instead of a constraint:
			 * `measureLoanInstalments` subtracts what earlier PAID runs took, so a settled instalment
			 * nets to zero and never reaches a line. That is a real trade — an invariant the database
			 * held is now one the engine holds — and the three tests in
			 * `loan-instalment-recovery.test.ts` named for it are what hold it.
			 */
			{
				// Named, because the change from the two-column form is a drop and an add. Drizzle tries
				// to resolve a same-shape index as a rename and asks an interactive question that a
				// `bolt sync` has nobody to answer — see the `HintsHandler` failure. A distinct name is
				// two unambiguous statements instead of one question.
				name: 'payslip_lines_instalment_per_payslip',
				columns: ['repayment_agreement_id', 'repayment_sequence', 'payslip_id'],
				unique: true,
				where: '"repayment_agreement_id" IS NOT NULL'
			}
		]
	}
);
