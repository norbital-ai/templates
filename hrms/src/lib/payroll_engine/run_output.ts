/**
 * The stint as the payroll run's named read (`output: 'run'`) declares it: the relations a run finds its stints by. A run
 * pays the stints of one pay group that are in its window, or that an unpaid claim, ad hoc entry, leave slot, loan
 * instalment or roster day was raised on. Every model the run reads through a stint declares this same layer, so the
 * whole run is one read.
 */
export const RUN_STINT = {
	fields: 'all',
	terms: { fields: ['pay_group_id'] },
	claim_catalog_entry: { fields: ['id', 'entity_id', 'payroll_run_id', 'incurred_on'] },
	adhoc_catalog_entry: { fields: ['id', 'entity_id', 'payroll_run_id', 'incurred_on'] },
	leave_catalog_entry: {
		fields: ['encashment'],
		leave_catalog_entry_day: { fields: ['payroll_run_id', 'incurred_on'] }
	},
	loan_catalog_entry_repayment: { fields: ['id', 'entity_id', 'payroll_run_id', 'paid_on'] },
	roster_entry: { fields: ['work_date'] }
} as const;
