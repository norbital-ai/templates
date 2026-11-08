export const earliestReceivablesCutoff = '2024-12-31';

export const receivableEntries = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			contact_id: { kind: 'text' },
			customer_id: { kind: 'text' },
			customer: { kind: 'text' },
			reference: { kind: 'text' },
			kind: { kind: 'enum', values: ['invoice', 'receipt'] },
			business_on: { kind: 'date' },
			due_on: { kind: 'date', optional: true },
			remaining: { kind: 'text' },
			settlements: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: { on: { kind: 'date' }, amount: { kind: 'text' } }
				}
			}
		}
	}
} as const;
