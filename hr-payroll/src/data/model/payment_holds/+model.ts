import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A disbursement hold on one employment — tax clearance, court order or dispute. An open hold blocks payment; release records its legal basis, evidence and reconciled amount.',
	icon: 'lucide:hand',
	label: 'directive_reference',
	fields: {
		/** The authority's basis for holding the money. */
		category: {
			kind: 'enum',
			values: ['TAX_CLEARANCE', 'COURT_ORDER', 'AGENCY_DIRECTION', 'EMPLOYEE_DISPUTE', 'OTHER'],
			default: 'TAX_CLEARANCE'
		},
		/** The directive's own reference, retained for reconciliation. */
		directive_reference: { kind: 'text' },
		/** The amount withheld, in the employment's currency; null while the authority has not stated one. */
		amount: { kind: 'decimal', scale: 2, optional: true },
		/** Form IR21: why no moneys were withheld under ITA s.68(7), where none were. */
		no_withholding_reason: { kind: 'text', optional: true },
		held_on: { kind: 'date' },
		/** Set when the authority releases the hold; open holds block the payslip's settlement. */
		released_on: { kind: 'date', optional: true },
		released_amount: { kind: 'decimal', scale: 2, optional: true },
		/** For tax clearance: IRAS release notice, tax-payment directive, or statutory expiry. */
		release_basis: {
			kind: 'enum',
			values: ['RELEASE_NOTICE', 'PAY_TAX_DIRECTIVE', 'THIRTY_DAY_EXPIRY'],
			optional: true
		},
		/** The day IRAS received the Form IR21 notification, not the employer's awareness day. */
		iras_notice_received_on: { kind: 'date', optional: true },
		release_directive_on: { kind: 'date', optional: true },
		amended_ir21_filed_on: { kind: 'date', optional: true },
		/** Tax due to IRAS under the clearance directive; determines the employee's balance. */
		directive_tax_amount: { kind: 'decimal', scale: 2, optional: true },
		/** Computed from the directive date and the sealed tax-clearance payment window. */
		tax_remittance_due_on: { kind: 'date', optional: true },
		tax_remitted_amount: { kind: 'decimal', scale: 2, optional: true },
		tax_remitted_on: { kind: 'date', optional: true },
		tax_remittance_reference: { kind: 'text', optional: true },
		tax_remittance_evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** The IRAS directive or filing acknowledgement used to close the hold. */
		reconciliation_reference: { kind: 'text', optional: true },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	index: [['employment_id', 'released_on']],
	search: { text: ['directive_reference'] }
});
