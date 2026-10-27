import { model } from '@norbital-ai/bolt';

const create_columns = [
	'terms_through',
	'salary_from',
	'salary_to',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'company_payments',
	'status',
	'paid_at',
	'bank_charges',
	'currency',
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'payroll_run_id',
	'employment_id'
] as const;

const update_columns = [
	'terms_through',
	'salary_from',
	'salary_to',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'status',
	'paid_at',
	'bank_charges',
	'currency',
	'gross',
	'total_deductions',
	'net',
	'employer_cost'
] as const;

export default model('payslip', {
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
					to: ['ON_HOLD', 'PAID'],
					// a payslip is a calculated settlement: only its payment state may move after creation
					edit: ['status', 'paid_at', 'bank_charges']
				},
				ON_HOLD: {
					to: ['DRAFT', 'PAID'],
					edit: ['status', 'paid_at', 'bank_charges']
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
		},
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'payslip',
			owned: true
		},
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'payslip'
		}
	},
	read: { payslip: { fields: 'all' }, 'payslip.payroll_run_id': { fields: 'all' } },
	// a paid settlement is sealed; deleting its run remains the only way to replace it, and that refuses once paid
	locked: { status: { eq: 'PAID' } },
	create: {
		columns: { payslip: create_columns }
	},
	update: {
		columns: { payslip: update_columns }
	}
});
