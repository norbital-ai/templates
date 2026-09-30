import { model } from '@norbital-ai/bolt';

/** The exact portion of one frozen tranche consumed by one actual payment. */
export default model({
	description:
		'Immutable source allocation of a payment event. Gross and previously priced deductions are reconciled independently in currency minor units.',
	icon: 'lucide:split',
	label: 'gross_amount',
	fields: {
		currency: { kind: 'currency' },
		gross_amount: { kind: 'money', currency: 'currency' },
		non_event_deduction_amount: { kind: 'money', currency: 'currency', default: 0 }
	},
	unique: [{ fields: ['payment_event_id', 'payable_tranche_id'] }],
	index: [['payable_tranche_id']]
});
