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
	const { orders, invoices } = yield* ctx.db.query({
		orders: {
			from: 'orders',
			where: { id: { in: rows.flatMap(({ value }) => value.order ?? []) } },
			all: true
		},
		invoices: {
			from: 'transactions',
			where: { id: { in: rows.flatMap(({ value }) => value.invoice ?? []) } },
			all: true
		}
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
	read: 'all',
	// the sync alone writes payments (no local columns); its rows pass through these checks
	create: {
		columns: [],
		transform: function* (rows, ctx) {
			yield* settle(
				rows.map((value) => ({ value, old: null })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: [],
		transform: function* (changes, ctx) {
			yield* settle(
				changes.map(({ before, set }) => ({ value: { ...before, ...set }, old: before })),
				ctx
			);
			return changes.map(({ set }) => set);
		}
	},
	queries: {
		ledger: {
			description: 'Payments and refunds for this order.',
			input: {
				order: { kind: 'id', of: 'orders', optional: true },
				as_of: { kind: 'date', optional: true },
				unapplied: { kind: 'bool', optional: true },
				include_withdrawn: { kind: 'bool', optional: true }
			},
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order: { kind: 'id', of: 'orders' },
						order_number: { kind: 'text' },
						party_name: { kind: 'text' },
						invoice: { kind: 'id', of: 'transactions', optional: true },
						invoice_number: { kind: 'text' },
						reference: { kind: 'text' },
						currency: { kind: 'currency' },
						amount: { kind: 'money', currency: 'currency' },
						settled_on: { kind: 'date' },
						state: { kind: 'enum', values: ['active', 'withdrawn'] },
						source_payment: { kind: 'id', of: 'source_payments', optional: true }
					}
				}
			},
			run: function* (input, ctx) {
				if (input.include_withdrawn && !input.order) yield* ctx.refuse('errors.parent_mismatch');
				const as_of = input.as_of ?? null;
				if (as_of && as_of > ctx.today) yield* ctx.refuse('errors.report_future');
				if (input.order && !(yield* ctx.query('orders', { id: input.order })))
					yield* ctx.refuse('errors.parent_mismatch');
				const where = {
					...(input.order ? { order: { eq: input.order } } : {}),
					...(as_of ? { settled_on: { lte: as_of } } : {})
				};
				const { source, orders, invoices, parties } = yield* ctx.query({
					source: { from: 'source_payments', where, all: true },
					orders: { from: 'orders', select: { number: true, party: true }, all: true },
					parties: { from: 'parties', select: { name: true }, all: true },
					invoices: { from: 'transactions', select: { reference: true }, all: true }
				});
				const byOrder = new Map(orders.rows.map((r) => [r.id, r.number]));
				const byInvoice = new Map(invoices.rows.map((r) => [r.id, r.reference]));
				return source.rows
					.filter((p) => (p.active || input.include_withdrawn) && (!input.unapplied || !p.invoice))
					.map((p) => ({
						order: p.order,
						order_number: byOrder.get(p.order) ?? '',
						party_name:
							parties.rows.find((v) => v.id === orders.rows.find((o) => o.id === p.order)?.party)
								?.name ?? '',
						invoice: p.invoice,
						invoice_number: p.invoice ? (byInvoice.get(p.invoice) ?? '') : '',
						reference: p.reference,
						currency: p.currency,
						amount: p.amount,
						settled_on: p.settled_on,
						state: p.active ? ('active' as const) : ('withdrawn' as const),
						source_payment: p.id
					}))
					.sort(
						(a, b) =>
							b.settled_on.localeCompare(a.settled_on) || a.reference.localeCompare(b.reference)
					);
			}
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
