import { sync, type Finding } from '@norbital-ai/bolt';
import { orderWorkbook } from '../../../lib/workbook.js';

// The table workbook: one header row per order, matched by its sequential number.
export default sync('orders', 'sheet', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	schema: orderWorkbook,
	read: function* ({ records }, ctx) {
		const numbers = [...new Set(records.flatMap((r) => (r.number ? [r.number] : [])))];
		const codes = [...new Set(records.map((r) => r.party_code))];
		const warehouseCodes = [
			...new Set(records.flatMap((r) => (r.warehouse_code ? [r.warehouse_code] : [])))
		];
		const { orders, parties, warehouses } = yield* ctx.query({
			orders: {
				where: { number: { in: numbers } },
				fields: [
					'id',
					'number',
					'ledger',
					'source_order_key',
					'party',
					'owner',
					'warehouse',
					'title',
					'direction',
					'ordered_on',
					'currency',
					'tax_inclusive',
					'valid_from',
					'valid_until',
					'payment_terms',
					'delivery_terms',
					'shipping_terms',
					'place_of_loading',
					'place_of_delivery',
					'packaging',
					'shipping_mark',
					'time_of_shipment',
					'other_terms',
					'payment_method',
					'buyer_contact',
					'buyer_mobile',
					'delivery_address',
					'delivery_date',
					'logistics_handler',
					'notes'
				]
			},
			parties: {
				where: {
					or: [{ external_code: { in: codes } }, { source_number: { in: codes } }]
				},
				fields: ['id', 'source', 'external_code', 'source_number', 'name', 'kind', 'active']
			},
			warehouses: {
				where: {
					or: [{ external_code: { in: warehouseCodes } }, { source_number: { in: warehouseCodes } }]
				},
				fields: ['id', 'source', 'external_code', 'source_number', 'name', 'active']
			}
		});
		const byNumber = new Map(orders.rows.map((order) => [order.number, order]));
		const findings: Finding[] = [];
		const rows: Record<string, string | boolean>[] = [];
		const text = (value: string | null | undefined) =>
			value != null && value.trim() !== '' ? value : undefined;
		for (const record of records) {
			const at = Number(record.$at ?? 0);
			const existing = record.number ? byNumber.get(record.number) : undefined;
			if (record.number && !existing) {
				findings.push({
					at,
					field: 'Order number',
					severity: 'refuse',
					message: 'No order has this number. Clear it to create a new order.'
				});
				continue;
			}
			const matches = parties.rows.filter(
				(party) =>
					party.external_code === record.party_code || party.source_number === record.party_code
			);
			const scoped = existing ? matches.filter((p) => p.source === existing.ledger) : matches;
			if (scoped.length !== 1) {
				findings.push({
					at,
					field: 'Party code',
					severity: 'refuse',
					message:
						scoped.length === 0
							? 'No party has this code in the order’s ledger.'
							: 'More than one ledger has this party code. Choose a code unique to one ledger.'
				});
				continue;
			}
			const party = scoped[0]!;
			const kind = record.direction === 'sales' ? 'customer' : 'supplier';
			if (!party.active || (party.kind !== kind && party.kind !== 'both')) {
				findings.push({
					at,
					field: 'Party code',
					severity: 'refuse',
					message: `Use an active ${kind} for a ${record.direction} order.`
				});
				continue;
			}
			const warehouse = record.warehouse_code
				? warehouses.rows.find(
						(row) =>
							row.source === party.source &&
							(row.external_code === record.warehouse_code ||
								row.source_number === record.warehouse_code)
					)
				: undefined;
			if (record.warehouse_code && (!warehouse || !warehouse.active)) {
				findings.push({
					at,
					field: 'Warehouse code',
					severity: 'refuse',
					message: 'No active warehouse has this code in the party’s ledger.'
				});
				continue;
			}
			if (!existing && !record.currency) {
				findings.push({
					at,
					field: 'Currency',
					severity: 'refuse',
					message: 'A new order needs its currency.'
				});
				continue;
			}
			const row: Record<string, string | boolean> = {
				party: party.id,
				direction: record.direction,
				title: record.title,
				payment_terms: record.payment_terms
			};
			if (record.currency) row.currency = record.currency;
			if (existing) {
				if (existing.source_order_key == null) {
					findings.push({
						at,
						field: 'Order number',
						severity: 'refuse',
						message: 'This order has no import key yet. Save it once in the app, then retry.'
					});
					continue;
				}
				row.source_order_key = existing.source_order_key;
			}
			if (warehouse) row.warehouse = warehouse.id;
			if (text(record.owner)) row.owner = text(record.owner)!;
			if (text(record.logistics_handler)) row.logistics_handler = text(record.logistics_handler)!;
			for (const field of [
				'delivery_terms',
				'shipping_terms',
				'place_of_loading',
				'place_of_delivery',
				'packaging',
				'shipping_mark',
				'time_of_shipment',
				'other_terms',
				'payment_method',
				'buyer_contact',
				'buyer_mobile',
				'delivery_address',
				'notes'
			] as const) {
				const value = text(record[field]);
				if (value !== undefined) row[field] = value;
			}
			for (const field of ['ordered_on', 'valid_from', 'valid_until', 'delivery_date'] as const) {
				const value = record[field] == null ? undefined : String(record[field]);
				if (value !== undefined) row[field] = value;
			}
			if (record.tax_inclusive != null) row.tax_inclusive = record.tax_inclusive;
			const changed =
				existing === undefined ||
				Object.entries(row).some(
					([field, value]) =>
						field !== 'source_order_key' &&
						String(existing[field as keyof typeof existing] ?? '') !== String(value ?? '')
				);
			if (changed) rows.push(row);
		}
		return { rows, findings };
	},
	write: function* (_input, ctx) {
		const { orders } = yield* ctx.query({
			orders: {
				fields: [
					'number',
					'direction',
					'party',
					'owner',
					'warehouse',
					'ordered_on',
					'currency',
					'tax_inclusive',
					'valid_from',
					'valid_until',
					'payment_terms',
					'delivery_terms',
					'title',
					'shipping_terms',
					'place_of_loading',
					'place_of_delivery',
					'packaging',
					'shipping_mark',
					'time_of_shipment',
					'other_terms',
					'payment_method',
					'buyer_contact',
					'buyer_mobile',
					'delivery_address',
					'delivery_date',
					'logistics_handler',
					'notes'
				],
				order_by: { number: 'asc' },
				limit: 10000
			}
		});
		const { parties, warehouses } = yield* ctx.query({
			parties: {
				where: {
					id: { in: [...new Set(orders.rows.map((order) => order.party))] }
				},
				fields: ['external_code']
			},
			warehouses: {
				where: {
					id: {
						in: [
							...new Set(orders.rows.flatMap((order) => (order.warehouse ? [order.warehouse] : [])))
						]
					}
				},
				fields: ['external_code']
			}
		});
		const partyCode = new Map(parties.rows.map((party) => [party.id, party.external_code]));
		const warehouseCode = new Map(
			warehouses.rows.map((warehouse) => [warehouse.id, warehouse.external_code])
		);
		const date = <T>(value: T | null | undefined) => value ?? null;
		return orders.rows.map((order) => ({
			number: order.number,
			direction: order.direction,
			party_code: partyCode.get(order.party) ?? '',
			title: order.title,
			owner: order.owner,
			warehouse_code: order.warehouse ? (warehouseCode.get(order.warehouse) ?? '') : '',
			ordered_on: date(order.ordered_on),
			currency: order.currency,
			tax_inclusive: order.tax_inclusive,
			valid_from: date(order.valid_from),
			valid_until: date(order.valid_until),
			payment_terms: order.payment_terms,
			delivery_terms: date(order.delivery_terms),
			shipping_terms: date(order.shipping_terms),
			place_of_loading: date(order.place_of_loading),
			place_of_delivery: date(order.place_of_delivery),
			packaging: date(order.packaging),
			shipping_mark: date(order.shipping_mark),
			time_of_shipment: date(order.time_of_shipment),
			other_terms: date(order.other_terms),
			payment_method: date(order.payment_method),
			buyer_contact: date(order.buyer_contact),
			buyer_mobile: date(order.buyer_mobile),
			delivery_address: date(order.delivery_address),
			delivery_date: date(order.delivery_date),
			logistics_handler: date(order.logistics_handler),
			notes: date(order.notes)
		}));
	}
});
