import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/leave_entitlement.js';

// `lifetime_days` and a band's `days` are a number or an expression (an untagged union): `json`, checked below.
const f = customField({
	description:
		'Computed annual leave: an entitlement matrix of who and how many days, availability and proration. Carry-forward and encashment are manually approved entries.',
	shape: {
		kind: 'object',
		fields: {
			availability: {
				kind: 'enum',
				values: ['UPFRONT', 'MONTHLY', 'UNLIMITED', 'PER_EVENT', 'CREDITED']
			},
			year_start_month: { kind: 'int', min: 1, max: 12 },
			year_anchor: {
				kind: 'enum',
				values: ['CALENDAR', 'SERVICE_ANNIVERSARY'],
				optional: true
			},
			auto_carry_one_year: { kind: 'bool', optional: true },
			proration: {
				kind: 'enum',
				values: ['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'HALF_MONTHS', 'CALENDAR_DAYS']
			},
			calendar_days: { kind: 'bool', optional: true },
			calendar_months: { kind: 'bool', optional: true },
			lifetime_events: { kind: 'int', min: 1, optional: true },
			transition_review_on: { kind: 'text', optional: true },
			consumes_after_days: { kind: 'number', min: 0, optional: true },
			lifetime_days: { kind: 'json', optional: true },
			child_lifetime: {
				kind: 'list',
				of: { kind: 'object', fields: { eligibility: { kind: 'text' }, days: { kind: 'json' } } },
				optional: true
			},
			child_years: { kind: 'bool', optional: true },
			rolling_months: { kind: 'int', min: 1, optional: true },
			weekly_days: { kind: 'number', min: 0, optional: true },
			rounding: {
				kind: 'enum',
				values: ['HALF_DAY', 'WHOLE_DAY', 'WHOLE_DAY_DOWN', 'EXACT'],
				optional: true
			},
			scaled_rounding: {
				kind: 'object',
				fields: {
					step: { kind: 'number', min: 0 },
					mode: { kind: 'enum', values: ['UP', 'DOWN', 'HALF_UP'] }
				},
				optional: true
			},
			hour_rounding: {
				kind: 'object',
				fields: {
					step: { kind: 'number', min: 0 },
					mode: { kind: 'enum', values: ['UP', 'DOWN', 'HALF_UP'] }
				},
				optional: true
			},
			part_time_hours: {
				kind: 'object',
				fields: {
					part_time_below_hours: { kind: 'number', min: 0 },
					comparator_weekly_hours: { kind: 'number', min: 0 },
					comparator_daily_hours: { kind: 'number', min: 0 }
				},
				optional: true
			},
			month_counts_when: { kind: 'number', min: 0, max: 1, optional: true },
			month_share_basis: {
				kind: 'enum',
				values: ['CALENDAR_DAYS', 'NORMAL_WORKING_DAYS'],
				optional: true
			},
			hour_share_step: { kind: 'number', min: 0, max: 1, optional: true },
			minimum_days: { kind: 'number', min: 0, optional: true },
			qualifies_window: { kind: 'bool', optional: true },
			encash_on_exit_when: { kind: 'text', optional: true },
			encash_carry_on_exit_when: { kind: 'text', optional: true },
			scale: { kind: 'text', optional: true },
			outpatient_sick_excludes_shift_allowance: { kind: 'bool', optional: true },
			service_excludes_no_pay: {
				kind: 'enum',
				values: ['EMPLOYEE_REQUESTED_FULL_DAYS'],
				optional: true
			},
			replans_on_no_pay: { kind: 'bool', optional: true },
			locks_attendance_after_use: { kind: 'bool', optional: true },
			forfeit_above_absence_share: { kind: 'number', min: 0, max: 1, optional: true },
			bands: {
				kind: 'list',
				of: { kind: 'object', fields: { eligibility: { kind: 'text' }, days: { kind: 'json' } } }
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
