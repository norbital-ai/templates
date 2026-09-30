import { model } from '@norbital-ai/bolt';

/** A wage or remuneration obligation to a person outside an employment contract. */
export default model({
	description:
		'A wage or remuneration obligation to a natural person without a labour contract, withheld per payment under the scheme `payroll.payment_occasion_scheme` names. Payable tranches retain the priced source; actual payment events retain each disbursement and its withholding.',
	icon: 'lucide:receipt-text',
	label: 'reference',
	fields: {
		/** The agreement's evidence reference; also the reference of its priced tranche. */
		reference: { kind: 'text' },
		currency: { kind: 'currency' },
		/** Agreed taxable wage/remuneration in the settings currency, paid in one or more actual disbursements. */
		agreed_gross: { kind: 'money', currency: 'currency' },
		agreed_due_on: { kind: 'date' },
		/** Tax residence for the entire actual-payment window; a changed status needs another row. */
		tax_residency: { kind: 'enum', values: ['RESIDENT', 'NON_RESIDENT'] },
		tax_residency_range: { kind: 'period', of: 'date' },
		/** Jurisdiction inputs the lineage declares in `settlement_facts`; `settlement.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} }
	},
	unique: [{ fields: ['company_id', 'reference'] }],
	index: [['company_id', 'employee_id']],
	search: { text: ['reference'] }
});
