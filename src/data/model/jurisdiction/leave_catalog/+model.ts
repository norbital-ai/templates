import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One leave definition: eligibility, computed entitlement, whether a day is unpaid, and whether it may be encashed. Manual entries decide carry-forward and encashment.',
	icon: 'lucide:calendar-days',
	label: 'name',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		description: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR'],
			default: 'DAY',
			help: 'What a request charges: DAY the planned working days of its range (rest and off days and published holidays charge nothing), CALENDAR_DAY every day of it, HOUR the scheduled hours of its planned working days.'
		},
		can_encash: {
			kind: 'bool',
			help: 'Whether untaken days of the class may be paid out. Stated on every class: no default decides it.'
		},
		encash_on_exit: {
			kind: 'bool',
			default: false
		},
		encash_at_window_end: {
			kind: 'bool',
			default: false,
			help: 'On the last day of the class’s window (a calendar or service year), its untaken balance is encashed as on exit.'
		},
		entitlement: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					unit: { kind: 'text', optional: true },
					days: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL entitlement in days over `service_months`, `bands`, `as_of`, the subject roots and `taken`; absent means the class is not metered.'
					},
					window: {
						kind: 'enum',
						values: ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT', 'ROLLING'],
						optional: true,
						help: 'The span the balance is metered over; absent means LIFETIME. EVENT meters each entry.facts.event_id (or window_key) on its own; ROLLING the window_months ending on the day read.'
					},
					window_months: {
						kind: 'int',
						optional: true,
						help: 'ROLLING: the months the window reaches back from the day read (that day included).'
					},
					service_year_offset_months: {
						kind: 'int',
						optional: true,
						help: 'SERVICE_YEAR: months after the employment start the first service year begins.'
					},
					window_key: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL over `entry` (the movement’s columns and facts) naming the EVENT window a movement counts in, e.g. `entry.facts.child_id`; absent means entry.facts.event_id.'
					},
					carry_forward: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL on the previous window: the most unused days carried into the next CALENDAR_YEAR or SERVICE_YEAR window; absent carries nothing.'
					},
					carry_depth: {
						kind: 'int',
						optional: true,
						help: 'How many windows carried days may still be carried (absent: once).'
					},
					consumes_after_days: {
						kind: 'int',
						optional: true,
						help: 'With consumes_code: the first N units of the class (in the pool’s window) are its own; only those past N draw on the pool.'
					},
					hours_per_day: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'With consumes_code and a non-day unit: CEL over the subject, the units one pool day holds.'
					},
					bands: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								service_months: { kind: 'int' },
								days: { kind: 'int' }
							}
						},
						optional: true
					}
				}
			},
			optional: true
		},
		is_npl: {
			kind: 'bool',
			default: false
		},
		pay_fraction: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		share_by: {
			kind: 'enum',
			values: ['WORKING_DAYS', 'CALENDAR_DAYS'],
			default: 'WORKING_DAYS',
			help: 'How a leave row spanning pay periods is shared between them.'
		},
		consumes_code: {
			kind: 'text',
			optional: true
		}
	}
});
