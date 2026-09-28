import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/work_rules.js';

const FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;
const HOURS_LIMIT = {
	key: { kind: 'text' },
	period: { kind: 'enum', values: ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] },
	max_hours: { kind: 'number' },
	unit: { kind: 'enum', values: ['WORKED_HOURS', 'CLOCK_HOURS'] },
	when: { kind: 'text', optional: true },
	counts_day_when: { kind: 'text', optional: true },
	counts_beyond_normal_when: { kind: 'text', optional: true },
	authority: { kind: 'text', optional: true }
} as const;
// `ordinary_add`/`overtime_add` are a number or an expression (an untagged union): `json`, checked below.
const f = customField({
	description:
		'One version’s work rules: proration, the ordinary-rate divisor and overtime eligibility as expressions over the person, the ordered bands that price a day (and the limits above which planned OT is recorded as incentive hours), the limits schedules must respect (hours, and the consecutive-work-days rest rule), the breaks the law owes, the minimum wage by region, the night premium and holiday/rest precedence.',
	shape: {
		kind: 'object',
		fields: {
			proration: { kind: 'custom', of: 'proration_basis' },
			proration_by: {
				kind: 'list',
				optional: true,
				of: {
					kind: 'object',
					fields: { when: { kind: 'text' }, basis: { kind: 'custom', of: 'proration_basis' } }
				}
			},
			proration_contractual: { kind: 'bool', optional: true },
			ordinary_divisor_days: { kind: 'text' },
			daily_month_days: { kind: 'text', optional: true },
			ordinary_rate_reference: {
				kind: 'object',
				optional: true,
				fields: {
					reference: { kind: 'enum', values: ['PREVIOUS_WAGE_PERIOD', 'LATEST_DUE_MONTH'] },
					pay_frequencies: { kind: 'list', of: { kind: 'enum', values: FREQUENCIES }, min: 1 },
					daily_divisor: { kind: 'number', min: 1, optional: true },
					authority: { kind: 'text' }
				}
			},
			encashment: {
				kind: 'object',
				optional: true,
				fields: {
					reference: {
						kind: 'enum',
						values: ['EVENT_DATE', 'PREVIOUS_MONTH', 'PREVIOUS_DAY_OR_MONTH']
					},
					day_amount: { kind: 'text' },
					pay_frequencies: { kind: 'list', of: { kind: 'enum', values: FREQUENCIES }, min: 1 },
					include_allowances: { kind: 'list', of: { kind: 'text' } },
					exclude_allowances: { kind: 'list', of: { kind: 'text' } },
					preserve_year_end_rate: { kind: 'bool' },
					required_facts: { kind: 'list', of: { kind: 'text' }, optional: true },
					authority: { kind: 'text' }
				}
			},
			gross_excluded_allowances: { kind: 'list', of: { kind: 'text' }, optional: true },
			overtime_when: { kind: 'text' },
			normal_hours: { kind: 'text', optional: true },
			rate_week_hours: { kind: 'number', optional: true },
			part_time_week_hours_below: { kind: 'number', min: 1, optional: true },
			part_time_comparator_when: { kind: 'text', optional: true },
			bands: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						label: { kind: 'text' },
						when: { kind: 'text' },
						take_hours: { kind: 'text' },
						price_amount: { kind: 'text' },
						funnel_above_hours: { kind: 'text', optional: true }
					}
				}
			},
			limits: {
				kind: 'list',
				of: {
					kind: 'union',
					by: 'measure',
					arms: {
						TOTAL_WORK_HOURS: HOURS_LIMIT,
						OVERTIME_HOURS: HOURS_LIMIT,
						ALL_OVERTIME_HOURS: HOURS_LIMIT,
						NORMAL_HOURS: HOURS_LIMIT,
						SPREAD_HOURS: HOURS_LIMIT,
						CONSECUTIVE_WORK_DAYS: {
							key: { kind: 'text' },
							max_days: { kind: 'int', min: 1 },
							discharged_by: { kind: 'enum', values: ['REST', 'REST_OR_OFF'] },
							suspended_by_leave: { kind: 'list', of: { kind: 'text' }, optional: true },
							average: {
								kind: 'object',
								optional: true,
								fields: {
									days: { kind: 'int', min: 1 },
									rest_days: { kind: 'int', min: 1 },
									when: { kind: 'text', optional: true }
								}
							},
							when: { kind: 'text', optional: true },
							authority: { kind: 'text', optional: true }
						}
					}
				}
			},
			breaks: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: { kind: 'text' },
						owed_minutes: { kind: 'text' },
						counts_as_worked_time: { kind: 'bool', optional: true }
					}
				}
			},
			wages: { kind: 'custom', of: 'wages' },
			authority: { kind: 'text', optional: true },
			night_premium: {
				kind: 'object',
				optional: true,
				fields: {
					from: { kind: 'text' },
					to: { kind: 'text' },
					ordinary_add: { kind: 'json' },
					overtime_add: { kind: 'json' }
				}
			},
			time_off_in_lieu: {
				kind: 'object',
				optional: true,
				fields: {
					leave_code: { kind: 'text' },
					year_leave_code: { kind: 'text' },
					expiry_months: { kind: 'text' },
					authority: { kind: 'text' }
				}
			},
			holiday_rest_precedence: {
				kind: 'enum',
				values: ['PUBLIC_HOLIDAY', 'REST_DAY', 'SUBSTITUTE']
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
