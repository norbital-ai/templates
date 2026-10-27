import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { expect, it as test } from '@effect/vitest';
import source from '../seed/seed.js';
import commercial_settings from '../seed/commercial_settings.json';
import document_templates from '../seed/document_templates.json';
import parties from '../seed/parties.json';
import products from '../seed/products.json';
import warehouses from '../seed/warehouses.json';
import { Instant } from '@norbital-ai/std/date';
import { committed, CUSTOMER, workspace } from './kit.js';
import { decimalText, firstRow, fixtureId } from './test-runtime.js';
import { confirmationOf, sealedExportOf } from './reads.js';

const NOW = '2026-10-10T00:00:00Z';
const SALES = fixtureId('sys_user', '00000000-0000-4000-8000-000000000901');
const PRODUCT = fixtureId('products', '00000000-0000-4000-8000-000000000202');
const WAREHOUSE = fixtureId('warehouses', '00000000-0000-4000-8000-000000000301');
const ORDER = fixtureId('orders', '00000000-0000-4000-8000-000000000902');
const LINE = fixtureId('order_lines', '00000000-0000-4000-8000-000000000903');
const STOCK = fixtureId('stock_snapshots', '00000000-0000-4000-8000-000000000904');
const CREDIT = fixtureId('credit_snapshots', '00000000-0000-4000-8000-000000000905');
const FLOOR = fixtureId('pricing_floors', '00000000-0000-4000-8000-000000000906');

const temporaryBank = Effect.fnUntraced(function* () {
	const directory = yield* Effect.acquireRelease(
		Effect.sync(() => {
			const parent = join(tmpdir(), 'norbital-scratch');
			mkdirSync(parent, { recursive: true });
			return mkdtempSync(join(parent, 'trade-sample-'));
		}),
		(path) => Effect.sync(() => rmSync(path, { recursive: true, force: true }))
	);
	return {
		directory,
		has: (path: string) => existsSync(join(directory, path)),
		json: (path: string) =>
			Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
				readFileSync(join(directory, path), 'utf8')
			)
	};
});

test.live(
	'an absent sample bank preserves the nine public defaults and duplicate sample IDs fail',
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const bank = yield* temporaryBank();
				const rows = source.rows(bank);
				expect(rows).toEqual({
					commercial_settings,
					document_templates,
					parties,
					products,
					warehouses
				});
				expect(
					Object.values(rows).reduce((count, model) => count + model.length, 0)
				).toBe(9);
				writeFileSync(
					join(bank.directory, 'sys_user.json'),
					JSON.stringify([{ id: SALES }, { id: SALES }])
				);
				expect(() => source.rows(bank)).toThrow('Duplicate sample identity in sys_user.');
				writeFileSync(
					join(bank.directory, 'sys_user.json'),
					JSON.stringify([{ id: SALES, team: 'Warehouse' }])
				);
				expect(() => source.rows(bank)).toThrow('Unknown sample team Warehouse.');
			})
		)
);

