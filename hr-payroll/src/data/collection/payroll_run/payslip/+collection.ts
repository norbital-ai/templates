import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'terms_through',
	'salary_from',
	'salary_to',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'status',
	'paid_at',
	'currency',
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'payroll_run_id',
	'employment_id'
] as const;
const update_columns = [
	'terms_through',
	'salary_from',
	'salary_to',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'status',
	'paid_at',
	'currency',
	'gross',
	'total_deductions',
	'net',
	'employer_cost'
] as const;

export default collection('payslip', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
