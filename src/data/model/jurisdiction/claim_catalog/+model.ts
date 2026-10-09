import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The claim catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap a claim (with the schemes each opts into). Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:receipt-text',
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
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
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
									values: ['BLOCK', 'ALLOW'],
									help: 'BLOCK pays up to the limit, ALLOW pays all; either flags the excess on the run.'
								},
								amount: {
									kind: 'text',
									format: 'cel'
								},
								window: {
									kind: 'enum',
									values: ['ENTRY', 'PERIOD', 'CALENDAR_YEAR'],
									optional: true,
									help: 'What the limit meters: each claim alone (default), or the settlement period or calendar year less the claims of the class already taken in it.'
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
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			}
		}
	}
});