test.live(
	'a merged native sample restores its joins and amounts and can seal an imported draft',
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const bank = yield* temporaryBank();
				const fixtures = {
					sys_user: [
						{
							id: SALES,
							name: 'Sample salesperson',
							email: 'sample.sales@example.test',
							kind: 'staff',
							active: true,
							admin: false,
							team: 'Sales'
						}
					],
					parties: [{ ...firstRow(parties), name: 'Sample customer' }],
					products: [
						{
							id: PRODUCT,
							external_code: 'SAMPLE-A',
							name: 'Sample polymer',
							unit: 'kg',
							currency: 'SGD',
							unit_price: '3.0000',
							tax_rate: '9',
							active: true,
							source_updated_at: NOW,
							source: 'kingdee'
						}
					],
					orders: [
						{
							id: ORDER,
							number: 'TR-2026-0042',
							title: 'Synthetic sample order',
							direction: 'sales',
							status: 'draft',
							ordered_on: '2026-10-10',
							currency: 'SGD',
							tax_inclusive: false,
							payment_terms: 'Net 30',
							party: CUSTOMER,
							party_name: 'Sample customer',
							owner: SALES,
							warehouse: WAREHOUSE,
							ledger: 'kingdee'
						}
					],
					order_lines: [
						{
							id: LINE,
							order: ORDER,
							product: PRODUCT,
							product_code: 'SAMPLE-A',
							product_name: 'Sample polymer',
							unit: 'kg',
							currency: 'SGD',
							quantity: '10',
							unit_price: '3.0000',
							discount_pct: '0',
							tax_rate: '9',
							net: '30.00',
							tax: '2.70',
							total: '32.70',
							floor_net: '2.00000000',
							floor_on: '2026-01-01'
						}
					],
					stock_snapshots: [
						{
							id: STOCK,
							external_code: 'SAMPLE-A:WEST:SAMPLE-001',
							product: PRODUCT,
							warehouse: WAREHOUSE,
							source: 'kingdee',
							unit: 'kg',
							currency: 'SGD',
							lot_number: 'SAMPLE-001',
							unit_cost: '1.50000000',
							on_hand: '100',
							erp_committed: '0',
							as_of: NOW,
							orders_as_of: NOW
						}
					],
					credit_snapshots: [
						{
							id: CREDIT,
							external_code: 'SAMPLE-CREDIT',
							party: CUSTOMER,
							source: 'kingdee',
							currency: 'SGD',
							credit_limit: '1000.00',
							credit_used: '0.00',
							credit_hold: false,
							as_of: NOW
						}
					],
					pricing_floors: [
						{
							id: FLOOR,
							product: PRODUCT,
							currency: 'SGD',
							group_code: 'WEST',
							effective_on: '2026-01-01',
							unit: 'kg',
							floor_price: '2.0000',
							tax_inclusive: false,
							tax_rate: '9',
							minimum_quantity: '0'
						}
					]
				} satisfies Record<string, readonly Record<string, Schema.Json>[]>;
				for (const [model, rows] of Object.entries(fixtures))
					writeFileSync(join(bank.directory, `${model}.json`), JSON.stringify(rows));
				const rows = source.rows(bank);
				expect(rows.parties).toHaveLength(2);
				expect(rows.products).toHaveLength(2);
				expect(rows.document_templates).toEqual(document_templates);
				const t = yield* workspace({ seed: rows, now: NOW });
				const as = t.as(t.admin);
				expect((yield* as.query({ parties: {} })).parties.rows).toHaveLength(2);
				expect((yield* as.query({ products: {} })).products.rows).toHaveLength(2);
				expect((yield* as.query({ orders: {} })).orders.rows).toHaveLength(1);
				// the bank names the team by label; the seed maps it to the workspace's handle
				expect(
					(yield* as.query({ sys_user: { where: { id: { eq: SALES } }, limit: 1 } })).sys_user
						.rows[0]
				).toMatchObject({
					team: 'sales',
					admin: false,
					active: true
				});
				const seeded = yield* as.query({
					orders: {
						where: { id: { eq: ORDER } },
						fields: ['number', 'ledger', 'owner', 'line_count', 'net', 'tax', 'total', 'party'],
						limit: 1
					},
					'orders.party': { fields: ['name'] },
					'orders.lines': { fields: ['total', 'product'] },
					products: { where: { id: { eq: PRODUCT } }, fields: ['name'] }
				});
				expect(seeded.orders.rows[0]).toMatchObject({
					number: 'TR-2026-0042',
					ledger: 'kingdee',
					owner: SALES,
					line_count: 1,
					net: decimalText('30.00'),
					tax: decimalText('2.70'),
					total: decimalText('32.70'),
					party: { id: CUSTOMER, name: 'Sample customer' },
					lines: [{ id: LINE, total: decimalText('32.70'), product: PRODUCT }]
				});
				// a line's product is not a declared layer of orders: its name is read beside the order
				expect(seeded.products.rows).toMatchObject([{ id: PRODUCT, name: 'Sample polymer' }]);
				expect(
					(yield* as.query({ stock_snapshots: { where: { id: { eq: STOCK } }, limit: 1 } }))
						.stock_snapshots.rows[0]
				).toMatchObject({
					product: PRODUCT,
					warehouse: WAREHOUSE,
					source: 'kingdee'
				});
				expect(
					(yield* as.query({ credit_snapshots: { where: { id: { eq: CREDIT } }, limit: 1 } }))
						.credit_snapshots.rows[0]
				).toMatchObject({
					party: CUSTOMER
				});
				expect(
					(yield* as.query({ pricing_floors: { where: { id: { eq: FLOOR } }, limit: 1 } }))
						.pricing_floors.rows[0]
				).toMatchObject({
					product: PRODUCT
				});
				const check = yield* confirmationOf(as, {
					order: ORDER,
					as_of: Instant(NOW)
				});
				expect(check).toMatchObject({
					warning: false,
					unavailable: false,
					gross: '32.70',
					below_inventory_cost: []
				});
				expect(
					committed(
						'orders',
						yield* as.act('orders.update', [
							{
								target: ORDER,
								set: { status: 'confirmed', check_hash: check.check_hash }
							}
						])
					)
				).toBe(ORDER);
				const sealed = (yield* as.query({ orders: { where: { id: { eq: ORDER } }, limit: 1 } }))
					.orders.rows[0];
				expect(sealed).toMatchObject({
					status: 'confirmed',
					sealed_snapshot: {
						total: '32.70',
						party_name: 'Sample customer',
						lines: [{ id: LINE, product: PRODUCT }]
					}
				});
				const exported = yield* sealedExportOf(as, { order: ORDER });
				expect(exported.number).toBe('TR-2026-0042');
				expect(exported.seal_hash).toBe(sealed?.seal_hash);
				expect(exported.contract).toContain('Sample customer');
				expect(exported.contract).toContain('Sample polymer');
				expect(exported.contract).toContain('32.70');
			})
		)
);
