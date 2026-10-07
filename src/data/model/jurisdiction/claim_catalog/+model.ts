import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The claim catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap a claim (with the schemes each opts into) and the evidence it demands. Sealed with its version; the run cites the version it priced against.',
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
		eligibility: {
			kind: 'text',
			default: ''
		},
		qualifies_when: {
			kind: 'text',
			default: ''
		},
		evidence: {
			kind: 'enum',
			values: ['NONE', 'OPTIONAL', 'REQUIRED'],
			default: 'NONE'
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
		leave_code: {
			kind: 'text',
			optional: true
		},
		unit_cap: {
			kind: 'decimal',
			scale: 2,
			optional: true
		},
		claim_window_months: {
			kind: 'int',
			optional: true
		},
		employer_premium_scheme: {
			kind: 'text',
			optional: true
		},
		minimum_service_months: {
			kind: 'int',
			optional: true
		}
	}
});
