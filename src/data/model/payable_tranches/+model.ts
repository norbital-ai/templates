import { model } from '@norbital-ai/bolt';

/** A frozen, priced source of wages or remuneration, settled through actual payment allocations. */
export default model({
	description:
		'One source-backed part of an obligation. Its due date, gross amount, non-payment deductions and tax treatment are fixed before cash is recorded.',
	icon: 'lucide:layers',
	label: 'reference',
	fields: {
		source_category: {
			kind: 'enum',
			values: ['REGULAR_WAGE', 'BONUS', 'RETRO_WAGE', 'MATERNITY_PAY', 'NONCONTRACT_REMUNERATION']
		},
		source_kind: { kind: 'text' },
		source_id: { kind: 'text' },
		/** Philippine maternity cash is separated into the SSS award and employer differential. */
		source_component: {
			kind: 'enum',
			values: ['SSS_AWARD', 'EMPLOYER_DIFFERENTIAL'],
			optional: true
		},
		reference: { kind: 'text' },
		due_on: { kind: 'date' },
		currency: { kind: 'currency' },
		gross_amount: { kind: 'money', currency: 'currency' },
		/** Deductions already priced before the actual payment; payment-date withholding is separate. */
		non_event_deduction_amount: { kind: 'money', currency: 'currency', default: 0 },
		/** A partly exempt source must be split into homogeneous tranches. */
		tax_treatment: { kind: 'enum', values: ['TAXABLE', 'EXEMPT'] }
	},
	unique: [{ fields: ['source_kind', 'source_id', 'reference'] }],
	index: [['due_on', 'source_category']],
	search: { text: ['reference', 'source_kind', 'source_id'] }
});
