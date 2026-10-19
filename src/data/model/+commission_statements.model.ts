import { model } from '@norbital-ai/bolt';
export default model({
	description: 'Monthly salesperson commission statement.',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'CS-{yyyy}-{0000}' },
		period: { kind: 'date' },
		currency: { kind: 'currency' },
		calculation_hash: { kind: 'text' },
		amount: { kind: 'money', currency: 'currency' },
		order_count: { kind: 'int' },
		acknowledged_at: { kind: 'instant' },
		snapshot: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order: { kind: 'text' },
						number: { kind: 'text' },
						seal_hash: { kind: 'text' },
						calculation_hash: { kind: 'text' },
						amount: { kind: 'text', optional: true },
						unresolved_lines: { kind: 'int' },
						awaiting_approval: { kind: 'bool' }
					}
				}
			}
		}
	},
	unique: [
		{
			fields: ['owner', 'period', 'currency', 'calculation_hash'],
			name: 'one_monthly_commission_statement'
		}
	]
});
