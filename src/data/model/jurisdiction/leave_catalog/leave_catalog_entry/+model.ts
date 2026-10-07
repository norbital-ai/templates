import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One leave movement for one employment: time off taken, encashment, carry forward or an adjustment under its leave class.',
	icon: 'lucide:calendar-off',
	label: 'occurred_on',
	fields: {
		reference: {
			kind: 'text',
			optional: true
		},
		occurred_on: {
			kind: 'date'
		},
		activity: {
			kind: 'enum',
			values: ['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL'],
			default: 'TIME_OFF'
		},
		days: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Days taken; 0.5 for a half day.'
		},
		from: {
			kind: 'date',
			optional: true,
			help: 'First day of the period this movement covers. The entry day is used when unset.'
		},
		to: {
			kind: 'date',
			optional: true
		},
		amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Cash for an encashment or an adjustment. Time off carries no amount.'
		},
		half_day_start: {
			kind: 'bool',
			optional: true,
			help: 'The first day is the second half of that day.'
		},
		half_day_end: {
			kind: 'bool',
			optional: true,
			help: 'The last day is the first half of that day.'
		},
		incurred_on: {
			kind: 'date',
			optional: true
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			optional: true,
			help: 'Anything this movement carries that the fields above do not name.'
		}
	}
});
