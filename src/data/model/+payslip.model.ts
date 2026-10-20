import { model } from '@norbital-ai/bolt';

export default model({
	description:
		"One person's settlement for one run. Contracted base, the proration segments the calendar produced, the statutory charges over their sum and every adjustment one captured input caused are held here. Year-to-date is a SUM over payslips, never a stored column.",
	icon: 'lucide:receipt',
	label: 'net',
	fields: {
		terms_through: {
			kind: 'date'
		},
		salary_from: {
			kind: 'date',
			optional: true
		},
		salary_to: {
			kind: 'date',
			optional: true
		},
		service_basis: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					from: { kind: 'date' },
					to: { kind: 'date' },
					days: { kind: 'number' },
					denominator: { kind: 'number' }
				}
			},
			optional: true
		},
		base: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					component_code: { kind: 'text' },
					label: { kind: 'text', optional: true },
					amount: { kind: 'number' },
					quantity: { kind: 'number', optional: true },
					rate: { kind: 'number', optional: true }
				}
			},
			optional: true
		},
		proration: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					component_code: { kind: 'text' },
					from: { kind: 'date' },
					to: { kind: 'date' },
					days: { kind: 'number' },
					denominator: { kind: 'number' },
					contract_amount: { kind: 'number' },
					prorated_amount: { kind: 'number' },
					window_from: { kind: 'date', optional: true }
				}
			},
			optional: true
		},
		statutory: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					scheme_code: { kind: 'text' },
					base_amount: { kind: 'number' },
					employee_amount: { kind: 'number' },
					employer_amount: { kind: 'number' },
					charged_base: { kind: 'number', optional: true },
					parts: { kind: 'record', of: { kind: 'number' } },
					wages: { kind: 'record', of: { kind: 'number' }, optional: true },
					rule_when: { kind: 'text', optional: true }
				}
			},
			optional: true
		},
		adjustments: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					family: { kind: 'text' },
					source_id: { kind: 'text' },
					component_code: { kind: 'text' },
					bucket: { kind: 'enum', values: ['EARNING', 'DEDUCTION'] },
					destination: { kind: 'enum', values: ['PAY', 'NET'] },
					amount: { kind: 'number' },
					label: { kind: 'text', optional: true }
				}
			},
			optional: true
		},
		company_payments: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					family: { kind: 'text' },
					source_id: { kind: 'text' },
					component_code: { kind: 'text' },
					amount: { kind: 'number' },
					label: { kind: 'text', optional: true }
				}
			},
			optional: true,
			help: 'Amounts the company settles outside employee net pay. The salary report uses the jurisdiction’s payment classification to distinguish cash payments from tax-only information.'
		},
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: {
					to: ['ON_HOLD', 'PAID']
				},
				ON_HOLD: {
					to: ['DRAFT', 'PAID']
				},
				PAID: {
					edit: 'none'
				}
			}
		},
		paid_at: {
			kind: 'instant',
			optional: true
		},
		bank_charges: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'The bank fee the company pays for this employee’s payment, in the payslip currency. Enter 0 if none; leave blank until confirmed. This does not change employee pay or statutory contributions.'
		},
		currency: {
			kind: 'currency'
		},
		gross: {
			kind: 'money',
			currency: 'currency'
		},
		total_deductions: {
			kind: 'money',
			currency: 'currency'
		},
		net: {
			kind: 'money',
			currency: 'currency'
		},
		employer_cost: {
			kind: 'money',
			currency: 'currency'
		}
	}
});
