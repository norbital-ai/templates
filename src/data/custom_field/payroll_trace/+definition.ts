import { customField } from '@norbital-ai/bolt';

const FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'] as const;
const f = customField({
	description:
		'The calculation flow behind one payroll run: per payslip, each charged scheme with the lines that fed its base, the producer reads it made, the governing rule and the two shares written.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				employment_id: { kind: 'text' },
				employee_number: { kind: 'text' },
				schemes: {
					kind: 'list',
					of: {
						kind: 'object',
						fields: {
							scheme_code: { kind: 'text' },
							rule_when: { kind: 'text', optional: true },
							first_contribution_due_on: { kind: 'text', optional: true },
							base_amount: { kind: 'number' },
							ordinary_amount: { kind: 'number', optional: true },
							assessment_frequency: { kind: 'enum', values: FREQUENCIES, optional: true },
							employee_amount: { kind: 'number' },
							employer_amount: { kind: 'number' },
							inputs: {
								kind: 'list',
								of: {
									kind: 'object',
									fields: {
										code: { kind: 'text' },
										label: { kind: 'text' },
										effect: { kind: 'enum', values: ['INCLUDE', 'REDUCE'] },
										amount: { kind: 'number' }
									}
								}
							},
							reads: {
								kind: 'list',
								of: {
									kind: 'object',
									fields: {
										code: { kind: 'text' },
										employee_amount: { kind: 'number' },
										ordinary_employee_amount: { kind: 'number', optional: true },
										employer_amount: { kind: 'number' }
									}
								}
							}
						}
					}
				},
				overtime_hours: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: { limit: { kind: 'text' }, month: { kind: 'text' }, hours: { kind: 'number' } }
					}
				},
				time_off_in_lieu: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							work_day_id: { kind: 'text' },
							date: { kind: 'text' },
							line: { kind: 'text' },
							label: { kind: 'text' },
							hours: { kind: 'number' },
							rate: { kind: 'number' },
							amount: { kind: 'number' },
							paid: { kind: 'bool' }
						}
					}
				},
				overtime_days: { kind: 'number', optional: true },
				minimum_wage: { kind: 'number', optional: true }
			}
		}
	}
});
export default f;
