import { model } from '../../../../../.norbital/models/ext_purchase_orders.ts';
import { Effect } from 'effect';
import { logisticsReceipt } from '../../../../lib/logistics.js';
import { type CreatedRow, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { agreement, agreementFields } from '../../../../lib/agreements.js';
type Header = Pick<
	CreatedRow<'ext_purchase_orders'>,
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
	const { orders } = yield* ctx.query({
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
export default model({
	description: 'Supplier order confirmation.',
	record_label: 'record.reference',
	fields: {
		external_id: { kind: 'text', hidden: true },
		reference: { kind: 'text' },
		agreement_hash: { kind: 'text', hidden: true },
		currency: { kind: 'currency' },
		status: { kind: 'enum', values: ['draft', 'issued', 'void'] },
		source_updated_at: { kind: 'instant', optional: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		order: { kind: 'ref', to: 'orders', inverse: 'ext_purchase_orders' }
	},
	outputs: { default: { fields: 'all' }, logistics: { fields: logisticsReceipt } },
	constraints: { natural_key: { unique: ['source', 'external_id'], import_key: true } },
	// Retain existing confirmation evidence. No PO sync is scheduled without a verified source binding.
	create: {
		columns: { fields: [] },
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ after }) => ({ value: after, old: null })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		columns: { fields: [] },
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ before, set }) => ({ value: { ...before, ...set }, old: before })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	}
});
