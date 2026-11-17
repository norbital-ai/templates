import type { Id } from '@norbital-ai/bolt';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BigDecimal, Effect, Schema } from 'effect';
import { it } from '@effect/vitest';
import sql from 'mssql';
import { validate_database_request } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { compile_sql_server } from '@norbital-ai/store/sqlserver';
import { workspace, committed, confirm } from './kit.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';
import { kingdeeCreditPolicy } from '../src/integration/kingdee/configuration.js';
const Access = Schema.Struct({
	sqlHost: Schema.String,
	sqlPort: Schema.Number,
	database: Schema.String,
	tlsServerName: Schema.String,
	accountIdentity: Schema.String,
	password: Schema.String,
	url: Schema.String,
	writer: Schema.Struct({ user: Schema.String, password: Schema.String })
});

const NativeOrder = Schema.Struct({
	id: Schema.Number,
	reference: Schema.String,
	rowversion: Schema.String,
	version: Schema.String,
	lines: Schema.Array(
		Schema.Struct({ entry: Schema.Number, item: Schema.Number, quantity: Schema.String })
	)
});
const ApiResponse = Schema.Struct({
	id: Schema.optionalKey(Schema.Number),
	delivery: Schema.optionalKey(Schema.Number),
	invoice: Schema.optionalKey(Schema.Number),
	orders: Schema.optionalKey(Schema.Array(NativeOrder))
});

/** The deployed simulator through the loopback relays, with its masters read. */
const simulator = Effect.fnUntraced(function* () {
	const a = Schema.decodeUnknownSync(Access)(
		JSON.parse(process.env.TRADE_SIMULATOR_ACCESS ?? '{}')
	);
	assert.equal(a.sqlHost, '127.0.0.1');
	assert.equal(new URL(a.url).hostname, '127.0.0.1');
	const pool = yield* Effect.acquireRelease(
		Effect.promise(() =>
			new sql.ConnectionPool({
				server: a.sqlHost,
				port: a.sqlPort,
				user: a.writer.user,
				password: a.writer.password,
				database: a.database,
				options: { encrypt: true, trustServerCertificate: false, serverName: a.tlsServerName }
			}).connect()
		),
		(pool) => Effect.promise(() => pool.close())
	);
	let cut = false,
		lost = false,
		requests = 0;
	const api = async (path: string, b?: Record<string, unknown>) => {
		const r = await fetch(a.url + '/api/' + path, {
			method: b ? 'POST' : 'GET',
			headers: {
				authorization: 'Bearer ' + a.password,
				'content-type': 'application/json',
				'Idempotency-Key': randomUUID()
			},
			...(b ? { body: JSON.stringify(b) } : {})
		});
		const v = await r.json();
		assert.equal(r.status, 200, path + ': ' + JSON.stringify(v));
		return Schema.decodeUnknownSync(ApiResponse)(v);
	};
	const nativeOrder = async (id: number | undefined) => {
		const row = (await api('state')).orders?.find((row) => row.id === id);
		assert(row, 'Native order required');
		return row;
	};
	const source: NonNullable<Parameters<typeof workspace>[0]>['source'] = (operation) =>
		Effect.tryPromise({
			try: async () => {
				if (cut) {
					cut = false;
					throw Error('Injected SQL transport outage');
				}
				const c = compile_sql_server(await Effect.runPromise(validate_database_request(operation)));
				const tx = pool.transaction();
				await tx.begin(
					c.transaction === 'serializable'
						? sql.ISOLATION_LEVEL.SERIALIZABLE
						: sql.ISOLATION_LEVEL.READ_COMMITTED
				);
				try {
					const r = tx.request();
					for (const [k, v] of Object.entries(c.parameters)) {
						if (typeof v === 'string') r.input(k, sql.NVarChar(sql.MAX), v);
						else r.input(k, v);
					}
					const result =
						c.statement === undefined ? await r.execute(c.procedure) : await r.query(c.statement);
					await tx.commit();
					requests++;
					// the write is in Kingdee; only its answer never arrives
					if (lost && c.transaction === 'serializable') {
						lost = false;
						throw Error('Injected lost reply after commit');
					}

					return { rows: result.recordset || [] };
				} catch (e) {
					await tx.rollback().catch(() => {});
					throw e;
				}
			},
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
		});
	const t = yield* workspace({ source, now: '2026-11-17T03:00:00Z' }),
		as = yield* t.as(t.admin),
		instance = fixtureId('sys_integration', 'kingdee');
	for (const model of ['parties', 'products', 'warehouses'] as const) yield* t.pull(model);
	const masters = yield* as.query({
		parties: { where: { source: { eq: instance }, external_code: { eq: '110' } } },
		products: { where: { source: { eq: instance }, external_code: { in: ['210', '211'] } } },
		warehouses: { where: { source: { eq: instance }, external_code: { eq: '311' } } }
	});
	assert.equal(masters.parties.rows.length, 1);
	assert.equal(masters.products.rows.length, 2);
	assert.equal(masters.warehouses.rows.length, 1);
	const configure = (owner: string) => {
		const config = {
			baseCurrency: 'CNY',
			branchNo: '0',
			maxWindowMinutes: 15,
			writeAccount: a.accountIdentity,
			stockAvailabilityAccount: a.accountIdentity,
			stockLotCostAccount: a.accountIdentity,
			deliveryCostAccount: a.accountIdentity,
			receivablesAccount: a.accountIdentity,
			invoiceAnalysisAccount: a.accountIdentity,
			creditAccount: a.accountIdentity,
			creditPolicy: kingdeeCreditPolicy,
			billerId: '41',
			salespersonBindings: JSON.stringify({
				[owner]: { employeeId: '21', departmentId: '31' }
			}),
			currencyBindings: '{"CNY":{"id":"1","base":true}}',
			settlementRules: '{"NET30":{"creditDays":30,"fromMonthEnd":false}}'
		};
		return as.act({
			'sys_integration.update': [{ target: { id: instance }, set: { configuration: config } }]
		});
	};
	return {
		api,
		pool,
		nativeOrder,
		t,
		as,
		instance,
		masters,
		configure,
		outage: () => {
			cut = true;
		},
		loseReply: () => {
			lost = true;
		},
		requests: () => requests
	};
});

