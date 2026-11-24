export const earliestPayablesCutoff = '2024-12-31';

/**
 * Hand-keyed KIS due dates outside 1900–2999 (e.g. a 3290 typo on a payment plan) read as none so
 * the report falls back to settlement-term rules instead of refusing the entire snapshot.
 */
export const safeDueDate = (value: string | null): string | null =>
	value === null || value < '1900-01-01' || value > '2999-12-31' ? null : value;

export const payableEntries = {
	kind: 'object',
	fields: {
		contact_id: { kind: 'text' },
		supplier_id: { kind: 'text' },
		supplier: { kind: 'text' },
		reference: { kind: 'text' },
		kind: { kind: 'enum', values: ['invoice', 'expense', 'payment'] },
		business_on: { kind: 'date' },
		due_on: { kind: 'date', optional: true },
		// Kingdee's own due date (1900–2999): what its checkpoint sums, beside any PO-term fallback
		kingdee_due_on: { kind: 'date', optional: true },
		settlement: { kind: 'text', optional: true },
		received_on: { kind: 'date', optional: true },
		remaining: { kind: 'text' },
		settlements: {
			kind: 'object',
			fields: { on: { kind: 'date' }, amount: { kind: 'text' } },
			many: true
		}
	},
	many: true
} as const;

export const payableAccruals = {
	kind: 'object',
	fields: {
		// YYYY-MM period of GL 2202.03 accrued-not-invoiced balance (not aged; noted beside the report)
		period: { kind: 'text' },
		amount: { kind: 'text' }
	},
	many: true
} as const;
