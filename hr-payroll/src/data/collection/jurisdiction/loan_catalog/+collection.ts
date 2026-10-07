import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'destination',
	'direction',
	'bands',
	'loan_type',
	'minimum_repayment',
	'approval_reference_required',
	'order_recovery_rule',
	'order_payment_when',
	'order_authority',
	'eligibility',
	'evidence',
	'settings_id'
] as const;
const update_columns = [
	'code',
	'name',
	'destination',
	'direction',
	'bands',
	'loan_type',
	'minimum_repayment',
	'approval_reference_required',
	'order_recovery_rule',
	'order_payment_when',
	'order_authority',
	'eligibility',
	'evidence'
] as const;

export default collection('loan_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
