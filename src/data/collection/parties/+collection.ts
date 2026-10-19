import { collection } from '@norbital-ai/bolt';
import { agreementSelect } from '../../../lib/agreements.js';
import { partnerProgress } from '../../../lib/partner-progress.js';
const c = collection('parties', {
	read: { fields: 'all' },
	queries: {
		progress: {
			description: 'Approved agreement quotas against observed fulfillment.',
			input: { party: { kind: 'id', of: 'parties' } },
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order: { kind: 'id', of: 'orders' },
						number: { kind: 'text' },
						sku: { kind: 'text' },
						unit: { kind: 'text' },
						currency: { kind: 'currency' },
						quota: { kind: 'decimal', scale: 3 },
						delivered: { kind: 'decimal', scale: 3, optional: true },
						fulfillment: { kind: 'decimal', scale: 2, optional: true },
						forecast: { kind: 'money', currency: 'currency' },
						actual: { kind: 'money', currency: 'currency', optional: true },
						valid_until: { kind: 'date', optional: true },
						state: {
							kind: 'enum',
							values: ['unknown', 'late', 'complete', 'overdue', 'in_progress']
						}
					}
				}
			}
		}
	}
});
c.query('progress', function* (input, ctx) {
	if (!(yield* ctx.get('parties', input.party))) yield* ctx.refuse('errors.parent_mismatch');
	const { orders, transactions, sales } = yield* ctx.read({
		orders: {
			collection: 'orders',
			where: { party: { eq: input.party } },
			select: { ...agreementSelect, number: true, currency: true },
			all: true
		},
		transactions: {
			collection: 'transactions',
			select: {
				order: true,
				seal_hash: true,
				status: true,
				kind: true,
				items: true,
				issued_on: true
			},
			all: true
		},
		sales: {
			collection: 'source_sales_lines',
			select: {
				order: true,
				active: true,
				order_line: true,
				seal_hash: true,
				unit: true,
				quantity: true,
				kind: true,
				business_on: true,
				net_amount: true
			},
			all: true
		}
	});
	return partnerProgress(orders.rows, transactions.rows, sales.rows, ctx.today);
});
export default c;
