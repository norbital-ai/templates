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
			daily_monthly_divisor_by_workweek: { kind: 'record', of: { kind: 'number' }, optional: true },
			part_time_monthly_hourly_floor: { kind: 'bool', optional: true },
			part_time_daily_hourly_floor: { kind: 'bool', optional: true },
			workplace_keyed: { kind: 'bool', optional: true },
			standalone_workplaces: { kind: 'list', of: { kind: 'text' }, optional: true },
			kbli_edition: { kind: 'text', optional: true },
			kbli_2025_from: { kind: 'text', optional: true },
			kbli_2025_to_2020: { kind: 'record', of: { kind: 'text' }, optional: true },
			monthly_by_sector: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						place: { kind: 'text' },
						kbli: { kind: 'list', of: { kind: 'text' } },
						when: { kind: 'text', optional: true },
						amount: { kind: 'number' }
					}
				},
				optional: true
			},
			strict_sector_places: { kind: 'list', of: { kind: 'text' }, optional: true },
			verified_ordinary_sectors: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: { place: { kind: 'text' }, kbli: { kind: 'text' } }
				},
				optional: true
			},
			daily_by_worksite: { kind: 'record', of: { kind: 'number' }, optional: true },
			daily_by_sector: { kind: 'record', of: { kind: 'number' }, optional: true },
			by_employment_type: {
				kind: 'record',
				of: { kind: 'record', of: { kind: 'number' } },
				optional: true
			},
			classified_by_worksite: {
				kind: 'object',
				fields: {
					single_establishment_fact: { kind: 'text' },
					headcount_fact: { kind: 'text' },
					rows: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								worksite: { kind: 'text' },
								sector: { kind: 'text', optional: true },
								employment_type: { kind: 'text', optional: true },
								min_workers: { kind: 'number', min: 0, optional: true },
								max_workers: { kind: 'number', min: 0, optional: true },
								rate_key: { kind: 'text' }
							}
						}
					}
				},
				optional: true
			},
			applies_when: { kind: 'text', optional: true },
			scale: { kind: 'text', optional: true },
			terms_when: { kind: 'text', optional: true },
			block_terms_when: { kind: 'bool', optional: true },
			floor_includes_fixed_allowances: { kind: 'bool', optional: true },
			block_unmeasured_results_pay: { kind: 'bool', optional: true },
			net_of_employee_schemes: { kind: 'list', of: { kind: 'text' }, optional: true },
			block_below_when: { kind: 'text', optional: true },
			substitutes_below: { kind: 'bool', optional: true },
			authority: { kind: 'text', optional: true }
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
