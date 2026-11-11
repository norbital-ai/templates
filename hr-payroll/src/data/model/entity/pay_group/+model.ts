import { tap } from '../../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';

export default model('pay_group', {
	description:
		'One payroll of a company: the people paid together on one schedule. A company with staff paid monthly and staff paid twice a month has two. Every contract names its group, and a payroll run is for one group.',
	icon: 'lucide:calendar-clock',
	label: 'name',
	search: { text: ['name'] },
	fields: {
		name: {
			kind: 'text',
			help: 'What HR calls this payroll, such as Monthly staff or Semi-monthly.'
		},
		payment_schedule: {
			kind: 'json',
			default: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_days: [25],
				pay_cutoff_day: 1
			},
			shape: {
				kind: 'union',
				by: 'frequency',
				arms: {
					MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					SEMI_MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					TEN_DAY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					INTEGER_MONTHS: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: {
							kind: 'list',
							min: 1,
							of: { kind: 'int', min: 1, max: 31 },
							help: 'The day each cycle part pays, in order; the last entry repeats. A day past the month end pays on the last day.'
						},
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 },
						month_interval: { kind: 'int', min: 1, max: 12 },
						anchor_date: { kind: 'date' }
					},
					WEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					BIWEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					DAILY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'list', of: { kind: 'int', min: 0, max: 6 } },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] }
					}
				}
			}
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'pay_groups' }
	},
	unique: [{ fields: ['entity_id', 'name'] }],
	read: 'all',
	create: { columns: { pay_group: ['name', 'payment_schedule', 'entity_id'] } },
	// a group stays with its company: its contracts and runs are that company's
	update: { columns: { pay_group: ['name', 'payment_schedule'] } },
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				'pay_group',
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'pay_group', changes);
		}
	}
});
