import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One leave definition: eligibility, computed entitlement, whether a day is unpaid, whether it may be encashed and the evidence it demands. Manual entries decide carry-forward and encashment.',
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
			default: ''
		},
		evidence: {
			kind: 'enum',
			values: ['NONE', 'OPTIONAL', 'REQUIRED'],
			default: 'NONE'
		},
		unit: {
			kind: 'enum',
			values: ['DAY', 'HOUR'],
			default: 'DAY'
		},
		can_encash: {
			kind: 'bool',
			default: true
		},
		encash_on_exit: {
			kind: 'bool',
			default: false
		},
		entitlement: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					unit: { kind: 'text', optional: true },
					days: {
						kind: 'text',
						optional: true,
						help: 'CEL entitlement in days over `service_months`, `bands`, `as_of`, the subject roots and `taken`; absent means the class is not metered.'
					},
					window: {
						kind: 'enum',
						values: ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT'],
						optional: true,
						help: 'The span the balance is metered over; absent means LIFETIME. EVENT meters each entry.facts.event_id (or window_key) on its own.'
					},
					window_key: {
						kind: 'text',
						optional: true,
						help: 'CEL over `entry` (the movement’s columns and facts) naming the EVENT window a movement counts in, e.g. `entry.facts.child_id`; absent means entry.facts.event_id.'
					},
					carry_forward: {
						kind: 'text',
						optional: true,
						help: 'CEL on the previous window: the most unused days carried into the next CALENDAR_YEAR or SERVICE_YEAR window; absent carries nothing.'
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
		},
		is_npl: {
			kind: 'bool',
			default: false
		},
		preceding_leave_same_event: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			},
			default: []
		},
		preceding_leave_contiguous: {
			kind: 'bool',
			default: false
		},
		requires_no_pay_origin: {
			kind: 'bool',
			default: false
		},
		pay_fraction: {
			kind: 'text',
			default: ''
		},
		paid_by: {
			kind: 'enum',
			values: ['EMPLOYER', 'FUND'],
			default: 'EMPLOYER'
		},
		evidence_after_days: {
			kind: 'int',
			min: 0,
			optional: true
		},
		consumes_code: {
			kind: 'text',
			optional: true
		}
	}
});
