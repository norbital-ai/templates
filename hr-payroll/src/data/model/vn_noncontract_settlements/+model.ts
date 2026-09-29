import { model } from '@norbital-ai/bolt';

/** A Vietnamese wage or remuneration obligation to a person outside an employment contract. */
export default model({
	description:
		'A Vietnamese wage or remuneration obligation to a natural person without a labour contract. Payable tranches retain the priced source; actual payment events retain each disbursement and its withholding.',
	icon: 'lucide:receipt-text',
	label: 'reference',
	fields: {
		reference: { kind: 'text' },
		/** Agreed taxable wage/remuneration, paid in one or more actual disbursements. */
		agreed_gross_vnd: { kind: 'int', min: 1 },
		agreed_due_on: { kind: 'date' },
		agreement_amount_reference: { kind: 'text' },
		/** The earning or engagement this payment settles. An employer reviews its legal substance, not its title. */
		relationship_reference: { kind: 'text' },
		relationship_reviewed_on: { kind: 'date' },
		/** Evidence that this payment is wage/remuneration under PIT, rather than business income. */
		income_nature_reference: { kind: 'text' },
		/** Tax residence is evidenced for the entire actual-payment window; a changed status needs another row. */
		tax_residency: { kind: 'enum', values: ['RESIDENT', 'NON_RESIDENT'] },
		tax_residency_range: { kind: 'period', of: 'date' },
		tax_residency_reference: { kind: 'text' },
		currency: { kind: 'currency' }
	},
	unique: [{ fields: ['company_id', 'reference'] }],
	index: [['company_id', 'employee_id']],
	search: { text: ['reference', 'relationship_reference', 'income_nature_reference'] }
});
