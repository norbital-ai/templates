import type { Id, Row } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';

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
	const quantities = new Map<string, BigDecimal.BigDecimal>();
	for (const delivery of deliveries)
		for (const item of delivery.items ?? []) {
			const key = `${item.order_line_id}/${item.unit}`;
			quantities.set(
				key,
				BigDecimal.sum(
					quantities.get(key) ?? BigDecimal.fromBigInt(0n),
					BigDecimal.fromStringUnsafe(item.quantity)
				)
			);
		}
	return quantities;
}
