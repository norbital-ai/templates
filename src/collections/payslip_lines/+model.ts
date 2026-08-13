import {
	custom,
	defineModel,
	enums,
	integer,
	numeric,
	sql,
	text,
	uuid
} from '@norbital-ai/pod/authoring';

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
			{
				columns: ['repayment_agreement_id', 'payslip_id', 'repayment_sequence'],
				unique: true,
				where: '"repayment_agreement_id" IS NOT NULL'
			}
		]
	}
);
