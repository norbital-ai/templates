import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One version of a jurisdiction settings lineage: general payroll data, owning its regulatory rule sets, family catalogues and schemes. Holidays belong to the entity that observes them. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
	icon: 'lucide:globe',
	label: 'name',
	fields: {
		code: {
			kind: 'text'
		},
		jurisdiction_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		employee_input_schema: {
			kind: 'json',
			optional: true
		},
		entity_input_schema: {
			kind: 'json',
			optional: true
		},
		behaviours: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					version: { kind: 'int' },
					rules: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								id: { kind: 'text' },
								catalog: { kind: 'text', optional: true },
								target_collection: { kind: 'text', optional: true },
								events: { kind: 'list', of: { kind: 'text' } },
								when: { kind: 'text', format: 'cel', optional: true },
								fields: { kind: 'list', of: { kind: 'text' }, optional: true },
								reads: { kind: 'record', of: { kind: 'json' }, optional: true },
								effect: { kind: 'text', optional: true }
							}
						}
					}
				}
			},
			default: {
				version: 1,
				rules: []
			}
		},
		sealed_at: {
			kind: 'instant',
			optional: true
		},
		voided_at: {
			kind: 'instant',
			optional: true
		},
		void_reason: {
			kind: 'text',
			optional: true
		},
		reference_tables: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true
		},
		payroll: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					currency: { kind: 'text', optional: true },
					timezone: { kind: 'text', optional: true },
					tax_year_start_month: { kind: 'int', optional: true },
					minor_units: { kind: 'int', min: 0, max: 4, optional: true },
					rolling_hours_months: { kind: 'int', min: 1, max: 12, optional: true },
					pay_date: { kind: 'text', format: 'cel', optional: true },
					week_start: { kind: 'int', min: 0, max: 6, optional: true },
					semi_monthly_split: { kind: 'int', min: 1, max: 27, optional: true },
					roster_week: { kind: 'enum', values: ['ROLLING', 'CALENDAR'], optional: true },
					base_salary_required: { kind: 'bool', optional: true },
					off_cycle_families: { kind: 'list', of: { kind: 'text' }, optional: true },
					monthly_wage: { kind: 'text', format: 'cel', optional: true },
					negative_net: { kind: 'enum', values: ['refuse', 'allow'], optional: true }
				}
			}
		},
		change_summary: {
			kind: 'text',
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		sources: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					urls: {
						kind: 'list',
						of: {
							kind: 'text',
							format: 'url'
						}
					},
					instructions: {
						kind: 'text',
						optional: true
					},
					research_domains: {
						kind: 'list',
						of: {
							kind: 'text',
							format: 'url'
						},
						optional: true
					}
				}
			}
		}
	}
});
