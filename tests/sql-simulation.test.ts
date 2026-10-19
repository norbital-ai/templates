import { decimalText, fixtureId, firstRow } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Context, Schema, Effect } from 'effect';
import { DbError, Writes, BoltError, type DatabaseRequest } from '@norbital-ai/bolt/engine';
import { createHash, randomUUID } from 'node:crypto';
import { expect, it as test, vi } from '@effect/vitest';
import { sqlServerDatabase } from '@norbital-ai/bolt-server';
import { databaseFixture } from './database-fixture.js';
import { direct } from './synced-kit.js';
import { workspace, draft, confirm, committed } from './kit.js';
const dsn = process.env.BOLT_TRADE_SQL_SIMULATION_DSN;
// The fixture connection must point to the dedicated Microsoft SQL Server simulation schema.
test.live.skipIf(!dsn)(
	'sales and supplier orders receive issued confirmations, then read-only deliveries and invoices through native CDC',
	() =>
		Effect.gen(function* () {
			if (!dsn) throw new Error('Simulation connection required');
			let loseResponse = true;
			const driver = sqlServerDatabase();
			const sql = databaseFixture(dsn, {
				query: Effect.fnUntraced(function* (credential: string, request: DatabaseRequest) {
					const result = yield* driver.query(credential, request);
					if (loseResponse && request.statement.includes('Order submission is busy')) {
						loseResponse = false;
						return yield* Effect.fail(
							BoltError.make('upstream', 'facility', 'Simulated lost committed response')
						);
					}
					return result;
				})
			});
			const t = yield* workspace({ source: sql.request });
			const write = sql.write;
			for (const collection of [
				'parties',
				'products',
				'warehouses',
				'stock_snapshots',
				'credit_snapshots'
			]) {
				yield* Effect.tryPromise({
					try: () =>
						expect
							.poll(() => Effect.runPromise(t.pull(collection, randomUUID())), {
								timeout: 15000
							})
							.toMatchObject({ pages: expect.any(Number) }),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			}
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
			const firstDelivery = yield* t.deliver();
			const [commands] = yield* t.db.read([
				{ text: "SELECT status, error FROM sys_message WHERE class = 'command'", params: [] }
			]);
			expect(firstDelivery, JSON.stringify(commands?.rows)).toMatchObject({ sent: 1, failed: 0 });
			t.clock.advance('1min');
			const retry = yield* t.deliver();
			const [retried] = yield* t.db.read([
				{
					text: "SELECT status, error, attempts FROM sys_message WHERE class = 'command'",
					params: []
				}
			]);
			expect(retry, JSON.stringify(retried?.rows)).toMatchObject({ sent: 1 });
			expect(yield* t.deliver()).toMatchObject({
				sent: 0
			});
			const poll = Effect.fnUntraced(function* (
				collection:
					| 'ext_sales_orders'
					| 'ext_purchase_orders'
					| 'transactions'
					| 'source_payments'
					| 'source_sales_lines'
					| 'stock_snapshots',
				count: number
			) {
				yield* Effect.tryPromise({
					try: () =>
						expect
							.poll(
								() =>
									Effect.runPromise(
										Effect.gen(function* () {
											yield* t.pull(collection, randomUUID());
											return (yield* t.as(t.admin).read(collection, { all: true })).rows.length;
										})
									),
								{ timeout: 15000 }
							)
							.toBe(count),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			});
			yield* poll('ext_sales_orders', 1);
			yield* poll('ext_purchase_orders', 1);
			for (const [own, collection, direction] of [
				[sales, 'ext_sales_orders', 'sales'],
				[purchase, 'ext_purchase_orders', 'purchasing']
			] as const) {
				const parent = firstRow((yield* t.as(t.admin).read(collection, { all: true })).rows);
				expect(parent).toMatchObject({ order: own.order, status: 'issued' });
				for (const kind of ['delivery', 'invoice']) {
					const external_id = randomUUID(),
						items = JSON.stringify([
							{
								order_line_id: own.line,
								product_name: 'Resin A',
								unit: 'kg',
								quantity: '4',
								unit_price: '2'
							}
						]);
					const documents = JSON.stringify([
						{ name: `${kind}.pdf`, url: `https://example.test/${kind}.pdf`, sha256: 'a'.repeat(64) }
					]);
					const statement = `INSERT colony.OrderTransaction VALUES (@external_id,@parent,@order_id,@direction,@kind,@reference,@seal,@currency,'issued',@items,@documents,'2026-10-10','2026-11-09','8.72',SYSUTCDATETIME());`;
					const parameters = {
						external_id,
						parent: String(parent.external_id),
						order_id: own.order,
						direction,
						kind,
						reference: kind + '-' + direction,
						seal: String(parent.agreement_hash),
						currency: 'SGD',
						items,
						documents
					};
					yield* write({
						key: external_id,
						hash: createHash('sha256').update(JSON.stringify(parameters)).digest('hex'),
						find: 'SELECT external_id AS __key,@hash AS __hash FROM colony.OrderTransaction WHERE external_id=@key',
						statement,
						parameters
					});
				}
			}
			yield* poll('transactions', 4);
			const transactions = yield* t.as(t.admin).read('transactions', { all: true });
			expect(
				transactions.rows.every(
					(row) =>
						row.status === 'issued' && row.order && (row.ext_sales_order || row.ext_purchase_order)
				)
			).toBe(true);
			expect(
				yield* direct(t, t.as(t.admin).authority, {
					collection: 'transactions',
					verb: 'create',
					input: [{ order: sales.order }]
				})
			).not.toMatchObject({ kind: 'committed' });
			const original = yield* t.as(t.admin).get('orders', sales.order);
			committed(
				'orders',
				yield* t
					.as(t.admin)
					.act('orders.revise', { target: sales.order, input: { reason: 'Extended agreement' } })
			);
			committed(
				'orders',
				yield* t.as(t.admin).act('orders.update', {
					target: sales.order,
					set: { payment_terms: 'Net 60', valid_until: PlainDate('2026-12-31') }
				})
			);
			committed(
				'order_lines',
				yield* t.as(t.admin).act('order_lines.update', {
					target: sales.line,
					set: { quantity: Decimal.of('20'), unit_price: Decimal.of('3') }
				})
			);
			yield* confirm(t, sales.order);
			expect(yield* t.deliver()).toMatchObject({
				sent: 1
			});
			yield* poll('ext_sales_orders', 2);
			const revised = yield* t.as(t.admin).get('orders', sales.order);
			expect(revised?.contract_versions).toMatchObject([{ seal_hash: original?.seal_hash }]);
			expect(revised?.sealed_contract).toContain('Net 60');
			expect(
				transactions.rows
					.filter((row) => row.order === sales.order)
					.every((row) => row.seal_hash === original?.seal_hash)
			).toBe(true);
			const invoice = transactions.rows.find(
				(row) => row.order === sales.order && row.kind === 'invoice'
			);
			if (invoice === undefined) throw new Error('Issued sales invoice required');
			const receipt = randomUUID(),
				fact = randomUUID();
			yield* write({
				key: receipt,
				hash: 'b'.repeat(64),
				find: 'SELECT external_code AS __key,@hash AS __hash FROM colony.source_payments WHERE external_code=@key',
				statement:
					"INSERT colony.source_payments VALUES (@key,@order_id,@invoice_id,'receipt','RCPT-1','2026-10-10',SYSUTCDATETIME(),@seal,'SGD','3',1)",
				parameters: {
					order_id: sales.order,
					invoice_id: String(invoice.erp_id),
					seal: String(original?.seal_hash)
				}
			});
			yield* poll('source_payments', 1);
			expect(
				yield* t.as(t.admin).query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ invoice: invoice.id, balance: decimalText('5.72') })
				])
			);
			yield* write({
				key: fact,
				hash: 'c'.repeat(64),
				find: 'SELECT external_code AS __key,@hash AS __hash FROM colony.source_sales_lines WHERE external_code=@key',
				statement:
					"INSERT colony.source_sales_lines (external_code,order_id,order_line_id,kind,reference,business_on,source_updated_at,seal_hash,unit,quantity,currency,net_amount,tax_amount,freight,active,lot_number,unit_cost) VALUES (@key,@order_id,@line_id,'shipment','SHIP-1','2026-10-10',SYSUTCDATETIME(),@seal,'kg','4','SGD','8','0.72','1.20',1,'LOT-001','1.50')",
				parameters: {
					order_id: sales.order,
					line_id: sales.line,
					seal: String(original?.seal_hash)
				}
			});
			yield* poll('source_sales_lines', 1);
			expect(yield* t.as(t.admin).query('orders.sales_detail', {})).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						lot_number: 'LOT-001',
						cost: decimalText('6.00'),
						margin: decimalText('0.80')
					})
				])
			);
			expect(yield* t.as(t.admin).query('orders.sales_analysis', {})).toEqual(
				expect.arrayContaining([expect.objectContaining({ net: decimalText('6.80') })])
			);
			yield* write({
				key: receipt,
				hash: 'd'.repeat(64),
				find: 'SELECT @key AS __key,@hash AS __hash WHERE NOT EXISTS(SELECT 1 FROM colony.source_payments WHERE external_code=@key)',
				statement: 'DELETE colony.source_payments WHERE external_code=@key',
				parameters: {}
			});
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(
							() =>
								Effect.runPromise(
									Effect.gen(function* () {
										yield* t.pull('source_payments', randomUUID());
										return (yield* t.as(t.admin).read('source_payments', { all: true })).rows[0]
											?.active;
									})
								),
							{ timeout: 15000 }
						)
						.toBe(false),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(
				yield* t.as(t.admin).query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ invoice: invoice.id, balance: decimalText('8.72') })
				])
			);
			const stockBefore = firstRow(
				(yield* t.as(t.admin).read('stock_snapshots', { all: true })).rows
			);
			yield* write({
				key: String(stockBefore.external_code),
				hash: 'e'.repeat(64),
				find: "SELECT external_code AS __key,@hash AS __hash FROM colony.stock_snapshots WHERE external_code=@key AND on_hand='96'",
				statement:
					"UPDATE colony.stock_snapshots SET on_hand='96',erp_committed='16',as_of=SYSUTCDATETIME(),orders_as_of=SYSUTCDATETIME() WHERE external_code=@key",
				parameters: {}
			});
			const writes = Context.get(t.services, Writes),
				act = writes.act;
			let localResponseLost = false;
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* Effect.acquireRelease(
						Effect.sync(() =>
							vi.spyOn(writes, 'act').mockImplementation((request) =>
								act(request).pipe(
									Effect.flatMap((result) => {
										if (
											!localResponseLost &&
											request.collection === 'stock_snapshots' &&
											request.mode._tag === 'Feed' &&
											result.outcome.kind === 'committed'
										) {
											localResponseLost = true;
											return Effect.fail(
												new DbError({
													sqlstate: '08006',
													message: 'Simulated lost local commit response'
												})
											);
										}
										return Effect.succeed(result);
									})
								)
							)
						),
						(spy) => Effect.sync(() => spy.mockRestore())
					);
					yield* Effect.tryPromise({
						try: () =>
							expect
								.poll(
									() =>
										Effect.runPromise(
											Effect.gen(function* () {
												yield* t
													.pull('stock_snapshots', randomUUID())
													.pipe(
														Effect.catchTag('DbError', (error) =>
															error.message === 'Simulated lost local commit response'
																? Effect.void
																: Effect.fail(error)
														)
													);
												return localResponseLost;
											})
										),
									{ timeout: 15000 }
								)
								.toBe(true),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
				})
			);
			yield* t.pull('stock_snapshots', 'local-response-recovery');
			const stockAfter = firstRow(
				(yield* t.as(t.admin).read('stock_snapshots', { all: true })).rows
			);
			expect(stockAfter).toMatchObject({
				on_hand: decimalText('96'),
				lot_number: 'LOT-001',
				unit_cost: decimalText('1.5'),
				revision: Number(stockBefore.revision) + 1
			});
			t.clock.set(new Date().toISOString());
			expect(
				yield* t.as(t.admin).query('stock_snapshots.projected_availability', {})
			).toMatchObject([
				{
					sellable: decimalText('80'),
					local_committed: decimalText('0'),
					projected: decimalText('80'),
					reason: 'available'
				}
			]);
			yield* write({
				key: String(stockBefore.external_code),
				hash: 'f'.repeat(64),
				find: 'SELECT @key AS __key,@hash AS __hash WHERE NOT EXISTS(SELECT 1 FROM colony.stock_snapshots WHERE external_code=@key)',
				statement: 'DELETE colony.stock_snapshots WHERE external_code=@key',
				parameters: {}
			});
			yield* poll('stock_snapshots', 0);
			const before = transactions.rows.map((row) => [row.id, row.revision]);
			yield* t.pull('transactions', 'replay');
			expect(
				(yield* t.as(t.admin).read('transactions', { all: true })).rows.map((row) => [
					row.id,
					row.revision
				])
			).toEqual(before);
		}),
	60000
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
