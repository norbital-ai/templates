import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'An expense a person paid for and is claiming back, dated by the day it was incurred and evidenced by its receipt. The amount is a positive magnitude; direction comes from the referenced catalogue.',
	icon: 'lucide:receipt-text',
	label: ['incurred_on', 'amount'],
	fields: {
		/** A positive magnitude in the employment's currency. */
		amount: { kind: 'decimal', scale: 2 },
		/** The day the expense was incurred, not the day it was entered. */
		incurred_on: { kind: 'date' },
		description: { kind: 'text', optional: true },
		/** The receipt; required when the catalogue row's `evidence` says so. */
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Facts and legal due date for a treatment reimbursement; optional for other claims. */
		medical_reimbursement: { kind: 'custom', of: 'medical_reimbursement', optional: true },
		/** Settle against the catalogue's direction (a claw-back). */
		as_adjustment_entry: { kind: 'bool', default: false },
		/** The period this settles in, overriding the cutoff; null is normal. */
		pay_period: { kind: 'text', optional: true }
	},
	index: [
		['employment_id', 'pay_period'],
		['employment_id', 'incurred_on']
	]
});
