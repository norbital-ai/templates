import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Dated cash evidence for one benefit case. A scheme refund is money received by the employer and never an employee payslip payment.',
	icon: 'lucide:receipt',
	label: ['paid_on', 'amount'],
	fields: {
		/** One of the case type's declared movement kinds. */
		kind: { kind: 'text' },
		/** The declared kind's direction, which the write records from the case type. */
		direction: { kind: 'enum', values: ['EMPLOYEE_PAYMENT', 'EMPLOYER_RECEIPT'], optional: true },
		paid_on: { kind: 'date' },
		amount: { kind: 'decimal', scale: 2, min: 0.01 },
		payment_reference: { kind: 'text' },
		/** Frozen when employee cash is recorded, so a later due-date change cannot hide an overlap. */
		planned_leave_span_at_payment: { kind: 'period', of: 'date', optional: true },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [{ fields: ['benefit_case_id', 'kind', 'payment_reference'] }],
	index: [['benefit_case_id', 'paid_on']],
	search: { text: ['payment_reference'] }
});
