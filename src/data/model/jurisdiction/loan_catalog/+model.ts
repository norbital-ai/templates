import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One loan_catalog record.',
	icon: 'lucide:file-text',
	label: 'entry_schema',
	fields: {
		entry_schema: { kind: 'text', optional: true },
		pricing: { kind: 'text', optional: true },
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		destination: { kind: 'text', optional: true },
		direction: { kind: 'text', optional: true },
		bands: { kind: 'text', optional: true },
		loan_type: { kind: 'text', optional: true },
		minimum_repayment: { kind: 'text', optional: true },
		approval_reference_required: { kind: 'text', optional: true },
		order_facts: { kind: 'text', optional: true },
		order_recovery_rule: { kind: 'text', optional: true },
		order_payment_when: { kind: 'text', optional: true },
		order_authority: { kind: 'text', optional: true },
		eligibility: { kind: 'text', optional: true },
		evidence: { kind: 'text', optional: true }
	}
});
