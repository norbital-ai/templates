import { model } from '@norbital-ai/bolt';

/** Evidence supplied with one actual Vietnamese payment, never a standing election. */
export default model({
	description:
		'Vietnam PIT instructions and documented declarations for one actual payment occasion. The payment event computes and freezes withholding; these facts never set the amount.',
	icon: 'lucide:file-check-2',
	label: 'payment_event_id',
	fields: {
		/** Decree 253/2026 art.50(2): the payee may request 10% below VND5m from July 2026. */
		withhold_below_threshold_requested: { kind: 'bool', default: false },
		request_received_on: { kind: 'date', optional: true },
		request_reference: { kind: 'text', optional: true },
		/** Circular 111/2013 art.25(1)(i) waiver before July 2026; July authority is unresolved. */
		commitment_form_reference: { kind: 'text', optional: true },
		commitment_received_on: { kind: 'date', optional: true },
		commitment_tax_year: { kind: 'int', min: 2000, optional: true },
		commitment_tax_id: { kind: 'text', optional: true },
		commitment_sole_income_declared: { kind: 'bool', optional: true },
		commitment_below_taxable_threshold_declared: { kind: 'bool', optional: true }
	},
	unique: [{ fields: ['payment_event_id'] }],
	search: { text: ['request_reference', 'commitment_form_reference'] }
});
