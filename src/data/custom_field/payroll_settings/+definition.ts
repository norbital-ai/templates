import { customField } from '@norbital-ai/bolt';
import {
	INCOME_RETURN_ITEMS,
	payrollSettingsFault
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
			separation_wage_average_months: { kind: 'int', min: 1, optional: true },
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
					authority: { kind: 'text' }
				}
			},
			holiday_in_no_pay_leave_unpaid: { kind: 'bool', optional: true },
			special_holiday_unworked_unpaid: { kind: 'bool', optional: true },
			regular_holiday_prior_workday: { kind: 'bool', optional: true },
			short_day_half_hours: { kind: 'number', optional: true },
			income_return: {
				kind: 'object',
				optional: true,
				fields: {
					form: { kind: 'enum', values: ['IR8A'] },
					items: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								code: { kind: 'text' },
								item: { kind: 'enum', values: INCOME_RETURN_ITEMS }
							}
						}
					},
					compulsory_scheme: { kind: 'text' },
					donation_schemes: { kind: 'list', of: { kind: 'text' } },
					mosque_fund: {
						kind: 'object',
						optional: true,
						fields: {
							scheme: { kind: 'text' },
							allocation: {
								kind: 'list',
								of: {
									kind: 'object',
									fields: { total: { kind: 'number' }, mosque: { kind: 'number' } }
								}
							},
							authority: { kind: 'text' }
						}
					},
					authority: { kind: 'text' }
				}
			}
		}
	}
});
export default f;
f.validate(payrollSettingsFault);
