import { agreement } from '../../../lib/agreements.js';
import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { d } from '../../../lib/commercial.js';
const c = collection('transactions', { read: { fields: 'all' } });
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'transactions'>) {
	const { identities } = yield* ctx.db.read({
		identities: {
			collection: 'transactions',
			where: {
				source: { in: inputs.flatMap((input) => (input.source ? [input.source] : [])) },
				erp_id: { in: inputs.flatMap((input) => (input.erp_id ? [input.erp_id] : [])) }
			},
			select: { order: true },
			all: true
		}
	});
	const orders = [
		...identities.rows.map((row) => row.order),
		...inputs.flatMap((input, i) => {
			const order = input.order ?? ctx.existing[i]?.order;
			return order ? [order] : [];
		})
	];
	const { previous, owners } = yield* ctx.db.read({
		previous: {
			collection: 'transactions',
			where: { order: { in: orders } },
			select: {
				source: true,
				erp_id: true,
				order: true,
				kind: true,
				status: true,
				items: true,
				documents: true,
				seal_hash: true,
				ext_sales_order: true,
				ext_purchase_order: true,
				source_updated_at: true,
				currency: true
			},
			all: true
		},
		owners: { collection: 'orders', where: { id: { in: orders } }, all: true }
	});
	const old = inputs.map((input, i) =>
		previous.rows.find(
			(row) =>
				row.id === ctx.existing[i]?.id ||
				(input.erp_id && row.source === input.source && row.erp_id === input.erp_id)
		)
	);
	for (const [i, input] of inputs.entries()) {
		const value = { ...old[i], ...input };
		const previousParent = old[i];
		if (
			previousParent &&
			((previousParent.ext_sales_order &&
				value.ext_sales_order !== previousParent.ext_sales_order) ||
				(previousParent.ext_purchase_order &&
					value.ext_purchase_order !== previousParent.ext_purchase_order))
		)
			yield* ctx.refuse('errors.evidence_sealed');
		if (!value.ext_sales_order && !value.ext_purchase_order)
			yield* ctx.refuse('errors.evidence_sealed');
		if ((value.ext_sales_order && value.ext_purchase_order) || !value.order)
			yield* ctx.refuse('errors.evidence_sealed');
		const order = owners.rows.find((row) => row.id === value.order);
		if (order && order.ledger !== value.source) yield* ctx.refuse('errors.ledger_mismatch');
		const version = order ? agreement(order, value.seal_hash) : undefined;
		const parent = value.ext_sales_order
			? yield* ctx.db.get('ext_sales_orders', value.ext_sales_order)
			: yield* ctx.db.get('ext_purchase_orders', value.ext_purchase_order!);
		if (
			!parent ||
			(parent.status !== 'issued' &&
				!(parent.status === 'void' && value.status === 'void' && previousParent)) ||
			parent.order !== value.order ||
			parent.agreement_hash !== value.seal_hash ||
			!version ||
			value.currency !== version.snapshot.currency ||
			(value.ext_sales_order ? order?.direction !== 'sales' : order?.direction !== 'purchasing')
		)
			yield* ctx.refuse('errors.evidence_sealed');
		if (
			value.kind === 'invoice' &&
			value.status === 'issued' &&
			(!value.issued_on || value.total == null || d(value.total).lt(0))
		)
			yield* ctx.refuse('errors.evidence_sealed');
		if (
			previousParent?.source_updated_at &&
			(!value.source_updated_at || value.source_updated_at < previousParent.source_updated_at)
		)
			yield* ctx.refuse('errors.evidence_sealed');
		if (
			previousParent &&
			(value.order !== previousParent.order ||
				value.kind !== previousParent.kind ||
				value.seal_hash !== previousParent.seal_hash ||
				value.currency !== previousParent.currency)
		)
			yield* ctx.refuse('errors.evidence_sealed');
		if (value.status === 'issued' && (!value.items?.length || !value.documents?.length))
			yield* ctx.refuse('errors.evidence_sealed');
		const seen = new Set<string>();
		for (const item of value.items ?? []) {
			const line = version?.snapshot.lines.find((line) => line.id === item.order_line_id);
			if (
				seen.has(`${item.order_line_id}/${item.lot_number ?? ''}`) ||
				!line ||
				line.unit !== item.unit ||
				d(item.quantity).lte(0) ||
				(item.net_amount != null && d(item.net_amount).lt(0)) ||
				(item.unit_price != null && !d(item.unit_price).eq(line.unit_price))
			)
				yield* ctx.refuse('errors.evidence_sealed');
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
				yield* ctx.refuse('errors.evidence_sealed');
		}
	}
	return inputs;
});
