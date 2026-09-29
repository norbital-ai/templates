import { model } from '@norbital-ai/bolt';

/** One case-plan partition, with employee premium shares evidenced independently of wages. */
export default model({
	description:
		'Dated maternity leave partition and sourced employee SSS, PhilHealth and Pag-IBIG premium shares. A forecast is rechecked against the run before settlement.',
	icon: 'lucide:calendar-range',
	label: 'cutoff_reference',
	fields: {
		cutoff_reference: { kind: 'text' },
		payroll_period: { kind: 'text' },
		salary_window: { kind: 'period', of: 'date' },
		leave_slice: { kind: 'period', of: 'date' },
		pay_on: { kind: 'date' },
		premium_basis: { kind: 'enum', values: ['ASSESSMENT', 'STATUTORY_PROJECTION'] },
		employee_sss_share: { kind: 'decimal', scale: 2, min: 0 },
		employee_philhealth_share: { kind: 'decimal', scale: 2, min: 0 },
		employee_pagibig_share: { kind: 'decimal', scale: 2, min: 0 },
		premium_reference: { kind: 'text' },
		premium_file: { kind: 'file', accept: ['*/*'], max: '20MiB' }
	},
	unique: [{ fields: ['ph_maternity_pay_plan_id', 'cutoff_reference'] }],
	index: [['ph_maternity_pay_plan_id', 'pay_on']],
	search: { text: ['cutoff_reference', 'premium_reference'] }
});
