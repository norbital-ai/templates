import { customField } from '@norbital-ai/bolt';
import {
	INCOME_RETURN_DATES,
	payrollSettingsFault,
	type PayrollSettings
} from '../../../lib/datatypes/payroll_settings.js';

const CATEGORIES = [
	'TAX_CLEARANCE',
	'COURT_ORDER',
	'AGENCY_DIRECTION',
	'EMPLOYEE_DISPUTE',
	'OTHER'
] as const;
const f = customField({
	description:
		'The payroll facts of one jurisdiction settings version: its currency, its IANA timezone, the month its tax year opens and whether unpaid leave prorates a standing allowance.',
	shape: {
		kind: 'object',
		fields: {
			currency: { kind: 'text' },
			timezone: { kind: 'text' },
			tax_year_start_month: { kind: 'int', min: 1, max: 12 },
			allowance_npl_prorates: { kind: 'bool' },
			payment_occasion_scheme: { kind: 'text', optional: true },
			separation_wage_average_months: { kind: 'int', min: 1, optional: true },
			trailing_wage_short_months: { kind: 'int', min: 1, optional: true },
			trailing_wage_long_months: { kind: 'int', min: 1, optional: true },
			final_pay_due_days: { kind: 'int', min: 1, optional: true },
			final_pay_deadlines: {
				kind: 'list',
				optional: true,
				of: {
					kind: 'object',
					fields: {
						when: { kind: 'text' },
						days: { kind: 'int', min: 0 },
						basis: {
							kind: 'enum',
							values: [
								'EVENT_DATE',
								'MONTH_END',
								'NEXT_PAYDAY',
								'WORKING_DAYS',
								'NON_REST_HOLIDAY_DAYS'
							]
						},
						authority: { kind: 'text' }
					}
				}
			},
			deduction_ceiling: {
				kind: 'object',
				optional: true,
				fields: {
					share: { kind: 'number', min: 0, max: 1 },
					assessment_period: { kind: 'enum', values: ['PAY_PERIOD', 'MONTH'], optional: true },
					basis: { kind: 'enum', values: ['GROSS', 'NET_OF_STATUTORY'] },
					basis_statutory_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					counts_statutory: { kind: 'bool' },
					counts_loans: { kind: 'bool' },
					loan_instalment_share: { kind: 'number', min: 0, max: 1, optional: true },
					group_limits: {
						kind: 'list',
						optional: true,
						of: {
							kind: 'object',
							fields: {
								codes: { kind: 'list', of: { kind: 'text' } },
								per_entry: { kind: 'bool', optional: true },
								share: { kind: 'number', min: 0, max: 1 },
								assessment_period: { kind: 'enum', values: ['PAY_PERIOD', 'MONTH'] }
							}
						}
					},
					basis_exempt_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					uncapped_payment_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					loan_instalment_exempt_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					advance_recovery: {
						kind: 'object',
						optional: true,
						fields: {
							codes: { kind: 'list', of: { kind: 'text' } },
							months: { kind: 'int', min: 1 },
							first_full_period: { kind: 'bool', optional: true },
							unrecoverable_before_employment_codes: {
								kind: 'list',
								of: { kind: 'text' },
								optional: true
							}
						}
					},
					approved_loan_extension: {
						kind: 'object',
						optional: true,
						fields: {
							codes: { kind: 'list', of: { kind: 'text' } },
							share: { kind: 'number', min: 0, max: 1 }
						}
					},
					exempt_codes: { kind: 'list', of: { kind: 'text' } },
					final_pay_exempt: { kind: 'bool' },
					final_pay_exempts_loans: { kind: 'bool', optional: true },
					final_pay_exempt_codes: { kind: 'list', of: { kind: 'text' }, optional: true },
					authority: { kind: 'text' }
				}
			},
			tax_clearance: {
				kind: 'object',
				optional: true,
				fields: {
					when: { kind: 'text' },
					category: { kind: 'enum', values: CATEGORIES },
					reference_label: { kind: 'text' },
					max_withhold_days: { kind: 'number', optional: true },
					tax_payment_days: { kind: 'number', optional: true },
					release: {
						kind: 'object',
						optional: true,
						fields: {
							bases: {
								kind: 'list',
								of: {
									kind: 'enum',
									values: ['RELEASE_NOTICE', 'PAY_TAX_DIRECTIVE', 'NOTICE_EXPIRY']
								},
								min: 1
							},
							evidence_required: { kind: 'bool' },
							amended_notice_resets: { kind: 'bool' }
						}
					},
					authority: { kind: 'text' }
				}
			},
			holiday_in_no_pay_leave_unpaid: { kind: 'bool', optional: true },
			holiday_adjacent_absence_unpaid: { kind: 'bool', optional: true },
			special_holiday_unworked_unpaid: { kind: 'bool', optional: true },
			regular_holiday_prior_workday: { kind: 'bool', optional: true },
			short_day_half_hours: { kind: 'number', optional: true },
			worksite_coverage: {
				kind: 'object',
				optional: true,
				fields: {
					source: { kind: 'text' },
					covered: { kind: 'list', of: { kind: 'text' }, optional: true },
					covered_by_wage_regions: { kind: 'bool', optional: true },
					refused: {
						kind: 'list',
						optional: true,
						of: {
							kind: 'object',
							fields: { values: { kind: 'list', of: { kind: 'text' } }, message: { kind: 'text' } }
						}
					},
					uncovered_message: { kind: 'text', optional: true },
					refuse_when: { kind: 'text', optional: true },
					refuse_message: { kind: 'text', optional: true },
					spans: {
						kind: 'list',
						of: {
							kind: 'enum',
							values: ['SALARY', 'ATTENDANCE', 'ARREARS', 'SERVICE_AFTER_EXIT']
						}
					},
					authority: { kind: 'text' }
				}
			},
			registration_scope: { kind: 'enum', values: ['JURISDICTION', 'LINEAGE'], optional: true },
			leave_constraints: {
				kind: 'list',
				optional: true,
				of: {
					kind: 'object',
					fields: {
						code: { kind: 'text' },
						year_anchor: {
							kind: 'enum',
							values: ['CALENDAR', 'SERVICE_ANNIVERSARY'],
							optional: true
						},
						auto_carry_one_year: { kind: 'bool', optional: true },
						proration_in: { kind: 'list', of: { kind: 'text' }, optional: true },
						rounding: {
							kind: 'enum',
							values: ['HALF_DAY', 'WHOLE_DAY', 'WHOLE_DAY_DOWN', 'EXACT'],
							optional: true
						},
						authority: { kind: 'text' }
					}
				}
			},
			income_return: {
				kind: 'object',
				optional: true,
				fields: {
					form: { kind: 'text' },
					items: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								key: { kind: 'text' },
								label: { kind: 'text' },
								order: { kind: 'int' },
								deduction: { kind: 'bool', optional: true },
								sum_of: { kind: 'list', of: { kind: 'text' }, optional: true }
							}
						}
					},
					classes: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								code: { kind: 'text' },
								item: { kind: 'text', optional: true },
								remission: { kind: 'bool', optional: true }
							}
						}
					},
					default_earning_item: { kind: 'text' },
					default_allowance_item: { kind: 'text' },
					remission_item: { kind: 'text', optional: true },
					compulsory_scheme: { kind: 'text' },
					compulsory_item: { kind: 'text' },
					donation_schemes: { kind: 'list', of: { kind: 'text' } },
					donation_item: { kind: 'text' },
					split_fund: {
						kind: 'object',
						optional: true,
						fields: {
							scheme: { kind: 'text' },
							allocation: {
								kind: 'list',
								of: {
									kind: 'object',
									fields: { total: { kind: 'number' }, part: { kind: 'number' } }
								}
							},
							part_item: { kind: 'text' },
							rest_item: { kind: 'text' },
							authority: { kind: 'text' }
						}
					},
					dates: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								key: { kind: 'text' },
								item: { kind: 'text', optional: true },
								value: { kind: 'enum', values: INCOME_RETURN_DATES },
								monthly: { kind: 'text', optional: true },
								other: { kind: 'text', optional: true }
							}
						}
					},
					identity_patterns: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { type: { kind: 'text' }, pattern: { kind: 'text' } }
						}
					},
					commencement_before: { kind: 'text', optional: true },
					cessation_return: {
						kind: 'object',
						optional: true,
						fields: {
							form: { kind: 'text' },
							due_months_before_cessation: { kind: 'int', min: 0 }
						}
					},
					authority: { kind: 'text' }
				}
			},
			benefit_cases: {
				kind: 'list',
				optional: true,
				of: {
					kind: 'object',
					fields: {
						case_type: { kind: 'text' },
						// Fact keys (`fact_keys`' shape, an untagged union the field language lacks): `json`,
						// each checked by `payrollSettingsFault`.
						facts: { kind: 'list', of: { kind: 'json' } },
						qualifications: {
							kind: 'list',
							optional: true,
							of: {
								kind: 'object',
								fields: {
									key: { kind: 'text' },
									claim: { kind: 'text' },
									when: { kind: 'text' },
									message: { kind: 'text' }
								}
							}
						},
						event_kinds: { kind: 'list', of: { kind: 'text' } },
						movement_kinds: {
							kind: 'list',
							of: {
								kind: 'object',
								fields: {
									code: { kind: 'text' },
									direction: { kind: 'enum', values: ['EMPLOYEE_PAYMENT', 'EMPLOYER_RECEIPT'] },
									component: { kind: 'text' }
								}
							}
						},
						components: {
							kind: 'object',
							fields: { award: { kind: 'text' }, differential: { kind: 'text' } }
						},
						min_event_on: { kind: 'text' },
						credit_scheme: { kind: 'text' },
						credit_cap: { kind: 'number' },
						credit_window: {
							kind: 'object',
							fields: {
								months: { kind: 'int', min: 1 },
								ends_months_before_event: { kind: 'text' }
							}
						},
						credit_min_count: { kind: 'int', min: 0 },
						credit_top_count: { kind: 'int', min: 1 },
						daily_divisor: { kind: 'number' },
						days: { kind: 'text' },
						min_days_after_event: { kind: 'int', min: 0 },
						advance_due_days: { kind: 'int', min: 0 },
						full_pay_days_divisor: { kind: 'number' },
						premium_schemes: { kind: 'list', of: { kind: 'text' } },
						differential_exemption_facts: { kind: 'list', of: { kind: 'text' } },
						authority: { kind: 'text' }
					}
				}
			},
			vocabularies: {
				kind: 'object',
				optional: true,
				fields: {
					statutory_work_category: { kind: 'list', of: { kind: 'text' } },
					work_classification: { kind: 'list', of: { kind: 'text' } },
					pass_type: { kind: 'list', of: { kind: 'text' } },
					tax_residency: { kind: 'list', of: { kind: 'text' } }
				}
			}
		}
	}
});
export default f;
// A benefit case type's `facts` are stored as `json`; the check reads them as `PayrollSettings` states them.
f.validate((value) => payrollSettingsFault(value as PayrollSettings));
