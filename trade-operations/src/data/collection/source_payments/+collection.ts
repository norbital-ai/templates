import { agreement } from '../../../lib/agreements.js';
import { collection, type QueryCtx, type TransformCtx } from '@norbital-ai/bolt';
import { d } from '../../../lib/commercial.js';
const c = collection('source_payments', {
	read: { fields: 'all' },
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
			}
		}
	}
});
export default c;
c.query('ledger', function* (input, ctx: QueryCtx) {
	if (input.include_withdrawn && !input.order) yield* ctx.refuse('errors.parent_mismatch');
	const as_of = input.as_of ?? (input.unapplied ? ctx.today : null);
	if (as_of && as_of > ctx.today) yield* ctx.refuse('errors.report_future');
	if (input.order && !(yield* ctx.get('orders', input.order)))
		yield* ctx.refuse('errors.parent_mismatch');
	const where = {
		...(input.order ? { order: { eq: input.order } } : {}),
		...(as_of ? { settled_on: { lte: as_of } } : {})
	};
	const { source, orders, invoices, parties } = yield* ctx.read({
		source: { collection: 'source_payments', where, all: true },
		orders: { collection: 'orders', select: { number: true, party: true }, all: true },
		parties: { collection: 'parties', select: { name: true }, all: true },
		invoices: { collection: 'transactions', select: { reference: true }, all: true }
	});
	const byOrder = new Map(orders.rows.map((r) => [r.id, r.number]));
	const byInvoice = new Map(invoices.rows.map((r) => [r.id, r.reference]));
	return source.rows
		.filter((p) => (p.active || input.include_withdrawn) && (!input.unapplied || !p.invoice))
		.map((p) => ({
			order: p.order,
			order_number: byOrder.get(p.order) ?? '',
			party_name:
				parties.rows.find((v) => v.id === orders.rows.find((o) => o.id === p.order)?.party)?.name ??
				'',
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
			(a, b) => b.settled_on.localeCompare(a.settled_on) || a.reference.localeCompare(b.reference)
		);
});
c.transform(function* (inputs, ctx: TransformCtx<'source_payments'>) {
	const { previous } = yield* ctx.db.read({
		previous: {
			collection: 'source_payments',
			where: {
				source: { in: inputs.flatMap((p) => (p.source ? [p.source] : [])) },
				external_code: { in: inputs.flatMap((p) => (p.external_code ? [p.external_code] : [])) }
			},
			all: true
		}
	});
	for (const [i, input] of inputs.entries()) {
		const old =
			ctx.existing[i] ??
			previous.rows.find(
				(p) => p.source === input.source && p.external_code === input.external_code
			);
		const value = { ...old, ...input };
		if (
			!value.order ||
			!value.reference?.trim() ||
			!value.source_updated_at ||
			value.amount == null ||
			d(value.amount).eq(0) ||
			(value.kind === 'receipt' ? d(value.amount).lt(0) : d(value.amount).gt(0))
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		const order = yield* ctx.db.get('orders', value.order);
		if (order && order.ledger !== value.source) return yield* ctx.refuse('errors.ledger_mismatch');
		if (
			!order ||
			!agreement(order, value.seal_hash) ||
			value.currency !== agreement(order, value.seal_hash)?.snapshot.currency
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		if (
			old &&
			(value.order !== old.order ||
				value.external_code !== old.external_code ||
				value.reference !== old.reference ||
				value.currency !== old.currency ||
				value.seal_hash !== old.seal_hash ||
				value.source_updated_at < old.source_updated_at)
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		if (value.invoice) {
			const invoice = yield* ctx.db.get('transactions', value.invoice);
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
				return yield* ctx.refuse('errors.evidence_sealed');
		}
	}
	return inputs;
});
