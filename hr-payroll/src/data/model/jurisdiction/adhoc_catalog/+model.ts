import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them and the schemes each counts toward. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:hand-coins',
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
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			optional: true
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
		},
		raise_on_exit: {
			kind: 'bool',
			default: false,
			help: 'The final slip raises this class itself when its eligibility holds on the exit (termination benefit, severance, notice in lieu), priced by its bands on an empty entry of the exit day; an entry of the class HR makes instead wins. A moved or undone exit takes it back.'
		},
		payable_after_exit: {
			kind: 'bool',
			default: false,
			help: 'Entries of this class may fall after the employment ends (non-compete pay, instalments of a separation payment) and are paid on a payslip of their own period.'
		}
	}
});
