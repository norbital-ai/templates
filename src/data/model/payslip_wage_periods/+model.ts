import { model } from '@norbital-ai/bolt';

export default model({
	description: 'The immutable wage-history records a payslip used to price statutory rates.',
	icon: 'lucide:link',
	// ponytail: a join row has no text of its own; a constant names it until the payslip graph copies the period's reference
	label: 'title',
	computed: { title: { kind: 'text', expr: 'Wage period' } },
	fields: {},
	unique: [{ fields: ['payslip_id', 'wage_period_id'] }]
});
