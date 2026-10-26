import { currency, Decimal, sum } from '@norbital-ai/std/decimal';
import {
	agreements,
	currentAgreement,
	executableAgreement,
	type AgreementOrder
} from './agreements.js';

import { PlainDate } from '@norbital-ai/std/date';
import { isMasked, type Row } from '@norbital-ai/bolt';
/** Latest approved quota per order; documents and sales facts retain their own approved SKU identity. */
export function partnerProgress(
	orders: readonly (AgreementOrder & Pick<Row<'orders'>, 'id' | 'number' | 'currency'>)[],
	documents: readonly Pick<
		Row<'transactions'>,
		'order' | 'seal_hash' | 'status' | 'kind' | 'items' | 'issued_on'
	>[],
	sales: readonly Pick<
		Row<'source_sales_lines'>,
		| 'order'
		| 'seal_hash'
		| 'active'
		| 'order_line'
		| 'unit'
		| 'quantity'
		| 'kind'
		| 'business_on'
		| 'net_amount'
	>[],
	today: string
) {
	return orders.flatMap((order) => {
		const versions = agreements(order),
			current = currentAgreement(order);
		if (!current) return [];
		const executable = executableAgreement(order);
		const lines = new Map(
			versions.flatMap((version) =>
				version.snapshot.lines.map((line) => [`${version.seal_hash}:${line.id}`, line] as const)
			)
		);
		const issued = documents.filter((doc) => doc.order === order.id && doc.status === 'issued');
		const facts = sales.filter((fact) => fact.order === order.id && fact.active);
		return current.snapshot.lines.map((line) => {
			const deliveries = issued.filter((doc) => doc.kind === 'delivery');
			const quantities = deliveries.flatMap((doc) =>
				doc.items && !isMasked(doc.items)
					? doc.items
							.filter(
								(item) =>
									lines.get(`${doc.seal_hash}:${item.order_line_id}`)?.product === line.product &&
									item.unit === line.unit
							)
							.map((item) => item.quantity)
					: []
			);
			const matching = facts.filter(
				(fact) =>
					lines.get(`${fact.seal_hash}:${fact.order_line}`)?.product === line.product &&
					fact.unit === line.unit
			);
			const physical = matching.some((fact) => fact.kind === 'shipment');
			const quantity = physical
				? sum(matching.filter((fact) => fact.kind !== 'invoice_only').map((fact) => fact.quantity))
				: deliveries.length
					? sum(quantities).plus(
							sum(matching.filter((fact) => fact.kind === 'return').map((fact) => fact.quantity))
						)
					: issued.length || matching.length
						? null
						: Decimal.of(0);
			const until = current.snapshot.valid_until;
			const complete = quantity !== null && quantity.gte(line.quantity);
			const events =
				!physical && deliveries.length
					? [
							...deliveries.flatMap((doc) =>
								doc.items && !isMasked(doc.items)
									? [
											{
												on: doc.issued_on,
												quantity: sum(
													doc.items
														.filter(
															(item) =>
																lines.get(`${doc.seal_hash}:${item.order_line_id}`)?.product ===
																	line.product && item.unit === line.unit
														)
														.map((item) => item.quantity)
												)
											}
										]
									: []
							),
							...matching
								.filter((fact) => fact.kind === 'return')
								.map((fact) => ({ on: fact.business_on, quantity: fact.quantity }))
						]
					: matching
							.filter((fact) => fact.kind !== 'invoice_only')
							.map((fact) => ({ on: fact.business_on, quantity: fact.quantity }));
			let running = Decimal.of(0),
				fulfilled: string | null = null;
			for (const event of events
				.filter((event) => event.on !== null)
				.sort((a, b) => a.on!.localeCompare(b.on!))) {
				const before = running.lt(line.quantity);
				running = running.plus(event.quantity);
				if (running.lt(line.quantity)) fulfilled = null;
				else if (before) fulfilled = event.on;
			}
			if (!complete || events.some((event) => event.on === null)) fulfilled = null;
			const state:
				| 'unknown'
				| 'late'
				| 'complete'
				| 'overdue'
				| 'in_progress'
				| 'source_void'
				| 'source_closed' =
				current.kingdee?.status === 'void'
					? 'source_void'
					: current.kingdee?.closed
						? 'source_closed'
						: quantity === null
							? 'unknown'
							: complete
								? until && fulfilled && fulfilled > until
									? 'late'
									: 'complete'
								: until && until < today
									? 'overdue'
									: 'in_progress';
			const invoiceItems = issued
				.filter((doc) => doc.kind === 'invoice')
				.flatMap((doc) =>
					doc.items && !isMasked(doc.items)
						? doc.items.filter(
								(item) =>
									lines.get(`${doc.seal_hash}:${item.order_line_id}`)?.product === line.product &&
									item.unit === line.unit
							)
						: []
				);
			const value = matching.length
				? matching.some((fact) => fact.net_amount === null)
					? null
					: sum(matching.map((fact) => fact.net_amount!))
				: invoiceItems.length
					? invoiceItems.some((item) => item.net_amount == null)
						? null
						: sum(invoiceItems.map((item) => item.net_amount!))
					: issued.length
						? null
						: Decimal.of(0);
			return {
				order: order.id,
				number: order.number,
				sku: line.product_name,
				unit: line.unit,
				currency: currency(current.snapshot.currency),
				quota: Decimal.of(line.quantity),
				delivered: quantity,
				fulfillment: quantity?.times(100).div(line.quantity, 2) ?? null,
				forecast: executable ? Decimal.of(line.net) : Decimal.of(0),
				actual: value,
				valid_until: until ? PlainDate(until) : null,
				state
			};
		});
	});
}
