import { model } from '@norbital-ai/bolt';

export default model({
	description: 'The immutable wage-history records a payslip used to price statutory rates.',
	icon: 'lucide:link',
	label: 'wage_period_id',
	fields: {},
	unique: [{ fields: ['payslip_id', 'wage_period_id'] }]
});
