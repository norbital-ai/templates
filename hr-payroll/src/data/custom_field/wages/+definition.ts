import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/wages.js';

const f = customField({
	description:
		'Regional minimum wages of one jurisdiction settings version, keyed by region name, in its currency.',
	shape: {
		kind: 'object',
		fields: {
			by_region: { kind: 'record', of: { kind: 'number' } },
			hourly_by_region: { kind: 'record', of: { kind: 'number' }, optional: true },
			weekly_monthly_factor: { kind: 'number', min: 1, optional: true },
			weekly_daily_hourly_alternative: { kind: 'bool', optional: true },
			protected_prior_floor_on: { kind: 'text', optional: true },
			part_time_monthly_full_time_week_hours: { kind: 'number', min: 1, optional: true },
			part_time_daily_hourly_floor: { kind: 'bool', optional: true },
			by_employment_type: {
				kind: 'record',
				of: { kind: 'record', of: { kind: 'number' } },
				optional: true
			},
			applies_when: { kind: 'text', optional: true },
			scale: { kind: 'text', optional: true },
			terms_when: { kind: 'text', optional: true },
			block_below_when: { kind: 'text', optional: true },
			authority: { kind: 'text', optional: true }
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
