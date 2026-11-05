import type { SourceProjection } from './sql.js';
import { Instant } from '@norbital-ai/std/date';
import { currency } from '@norbital-ai/std/decimal';
import { SourceRowInvalid, type SqlRow } from './polling.js';

const ref = (tableAlias: string, name: string) => ({ tableAlias, name });
const column = (tableAlias: string, name: string) => ({ column: ref(tableAlias, name) });

/** EPG KIS physical read bindings. FNumber is a display number; FItemID is the stable identity. */
export const bindings = {
	parties: {
		table: { schema: 'dbo', name: 't_Item' },
		alias: 'parties',
		key: 'external_code',
		columns: [
			'external_code',
			'source_number',
			'item_class',
			'deleted',
			'unused',
			'customer_name',
			'customer_deleted',
			'customer_address',
			'customer_phone',
			'customer_currency_id',
			'supplier_name',
			'supplier_deleted'
		],
		fields: {
			external_code: column('parties', 'FItemID'),
			source_number: column('parties', 'FNumber'),
			item_class: column('parties', 'FItemClassID'),
			deleted: column('parties', 'FDeleted'),
			unused: column('parties', 'FUnUsed'),
			customer_name: column('customer', 'FName'),
			customer_deleted: column('customer', 'FDeleted'),
			customer_address: column('customer', 'FAddress'),
			customer_phone: column('customer', 'FPhone'),
			customer_currency_id: column('customer', 'FCurrencyID'),
			supplier_name: column('supplier', 'FName'),
			supplier_deleted: column('supplier', 'FDeleted')
		},
		joins: [
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Organization' },
				alias: 'customer',
				on: [{ left: ref('parties', 'FItemID'), right: ref('customer', 'FItemID') }]
			},
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Supplier' },
				alias: 'supplier',
				on: [{ left: ref('parties', 'FItemID'), right: ref('supplier', 'FItemID') }]
			}
		],
		filters: [
			{ field: ref('parties', 'FItemClassID'), op: 'in', value: [1, 8] },
			{ field: ref('parties', 'FDetail'), op: 'eq', value: 1 }
		],
		rowversions: [
			ref('parties', 'FModifyTime'),
			ref('customer', 'FModifyTime'),
			ref('supplier', 'FModifyTime')
		],
		texts: ['external_code', 'customer_currency_id']
	},
	products: {
		table: { schema: 'dbo', name: 't_Item' },
		alias: 'products',
		key: 'external_code',
		columns: [
			'external_code',
			'source_number',
			'name',
			'spec',
			'unit',
			'deleted',
			'unused',
			'detail_deleted'
		],
		fields: {
			external_code: column('products', 'FItemID'),
			source_number: column('products', 'FNumber'),
			name: column('products', 'FName'),
			spec: column('detail', 'FModel'),
			unit: column('unit', 'FName'),
			deleted: column('products', 'FDeleted'),
			unused: column('products', 'FUnUsed'),
			detail_deleted: column('detail', 'FDeleted')
		},
		joins: [
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_ICItem' },
				alias: 'detail',
				on: [{ left: ref('products', 'FItemID'), right: ref('detail', 'FItemID') }]
			},
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Item' },
				alias: 'unit',
				on: [{ left: ref('detail', 'FUnitID'), right: ref('unit', 'FItemID') }],
				where: { FItemClassID: 7 }
			}
		],
		filters: [
			{ field: ref('products', 'FItemClassID'), op: 'eq', value: 4 },
			{ field: ref('products', 'FDetail'), op: 'eq', value: 1 }
		],
		// Keep the deleted detail joined so its own change marker remains visible.
		rowversions: [
			ref('products', 'FModifyTime'),
			ref('detail', 'FModifyTime'),
			ref('unit', 'FModifyTime')
		],
		texts: ['external_code']
	},
	warehouses: {
		table: { schema: 'dbo', name: 't_Item' },
		alias: 'warehouses',
		key: 'external_code',
		columns: ['external_code', 'source_number', 'name', 'group_code', 'deleted', 'unused'],
		fields: {
			external_code: column('warehouses', 'FItemID'),
			source_number: column('warehouses', 'FNumber'),
			name: column('warehouses', 'FName'),
			group_code: column('parent', 'FNumber'),
			deleted: column('warehouses', 'FDeleted'),
			unused: column('warehouses', 'FUnUsed')
		},
		joins: [
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Stock' },
				alias: 'detail',
				on: [{ left: ref('warehouses', 'FItemID'), right: ref('detail', 'FItemID') }]
			},
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Item' },
				alias: 'parent',
				on: [{ left: ref('warehouses', 'FParentID'), right: ref('parent', 'FItemID') }],
				where: { FItemClassID: 5, FDetail: 0 }
			}
		],
		filters: [
			{ field: ref('warehouses', 'FItemClassID'), op: 'eq', value: 5 },
			{ field: ref('warehouses', 'FDetail'), op: 'eq', value: 1 }
		],
		rowversions: [
			ref('warehouses', 'FModifyTime'),
			ref('detail', 'FModifyTime'),
			ref('parent', 'FModifyTime')
		],
		texts: ['external_code']
	},
	stock_snapshots: {
		table: { schema: 'dbo', name: 'ICInventory' },
		alias: 'stock_snapshots',
		key: 'external_code',
		keyParts: ['item_id', 'warehouse_id', 'lot_number'],
		columns: ['item_id', 'warehouse_id', 'lot_number', 'unit', 'on_hand'],
		fields: {
			item_id: column('stock_snapshots', 'FItemID'),
			warehouse_id: column('stock_snapshots', 'FStockID'),
			lot_number: column('stock_snapshots', 'FBatchNo'),
			unit: column('unit', 'FName'),
			on_hand: { aggregate: 'sum', column: ref('stock_snapshots', 'FQty') }
		},
		joins: [
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_ICItem' },
				alias: 'detail',
				on: [{ left: ref('stock_snapshots', 'FItemID'), right: ref('detail', 'FItemID') }],
				where: { FDeleted: 0 }
			},
			{
				kind: 'left',
				table: { schema: 'dbo', name: 't_Item' },
				alias: 'unit',
				on: [{ left: ref('detail', 'FUnitID'), right: ref('unit', 'FItemID') }],
				where: { FItemClassID: 7 }
			}
		],
		groupBy: [
			ref('stock_snapshots', 'FItemID'),
			ref('stock_snapshots', 'FStockID'),
			ref('stock_snapshots', 'FBatchNo'),
			ref('unit', 'FName')
		],
		texts: ['item_id', 'warehouse_id'],
		decimals: ['on_hand']
	}
} satisfies Record<string, SourceProjection>;

