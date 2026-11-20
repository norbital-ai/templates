import type { OrderTrade } from '../../../lib/order-trade.js';
import { Equal } from 'effect';
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
					'trade',
					'packaging',
					'payment_method',
					'buyer_contact',
					'customer_po_no',
					'delivery_address',
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
		const { settlements, contacts } = yield* ctx.query({
			settlements: {
				where: {
					code: {
						in: [...new Set(records.flatMap((r) => (r.payment_terms ? [r.payment_terms] : [])))]
					}
				},
				fields: ['code', 'source']
			},
			contacts: {
				where: {
					party: { in: parties.rows.map((party) => party.id) },
					name: {
						in: [...new Set(records.flatMap((r) => (r.buyer_contact ? [r.buyer_contact] : [])))]
					}
				},
				fields: ['party', 'name']
			}
		});
		const byNumber = new Map(orders.rows.map((order) => [order.number, order]));
		const findings: Finding[] = [];
		const rows: Record<string, string | boolean | OrderTrade>[] = [];
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
			const party = scoped[0];
			if (scoped.length !== 1 || party === undefined) {
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
			const partyKind = record.direction === 'sales' ? 'customer' : 'supplier';
			if (!party.active || (party.kind !== partyKind && party.kind !== 'both')) {
				findings.push({
					at,
					field: 'Party code',
					severity: 'refuse',
					message: `Use an active ${partyKind} for a ${record.direction} order.`
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
			const terms = record.payment_terms
				? settlements.rows.filter(
						(row) => row.code === record.payment_terms && row.source === party.source
					)
				: [];
			if (record.payment_terms && terms.length !== 1) {
				findings.push({
					at,
					field: 'Payment terms',
					severity: 'refuse',
					message: 'No Kingdee settlement method has this code in the party’s ledger.'
				});
				continue;
			}
			const buyers = record.buyer_contact
				? contacts.rows.filter((row) => row.party === party.id && row.name === record.buyer_contact)
				: [];
			if (record.buyer_contact && buyers.length !== 1) {
				findings.push({
					at,
					field: 'Buyer contact',
					severity: 'refuse',
					message:
						buyers.length === 0
							? 'The party has no contact with this name.'
							: 'The party has more than one contact with this name.'
				});
				continue;
			}
			const row: Record<string, string | boolean | OrderTrade> = {
				party: party.id,
				direction: record.direction,
				title: record.title
			};
			if (terms[0]) row.payment_terms = terms[0].id;
			if (buyers[0]) row.buyer_contact = buyers[0].id;
			if (record.payment_method) row.payment_method = record.payment_method;
			const hasForeign = Boolean(
				record.shipping_terms ||
				record.place_of_loading ||
				record.place_of_delivery ||
				record.shipping_mark ||
				record.shipment_from ||
				record.shipment_to ||
				record.other_terms
			);
			const hasDomestic = Boolean(record.delivery_place || record.delivery_date);
			const kind =
				record.trade_kind ?? existing?.trade.kind ?? (hasForeign ? 'foreign' : 'domestic');
			if (kind === 'domestic' ? hasForeign : hasDomestic) {
				findings.push({
					at,
					field: 'Order type',
					severity: 'refuse',
					message: 'Use only the fields for the selected order type.'
				});
				continue;
			}
			if (record.shipment_to && !record.shipment_from) {
				findings.push({
					at,
					field: 'Ships from',
					severity: 'refuse',
					message: 'Enter the start of the shipment window.'
				});
				continue;
			}
			const prior = existing?.trade;
			if (kind === 'foreign') {
				row.trade = {
					...(prior?.kind === kind ? prior : {}),
					kind,
					...(record.shipping_terms ? { shipping_terms: record.shipping_terms } : {}),
					...(record.place_of_loading ? { place_of_loading: record.place_of_loading } : {}),
					...(record.place_of_delivery ? { place_of_delivery: record.place_of_delivery } : {}),
					...(record.shipping_mark ? { shipping_mark: record.shipping_mark } : {}),
					...(record.other_terms ? { other_terms: record.other_terms } : {}),
					...(record.shipment_from
						? { shipment: { from: record.shipment_from, to: record.shipment_to ?? null } }
						: {})
				};
			} else {
				row.trade = {
					...(prior?.kind === kind ? prior : {}),
					kind,
					...(record.delivery_place ? { delivery_place: record.delivery_place } : {}),
					...(record.delivery_date ? { delivery_date: record.delivery_date } : {})
				};
			}
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
			const owner = text(record.owner);
			if (owner) row.owner = owner;
			const handler = text(record.logistics_handler);
			if (handler) row.logistics_handler = handler;
			for (const field of ['packaging', 'customer_po_no', 'delivery_address', 'notes'] as const) {
				const value = text(record[field]);
				if (value !== undefined) row[field] = value;
			}
			for (const field of ['ordered_on', 'valid_from', 'valid_until'] as const) {
				const value = record[field] == null ? undefined : String(record[field]);
				if (value !== undefined) row[field] = value;
			}
			if (record.tax_inclusive != null) row.tax_inclusive = record.tax_inclusive;
			const before = new Map<string, unknown>(existing ? Object.entries(existing) : []);
			const changed =
				existing === undefined ||
				Object.entries(row).some(
					([field, value]) =>
						field !== 'source_order_key' && !Equal.equals(before.get(field), value)
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
					'title',
					'trade',
					'packaging',
					'payment_method',
					'customer_po_no',
					'delivery_address',
					'logistics_handler',
					'notes'
				],
				order_by: { number: 'asc' },
				limit: 10000,
				payment_terms: { fields: ['code'] },
				buyer_contact: { fields: ['name'] }
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
		return orders.rows.map((order) => {
			const foreign = order.trade.kind === 'foreign' ? order.trade : null;
			return {
				trade_kind: order.trade.kind,
				delivery_place: order.trade.kind === 'domestic' ? date(order.trade.delivery_place) : null,
				delivery_date: order.trade.kind === 'domestic' ? date(order.trade.delivery_date) : null,
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
				payment_terms: date(order.payment_terms?.code),
				shipping_terms: date(foreign?.shipping_terms),
				place_of_loading: date(foreign?.place_of_loading),
				place_of_delivery: date(foreign?.place_of_delivery),
				packaging: date(order.packaging),
				shipping_mark: date(foreign?.shipping_mark),
				shipment_from: date(foreign?.shipment?.from),
				shipment_to: date(foreign?.shipment?.to),
				other_terms: date(foreign?.other_terms),
				payment_method: date(order.payment_method),
				buyer_contact: date(order.buyer_contact?.name),
				customer_po_no: date(order.customer_po_no),
				delivery_address: date(order.delivery_address),
				logistics_handler: date(order.logistics_handler),
				notes: date(order.notes)
			};
		});
	}
});
