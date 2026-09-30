import { model } from '@norbital-ai/bolt';

/** Frozen source facts for a benefit advance; a candidate is never the scheme's award. */
export default model({
	description:
		'Documented full-pay basis and a frozen contribution-statement candidate for one benefit case. Cash payment and the later actual award are separate records.',
	icon: 'lucide:file-calculator',
	label: 'basis_reference',
	fields: {
		basis_method: { kind: 'enum', values: ['DOCUMENTED_MONTHLY_EQUIVALENT'] },
		monthly_full_pay_basis: { kind: 'decimal', scale: 2, min: 0.01 },
		qualifying_allowances_assessed: { kind: 'bool' },
		basis_reference: { kind: 'text' },
		basis_file: { kind: 'file', accept: ['*/*'], max: '20MiB' },
		/** Immutable correction sequence; an earlier revision remains visible but cannot settle. */
		plan_number: { kind: 'int', min: 1, optional: true },
		plan_created_on: { kind: 'date', optional: true },
		application_on_at_plan: { kind: 'date', optional: true },
		advance_due_on: { kind: 'date', optional: true },
		event_basis_kind: { kind: 'enum', values: ['EXPECTED_EVENT', 'ACTUAL_EVENT'], optional: true },
		event_basis_on: { kind: 'date', optional: true },
		candidate_amount: { kind: 'decimal', scale: 2, min: 0, optional: true },
		candidate_compensable_days: { kind: 'int', optional: true },
		candidate_window_from: { kind: 'text', optional: true },
		candidate_window_through: { kind: 'text', optional: true },
		/** The window's statement months, paid dates and credits, as captured when the plan was made. */
		history_snapshot: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['benefit_case_id', 'plan_number'] }],
	index: [['advance_due_on']],
	search: { text: ['basis_reference'] }
});
