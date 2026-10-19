import { agreement, agreementSelect } from '../../../lib/agreements.js';
import { collection, type TransformCtx } from '@norbital-ai/bolt';
const c = collection('ext_purchase_orders', { read: { fields: 'all' } });
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'ext_purchase_orders'>) {
	const { previous, orders } = yield* ctx.db.read({
		previous: {
			collection: 'ext_purchase_orders',
			where: {
				source: { in: inputs.flatMap((input) => (input.source ? [input.source] : [])) },
				external_id: {
					in: inputs.flatMap((input) => (input.external_id ? [input.external_id] : []))
				}
			},
			all: true
		},
		orders: {
			collection: 'orders',
			where: {
				or: [
					{ id: { in: inputs.flatMap((input, i) => input.order ?? ctx.existing[i]?.order ?? []) } },
					{ id: { in: { member: 'previous', field: 'order' } } }
				]
			},
			select: { ...agreementSelect, direction: true, ledger: true },
			all: true
		}
	});
	for (const [i, input] of inputs.entries()) {
		const old =
			ctx.existing[i] ??
			previous.rows.find(
				(row) => row.source === input.source && row.external_id === input.external_id
			);
		const value = { ...old, ...input };
		if (!value.order) return yield* ctx.refuse('errors.order_not_confirmed');
		const order = orders.rows.find((row) => row.id === value.order);
		if (
			!order ||
			order.direction !== 'purchasing' ||
			!['draft', 'confirmed', 'closed'].includes(order.status) ||
			!agreement(order, value.agreement_hash)
		)
			return yield* ctx.refuse('errors.order_not_confirmed');
		if (order.ledger !== value.source) return yield* ctx.refuse('errors.ledger_mismatch');
		if (
			value.currency !== agreement(order, value.agreement_hash)?.snapshot.currency ||
			!value.reference?.trim()
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		if (
			old &&
			(value.order !== old.order ||
				value.external_id !== old.external_id ||
				value.agreement_hash !== old.agreement_hash ||
				value.currency !== old.currency)
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		if (
			old?.source_updated_at &&
			(!value.source_updated_at || value.source_updated_at < old.source_updated_at)
		)
			return yield* ctx.refuse('errors.evidence_sealed');
	}
	return inputs;
});
