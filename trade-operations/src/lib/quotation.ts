import { BigDecimal } from 'effect';
import { type Id, type ReadAnswer } from '@norbital-ai/bolt';
import { price, unitRatio } from './commercial.js';
import {
	averageLotCost,
	estimateFifoCost,
	fifoStockFields,
	type PurchaseLotCosts
} from './lot-cost.js';
import { confirmedAt, feeds, type Ledger } from '../integration/kingdee/connection-status.js';
/** One draft's quotation read: the order with its party and lines. */
export const quotationRead = (order: Id<'orders'>) =>
	({ orders: { where: { id: { eq: order } }, limit: 1, party: {}, lines: {} } }) as const;
/** The saved order facts that scope its cost read. */
export const quotationScopeRead = (order: Id<'orders'>) =>
	({
		orders: {
			where: { id: { eq: order } },
			fields: ['revision'],
			limit: 1,
			lines: { fields: ['product'] }
		}
	}) as const;
/** The draft with the stock lots of its products, without sending unrelated ones. */
export const quotationCostRead = (
	order: ReadAnswer<ReturnType<typeof quotationScopeRead>>['orders']['rows'][number]
) => {
	const products = [...new Set(order.lines.map((line) => line.product))];
	return {
		orders: {
			...quotationRead(order.id).orders,
			// a concurrent edit refreshes the scope before these lots can price it
			where: {
				id: { eq: order.id },
				revision: { eq: order.revision },
				lines: { every: { product: { in: products } } }
			}
		},
		stock_snapshots: {
			where: { product: { in: products } },
			fields: [...fifoStockFields, 'currency', 'unit_cost'],
			limit: 10000
		}
	} as const;
};
type CostAnswer = ReadAnswer<ReturnType<typeof quotationCostRead>>;
/** The sales lines priced below their product's quantity-weighted remaining inventory cost. */
export function belowInventoryCost(answer: CostAnswer) {
	const doc = answer.orders.rows[0];
	if (!doc || doc.direction !== 'sales') return [];
	return doc.lines
		.filter((line) => {
			const average = averageLotCost(
				answer.stock_snapshots.rows,
				line.product,
				line.unit,
				doc.currency
			);
			return (
				average !== null &&
				BigDecimal.isLessThan(
					BigDecimal.round(
						BigDecimal.divideUnsafe(
							price(doc, line).net,
							BigDecimal.fromStringUnsafe(line.quantity)
						),
						{ scale: 8 }
					),
					average
				)
			);
		})
		.map((line) => line.product_name);
}
export function quotationFifoCosts(
	answer: CostAnswer,
	purchase: PurchaseLotCosts,
	as_of: string,
	ledger: Ledger
) {
	const doc = answer.orders.rows[0];
	if (!doc || doc.direction !== 'sales' || !doc.warehouse || !doc.ledger) return [];
	const source = doc.ledger;
	const confirmed = {
		stock: confirmedAt(ledger, feeds.stock, as_of),
		lots: confirmedAt(ledger, feeds.lotCosts, as_of)
	};
	const warehouse = doc.warehouse;
	const groups = new Map<
		string,
		{
			line: (typeof doc.lines)[number];
			quantity: BigDecimal.BigDecimal;
			net: BigDecimal.BigDecimal;
		}
	>();
	for (const line of doc.lines) {
		const net = price(doc, line).net;
		const lineQty = BigDecimal.fromStringUnsafe(line.quantity);
		// Share one FIFO lot queue across lines of the same product with compatible units (e.g. kg + t).
		let matched: {
			line: (typeof doc.lines)[number];
			quantity: BigDecimal.BigDecimal;
			net: BigDecimal.BigDecimal;
		} | null = null;
		let ratio: BigDecimal.BigDecimal | null = null;
		for (const existing of groups.values()) {
			if (existing.line.product !== line.product) continue;
			const converted = unitRatio(line.unit, existing.line.unit);
			if (converted !== null) {
				matched = existing;
				ratio = converted;
				break;
			}
		}
		if (matched && ratio !== null) {
			matched.quantity = BigDecimal.sum(matched.quantity, BigDecimal.multiply(lineQty, ratio));
			matched.net = BigDecimal.sum(matched.net, net);
		} else {
			const key = JSON.stringify([line.product, line.unit.normalize('NFKC').trim().toLowerCase()]);
			groups.set(key, { line, quantity: lineQty, net });
		}
	}
	return [...groups].map(([key, { line, quantity, net }]) => {
		const estimate = answer.stock_snapshots.next
			? null
			: estimateFifoCost(answer.stock_snapshots.rows, purchase, {
					product: line.product,
					productCode: line.product_code,
					source,
					warehouses: [warehouse],
					quantity: BigDecimal.format(quantity),
					unit: line.unit,
					currency: doc.currency,
					as_of,
					confirmed
				});
		return {
			key,
			product: line.product_name,
			quantity,
			unit: line.unit,
			estimate,
			below: estimate !== null && BigDecimal.isLessThan(net, estimate.total)
		};
	});
}
