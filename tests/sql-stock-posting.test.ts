import { fixtureId, decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it as test } from '@effect/vitest';
import { databaseFixture } from './database-fixture.js';
import { workspace, draft, confirm, committed, PRODUCT } from './kit.js';
const dsn = process.env.BOLT_TRADE_SQL_SIMULATION_DSN;
test.live.skipIf(!dsn)(
	'real SQL source posts FIFO once for a DO/invoice pair and increases stock for supplier receipts',
	() =>
		Effect.gen(function* () {
			if (!dsn) throw new Error('Simulation connection required');
			const sql = databaseFixture(dsn);
			const t = yield* workspace({ source: sql.request });
			const as = t.as(t.admin);
			const write = Effect.fnUntraced(function* (
				key: string,
				statement: string,
				parameters: Record<string, string> = {},
				find = 'SELECT external_id AS __key,@hash AS __hash FROM colony.OrderTransaction WHERE external_id=@key'
			) {
				return yield* sql.write({ key, hash: 'e'.repeat(64), find, statement, parameters });
			});
			yield* write(
				'stock-date',
				"IF COL_LENGTH('colony.stock_snapshots','received_on') IS NULL ALTER TABLE colony.stock_snapshots ADD received_on date;",
				{},
				"SELECT @key AS __key,@hash AS __hash WHERE COL_LENGTH('colony.stock_snapshots','received_on') IS NOT NULL"
			);
			yield* write(
				'setup-stock',
				"IF OBJECT_ID('colony.InventoryPosting') IS NULL CREATE TABLE colony.InventoryPosting(movement nvarchar(120) PRIMARY KEY,order_id varchar(36),quantity decimal(18,3),items nvarchar(max),posted_at datetime2); UPDATE colony.stock_snapshots SET on_hand='5',received_on='2026-09-01' WHERE external_code='RESIN-A:WEST'; INSERT colony.stock_snapshots(external_code,lot_number,unit_cost,currency,unit,on_hand,erp_committed,as_of,orders_as_of,product_code,warehouse_code,received_on) VALUES('RESIN-A:WEST:LOT-002','LOT-002','2','SGD','kg','10','0',SYSUTCDATETIME(),SYSUTCDATETIME(),'RESIN-A','WEST','2026-09-02');",
				{},
				"SELECT @key AS __key,@hash AS __hash WHERE EXISTS(SELECT 1 FROM colony.stock_snapshots WHERE external_code='RESIN-A:WEST:LOT-002')"
			);
			yield* write(
				'procedure',
				`EXEC(N'${readFileSync(new URL('./fixtures/accounting-stock-posting.sql', import.meta.url), 'utf8').replaceAll("'", "''")}')`,
				{},
				"SELECT @key AS __key,@hash AS __hash WHERE OBJECT_ID('colony.PostStockDocument') IS NOT NULL"
			);
			const pull = Effect.fnUntraced(function* (collection: string) {
				yield* Effect.tryPromise({
					try: () =>
						expect
							.poll(() => Effect.runPromise(t.pull(collection, randomUUID())), {
								timeout: 20000
							})
							.toMatchObject({ pages: expect.any(Number) }),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			});
			for (const c of ['parties', 'products', 'warehouses', 'stock_snapshots']) yield* pull(c);
			committed(
				'pricing_floors',
				yield* as.act('pricing_floors.create', {
					product: PRODUCT,
					currency: 'SGD',
					group_code: 'WEST',
					effective_on: PlainDate('2026-01-01'),
					unit: 'kg',
					floor_price: Decimal.of('1'),
					tax_inclusive: false
				})
			);
			committed(
				'commission_rules',
				yield* as.act('commission_rules.create', {
					code: 'default',
					currency: 'SGD',
					effective_on: PlainDate('2026-01-01'),
					basis_unit: 't',
					fixed_rate: Decimal.of('10'),
					spread_pct: Decimal.of('20')
				})
			);
			const sales = yield* draft(
				t,
				'sales',
				undefined,
				undefined,
				fixtureId('warehouses', '00000000-0000-4000-8000-000000000301')
			);
			const purchase = yield* draft(t, 'purchasing');
			yield* confirm(t, sales.order);
			yield* confirm(t, purchase.order);
			expect(yield* t.deliver()).toMatchObject({ sent: 2 });
			yield* pull('ext_sales_orders');
			yield* pull('ext_purchase_orders');
			const move = 'FIFO-' + randomUUID();
			const post = (
				own: Effect.Success<ReturnType<typeof draft>>,
				kind: string,
				quantity: string,
				movement: string,
				lot = '',
				cost = '0'
			) =>
				write(
					randomUUID(),
					'EXEC colony.PostStockDocument @external_id=@key,@movement=@movement,@order_id=@order,@line_id=@line,@kind=@kind,@quantity=@quantity,@receipt_lot=@lot,@receipt_cost=@cost',
					{ movement, order: own.order, line: own.line, kind, quantity, lot, cost }
				);
			yield* post(sales, 'delivery', '8', move);
			yield* post(sales, 'invoice', '8', move);
			for (const c of ['stock_snapshots', 'transactions', 'source_sales_lines']) yield* pull(c);
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('stock_snapshots');
										return (yield* as.read('stock_snapshots', { all: true })).rows.map((row) => ({
											lot: row.lot_number,
											qty: row.on_hand.toString()
										}));
									})
								),
							{ timeout: 20000 }
						)
						.toEqual(
							expect.arrayContaining([
								{ lot: 'LOT-001', qty: '0.000' },
								{ lot: 'LOT-002', qty: '7.000' }
							])
						),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('source_sales_lines');
										return yield* as.query('orders.sales_detail', {});
									})
								),
							{ timeout: 20000 }
						)
						.toEqual(
							expect.arrayContaining([
								expect.objectContaining({
									lot_number: 'LOT-001',
									cost: decimalText('7.50'),
									margin: decimalText('2.50')
								}),
								expect.objectContaining({
									lot_number: 'LOT-002',
									cost: decimalText('6.00'),
									margin: decimalText('0.00')
								})
							])
						),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const receipt = 'RECEIPT-' + randomUUID();
			yield* post(purchase, 'delivery', '7', receipt, 'LOT-003', '1.8');
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('stock_snapshots');
										return (yield* as.read('stock_snapshots', { all: true })).rows;
									})
								),
							{ timeout: 20000 }
						)
						.toEqual(
							expect.arrayContaining([
								expect.objectContaining({
									lot_number: 'LOT-003',
									on_hand: decimalText('7.000'),
									unit_cost: decimalText('1.80000000')
								})
							])
						),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* post(purchase, 'invoice', '7', receipt);
			yield* write(
				purchase.order,
				"UPDATE colony.OrderTransaction SET items=JSON_MODIFY(items,'$[0].net_amount','14'),total='15.26',source_updated_at=SYSUTCDATETIME() WHERE order_id=@order AND kind='invoice'",
				{ order: purchase.order },
				"SELECT @key AS __key,@hash AS __hash WHERE EXISTS(SELECT 1 FROM colony.OrderTransaction WHERE order_id=@key AND kind='invoice' AND JSON_VALUE(items,'$[0].net_amount')='14')"
			);
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('transactions');
										return yield* as.query('parties.progress', {
											party: fixtureId('parties', '00000000-0000-4000-8000-000000000102')
										});
									})
								),
							{ timeout: 20000 }
						)
						.toMatchObject([
							{
								quota: decimalText('10'),
								delivered: decimalText('7.000'),
								fulfillment: decimalText('70.00'),
								actual: decimalText('14')
							}
						]),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* pull('stock_snapshots');
			expect((yield* as.read('stock_snapshots', { all: true })).rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ lot_number: 'LOT-003', on_hand: decimalText('7.000') })
				])
			);
			t.clock.set(new Date().toISOString());
			expect(yield* as.query('orders.commission', { order: sales.order })).toMatchObject([
				{ amount: decimalText('2.10') }
			]); // agreement estimate: ten kg
			expect(
				yield* as.query('commission_statements.board', {
					period: PlainDate('2026-10-01')
				})
			).toMatchObject([{ amount: decimalText('1.68') }]); // earned on eight kg; no second invoice commission
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('transactions');
										return (yield* as.read('transactions', { all: true })).rows.length;
									})
								),
							{ timeout: 20000 }
						)
						.toBe(4),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* post(sales, 'delivery', '4', 'EXTRA-' + randomUUID());
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('transactions');
										yield* pull('source_sales_lines');
										yield* pull('stock_snapshots');
										return yield* as.query('commission_statements.board', {
											period: PlainDate('2026-10-01')
										});
									})
								),
							{ timeout: 20000 }
						)
						.toMatchObject([{ amount: decimalText('2.52') }]),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(
				yield* as.query('parties.progress', {
					party: fixtureId('parties', '00000000-0000-4000-8000-000000000101')
				})
			).toMatchObject([
				{
					quota: decimalText('10'),
					delivered: decimalText('12.000'),
					fulfillment: decimalText('120.00')
				}
			]);
			expect((yield* as.read('stock_snapshots', { all: true })).rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ lot_number: 'LOT-002', on_hand: decimalText('3.000') })
				])
			);
			yield* post(sales, 'invoice', '2', 'DIRECT-' + randomUUID());
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* pull('transactions');
										yield* pull('source_sales_lines');
										yield* pull('stock_snapshots');
										return yield* as.query('parties.progress', {
											party: fixtureId('parties', '00000000-0000-4000-8000-000000000101')
										});
									})
								),
							{ timeout: 20000 }
						)
						.toMatchObject([
							{
								quota: decimalText('10'),
								delivered: decimalText('14.000'),
								fulfillment: decimalText('140.00')
							}
						]),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(
				yield* as.query('commission_statements.board', { period: PlainDate('2026-10-01') })
			).toMatchObject([{ amount: decimalText('2.94') }]);
			expect((yield* as.read('stock_snapshots', { all: true })).rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ lot_number: 'LOT-002', on_hand: decimalText('1.000') })
				])
			);
		}),
	90000
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
