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
			protected_prior_floor: {
				kind: 'object',
				fields: {
					on: { kind: 'text' },
					region_fact: { kind: 'text' },
					reclassified_fact: { kind: 'text' },
					authority: { kind: 'text', optional: true }
				},
				optional: true
			},
			part_time_monthly_full_time_week_hours: { kind: 'number', min: 1, optional: true },
			daily_monthly_divisor_by_workweek: { kind: 'record', of: { kind: 'number' }, optional: true },
			part_time_monthly_hourly_floor: { kind: 'bool', optional: true },
			part_time_daily_hourly_floor: { kind: 'bool', optional: true },
			workplace_keyed: { kind: 'bool', optional: true },
			standalone_workplaces: { kind: 'list', of: { kind: 'text' }, optional: true },
			sector_code_pattern: { kind: 'text', optional: true },
			sector_editions: { kind: 'list', of: { kind: 'text' }, optional: true },
			sector_edition: { kind: 'text', optional: true },
			sector_edition_from: { kind: 'text', optional: true },
			sector_edition_map: { kind: 'record', of: { kind: 'text' }, optional: true },
			monthly_by_sector: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						place: { kind: 'text' },
						sector_codes: { kind: 'list', of: { kind: 'text' } },
						when: { kind: 'text', optional: true },
						valid_when: { kind: 'text', optional: true },
						validation_message: { kind: 'text', optional: true },
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
					fields: { place: { kind: 'text' }, sector_code: { kind: 'text' } }
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
								rate_key: { kind: 'text' },
								requires_evidence: { kind: 'list', of: { kind: 'text' }, optional: true }
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
			contract_rules: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						key: { kind: 'text' },
						when: { kind: 'text' },
						holds: { kind: 'text' },
						severity: { kind: 'enum', values: ['BLOCKER', 'WARNING'] },
						message: { kind: 'text' },
						authority: { kind: 'text', optional: true }
					}
				},
				optional: true
			},
			hourly_floor: {
				kind: 'object',
				fields: {
					from_monthly_divisor: { kind: 'number' },
					allowed_when: { kind: 'text' },
					refusal: { kind: 'text' },
					authority: { kind: 'text', optional: true }
				},
				optional: true
			},
			floor_includes_fixed_allowances: { kind: 'bool', optional: true },
			block_unmeasured_results_pay: { kind: 'bool', optional: true },
			results_pay: {
				kind: 'object',
				fields: {
					measure_piece_from_units: { kind: 'bool', optional: true },
					piece_calendar_leave_refused: { kind: 'bool', optional: true },
					piece_history_weeks: { kind: 'number', optional: true },
					piece_history_catalogues: { kind: 'list', of: { kind: 'text' }, optional: true },
					task_only_time_events_refused: { kind: 'bool', optional: true },
					levy_scheme: { kind: 'text', optional: true },
					applies_when: { kind: 'text', optional: true },
					levy_unclassified_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					results_wage_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					zero_results_code: { kind: 'text', optional: true }
				},
				optional: true
			},
			net_of_employee_schemes: { kind: 'list', of: { kind: 'text' }, optional: true },
			net_of_employee_schemes_when: { kind: 'text', optional: true },
			block_below_when: { kind: 'text', optional: true },
			substitutes_below: { kind: 'bool', optional: true },
			authority: { kind: 'text', optional: true }
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
