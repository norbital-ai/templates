import { model } from '@norbital-ai/bolt';
import { agreementSelect } from '../../../lib/agreements.js';
import { partnerProgress } from '../../../lib/partner-progress.js';
import { columns, readSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';
export default model('parties', {
	description: 'parties',
	label: 'name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['customer', 'supplier', 'both']
		},
		currency: {
			kind: 'currency'
		},
		active: {
			kind: 'bool',
			default: true
		},
		address: {
			kind: 'text',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	search: {
		text: ['name', 'external_code']
	},
	key: ['source', 'external_code'],
	read: 'all',
	queries: {
		progress: {
			description: 'Approved agreement quotas against observed fulfillment on a date.',
			input: { party: { kind: 'id', of: 'parties' }, as_of: { kind: 'date' } },
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
							values: [
								'unknown',
								'late',
								'complete',
								'overdue',
								'in_progress',
								'source_void',
								'source_closed'
							]
						}
					}
				}
			},
			run: function* (input, ctx) {
				if (!(yield* ctx.query('parties', { id: input.party })))
					yield* ctx.refuse('errors.parent_mismatch');
				const { orders, transactions, sales } = yield* ctx.query({
					orders: {
						from: 'orders',
						where: { party: { eq: input.party } },
						select: { ...agreementSelect, number: true, currency: true },
						all: true
					},
					transactions: {
						from: 'transactions',
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
						from: 'source_sales_lines',
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
				return partnerProgress(orders.rows, transactions.rows, sales.rows, input.as_of);
			}
		}
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readSource(
					projections.parties,
					cursor,
					ctx,
					(row) => {
						const r = columns(row);
						return {
							external_code: r.text('external_code'),
							source_number: r.text('source_number', null),
							name: r.text('name'),
							kind: r.one('kind', ['customer', 'supplier', 'both']),
							currency: r.currency('currency'),
							active: r.bool('active', true),
							address: r.text('address', null),
							phone: r.text('phone', null),
							source_updated_at: r.instant('source_updated_at')
						};
					},
					preserveSource({ model: 'parties', instance, projection: projections.parties, ctx })
				);
			}
		}
	}
});
