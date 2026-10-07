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
			max: 31
		},
		late_arrival_grace_minutes: {
			kind: 'int',
			min: 0,
			default: 15
		},
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY'],
			default: 'MONTHLY'
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
