import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One coverage month on a member’s evidenced statutory contribution statement. A zero-credit row explicitly records no qualifying payment; assessed payroll contributions are not proof of payment.',
	icon: 'lucide:badge-check',
	label: 'coverage_month',
	fields: {
		/** The `statutory_contributions` code whose statement this is. */
		scheme_code: { kind: 'text' },
		coverage_month: { kind: 'text' },
		/** The month's regular credit; a benefit case caps it at its type's `credit_cap`. */
		credited_amount: { kind: 'decimal', scale: 2, min: 0 },
		/** Date the scheme received payment; absent when the statement has no paid credit for this month. */
		paid_on: { kind: 'date', optional: true },
		/** Statement or remittance proof identifier, including prior-employer months. */
		source_reference: { kind: 'text' },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [{ fields: ['employee_id', 'scheme_code', 'coverage_month'] }],
	index: [['employee_id', 'coverage_month']],
	search: { text: ['source_reference'] }
});
