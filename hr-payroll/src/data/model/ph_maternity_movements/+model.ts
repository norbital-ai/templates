import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Dated cash evidence for one Philippine maternity case. An SSS reimbursement is money received by the employer and never an employee payslip payment.',
	icon: 'lucide:receipt',
	label: ['paid_on', 'amount'],
	fields: {
		kind: {
			kind: 'enum',
			values: ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL', 'SSS_REIMBURSEMENT']
		},
		paid_on: { kind: 'date' },
		amount: { kind: 'decimal', scale: 2, min: 0.01 },
		payment_reference: { kind: 'text' },
		/** Frozen when employee cash is recorded, so a later due-date change cannot hide an overlap. */
		planned_leave_span_at_payment: { kind: 'period', of: 'date', optional: true },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [{ fields: ['ph_maternity_case_id', 'kind', 'payment_reference'] }],
	index: [['ph_maternity_case_id', 'paid_on']],
	search: { text: ['payment_reference'] }
});