it.live.skipIf(!process.env.TRADE_SIMULATOR_ACCESS)(
	'the simulator completes the real two-way order, fulfillment and stock flow through a loopback link',
	() =>
		Effect.gen(function* () {
			const s = yield* simulator();
			const { api, pool, nativeOrder, t, as, instance, masters } = s;
			const report = yield* Effect.gen(function* () {
				const local = committed(
					'orders',
					yield* as.act({
						'orders.create': [
							{
								title: 'Live two-way acceptance ' + randomUUID().slice(0, 8),
								direction: 'sales',
								party: firstRow(masters.parties.rows).id,
								currency: 'CNY',
								payment_terms: 'NET30'
							}
						]
					})
				);
				yield* t.db.write({
					text: 'UPDATE orders SET number = $2 WHERE id = $1',
					params: [local, 'ACCEPTANCE-PUSH-' + randomUUID().slice(0, 8)]
				});
				const owner = firstRow(
					(yield* as.query({ orders: { where: { id: { eq: local } } } })).orders.rows
				).owner;
				yield* s.configure(owner);
				const readCredit = () =>
					as.query({
						credit_snapshots: { where: { source: { eq: instance }, external_code: { eq: '110' } } }
					});
				yield* t.pull('credit_snapshots');
				const baselineCredit = firstRow((yield* readCredit()).credit_snapshots.rows);
				assert(baselineCredit.credit_used !== null);
				const baselineUsed = BigDecimal.fromStringUnsafe(baselineCredit.credit_used);
				const creditMovement = Effect.fnUntraced(function* (delta: string) {
					yield* t.pull('credit_snapshots');
					const row = firstRow((yield* readCredit()).credit_snapshots.rows);
					assert(row.credit_used !== null && row.credit_limit !== null);
					const expected = BigDecimal.sum(baselineUsed, BigDecimal.fromStringUnsafe(delta));
					assert(
						sameDecimal(row.credit_used, BigDecimal.format(expected)),
						'Native credit movement must be exact'
					);
					assert(
						sameDecimal(
							row.credit_available,
							BigDecimal.format(
								BigDecimal.subtract(BigDecimal.fromStringUnsafe(row.credit_limit), expected)
							)
						)
					);
				});
				for (const product of masters.products.rows)
					committed(
						'order_lines',
						yield* as.act({
							'order_lines.create': [
								{
									order: local,
									product: product.id,
									quantity: '10',
									unit_price: '8',
									discount_pct: '0',
									tax_rate: '13'
								}
							]
						})
					);
				yield* confirm(t, local);
				yield* t.deliver();
				yield* t.pull('orders');
				yield* t.pull('order_lines');
				const localOrder = firstRow(
					(yield* as.query({ orders: { where: { id: { eq: local } }, lines: {} } })).orders.rows
				);
				assert(localOrder.kingdee?.fid, 'Local order must reach native SQL');
				const pushed = Number(localOrder.kingdee.fid);
				yield* Effect.promise(() => api('orders/submit', { id: pushed }));
				yield* Effect.promise(() => api('orders/approve', { id: pushed, actor: 21 }));
				yield* Effect.promise(() => api('orders/approve', { id: pushed, actor: 42 }));
				const foreign = yield* Effect.promise(() =>
					api('orders/create', {
						customer: 110,
						item: 210,
						quantity: '20',
						price: '8',
						tax: '13',
						reference: 'ACCEPTANCE-NATIVE-' + randomUUID().slice(0, 8)
					})
				);
				yield* Effect.promise(() =>
					pool
						.request()
						.input('id', sql.Int, foreign.id)
						.query(
							`UPDATE dbo.SEOrder SET FAreaPS=2,FSaleStyle=101,FSettleDate=DATEADD(day,45,FDate) WHERE FInterID=@id AND FBrNo='0'`
						)
				);
				const nativeTerms = () =>
					Effect.promise(
						async () =>
							(
								await pool
									.request()
									.input('id', sql.Int, foreign.id)
									.query(
										`SELECT FDeptID,FEmpID,FAreaPS,FSaleStyle,CONVERT(varchar(33),FDate,126) date,CONVERT(varchar(33),FSettleDate,126) due FROM dbo.SEOrder WHERE FInterID=@id AND FBrNo='0'`
									)
							).recordset
					);
				const retainedTerms = yield* nativeTerms();
				let native = yield* Effect.promise(() => nativeOrder(foreign.id));
				yield* Effect.promise(() =>
					api('orders/line-save', {
						id: foreign.id,
						expected: native.rowversion,
						item: 211,
						quantity: '12',
						price: '9',
						tax: '13',
						note: 'Two-line source import acceptance'
					})
				);
				yield* Effect.promise(() => api('orders/submit', { id: foreign.id }));
				yield* Effect.promise(() => api('orders/approve', { id: foreign.id, actor: 21 }));
				yield* Effect.promise(() => api('orders/approve', { id: foreign.id, actor: 42 }));
				yield* t.pull('orders');
				yield* t.deliver();
				yield* t.pull('orders');
				yield* t.pull('order_lines');
				const readImported = () =>
					as.query({ orders: { where: { title: { eq: native.reference } }, lines: {} } });
				const imported = (yield* readImported()).orders.rows[0];
				assert(imported, 'Kingdee-created SO must be imported');
				assert.equal(imported.lines.length, 2);
				const changed = firstRow(imported.lines.filter((l) => l.product_code === '210'));
				committed(
					'order_lines',
					yield* as.act({
						'order_lines.update': [
							{ target: yield* t.at('order_lines', changed.id), set: { quantity: '22' } }
						]
					})
				);
				s.outage();
				yield* t.deliver();
				t.clock.advance('2min');
				yield* t.deliver();
				yield* t.pull('orders');
				yield* t.pull('order_lines');
				native = yield* Effect.promise(() => nativeOrder(foreign.id));
				assert.equal(
					native.version,
					'001',
					JSON.stringify(
						(yield* as.query({
							order_lines: { where: { order: { eq: imported.id } } }
						})).order_lines.rows.map((l) => ({ entry: l.source_entry_id, sync: l.$sync }))
					)
				);
				assert.equal(Number(firstRow(native.lines.filter((l) => l.item === 210)).quantity), 22);
				assert.deepEqual(yield* nativeTerms(), retainedTerms);
				yield* Effect.promise(() =>
					api('orders/line-save', {
						id: foreign.id,
						expected: native.rowversion,
						entry: 2,
						item: 211,
						quantity: '14',
						price: '9',
						tax: '13',
						note: 'Native edit after import'
					})
				);
				yield* t.pull('orders');
				yield* t.pull('order_lines');
				assert.equal(
					Number(
						firstRow(
							firstRow((yield* readImported()).orders.rows).lines.filter(
								(l) => l.product_code === '211'
							)
						).quantity
					),
					14
				);
				const d = yield* Effect.promise(() =>
					api('deliveries/save', {
						id: foreign.id,
						lines: [
							{ entry: 1, quantity: '4', warehouse: 311, lot: 'LOT-01' },
							{ entry: 2, quantity: '3', warehouse: 311, lot: 'LOT-02' }
						]
					})
				);
				yield* Effect.promise(() =>
					api('deliveries/audit', { id: foreign.id, delivery: d.delivery, actor: 21 })
				);
				yield* creditMovement('66.67');
				const i = yield* Effect.promise(() =>
					api('invoices/save', {
						id: foreign.id,
						due: '2027-01-30',
						lines: [
							{ delivery: d.delivery, entry: 1, quantity: '4' },
							{ delivery: d.delivery, entry: 2, quantity: '3' }
						]
					})
				);
				yield* creditMovement('66.67');
				yield* Effect.promise(() =>
					api('invoices/audit', { id: foreign.id, invoice: i.invoice, actor: 42 })
				);
				yield* creditMovement('133.34');
				yield* Effect.promise(() =>
					api('receipts/create', { id: foreign.id, invoice: i.invoice, amount: '10.00' })
				);
				yield* creditMovement('123.34');
				yield* Effect.promise(() =>
					api('deliveries/match', { id: foreign.id, delivery: d.delivery, actor: 42 })
				);
				yield* creditMovement('56.67');
				for (const model of [
					'transactions',
					'source_payments',
					'stock_snapshots',
					'source_stock_commitments',
					'source_lot_costs',
					'source_sales_lines'
				] as const)
					yield* t.pull(model);
				const facts = yield* as.query({
					transactions: { where: { order: { eq: imported.id } } },
					source_payments: { where: { order: { eq: imported.id } } },
					stock_snapshots: { where: { source: { eq: instance } } }
				});
				const delivery = facts.transactions.rows.find((x) => x.kind === 'delivery'),
					invoice = facts.transactions.rows.find((x) => x.kind === 'invoice');
				assert.equal(delivery?.items?.length, 2);
				assert.equal(invoice?.items?.length, 2);
				assert.equal(facts.source_payments.rows.length, 1);
				yield* Effect.promise(() =>
					api('receipts/create', { id: foreign.id, invoice: i.invoice, amount: '56.67' })
				);
				yield* creditMovement('0');
				yield* t.pull('source_payments');
				assert.equal(
					(yield* as.query({ source_payments: { where: { order: { eq: imported.id } } } }))
						.source_payments.rows.length,
					2
				);
				assert(
					facts.stock_snapshots.rows.some((s) => s.lot_number === 'LOT-01'),
					'Batch-aware stock snapshot required'
				);
				const count = (yield* readImported()).orders.rows.length;
				yield* t.pull('orders');
				yield* t.pull('orders');
				yield* t.pull('order_lines');
				assert.equal((yield* readImported()).orders.rows.length, count);
				return {
					passed: true,
					certificateVerified: true,
					requests: s.requests(),
					pushedOrder: pushed,
					importedOrder: foreign.id,
					delivery: d.delivery,
					invoice: i.invoice,
					warehouseCount: masters.warehouses.rows.length,
					stockRows: facts.stock_snapshots.rows.length,
					creditMovementCny: ['0', '66.67', '133.34', '123.34', '56.67', '0'],
					checks: [
						'Kingdee-created SO imported by the order read',
						'atomic two-line import',
						'local order push',
						'both directions of line amendment',
						'outage and recovery',
						'native header retained during amendment',
						'native multi-line DO/invoice read',
						'receipt allocation',
						'credit sync after invoice audit, partial/full payments and DO matching',
						'warehouse / stock / batch / commitments / costs / sales reads',
						'repeat import without duplicates'
					]
				};
			});
			if (process.env.TRADE_SIMULATOR_REPORT)
				writeFileSync(process.env.TRADE_SIMULATOR_REPORT, JSON.stringify(report, null, 2) + '\n');
			console.log('TWO_WAY_ACCEPTANCE ' + JSON.stringify(report));
		})
);

