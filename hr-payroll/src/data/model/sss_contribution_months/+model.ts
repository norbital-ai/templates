import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One coverage month on a Philippine member’s evidenced SSS contribution statement. A zero-credit row explicitly records no qualifying payment; assessed payroll contributions are not proof of payment.',
	icon: 'lucide:badge-check',
	label: 'coverage_month',
	fields: {
		coverage_month: { kind: 'text' },
		/** Regular SSS MSC only; the WISP/MPF portion cannot raise the benefit base above PHP 20,000. */
		regular_msc: { kind: 'decimal', scale: 2, min: 0, max: 20_000 },
		/** Date SSS received payment; absent when the statement has no paid credit for this month. */
		paid_on: { kind: 'date', optional: true },
		/** SSS statement or remittance proof identifier, including prior-employer months. */
		source_reference: { kind: 'text' },
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true }
	},
	unique: [{ fields: ['employee_id', 'coverage_month'] }],
	index: [['employee_id', 'coverage_month']],
	search: { text: ['source_reference'] }
});
