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
			kind: 'json',
			optional: true
		},
		base: {
			kind: 'json',
			optional: true
		},
		proration: {
			kind: 'json',
			optional: true
		},
		statutory: {
			kind: 'json',
			optional: true
		},
		adjustments: {
			kind: 'json',
			optional: true
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
