import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The bank name, bank code, account number and account holder name a salary payment is credited to.',
	shape: {
		kind: 'object',
		fields: {
			bank_name: { kind: 'text' },
			bank_code: { kind: 'text' },
			bank_account_number: { kind: 'text' },
			bank_account_name: { kind: 'text' }
		}
	}
});
export default f;
f.validate((account) =>
	Object.values(account).every((field) => field !== '' && field === field.trim())
		? undefined
		: 'Enter every bank account field, without surrounding spaces.'
);
