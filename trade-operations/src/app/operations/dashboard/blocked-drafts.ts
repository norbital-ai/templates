import type { Row } from '@norbital-ai/bolt';

/**
 * The drafts that cannot sync to Kingdee yet, and why: no payment terms, no lines, or an open request holding the
 * order or one of its lines.
 */
export function blockedDrafts(
	orders: readonly Pick<Row<'orders'>, 'id' | 'payment_terms' | 'line_count' | '$approval'>[],
	lines: readonly Pick<Row<'order_lines'>, 'order' | '$approval'>[]
) {
	const held = new Set(lines.flatMap((line) => (line.$approval ? [line.order] : [])));
	return orders.flatMap((order) => {
		const reasons = [
			...(order.payment_terms ? [] : (['no_terms'] as const)),
			...(order.line_count ? [] : (['no_lines'] as const)),
			...(order.$approval || held.has(order.id) ? (['approval'] as const) : [])
		];
		return reasons.length ? [{ order: order.id, reasons }] : [];
	});
}