export type SourceBindingName = keyof typeof bindings;
type SourceConfiguration = { readonly baseCurrency: string };

/** Translate verified source fields only; observation time is not a Kingdee modification time. */
export function normalizeSourceRow(
	alias: SourceBindingName,
	row: SqlRow,
	configuration: SourceConfiguration,
	observedAt: string
): SqlRow {
	const invalid = (column: string, reason: string): never => {
		throw new SourceRowInvalid({ column, reason });
	};
	const text = (name: string, optional = false): string | null => {
		const value = row[name];
		if ((value === null || value === undefined) && optional) return null;
		if (typeof value !== 'string') return invalid(name, 'Expected Kingdee text');
		const result = value.trim();
		if (result === '') {
			if (optional) return null;
			return invalid(name, 'Required Kingdee text is empty');
		}
		return result;
	};
	const integer = (name: string): bigint => {
		const value = row[name];
		if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
		if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
		return invalid(name, 'Expected an exact Kingdee integer');
	};
	const flag = (name: string, optional = false): boolean => {
		const value = row[name];
		if ((value === null || value === undefined) && optional) return false;
		return typeof value === 'boolean' ? value : integer(name) !== 0n;
	};
	let observed: string;
	try {
		observed = Instant(observedAt);
	} catch {
		return invalid('observedAt', 'Expected an ISO observation instant');
	}
	if (alias === 'stock_snapshots')
		return {
			...row,
			external_code: text('__key'),
			product_code: integer('item_id').toString(),
			warehouse_code: integer('warehouse_id').toString(),
			lot_number: text('lot_number', true),
			unit: text('unit', true),
			unit_cost: null,
			currency: null,
			erp_committed: null,
			as_of: observed,
			orders_as_of: null
		};
	let baseCurrency: string;
	try {
		baseCurrency = currency(configuration.baseCurrency);
	} catch {
		return invalid('baseCurrency', 'Configure the verified account-set base currency');
	}
	const common = {
		external_code: integer('external_code').toString(),
		source_number: text('source_number', true),
		active: !flag('deleted') && !flag('unused', true),
		source_updated_at: observed
	};
	if (alias === 'parties') {
		const itemClass = integer('item_class');
		if (itemClass !== 1n && itemClass !== 8n)
			return invalid('item_class', 'Expected a Kingdee customer or supplier class');
		const customer = itemClass === 1n;
		return {
			...row,
			...common,
			name: text(customer ? 'customer_name' : 'supplier_name'),
			kind: customer ? 'customer' : 'supplier',
			currency: baseCurrency,
			active: common.active && !flag(customer ? 'customer_deleted' : 'supplier_deleted'),
			address: customer ? text('customer_address', true) : null,
			phone: customer ? text('customer_phone', true) : null
		};
	}
	if (alias === 'products')
		return {
			...row,
			...common,
			name: text('name'),
			spec: text('spec', true),
			unit: text('unit', true),
			currency: baseCurrency,
			unit_price: null,
			tax_rate: null,
			active: common.active && !flag('detail_deleted', true)
		};
	return {
		...row,
		...common,
		name: text('name'),
		group_code: text('group_code', true)
	};
}
