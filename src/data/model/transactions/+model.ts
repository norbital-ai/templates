import { Effect } from 'effect';
import { readTransactions } from '../../../integration/kingdee/order-source.js';
import { model, type CreateRow, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';
import { agreement } from '../../../lib/agreements.js';

const transactionItems = {
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
const transactionDocuments = {
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

type Evidence = Pick<
	CreateRow<'transactions'>,
	| 'source'
	| 'order'
	| 'ext_sales_order'
	| 'ext_purchase_order'
	| 'kind'
	| 'status'
	| 'seal_hash'
	| 'currency'
	| 'items'
	| 'documents'
	| 'issued_on'
	| 'total'
	| 'source_updated_at'
>;
/** A delivery or invoice is evidence of its issued parent's sealed agreement and never moves once written. */
const settle = Effect.fnUntraced(function* (
	rows: readonly { readonly value: Evidence; readonly old: StoredRow<'transactions'> | null }[],
	ctx: WriteCtx<'transactions'>
) {
	const {
		orders: owners,
		ext_sales_orders: sales,
		ext_purchase_orders: purchases
	} = yield* ctx.db.query({
		orders: {
			where: {
				id: {
					in: rows.flatMap(({ value, old }) => [value.order, old?.order].flatMap((id) => id ?? []))
				}
			}
		},
		ext_sales_orders: {
			where: { id: { in: rows.flatMap(({ value }) => value.ext_sales_order ?? []) } }
		},
		ext_purchase_orders: {
			where: { id: { in: rows.flatMap(({ value }) => value.ext_purchase_order ?? []) } }
		}
	});
	for (const [i, { value, old }] of rows.entries()) {
		if (
			old &&
			((old.ext_sales_order && value.ext_sales_order !== old.ext_sales_order) ||
				(old.ext_purchase_order && value.ext_purchase_order !== old.ext_purchase_order))
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (!value.ext_sales_order && !value.ext_purchase_order)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if ((value.ext_sales_order && value.ext_purchase_order) || !value.order)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		const order = owners.rows.find((row) => row.id === value.order);
		if (order && order.ledger !== value.source)
			yield* ctx.refuse('errors.ledger_mismatch', { row: i });
		const version = order ? agreement(order, value.seal_hash) : undefined;
		const parent = value.ext_sales_order
			? sales.rows.find((row) => row.id === value.ext_sales_order)
			: purchases.rows.find((row) => row.id === value.ext_purchase_order);
		if (
			!parent ||
			(parent.status !== 'issued' &&
				!(parent.status === 'void' && value.status === 'void' && old)) ||
			parent.order !== value.order ||
			parent.agreement_hash !== value.seal_hash ||
			!version ||
			value.currency !== version.snapshot.currency ||
			(value.ext_sales_order ? order?.direction !== 'sales' : order?.direction !== 'purchasing')
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			value.kind === 'invoice' &&
			value.status === 'issued' &&
			(!value.issued_on || value.total == null || Decimal.of(value.total).lt(0))
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old?.source_updated_at &&
			(!value.source_updated_at || value.source_updated_at < old.source_updated_at)
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old &&
			(value.order !== old.order ||
				value.kind !== old.kind ||
				value.seal_hash !== old.seal_hash ||
				value.currency !== old.currency)
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (value.status === 'issued' && !value.items?.length)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		const seen = new Set<string>();
		for (const item of value.items ?? []) {
			const line = version?.snapshot.lines.find((line) => line.id === item.order_line_id);
			if (
				seen.has(`${item.order_line_id}/${item.lot_number ?? ''}`) ||
				!line ||
				line.unit !== item.unit ||
				Decimal.of(item.quantity).lte(0) ||
				(item.net_amount != null && Decimal.of(item.net_amount).lt(0)) ||
				(item.unit_price != null && !Decimal.of(item.unit_price).eq(line.unit_price))
			)
				yield* ctx.refuse('errors.evidence_sealed', { row: i });
			seen.add(`${item.order_line_id}/${item.lot_number ?? ''}`);
		}
		for (const document of value.documents ?? []) {
			const url = new URL(document.url);
			if (
				url.protocol !== 'https:' ||
				url.username ||
				url.password ||
				!/^[a-f0-9]{64}$/i.test(document.sha256)
			)
				yield* ctx.refuse('errors.evidence_sealed', { row: i });
		}
	}
});
export default model('transactions', {
	description: 'Issued deliveries and invoices against an order agreement.',
	label: 'reference',
	fields: {
		erp_id: { kind: 'text', hidden: true },
		kind: { kind: 'enum', values: ['invoice', 'delivery'] },
		reference: { kind: 'text' },
		seal_hash: { kind: 'text', hidden: true },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['issued', 'void'], default: 'issued' },
		items: { kind: 'json', shape: transactionItems, optional: true },
		documents: { kind: 'json', shape: transactionDocuments, optional: true },
		issued_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		total: { kind: 'money', currency: 'currency', optional: true },
		source_updated_at: { kind: 'instant', optional: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		ext_sales_order: {
			kind: 'ref',
			to: 'ext_sales_orders',
			inverse: 'transactions',
			optional: true
		},
		ext_purchase_order: {
			kind: 'ref',
			to: 'ext_purchase_orders',
			inverse: 'transactions',
			optional: true
		},
		order: { kind: 'ref', to: 'orders', inverse: 'transactions' }
	},
	key: ['source', 'erp_id'],
	// aging names each invoice's order
	search: { text: ['reference', 'kind'] },
	read: { transactions: { fields: 'all' }, 'transactions.order': { fields: 'all' } },
	// the sync alone writes transactions (no local columns); its rows pass through these checks
	create: {
		columns: { transactions: [] },
		transform: function* (rows, ctx) {
			yield* settle(
				rows.map((value) => ({ value, old: null })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: { transactions: [] },
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ before, set }) => ({ value: { ...before, ...set }, old: before })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '5min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readTransactions(instance, cursor, ctx);
			}
		}
	}
});
