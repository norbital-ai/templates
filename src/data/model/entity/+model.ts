import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'An employing entity bound to one jurisdiction settings lineage: its attendance cutoff, pay frequency and risk class. Headcount is derived from active employment contracts, never stored.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
		settings_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		registration_number: {
			kind: 'text',
			optional: true
		},
		pay_cutoff_day: {
			kind: 'int',
			min: 1,
			max: 28,
			help: 'The day attendance closes: 1 attends the calendar month; 2–28 attend from the previous month’s cutoff through the day before this one.'
		},
		late_arrival_grace_minutes: {
			kind: 'int',
			min: 0,
			default: 15
		},
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY', 'DAILY'],
			default: 'MONTHLY',
			help: 'The frequency the entity pays at from its start; a later switch is a `pay_frequency_changes` row.'
		},
		pay_frequency_changes: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						from: { kind: 'date' },
						frequency: {
							kind: 'enum',
							values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY', 'DAILY']
						}
					}
				}
			},
			default: [],
			help: 'Each switch of pay frequency, from its first day: a past period always reads the frequency then in force.'
		},
		risk_class: {
			kind: 'text',
			optional: true
		},
		region: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {},
			help: "The entity facts the jurisdiction's entity input schema declares."
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		time_zone: {
			kind: 'text',
			optional: true,
			help: "The zone this entity's payroll windows and rostered days are counted in."
		},
		disbursement_account: {
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
		}
	}
});
