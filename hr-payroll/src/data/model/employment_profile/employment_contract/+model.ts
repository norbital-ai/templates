import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it; departure closes its range once. Rehires create new contracts.',
	icon: 'lucide:briefcase',
	label: 'employee_number',
	fields: {
		employee_number: {
			kind: 'text'
		},
		contract_number: {
			kind: 'seq',
			per: ['employee_id', 'company_id']
		},
		bank: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					bank_name: {
						kind: 'text'
					},
					bank_code: {
						kind: 'text'
					},
					bank_account_number: {
						kind: 'text'
					},
					bank_account_name: {
						kind: 'text'
					}
				}
			},
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		signed_contract_end: {
			kind: 'date',
			optional: true
		},
		prior_service_months: {
			kind: 'int',
			min: 0,
			optional: true
		},
		exit_ground: {
			kind: 'text',
			optional: true
		},
		exit_facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true
		},
		comments: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json'
		}
	}
});
