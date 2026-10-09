import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into and who may borrow. Sealed with its version; the run cites the version it priced against.',
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
		authority: {
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
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'ALLOW']
								},
								amount: {
									kind: 'text',
									format: 'cel'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		}
	}
});
