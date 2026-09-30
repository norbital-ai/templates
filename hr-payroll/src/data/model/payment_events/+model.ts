import { model } from '@norbital-ai/bolt';

/** One evidenced actual disbursement to one person. Creation is the entire immutable payment. */
export default model({
	description:
		'An actual cash disbursement or evidenced zero-cash settlement for one person, with its source allocations and statutory withholding recorded atomically.',
	icon: 'lucide:banknote',
	label: 'reference',
	fields: {
		kind: { kind: 'enum', values: ['CASH', 'NON_CASH_SETTLEMENT'], default: 'CASH' },
		paid_on: { kind: 'date' },
		reference: { kind: 'text' },
		non_cash_basis_reference: { kind: 'text', optional: true },
		/** An already evidenced external cash movement credited once, never a second disbursement. */
		external_source_kind: { kind: 'text', optional: true },
		external_source_id: { kind: 'text', optional: true },
		currency: { kind: 'currency' },
		gross_amount: { kind: 'money', currency: 'currency' },
		non_event_deduction_amount: { kind: 'money', currency: 'currency' },
		cash_amount: { kind: 'money', currency: 'currency' },
		statutory: { kind: 'custom', of: 'payslip_statutory' },
		/** Jurisdiction inputs the lineage declares in `payment_facts`; `payment.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} }
	},
	unique: [
		{ fields: ['company_id', 'employee_id', 'paid_on', 'reference'] },
		{
			fields: ['external_source_kind', 'external_source_id'],
			where: {
				external_source_kind: { isNull: false },
				external_source_id: { isNull: false }
			}
		}
	],
	index: [['company_id', 'employee_id', 'paid_on']],
	search: { text: ['reference'] }
});
