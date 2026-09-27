import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Approved dated wage history used where statutory ordinary or normal-wage rates cannot be reconstructed from the current contract.',
	icon: 'lucide:calendar-range',
	label: 'reference',
	fields: {
		/** The inclusive dates the recorded wages belong to. */
		period: { kind: 'period', of: 'date' },
		currency: { kind: 'currency' },
		/** Normal-hours wages due for the complete period, before sickness or unpaid-leave reductions. */
		normal_wages: { kind: 'money', currency: 'currency', optional: true },
		/** Statutory ordinary earnings for actual qualifying work in the period. */
		ordinary_wages: { kind: 'money', currency: 'currency', optional: true },
		/** Actual qualifying days worked; supplied with ordinary_wages, never inferred from a roster. */
		ordinary_days: { kind: 'decimal', scale: 3, optional: true },
		/** The contractual date on which the period's wages mature. */
		due_on: { kind: 'date' },
		/** The date wages were actually received, including an advance. */
		paid_on: { kind: 'date', optional: true },
		/** Payroll, contract or opening-history evidence for the recorded figures. */
		reference: { kind: 'text' }
	},
	index: [['employment_id', 'due_on']],
	noOverlap: [
		{ key: ['employment_id'], period: 'period', name: 'employment_wage_periods_no_overlap' }
	],
	search: { text: ['reference'] }
});
