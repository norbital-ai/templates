import { expect, it as test } from '@effect/vitest';
import { bindings, normalizeSourceRow } from '../src/integration/kingdee/source-bindings.js';
import { SourceRowInvalid } from '../src/integration/kingdee/polling.js';

const configuration = { baseCurrency: 'CNY' };
const observedAt = '2026-10-26T02:00:00.000Z';
const marker = '0x0000000000000042';
const identity = {
	__key: '123',
	__rowversion: marker,
	external_code: '123',
	source_number: '01.002',
	deleted: 0,
	unused: 0
};
const customer = {
	...identity,
	item_class: 1,
	customer_name: 'EPG customer',
	customer_deleted: 0,
	customer_address: ' Shanghai ',
	customer_phone: '12345678',
	customer_currency_id: '0',
	supplier_name: null,
	supplier_deleted: null
};

test('parties bind one stable item identity across the customer and supplier detail tables', () => {
	expect(bindings.parties).toMatchObject({
		table: { schema: 'dbo', name: 't_Item' },
		alias: 'parties',
		key: 'external_code',
		fields: {
			external_code: { column: { tableAlias: 'parties', name: 'FItemID' } },
			source_number: { column: { tableAlias: 'parties', name: 'FNumber' } },
			customer_name: { column: { tableAlias: 'customer', name: 'FName' } },
			supplier_name: { column: { tableAlias: 'supplier', name: 'FName' } }
		},
		texts: ['external_code', 'customer_currency_id']
	});
	expect(bindings.parties.joins.map((join) => join.table.name)).toEqual([
		't_Organization',
		't_Supplier'
	]);
	expect(bindings.parties.rowversions).toEqual([
		{ tableAlias: 'parties', name: 'FModifyTime' },
		{ tableAlias: 'customer', name: 'FModifyTime' },
		{ tableAlias: 'supplier', name: 'FModifyTime' }
	]);
	expect(bindings.parties.filters).toEqual([
		{ field: { tableAlias: 'parties', name: 'FItemClassID' }, op: 'in', value: [1, 8] },
		{ field: { tableAlias: 'parties', name: 'FDetail' }, op: 'eq', value: 1 }
	]);
});

test('customers use the configured account currency and observation instant, preserving their source marker', () => {
	expect(normalizeSourceRow('parties', customer, configuration, observedAt)).toMatchObject({
		__key: '123',
		__rowversion: marker,
		external_code: '123',
		source_number: '01.002',
		name: 'EPG customer',
		kind: 'customer',
		currency: 'CNY',
		active: true,
		address: 'Shanghai',
		phone: '12345678',
		source_updated_at: observedAt
	});
	expect(
		normalizeSourceRow('parties', { ...customer, customer_deleted: -1 }, configuration, observedAt)
	).toMatchObject({ active: false });
});

test('suppliers use verified detail names without guessing their contact columns', () => {
	expect(
		normalizeSourceRow(
			'parties',
			{ ...identity, item_class: '8', supplier_name: 'EPG supplier', supplier_deleted: false },
			configuration,
			observedAt
		)
	).toMatchObject({
		kind: 'supplier',
		name: 'EPG supplier',
		currency: 'CNY',
		address: null,
		phone: null,
		active: true
	});
});

test('product dependencies include detail and unit edits, and deleted details remain observable', () => {
	expect(bindings.products.rowversions).toEqual([
		{ tableAlias: 'products', name: 'FModifyTime' },
		{ tableAlias: 'detail', name: 'FModifyTime' },
		{ tableAlias: 'unit', name: 'FModifyTime' }
	]);
	expect(bindings.products.joins[0]).not.toHaveProperty('where');
	const product = {
		...identity,
		name: 'Resin',
		spec: 'A',
		unit: null,
		detail_deleted: null
	};
	expect(normalizeSourceRow('products', product, configuration, observedAt)).toMatchObject({
		external_code: '123',
		name: 'Resin',
		unit: null,
		unit_price: null,
		tax_rate: null,
		active: true,
		currency: 'CNY',
		source_updated_at: observedAt
	});
	expect(
		normalizeSourceRow('products', { ...product, detail_deleted: 1 }, configuration, observedAt)
	).toMatchObject({ active: false });
	expect(
		normalizeSourceRow('products', { ...product, unused: '1' }, configuration, observedAt)
	).toMatchObject({ active: false });
});

test('warehouses include only leaves and follow parent group changes', () => {
	expect(bindings.warehouses.joins[1]).toMatchObject({
		table: { schema: 'dbo', name: 't_Item' },
		alias: 'parent',
		where: { FItemClassID: 5, FDetail: 0 }
	});
	expect(bindings.warehouses.rowversions).toContainEqual({
		tableAlias: 'parent',
		name: 'FModifyTime'
	});
	expect(
		normalizeSourceRow(
			'warehouses',
			{ ...identity, name: 'Warehouse', group_code: null },
			configuration,
			observedAt
		)
	).toMatchObject({ external_code: '123', group_code: null, active: true });
});

test('stock sums each product, warehouse and lot grain and leaves unverified accounting values unknown', () => {
	expect(bindings.stock_snapshots).toMatchObject({
		table: { schema: 'dbo', name: 'ICInventory' },
		keyParts: ['item_id', 'warehouse_id', 'lot_number'],
		fields: {
			on_hand: { aggregate: 'sum', column: { tableAlias: 'stock_snapshots', name: 'FQty' } }
		},
		texts: ['item_id', 'warehouse_id'],
		decimals: ['on_hand']
	});
	expect(bindings.stock_snapshots.groupBy).toEqual([
		{ tableAlias: 'stock_snapshots', name: 'FItemID' },
		{ tableAlias: 'stock_snapshots', name: 'FStockID' },
		{ tableAlias: 'stock_snapshots', name: 'FBatchNo' },
		{ tableAlias: 'unit', name: 'FName' }
	]);
	expect(bindings.stock_snapshots).not.toHaveProperty('rowversion');
	expect(bindings.stock_snapshots).not.toHaveProperty('rowversions');
	expect(
		normalizeSourceRow(
			'stock_snapshots',
			{
				__key: 'V003100320033:V00340035:N',
				item_id: '123',
				warehouse_id: '45',
				lot_number: null,
				unit: 'kg',
				on_hand: '9007199254740993.123'
			},
			configuration,
			observedAt
		)
	).toMatchObject({
		external_code: 'V003100320033:V00340035:N',
		product_code: '123',
		warehouse_code: '45',
		lot_number: null,
		on_hand: '9007199254740993.123',
		unit_cost: null,
		currency: null,
		erp_committed: null,
		orders_as_of: null,
		as_of: observedAt
	});
});

test('invalid source identities, flags, classes, clocks and currency policy fail before a page can commit', () => {
	for (const row of [
		{ ...customer, external_code: 9007199254740992 },
		{ ...customer, external_code: 'not-an-id' },
		{ ...customer, deleted: 'no' },
		{ ...customer, item_class: 4 },
		{ ...customer, customer_name: null }
	])
		expect(() => normalizeSourceRow('parties', row, configuration, observedAt)).toThrow(
			SourceRowInvalid
		);
	expect(() => normalizeSourceRow('parties', customer, configuration, '2026')).toThrow(
		SourceRowInvalid
	);
	expect(() =>
		normalizeSourceRow('parties', customer, { baseCurrency: 'unknown' }, observedAt)
	).toThrow(SourceRowInvalid);
});
