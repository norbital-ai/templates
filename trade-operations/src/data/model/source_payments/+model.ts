import { readPaymentSource } from '../../../integration/kingdee/financial-source.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { model, type CreateRow, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { agreement } from '../../../lib/agreements.js';

type Payment = Pick<
	CreateRow<'source_payments'>,
	| 'source'
	| 'order'
	| 'invoice'
	| 'external_code'
	| 'kind'
	| 'reference'
	| 'source_updated_at'
	| 'seal_hash'
	| 'currency'
	| 'amount'
	| 'active'
>;
/** A payment applies to this ledger's sealed agreement (and its issued invoice) and never moves once written. */
const settle = Effect.fnUntraced(function* (
	rows: readonly { readonly value: Payment; readonly old: StoredRow<'source_payments'> | null }[],
	ctx: WriteCtx<'source_payments'>
) {
	const { orders, transactions: invoices } = yield* ctx.db.query({
		orders: { where: { id: { in: rows.flatMap(({ value }) => value.order ?? []) } } },
		transactions: { where: { id: { in: rows.flatMap(({ value }) => value.invoice ?? []) } } }
	});
	for (const [i, { value, old }] of rows.entries()) {
		if (
			!value.order ||
			!value.reference?.trim() ||
			!value.source_updated_at ||
			value.amount == null ||
			Decimal.of(value.amount).eq(0) ||
			(value.kind === 'receipt' ? Decimal.of(value.amount).lt(0) : Decimal.of(value.amount).gt(0))
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		const order = orders.rows.find((row) => row.id === value.order);
		if (order && order.ledger !== value.source)
			return yield* ctx.refuse('errors.ledger_mismatch', { row: i });
		if (
			!order ||
			!agreement(order, value.seal_hash) ||
			value.currency !== agreement(order, value.seal_hash)?.snapshot.currency
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (
			old &&
			(value.order !== old.order ||
				value.external_code !== old.external_code ||
				value.reference !== old.reference ||
				value.currency !== old.currency ||
				value.seal_hash !== old.seal_hash ||
				value.source_updated_at < old.source_updated_at)
		)
			return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		if (value.invoice) {
			const invoice = invoices.rows.find((row) => row.id === value.invoice);
			if (
				!invoice ||
				invoice.order !== value.order ||
				invoice.kind !== 'invoice' ||
				(invoice.status !== 'issued' &&
					!(
						invoice.status === 'void' &&
						old?.invoice === value.invoice &&
						value.active === false
					)) ||
				invoice.currency !== value.currency ||
				invoice.seal_hash !== value.seal_hash
			)
				return yield* ctx.refuse('errors.evidence_sealed', { row: i });
		}
	}
});
export default model('source_payments', {
	description: 'Payments and refunds for each order.',
	label: 'reference',
	fields: {
		external_code: { kind: 'text' },
		kind: { kind: 'enum', values: ['receipt', 'refund'] },
		reference: { kind: 'text' },
		settled_on: { kind: 'date' },
		source_updated_at: { kind: 'instant' },
		seal_hash: { kind: 'text' },
		currency: { kind: 'currency' },
		amount: { kind: 'money', currency: 'currency' },
		active: { kind: 'bool', default: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		invoice: { kind: 'ref', to: 'transactions', optional: true },
		order: { kind: 'ref', to: 'orders', inverse: 'source_payments' }
	},
	key: ['source', 'external_code'],
	unique: [{ fields: ['order', 'reference'], name: 'one_source_receipt_per_order' }],
	// the payment ledger reads each payment's order (and its party) and invoice
	read: {
		source_payments: { fields: 'all' },
		'source_payments.order': { fields: 'all' },
		'source_payments.order.party': { fields: 'all' },
		'source_payments.invoice': { fields: 'all' }
	},
	// the sync alone writes payments (no local columns); its rows pass through these checks
	create: {
		columns: { source_payments: [] },
		transform: function* (rows, ctx) {
			yield* settle(
				rows.map((value) => ({ value, old: null })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: { source_payments: [] },
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
				return yield* readPaymentSource(instance, cursor, ctx);
			}
		}
	}
});
