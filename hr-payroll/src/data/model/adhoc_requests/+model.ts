import { model } from '@norbital-ai/bolt';

/** One instance of an ad hoc class, due whole in one pay period: never prorated, never repeated. */
export default model({
	description:
		'A one-off payment or deduction a person is owed in one pay period: the ad hoc class, the amount and the day it is for. The amount is a positive magnitude; direction comes from the referenced catalogue. Never prorated; settled once by the run that captures it.',
	icon: 'lucide:hand-coins',
	label: ['event_date', 'amount'],
	fields: {
		/** A positive magnitude in the employment's currency. */
		amount: { kind: 'decimal', scale: 2 },
		/** The day the payment is for; the cutoff places it in a period. */
		event_date: { kind: 'date' },
		/** Why it is paid. */
		reason: { kind: 'text', default: '' },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Settle against the catalogue's direction (a claw-back). */
		as_adjustment_entry: { kind: 'bool', default: false },
		/** A wage paid late: the amount is the late sum, priced by the class (VN LC art.97(4)). */
		late_wage: { kind: 'custom', of: 'late_wage', optional: true },
		/** Inputs the catalogue row declares in `request_facts`; `entry.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		pay_period: { kind: 'text', optional: true }
	},
	index: [
		['employment_id', 'pay_period'],
		['employment_id', 'event_date']
	]
});
