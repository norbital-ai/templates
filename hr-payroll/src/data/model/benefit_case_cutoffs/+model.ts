import { model } from '@norbital-ai/bolt';

/** One case-plan partition, with employee premium shares evidenced independently of wages. */
export default model({
	description:
		'Dated benefit leave partition and the sourced employee premium share of each scheme the case type nets full pay of. A forecast is rechecked against the run before settlement.',
	icon: 'lucide:calendar-range',
	label: 'cutoff_reference',
	fields: {
		cutoff_reference: { kind: 'text' },
		payroll_period: { kind: 'text' },
		salary_window: { kind: 'period', of: 'date' },
		leave_slice: { kind: 'period', of: 'date' },
		pay_on: { kind: 'date' },
		premium_basis: { kind: 'enum', values: ['ASSESSMENT', 'STATUTORY_PROJECTION'] },
		/** The employee share by `statutory_contributions` code (the case type's `premium_schemes`). */
		premium_shares: { kind: 'custom', of: 'entity_facts', default: {} },
		premium_reference: { kind: 'text' },
		premium_file: { kind: 'file', accept: ['*/*'], max: '20MiB' }
	},
	unique: [{ fields: ['benefit_case_plan_id', 'cutoff_reference'] }],
	index: [['benefit_case_plan_id', 'pay_on']],
	search: { text: ['cutoff_reference', 'premium_reference'] }
});
