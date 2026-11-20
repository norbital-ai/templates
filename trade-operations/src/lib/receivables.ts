export const earliestReceivablesCutoff = '2024-12-31';

export const receivableEntries = {
	kind: 'json',
	shape: {
		kind: 'object',
		fields: {
			contact_id: { kind: 'text' },
			customer_id: { kind: 'text' },
			customer: { kind: 'text' },
			reference: { kind: 'text' },
			kind: { kind: 'enum', values: ['invoice', 'receipt'] },
			business_on: { kind: 'date' },
			due_on: { kind: 'date', optional: true },
			// Kingdee's own due date: what its checkpoint sums, beside the one the order's terms set
			kingdee_due_on: { kind: 'date', optional: true },
			settlement: { kind: 'text', optional: true },
			delivered_on: { kind: 'date', optional: true },
			remaining: { kind: 'text' },
			settlements: {
				kind: 'object',
				fields: { on: { kind: 'date' }, amount: { kind: 'text' } },
				many: true
			}
		}
	},
	many: true
} as const;
