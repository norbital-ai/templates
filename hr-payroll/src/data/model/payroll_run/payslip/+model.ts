import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One payslip record.',
	icon: 'lucide:file-text',
	label: 'terms_through',
	fields: {
		terms_through: { kind: 'text', optional: true },
		salary_from: { kind: 'text', optional: true },
		salary_to: { kind: 'text', optional: true },
		service_basis: { kind: 'text', optional: true },
		leave_settlements: { kind: 'text', optional: true },
		statutory_absence_settlements: { kind: 'text', optional: true },
		base: { kind: 'text', optional: true },
		proration: { kind: 'text', optional: true },
		statutory: { kind: 'text', optional: true },
		adjustments: { kind: 'text', optional: true },
		payment_mode: { kind: 'text', optional: true },
		status: { kind: 'text', optional: true },
		paid_at: { kind: 'instant', optional: true },
		currency: { kind: 'text', optional: true },
		gross: { kind: 'text', optional: true },
		total_deductions: { kind: 'text', optional: true },
		net: { kind: 'text', optional: true },
		unfunded_contributions: { kind: 'text', optional: true },
		funding_received: { kind: 'text', optional: true },
		funding_received_on: { kind: 'text', optional: true },
		funding_reference: { kind: 'text', optional: true },
		employer_cost: { kind: 'text', optional: true }
	}
});