it.live.skipIf(!process.env.TRADE_SIMULATOR_ACCESS)(
	'the simulator keeps both sides equal through a lost reply, a native close, a refused change and a deleted SO',
	() =>
		Effect.gen(function* () {
			const { api, pool, t, as, masters, configure, loseReply } = yield* simulator();
			const draft = Effect.fnUntraced(function* () {
				const order = committed(
					'orders',
					yield* as.act({
						'orders.create': [
							{
								title: 'Consistency acceptance ' + randomUUID().slice(0, 8),
								direction: 'sales',
								party: firstRow(masters.parties.rows).id,
								currency: 'CNY',
								payment_terms: 'NET30'
							}
						]
					})
				);
				yield* t.db.write({
					text: 'UPDATE orders SET number = $2 WHERE id = $1',
					params: [order, 'ACCEPTANCE-SYNC-' + randomUUID().slice(0, 8)]
				});
				const line = committed(
					'order_lines',
					yield* as.act({
						'order_lines.create': [
							{
								order,
								product: firstRow(masters.products.rows).id,
								quantity: '10',
								unit_price: '8',
								discount_pct: '0',
								tax_rate: '13'
							}
						]
					})
				);
				return { order, line };
			});
			const read = (order: Id<'orders'>) =>
				Effect.map(
					as.query({ orders: { where: { id: { eq: order } }, lines: {} } }),
					({ orders }) => firstRow(orders.rows)
				);
			const pull = Effect.gen(function* () {
				yield* t.pull('orders');
				yield* t.pull('order_lines');
			});
			const edit = Effect.fnUntraced(function* (line: Id<'order_lines'>, quantity: string) {
				committed(
					'order_lines',
					yield* as.act({
						'order_lines.update': [{ target: yield* t.at('order_lines', line), set: { quantity } }]
					})
				);
				yield* t.deliver();
			});
			const status = (line: Id<'order_lines'>) =>
				Effect.map(
					as.query({ order_lines: { where: { id: { eq: line } }, limit: 1 } }),
					({ order_lines }) => order_lines.rows[0]?.$sync?.kingdee?.status
				);
			const native = (statement: string, id: number) =>
				Effect.promise(() => pool.request().input('id', sql.Int, id).query(statement));

			const closed = yield* draft();
			const deleted = yield* draft();
			yield* configure((yield* read(closed.order)).owner);
			yield* confirm(t, closed.order);
			yield* confirm(t, deleted.order);
			yield* t.deliver();
			yield* pull;
			const closedFid = Number((yield* read(closed.order)).kingdee?.fid);
			const deletedFid = Number((yield* read(deleted.order)).kingdee?.fid);
			assert(closedFid && deletedFid, 'Both orders must reach native SQL');

			// the simulator closes as KIS does: FStatus 3 with FClosed left at 0
			yield* Effect.promise(() => api('orders/submit', { id: closedFid }));
			yield* Effect.promise(() => api('orders/approve', { id: closedFid, actor: 21 }));
			yield* Effect.promise(() => api('orders/approve', { id: closedFid, actor: 42 }));
			// an amendment Kingdee committed whose reply was lost is found there, not applied twice
			loseReply();
			yield* edit(closed.line, '12');
			assert.equal(yield* status(closed.line), 'pending');
			t.clock.advance('2min');
			yield* t.deliver();
			yield* pull;
			const amended = yield* native(
				`SELECT h.FVersionNo version,(SELECT COUNT(*) FROM dbo.ICOrderAlter a WHERE a.FInterID=h.FInterID) changes,(SELECT COUNT(*) FROM dbo.SEOrder x WHERE x.FBillNo=h.FBillNo AND x.FBrNo=h.FBrNo AND x.FChangeMark=1) archives FROM dbo.SEOrder h WHERE h.FInterID=@id AND h.FBrNo='0'`,
				closedFid
			);
			assert.deepEqual(firstRow(amended.recordset), { version: '001', changes: 1, archives: 1 });
			assert.equal(yield* status(closed.line), 'ok');
			yield* Effect.promise(() => api('orders/close', { id: closedFid }));
			yield* pull;
			assert.deepEqual(
				[(yield* read(closed.order)).kingdee?.status, (yield* read(closed.order)).kingdee?.closed],
				['issued', true]
			);
			// Kingdee refuses a change to a closed SO for good: the line returns to the SO's terms
			yield* edit(closed.line, '15');
			yield* pull;
			yield* t.deliver();
			yield* pull;
			const line = firstRow((yield* read(closed.order)).lines);
			assert(sameDecimal(line.quantity, '12'), 'The refused change must return to the SO quantity');
			const entries = yield* native(
				`SELECT CONVERT(varchar(100),FQty) quantity FROM dbo.SEOrderEntry WHERE FInterID=@id AND FBrNO='0'`,
				closedFid
			);
			assert(sameDecimal(String(firstRow(entries.recordset).quantity), '12'));

			// an unaudited SO deleted in Kingdee is never recreated
			yield* Effect.promise(() => api('orders/delete', { id: deletedFid }));
			yield* pull;
			yield* edit(deleted.line, '15');
			const reference = (yield* read(deleted.order)).kingdee?.reference ?? '';
			const recreated = yield* Effect.promise(() =>
				pool
					.request()
					.input('reference', sql.NVarChar(255), reference)
					.query(`SELECT 1 found FROM dbo.SEOrder WHERE FBillNo=@reference AND FBrNo='0'`)
			);
			assert.equal(recreated.recordset.length, 0);
		})
);
