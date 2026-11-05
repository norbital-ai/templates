import { customField } from '@norbital-ai/bolt';

/** A bank account: the employer's paying account or an employee's receiving account. */
export default customField('bank', {
	description: 'A bank account used to pay or receive salary.',
	shape: {
		kind: 'object',
		fields: {
			bank_name: { kind: 'text' },
			bank_code: { kind: 'text' },
			bank_account_number: { kind: 'text' },
			bank_account_name: { kind: 'text' }
		}
	},
	validate: (value) =>
		value.bank_name.trim() === '' || value.bank_account_number.trim() === ''
			? 'A bank needs its name and account number.'
			: undefined
});
