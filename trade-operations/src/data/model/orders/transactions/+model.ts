import { BigDecimal, Effect } from 'effect';
import { logisticsDocument, logisticsOrder } from '../../../../lib/logistics.js';
import { type CreatedRow, model, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';

const transactionItems = {
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
	},
	many: true
} as const;
const transactionDocuments = {
	kind: 'object',
	fields: {
		name: { kind: 'text' },
		url: { kind: 'text' },
		sha256: { kind: 'text' }
	},
	many: true
} as const;

type Evidence = Pick<
	CreatedRow<'transactions'>,
	| 'source'
	| 'order'
	| 'kind'
	| 'status'
	| 'currency'
	| 'items'
	| 'documents'
	| 'issued_on'
	| 'total'
	| 'source_updated_at'
>;
/** A delivery or invoice is evidence of its order's issued Kingdee SO or PO and never moves once written. */
const settle = Effect.fnUntraced(function* (
	rows: readonly { readonly value: Evidence; readonly old: StoredRow<'transactions'> | null }[],
	ctx: WriteCtx<'transactions'>
) {
	const orderIds = [...new Set(rows.flatMap(({ value }) => value.order ?? []))];
	const { orders: owners, order_lines: lines } = yield* ctx.query({
		orders: { where: { id: { in: orderIds } } },
		order_lines: { where: { order: { in: orderIds } }, fields: ['order', 'unit', 'unit_price'] }
	});
	for (const [i, { value, old }] of rows.entries()) {
		const order = owners.rows.find((row) => row.id === value.order);
		if (!order) return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (order.ledger !== value.source) yield* ctx.refuse('errors.ledger_mismatch', { row: i });
		const parent = order.kingdee;
		if (
			!parent ||
			(parent.status !== 'issued' &&
				!(parent.status === 'void' && value.status === 'void' && old)) ||
			value.currency !== order.currency
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		const first = value.items?.[0];
		const reversal =
			first !== undefined && BigDecimal.isNegative(BigDecimal.fromStringUnsafe(first.quantity));
		const factor = BigDecimal.fromBigInt(reversal ? -1n : 1n);
		const priorQuantity = old?.items?.[0]?.quantity;
		if (
			first &&
			priorQuantity != null &&
			reversal !== BigDecimal.isNegative(BigDecimal.fromStringUnsafe(priorQuantity))
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			value.kind === 'invoice' &&
			value.status === 'issued' &&
			(!value.issued_on ||
				value.total == null ||
				BigDecimal.isNegative(
					BigDecimal.multiply(BigDecimal.fromStringUnsafe(value.total), factor)
				))
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old?.source_updated_at &&
			(!value.source_updated_at || value.source_updated_at < old.source_updated_at)
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old &&
			(value.order !== old.order || value.kind !== old.kind || value.currency !== old.currency)
		)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if ((value.status === 'issued' || value.status === 'draft') && !value.items?.length)
			yield* ctx.refuse('errors.evidence_sealed', { row: i });
		const seen = new Set<string>();
		for (const item of value.items ?? []) {
			const line = lines.rows.find((line) => line.id === item.order_line_id);
			if (
				seen.has(`${item.order_line_id}/${item.lot_number ?? ''}`) ||
				!line ||
				line.unit !== item.unit ||
				!BigDecimal.isPositive(
					BigDecimal.multiply(BigDecimal.fromStringUnsafe(item.quantity), factor)
				) ||
				(item.net_amount != null &&
					BigDecimal.isNegative(
						BigDecimal.multiply(BigDecimal.fromStringUnsafe(item.net_amount), factor)
					)) ||
				(item.unit_price != null &&
					!BigDecimal.equals(
						BigDecimal.fromStringUnsafe(item.unit_price),
						BigDecimal.fromStringUnsafe(line.unit_price)
					))
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
	description: 'Deliveries (unaudited and issued) and issued invoices against an order.',
	record_label: 'record.reference',
	fields: {
		erp_id: { kind: 'text', hidden: true },
		kind: { kind: 'enum', values: ['invoice', 'delivery'] },
		reference: { kind: 'text' },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['draft', 'issued', 'void'], default: 'issued' },
		items: { kind: 'json', shape: transactionItems, optional: true },
		documents: { kind: 'json', shape: transactionDocuments, optional: true },
		issued_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		total: { kind: 'money', currency: 'currency', optional: true },
		credit_check: {
			kind: 'enum',
			values: ['passed', 'failed', 'released', 'bypassed', 'unchecked'],
			optional: true
		},
		credit_check_detail: { kind: 'text', optional: true },
		credit_checked_at: { kind: 'instant', optional: true },
		source_updated_at: { kind: 'instant', optional: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		order: { kind: 'ref', to: 'orders', inverse: 'transactions' }
	},
	outputs: {
		default: { fields: 'all', order: { fields: 'all', ledger: { fields: ['name'] } } },
		logistics: { fields: logisticsDocument, order: { fields: logisticsOrder } }
	},
	constraints: { natural_key: { unique: ['source', 'erp_id'], import_key: true } },
	// aging names each invoice's order
	indexes: { search: { text: ['reference', 'kind'] } },
	// the sync alone writes transactions (no local columns); its rows pass through these checks
	create: {
		fields: [
			'erp_id',
			'kind',
			'reference',
			'currency',
			'status',
			'items',
			'documents',
			'issued_on',
			'due_on',
			'total',
			'credit_check',
			'credit_check_detail',
			'credit_checked_at',
			'source_updated_at',
			'source',
			'order'
		],
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ after }) => ({ value: after, old: null })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: [
			'erp_id',
			'kind',
			'reference',
			'currency',
			'status',
			'items',
			'documents',
			'issued_on',
			'due_on',
			'total',
			'credit_check',
			'credit_check_detail',
			'credit_checked_at',
			'source_updated_at',
			'source',
			'order'
		],
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ before, after }) => ({ value: after, old: before })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
