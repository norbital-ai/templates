import type { Id, Row } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { type D, dec } from './values.js';

export const orderDeliveries = (order: Id<'orders'>) =>
	({
		transactions: {
			where: { order: { eq: order }, kind: { eq: 'delivery' }, status: { eq: 'issued' } },
			// A corrected source sweep refreshes the first live page even if its quantities stayed the same.
			fields: ['items', 'source_updated_at'],
			limit: 100
		}
	}) as const;

/** Delivered quantity per order line and unit, keyed `<line id>/<unit>`. */
export function deliveredByLine(deliveries: readonly Pick<Row<'transactions'>, 'items'>[]) {
	const quantities = new Map<string, D>();
	for (const delivery of deliveries)
		for (const item of delivery.items ?? []) {
			const key = `${item.order_line_id}/${item.unit}`;
			quantities.set(key, BigDecimal.sum(quantities.get(key) ?? dec(0), dec(item.quantity)));
		}
	return quantities;
}
