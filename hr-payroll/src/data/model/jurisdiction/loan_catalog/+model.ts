import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into, the minimum instalment and who may borrow. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'],
			default: 'NET'
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			default: 'SUBTRACT',
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text'
						},
						amount: {
							kind: 'text'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								period: {
									kind: 'enum',
									values: ['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT']
								},
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'ALLOW']
								},
								amount: {
									kind: 'text'
								}
							}
						}
					}
				}
			}
		},
		loan_type: {
			kind: 'enum',
			values: ['STAFF', 'GOVERNMENT', 'FESTIVE'],
			default: 'STAFF'
		},
		minimum_repayment: {
			kind: 'decimal',
			scale: 2,
			optional: true
		},
		approval_reference_required: {
			kind: 'bool',
			optional: true
		},
		order_recovery_rule: {
			kind: 'text',
			optional: true
		},
		order_payment_when: {
			kind: 'text',
			optional: true
		},
		order_authority: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text',
			default: ''
		},
		evidence: {
			kind: 'enum',
			values: ['NONE', 'OPTIONAL', 'REQUIRED'],
			default: 'NONE'
		}
	}
});
