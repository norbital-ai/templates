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
			proration: {
				kind: 'enum',
				values: ['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'HALF_MONTHS', 'CALENDAR_DAYS']
			},
			lifetime_events: { kind: 'int', min: 1, optional: true },
			consumes_after_days: { kind: 'number', min: 0, optional: true },
			lifetime_days: { kind: 'json', optional: true },
			child_lifetime: {
				kind: 'list',
				of: { kind: 'object', fields: { eligibility: { kind: 'text' }, days: { kind: 'json' } } },
				optional: true
			},
			child_years: { kind: 'bool', optional: true },
			rolling_months: { kind: 'int', min: 1, optional: true },
			rounding: {
				kind: 'enum',
				values: ['HALF_DAY', 'WHOLE_DAY', 'WHOLE_DAY_DOWN', 'EXACT'],
				optional: true
			},
			minimum_days: { kind: 'number', min: 0, optional: true },
			qualifies_window: { kind: 'bool', optional: true },
			encash_on_exit_when: { kind: 'text', optional: true },
			scale: { kind: 'text', optional: true },
			bands: {
				kind: 'list',
				of: { kind: 'object', fields: { eligibility: { kind: 'text' }, days: { kind: 'json' } } }
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
