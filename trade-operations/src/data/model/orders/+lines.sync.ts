import { sync, type Finding } from '@norbital-ai/bolt';
import { orderLineWorkbook } from '../../../lib/workbook.js';

// The line workbook: one row per line, matched by order number and the stable line key.
export default sync('orders', 'lines', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	schema: orderLineWorkbook,
	read: function* ({ records }, ctx) {
		const numbers = [...new Set(records.map((record) => record.order_number))];
		const { orders } = yield* ctx.query({
			orders: { where: { number: { in: numbers } }, fields: ['id', 'number', 'ledger'] }
		});
		const byNumber = new Map(orders.rows.map((order) => [order.number, order]));
		const orderIds = orders.rows.map((order) => order.id);
		const codes = [...new Set(records.map((record) => record.product_code))];
		const { products, order_lines: lines } = yield* ctx.query({
			products: {
				where: {
					or: [{ external_code: { in: codes } }, { source_number: { in: codes } }]
				},
				fields: ['id', 'source', 'external_code', 'source_number', 'name']
			},
			order_lines: {
				where: { order: { in: orderIds } },
				fields: ['id', 'order', 'line_key', 'product']
			}
		});
		const lineAt = (order: string, key: string | undefined) =>
			key ? lines.rows.find((line) => line.order === order && line.line_key === key) : undefined;
		const findings: Finding[] = [];
		const rows: Record<string, string | number>[] = [];
		for (const record of records) {
			const at = Number(record.$at ?? 0);
			const order = byNumber.get(record.order_number);
			if (!order) {
				findings.push({
					at,
					field: 'Order number',
					severity: 'refuse',
					message: 'No visible order has this number.'
				});
				continue;
			}
			const matches = products.rows.filter(
				(product) =>
					product.source === order.ledger &&
					(product.external_code === record.product_code ||
						product.source_number === record.product_code)
			);
			if (matches.length !== 1) {
				findings.push({
					at,
					field: 'Product code',
					severity: 'refuse',
					message:
						matches.length === 0
							? 'No product in this order’s ledger has this code.'
							: 'More than one product matches this code; use its unique source number.'
				});
				continue;
			}
			const product = matches[0]!;
			const existing = lineAt(order.id, record.line_key ?? undefined);
			if (existing && existing.product !== product.id) {
				findings.push({
					at,
					field: 'Product code',
					severity: 'refuse',
					message: 'A line keeps its product; add a new line instead.'
				});
				continue;
			}
			const row: Record<string, string | number> = {
				order: order.id,
				product: product.id,
				quantity: record.quantity
			};
			if (record.line_key) row.line_key = record.line_key;
			if (record.unit_price != null) row.unit_price = record.unit_price;
			if (record.discount_pct != null) row.discount_pct = record.discount_pct;
			if (record.tax_rate != null) row.tax_rate = record.tax_rate;
			rows.push(row);
		}
		return { rows: [], related: { order_lines: rows }, findings };
	},
	write: function* (_input, ctx) {
		const { order_lines: lines } = yield* ctx.query({
			order_lines: {
				fields: [
					'id',
					'order',
					'line_key',
					'product',
					'quantity',
					'unit_price',
					'discount_pct',
					'tax_rate'
				] as const,
				limit: 10000
			}
		});
		const orderIds = [...new Set(lines.rows.map((line) => line.order))];
		const productIds = [...new Set(lines.rows.map((line) => line.product))];
		const { orders, products } = yield* ctx.query({
			orders: { where: { id: { in: orderIds } }, fields: ['id', 'number'] },
			products: {
				where: { id: { in: productIds } },
				fields: ['id', 'external_code', 'source_number']
			}
		});
		const orderNumber = new Map(orders.rows.map((order) => [order.id, order.number]));
		const productCode = new Map(
			products.rows.map((product) => [product.id, product.source_number ?? product.external_code])
		);
		return lines.rows
			.map((line) => ({
				order_number: orderNumber.get(line.order) ?? '',
				line_key: line.line_key ?? line.id,
				product_code: productCode.get(line.product) ?? '',
				quantity: Number(String(line.quantity)),
				unit_price: Number(String(line.unit_price)),
				discount_pct: Number(String(line.discount_pct)),
				tax_rate: Number(String(line.tax_rate))
			}))
			.sort(
				(a, b) =>
					a.order_number.localeCompare(b.order_number) || a.line_key.localeCompare(b.line_key)
			);
	}
});
