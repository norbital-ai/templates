import { Effect } from 'effect';
import { readPurchaseOrders } from '../../../integration/kingdee/order-source.js';
import { model, type CreateRow, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { agreement, agreementFields } from '../../../lib/agreements.js';
type Header = Pick<
	CreateRow<'ext_purchase_orders'>,
	| 'order'
	| 'source'
	| 'external_id'
	| 'agreement_hash'
	| 'currency'
	| 'reference'
	| 'status'
	| 'source_updated_at'
>;
/** A confirmation is evidence of this ledger's sealed purchase agreement and never moves once written. */
const settle = Effect.fnUntraced(function* (
	rows: readonly {
		readonly value: Header;
		readonly old: StoredRow<'ext_purchase_orders'> | null;
	}[],
	ctx: WriteCtx<'ext_purchase_orders'>
) {
	const { orders } = yield* ctx.db.query({
		orders: {
			where: {
				id: {
					in: rows.flatMap(({ value, old }) => [value.order, old?.order].flatMap((id) => id ?? []))
				}
			},
			fields: [...agreementFields, 'direction', 'ledger']
		}
	});
	for (const [i, { value, old }] of rows.entries()) {
		if (!value.order) return yield* ctx.refuse('errors.order_not_confirmed', { row: i });
		const order = orders.rows.find((row) => row.id === value.order);
		if (!order || order.direction !== 'purchasing' || !agreement(order, value.agreement_hash))
			return yield* ctx.refuse('errors.order_not_confirmed', { row: i });
		if (order.ledger !== value.source)
			return yield* ctx.refuse('errors.ledger_mismatch', { row: i });
		if (
			value.currency !== agreement(order, value.agreement_hash)?.snapshot.currency ||
			!value.reference?.trim()
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old &&
			(value.order !== old.order ||
				value.external_id !== old.external_id ||
				value.agreement_hash !== old.agreement_hash ||
				value.currency !== old.currency)
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old?.source_updated_at &&
			(!value.source_updated_at || value.source_updated_at < old.source_updated_at)
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
	}
});
export default model('ext_purchase_orders', {
	description: 'Supplier order confirmation.',
	label: 'reference',
	fields: {
		external_id: { kind: 'text' },
		reference: { kind: 'text' },
		agreement_hash: { kind: 'text', hidden: true },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['draft', 'issued', 'void'] },
		source_updated_at: { kind: 'instant', optional: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		order: { kind: 'ref', to: 'orders', inverse: 'ext_purchase_orders' }
	},
	key: ['source', 'external_id'],
	read: 'all',
	// the sync alone writes confirmations (no local columns); its rows pass through these checks
	create: {
		columns: { ext_purchase_orders: [] },
		transform: function* (rows, ctx) {
			yield* settle(
				rows.map((value) => ({ value, old: null })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: { ext_purchase_orders: [] },
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
				return yield* readPurchaseOrders(instance, cursor, ctx);
			}
		}
	}
});
