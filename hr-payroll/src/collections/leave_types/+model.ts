import { custom, boolean, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		eligibility: custom('eligibility_rules').notNull(),
		aggregates_with: text(),
		encash_on_exit: boolean().notNull(),
		requires_certificate_after_days: integer(),
		accrual: custom('leave_accrual').notNull(),
		entitlement: custom('leave_entitlement').notNull(),
		payroll_effect: custom('leave_payroll_effect').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			"A company's kind of leave, including its statutory, organisation and employee entitlement matrix, accrual, carry, eligibility and payroll effect.",
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		// Plan 02 §7: company =, code =, effective range &&.
		exclusions: [
			{
				name: 'leave_types_no_overlap',
				elements: [
					{ expr: 'company_id', with: '=' },
					{ expr: 'code', with: '=' },
					{ expr: 'bolt_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
