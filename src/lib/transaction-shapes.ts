export const transactionItems = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			lot_number: { kind: 'text', optional: true },
			unit_cost: { kind: 'decimal', scale: 8, optional: true },
			net_amount: { kind: 'decimal', scale: 8, optional: true },
			order_line_id: { kind: 'text' },
			product_name: { kind: 'text' },
			unit: { kind: 'text' },
			quantity: { kind: 'decimal', scale: 3 },
			unit_price: { kind: 'decimal', scale: 4, optional: true }
		}
	}
} as const;
export const transactionDocuments = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			name: { kind: 'text' },
			url: { kind: 'text' },
			sha256: { kind: 'text' }
		}
	}
} as const;
