import { integration } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { agreement, agreementSelect } from '../../lib/agreements.js';
import { isMasked } from '../../lib/access.js';
import { columns, query, readCdc, SourceRowInvalid, type SqlRow } from './cdc.js';
import { orderItems } from './order-batch.js';
import { projections } from './projections.js';
import { submitOrder, verifyOrder } from './submission.js';
const kingdee = integration('kingdee', {
	description: 'Accounting SQL Server CDC and approved order submissions.',
	driver: 'sqlserver',
	credential: { connectionString: { kind: 'text', label: 'SQL Server connection string' } },
	configuration: {
		maxLagMinutes: { kind: 'int', min: 1, default: 15, label: 'Capture lag alert (minutes)' },
		retentionMinutes: { kind: 'int', min: 1, default: 4320, label: 'CDC retention (minutes)' },
		minRetentionMinutes: {
			kind: 'int',
			min: 0,
			default: 15,
			label: 'Retention warning margin (minutes)'
		}
	},
	feeds: {
		parties: {
			into: 'parties',
			key: ['external_code'],
			cron: '*/15 * * * *',
			removed: { active: false }
		},
		products: {
			into: 'products',
			key: ['external_code'],
			cron: '*/15 * * * *',
			removed: { active: false }
		},
		warehouses: {
			into: 'warehouses',
			key: ['external_code'],
			cron: '*/15 * * * *',
			removed: { active: false }
		},
		stock_snapshots: { into: 'stock_snapshots', key: ['external_code'], cron: '*/15 * * * *' },
		credit_snapshots: { into: 'credit_snapshots', key: ['external_code'], cron: '*/15 * * * *' },
		ext_sales_orders: {
			into: 'ext_sales_orders',
			key: ['external_id'],
			cron: '*/5 * * * *',
			removed: { status: 'void' }
		},
		ext_purchase_orders: {
			into: 'ext_purchase_orders',
			key: ['external_id'],
			cron: '*/5 * * * *',
			removed: { status: 'void' }
		},
		transactions: {
			into: 'transactions',
			key: ['erp_id'],
			cron: '*/5 * * * *',
			removed: { status: 'void' }
		},
		source_payments: {
			into: 'source_payments',
			key: ['external_code'],
			cron: '*/5 * * * *',
			removed: { active: false }
		},
		source_sales_lines: {
			into: 'source_sales_lines',
			key: ['external_code'],
			cron: '*/15 * * * *',
			removed: { active: false }
		}
	},
	outbound: {
		orders: {
			from: 'orders',
			on: ['create', 'update'],
			when: { status: { eq: 'confirmed' } },
			via: 'ledger',
			version: 'seal_hash'
		}
	}
});
export default kingdee;
kingdee.test(function* (ctx) {
	const rows = yield* query(ctx, 'SELECT sys.fn_cdc_get_max_lsn() AS maximum');
	yield* Schema.decodeUnknownEffect(
		Schema.Struct({ maximum: Schema.String.check(Schema.isPattern(/^0x(?!0{20}$)[a-f0-9]{20}$/i)) })
	)(rows[0]).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$row', reason: String(cause) }))
	);
});
kingdee.feed('parties', {
	read: function* (cursor, ctx) {
		return yield* readCdc(projections.parties, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			return {
				external_code: r.text('external_code'),
				name: r.text('name'),
				kind: r.one('kind', ['customer', 'supplier', 'both']),
				currency: r.currency('currency'),
				active: r.bool('active', true),
				address: r.text('address', null),
				phone: r.text('phone', null),
				source_updated_at: r.instant('source_updated_at')
			};
		});
	}
});
kingdee.feed('products', {
	read: function* (cursor, ctx) {
		return yield* readCdc(projections.products, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			return {
				external_code: r.text('external_code'),
				name: r.text('name'),
				spec: r.text('spec', null),
				unit: r.text('unit'),
				currency: r.currency('currency'),
				unit_price: r.decimal('unit_price', null),
				tax_rate: r.decimal('tax_rate', Decimal.of(0)),
				active: r.bool('active', true),
				source_updated_at: r.instant('source_updated_at')
			};
		});
	}
});
kingdee.feed('warehouses', {
	read: function* (cursor, ctx) {
		return yield* readCdc(projections.warehouses, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			return {
				external_code: r.text('external_code'),
				name: r.text('name'),
				group_code: r.text('group_code'),
				active: r.bool('active', true),
				source_updated_at: r.instant('source_updated_at')
			};
		});
	}
});
kingdee.feed('stock_snapshots', {
	read: function* (cursor, ctx) {
		const own = { source: { eq: ctx.instance } };
		const { products, warehouses } = yield* ctx.read({
			products: { collection: 'products', where: own, select: { external_code: true }, all: true },
			warehouses: {
				collection: 'warehouses',
				where: own,
				select: { external_code: true },
				all: true
			}
		});
		return yield* readCdc(projections.stock_snapshots, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			const product = products.rows.find((p) => p.external_code === r.text('product_code'));
			const warehouse = warehouses.rows.find((w) => w.external_code === r.text('warehouse_code'));
			if (!product || !warehouse)
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Stock requires its synced product and warehouse'
				});
			return {
				external_code: r.text('external_code'),
				lot_number: r.text('lot_number', null),
				unit_cost: r.decimal('unit_cost', null),
				currency: r.currency('currency', null),
				unit: r.text('unit'),
				on_hand: r.decimal('on_hand'),
				erp_committed: r.decimal('erp_committed', null),
				as_of: r.instant('as_of'),
				orders_as_of: r.instant('orders_as_of', null),
				product: product.id,
				warehouse: warehouse.id
			};
		});
	}
});
kingdee.feed('credit_snapshots', {
	read: function* (cursor, ctx) {
		const parties = yield* ctx.read('parties', {
			where: { source: { eq: ctx.instance } },
			select: { external_code: true },
			all: true
		});
		return yield* readCdc(projections.credit_snapshots, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			const party = parties.rows.find((p) => p.external_code === r.text('party_code'));
			if (!party)
				throw new SourceRowInvalid({ column: '$row', reason: 'Credit requires its synced party' });
			return {
				external_code: r.text('external_code'),
				currency: r.currency('currency'),
				credit_limit: r.decimal('credit_limit', null),
				credit_used: r.decimal('credit_used', null),
				credit_hold: r.bool('credit_hold', false),
				as_of: r.instant('as_of'),
				party: party.id
			};
		});
	}
});
const orderHeader = (row: SqlRow) => {
	const r = columns(row);
	return {
		external_id: r.text('external_id'),
		order: r.id('order_id', 'orders'),
		reference: r.text('reference'),
		agreement_hash: r.text('agreement_hash'),
		currency: r.currency('currency'),
		status: r.one('status', ['draft', 'issued', 'void']),
		source_updated_at: r.instant('source_updated_at')
	};
};
kingdee.feed('ext_sales_orders', {
	read: function* (cursor, ctx) {
		return yield* readCdc(projections.ext_sales_orders, 'external_id', cursor, ctx, orderHeader);
	}
});
kingdee.feed('ext_purchase_orders', {
	read: function* (cursor, ctx) {
		return yield* readCdc(projections.ext_purchase_orders, 'external_id', cursor, ctx, orderHeader);
	}
});
const Item = Schema.Struct({
	order_line_id: Schema.String,
	product_name: Schema.String,
	unit: Schema.String,
	quantity: Schema.String,
	unit_price: Schema.optional(Schema.String),
	lot_number: Schema.optional(Schema.String),
	unit_cost: Schema.optional(Schema.String),
	net_amount: Schema.optional(Schema.String)
});
const Document = Schema.Struct({ name: Schema.String, url: Schema.String, sha256: Schema.String });
kingdee.feed('transactions', {
	read: function* (cursor, ctx) {
		const own = { source: { eq: ctx.instance } };
		const { sales, purchases } = yield* ctx.read({
			sales: {
				collection: 'ext_sales_orders',
				where: own,
				select: { external_id: true },
				all: true
			},
			purchases: {
				collection: 'ext_purchase_orders',
				where: own,
				select: { external_id: true },
				all: true
			}
		});
		return yield* readCdc(projections.transactions, 'erp_id', cursor, ctx, (row) => {
			const r = columns(row);
			const direction = r.one('direction', ['sales', 'purchasing']);
			const parent = r.text('parent_id');
			return {
				erp_id: r.text('external_id'),
				order: r.id('order_id', 'orders'),
				ext_sales_order:
					direction === 'sales'
						? (sales.rows.find((o) => o.external_id === parent)?.id ?? null)
						: null,
				ext_purchase_order:
					direction === 'purchasing'
						? (purchases.rows.find((o) => o.external_id === parent)?.id ?? null)
						: null,
				kind: r.one('kind', ['invoice', 'delivery']),
				reference: r.text('reference'),
				seal_hash: r.text('seal_hash'),
				currency: r.currency('currency'),
				status: r.one('status', ['issued', 'void']),
				items: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Item)))(
					r.text('items')
				).map(({ quantity, unit_price, unit_cost, net_amount, lot_number, ...item }) => ({
					...item,
					quantity: Decimal.of(quantity),
					...(lot_number === undefined ? {} : { lot_number }),
					...(unit_cost == null ? {} : { unit_cost: Decimal.of(unit_cost) }),
					...(net_amount == null ? {} : { net_amount: Decimal.of(net_amount) }),
					...(unit_price == null ? {} : { unit_price: Decimal.of(unit_price) })
				})),
				documents: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Document)))(
					r.text('documents')
				),
				issued_on: r.date('issued_on', null),
				due_on: r.date('due_on', null),
				total: r.decimal('total', null),
				source_updated_at: r.instant('source_updated_at')
			};
		});
	}
});
kingdee.feed('source_payments', {
	read: function* (cursor, ctx) {
		const invoices = yield* ctx.read('transactions', {
			where: { source: { eq: ctx.instance } },
			select: { erp_id: true },
			all: true
		});
		return yield* readCdc(projections.source_payments, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			const code = r.text('invoice_id', null);
			const invoice = code === null ? null : invoices.rows.find((i) => i.erp_id === code);
			if (invoice === undefined)
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Payment requires its synced invoice'
				});
			return {
				external_code: r.text('external_code'),
				order: r.id('order_id', 'orders'),
				invoice: invoice?.id ?? null,
				kind: r.one('kind', ['receipt', 'refund']),
				reference: r.text('reference'),
				settled_on: r.date('settled_on'),
				source_updated_at: r.instant('source_updated_at'),
				seal_hash: r.text('seal_hash'),
				currency: r.currency('currency'),
				amount: r.decimal('amount'),
				active: r.bool('active')
			};
		});
	}
});
kingdee.feed('source_sales_lines', {
	read: function* (cursor, ctx) {
		const { orders, previous } = yield* ctx.read({
			orders: {
				collection: 'orders',
				where: { ledger: { eq: ctx.instance } },
				select: { ...agreementSelect, direction: true, currency: true },
				all: true
			},
			previous: {
				collection: 'source_sales_lines',
				where: { source: { eq: ctx.instance } },
				select: {
					external_code: true,
					order: true,
					order_line: true,
					seal_hash: true,
					source_updated_at: true
				},
				all: true
			}
		});
		return yield* readCdc(projections.source_sales_lines, 'external_code', cursor, ctx, (row) => {
			const r = columns(row);
			const fact = {
				external_code: r.text('external_code'),
				lot_number: r.text('lot_number', null),
				unit_cost: r.decimal('unit_cost', null),
				order_line: r.text('order_line_id'),
				kind: r.one('kind', ['shipment', 'return', 'invoice_only']),
				reference: r.text('reference'),
				business_on: r.date('business_on'),
				source_updated_at: r.instant('source_updated_at'),
				seal_hash: r.text('seal_hash'),
				unit: r.text('unit'),
				quantity: r.decimal('quantity'),
				currency: r.currency('currency'),
				net_amount: r.decimal('net_amount', null),
				tax_amount: r.decimal('tax_amount', null),
				freight: r.decimal('freight', null),
				active: r.bool('active', true)
			};
			const order = orders.rows.find((o) => o.id === r.text('order_id'));
			const old = previous.rows.find((p) => p.external_code === fact.external_code);
			const version = order ? agreement(order, fact.seal_hash) : undefined;
			const sealedLine = version?.snapshot.lines.find((item) => item.id === fact.order_line);
			if (!order || !version || !sealedLine || order.direction !== 'sales')
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Source fact requires an approved sealed SO'
				});
			if (
				old &&
				(old.order !== order.id ||
					old.order_line !== sealedLine.id ||
					old.seal_hash !== fact.seal_hash)
			)
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Source fact cannot cross SOs or lines'
				});
			if (fact.currency !== version.snapshot.currency || fact.unit !== sealedLine.unit)
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Source fact currency or unit mismatch'
				});
			if (fact.unit_cost !== null && fact.unit_cost.lt(0))
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Source lot cost cannot be negative'
				});
			if (
				fact.quantity.eq(0) ||
				(fact.kind === 'return' ? fact.quantity.gt(0) : fact.quantity.lt(0))
			)
				throw new SourceRowInvalid({
					column: '$row',
					reason: 'Source fact quantity sign mismatch'
				});
			for (const amount of [fact.net_amount, fact.tax_amount, fact.freight]) {
				if (amount !== null && (fact.kind === 'return' ? amount.gt(0) : amount.lt(0)))
					throw new SourceRowInvalid({
						column: '$row',
						reason: 'Source fact amount sign mismatch'
					});
			}
			if (old && fact.source_updated_at < old.source_updated_at)
				throw new SourceRowInvalid({ column: '$row', reason: 'Older source fact revision' });
			return { ...fact, order: order.id };
		});
	}
});
kingdee.outbound('orders', {
	build: (row) => {
		if (
			row.status !== 'confirmed' ||
			!row.seal_hash ||
			!row.sealed_contract ||
			isMasked(row.sealed_contract) ||
			!row.sealed_snapshot ||
			isMasked(row.sealed_snapshot)
		)
			return null;
		const snapshot = row.sealed_snapshot;
		return {
			order_id: String(row.id),
			reference: row.number,
			direction: snapshot.direction,
			agreement_hash: row.seal_hash,
			currency: snapshot.currency,
			party_code: snapshot.party_code,
			agreement: JSON.stringify(snapshot),
			contract: row.sealed_contract,
			items: orderItems(snapshot.lines)
		};
	},
	run: function* (payload, ctx) {
		yield* verifyOrder(payload, ctx);
		return { id: yield* submitOrder(payload, ctx.key, ctx) };
	}
});
