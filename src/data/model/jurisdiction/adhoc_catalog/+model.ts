import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them, the schemes each counts toward, the evidence a request demands and who raises one. Sealed with its version; the run cites the version it priced against.',
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
			optional: true
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
		raised_by: {
			kind: 'enum',
			values: ['MANUAL', 'SEPARATION', 'SCHEDULED'],
			default: 'MANUAL'
		},
		schedule: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					due: {
						kind: 'text'
					},
					raise_days_before: {
						kind: 'int',
						min: 0,
						optional: true
					},
					population: {
						kind: 'text',
						optional: true
					},
					duty: {
						kind: 'text'
					}
				}
			},
			optional: true
		}
	}
});
