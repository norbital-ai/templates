import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { BigDecimal, Effect, Exit, Schema } from 'effect';
import mssql from 'mssql';
import { validate_database_request, type DatabaseRequest } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { compile_sql_server } from '@norbital-ai/store/sqlserver';
import { committed, confirm, SETTINGS, workspace } from './kit.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';
import { confirmationRead, quotationFifoCosts } from '../src/lib/confirmation.js';
import { estimateFifoCost, inventoryCostRead, purchaseLotCostRead } from '../src/lib/lot-cost.js';
import {
	logisticsStockAvailabilityRead,
	stockAvailability,
	stockAvailabilityRead
} from '../src/lib/stock-availability.js';
import {
	agingDetails,
	agingRead,
	agingSummary,
	arAging,
	estimateAging,
	receivablesRead,
	readSalesReport,
	salesAnalysis,
	salesDetail,
	salesReadDuring
} from '../src/lib/reports.js';

const password = process.env.TRADE_SQL2017_PROBE_PASSWORD;
const port = Number(process.env.TRADE_SQL2017_PROBE_PORT ?? 11434);
const fixture = new URL('./fixtures/kingdee-2017.sql', import.meta.url);
const ordersFixture = new URL('./fixtures/kingdee-2017-orders.sql', import.meta.url);
const sourcePage = 'SELECT TOP 1000';

const probeDatabase = Effect.fnUntraced(function* (
	prefix: 'TradePollingProbe' | 'TradeLineageProbe'
) {
	const config = {
		server: '127.0.0.1',
		port,
		user: 'sa',
		password,
		options: { encrypt: true, trustServerCertificate: true, serverName: 'localhost' }
	};
	const database = `${prefix}_${randomUUID().replaceAll('-', '')}`;
	const connect = (name: string) =>
		Effect.acquireRelease(
			Effect.promise(() => new mssql.ConnectionPool({ ...config, database: name }).connect()),
			(pool) => Effect.promise(() => pool.close())
		);
	const admin = yield* connect('master');
	const major = yield* Effect.promise(() =>
		admin.request().query("SELECT CONVERT(int,SERVERPROPERTY('ProductMajorVersion')) AS major")
	);
	expect(major.recordset[0]?.major).toBe(14);
	yield* Effect.acquireRelease(
		Effect.promise(() => admin.request().query(`CREATE DATABASE [${database}]`)),
		() => Effect.promise(() => admin.request().query(`DROP DATABASE [${database}]`))
	);
	yield* Effect.promise(() =>
		admin
			.request()
			.query(
				`ALTER DATABASE [${database}] SET COMPATIBILITY_LEVEL = 140; ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON`
			)
	);
	const source = yield* connect(database);
	const sql = (statement: string) => Effect.promise(() => source.request().query(statement));
	const tables = readFileSync(fixture, 'utf8').split(/^GO\s*$/m)[3];
	if (!tables?.includes('CREATE TABLE dbo.t_ICItem')) throw new Error('Expected master fixture');
	yield* sql(tables);
	return { source, sql, database };
});

const bind = (request: mssql.Request, parameters: Readonly<Record<string, unknown>>) => {
	for (const [name, value] of Object.entries(parameters)) {
		if (typeof value === 'string') request.input(name, mssql.NVarChar(mssql.MAX), value);
		else request.input(name, value);
	}
	return request;
};

it.effect.skipIf(!password)(
	'checks open commitments and purchase lots in bounded requests and uses the oldest batches for a saved quote',
	() =>
		Effect.gen(function* () {
			const { source, sql } = yield* probeDatabase('TradePollingProbe');
			yield* sql(`
			CREATE TABLE dbo.SEOrder (FBrNo nvarchar(20), FInterID int, FCancellation bit, FStatus int, FClosed bit, FChangeMark bit);
			CREATE TABLE dbo.SEOrderEntry (FBrNO nvarchar(20), FInterID int, FItemID int, FQty decimal(28,10), FStockQty decimal(28,10), FMrpClosed bit);
			INSERT dbo.SEOrder VALUES ('0',1,0,0,0,0),('1',1,0,2,0,0),('0',2,0,3,0,0),('0',3,0,1,0,1),('0',4,1,1,0,0),('0',5,0,1,1,0);
			INSERT dbo.SEOrderEntry VALUES ('0',1,210,8,2,0),('0',1,210,5,0,1),('1',1,210,1,0,0),('0',2,210,4,0,0),('0',3,210,4,0,0),('0',4,210,4,0,0),('0',5,210,4,0,0);
			DELETE dbo.ICInventory;
			INSERT dbo.ICInventory VALUES (210,311,'LOT-01',5), (210,311,'LOT-02',5.5);
			CREATE TABLE dbo.ICStockBill (FInterID int PRIMARY KEY, FTranType int, FCancellation bit, FCheckDate datetime, FDate datetime, FROB int);
			CREATE TABLE dbo.ICStockBillEntry (FInterID int, FItemID int, FBatchNo nvarchar(40), FQty decimal(28,10), FAmount decimal(28,10));
			INSERT dbo.ICStockBill VALUES (1,1,0,'20260901','20260901',1),(2,1,0,'20261001','20261001',1),(3,1,1,'20261002','20261002',1),(4,21,0,'20260902','20260902',1);
			INSERT dbo.ICStockBillEntry VALUES (1,210,'LOT-01',10,20),(2,210,'LOT-02',10,30),(3,210,'LOT-01',10,90),(4,210,'LOT-02',2,9);
			CREATE USER trade_stock_reader WITHOUT LOGIN;
			GRANT SELECT ON dbo.SEOrder TO trade_stock_reader;
			GRANT SELECT ON dbo.SEOrderEntry TO trade_stock_reader;
			GRANT SELECT ON dbo.t_ICItem TO trade_stock_reader;
			GRANT SELECT ON dbo.t_Item TO trade_stock_reader;
			GRANT SELECT ON dbo.ICStockBill TO trade_stock_reader;
			GRANT SELECT ON dbo.ICStockBillEntry TO trade_stock_reader;
			GRANT SELECT ON dbo.ICInventory TO trade_stock_reader;
		`);
			const { account } = firstRow(
				(yield* sql(
					"SELECT LOWER(CONCAT(database_guid,'/',recovery_fork_guid)) AS account FROM sys.database_recovery_status WHERE database_id=DB_ID()"
				)).recordset
			);
			const payloads: (string | null)[] = [];
			const costPayloads: (string | null)[] = [];
			const t = yield* workspace({
				source: (operation) =>
					Effect.tryPromise({
						try: async () => {
							const compiled = compile_sql_server(
								await Effect.runPromise(validate_database_request(operation))
							);
							const isStock = String(compiled.parameters.stmt).includes(
								'kingdee-stock-commitments'
							);
							const isCost = String(compiled.parameters.stmt).includes('kingdee-stock-lot-costs');
							if ((isStock || isCost) && compiled.statement === undefined) {
								const tx = source.transaction();
								await tx.begin();
								try {
									await tx.request().query("EXECUTE AS USER='trade_stock_reader'");
									const result = await bind(tx.request(), compiled.parameters).execute(
										compiled.procedure
									);
									await tx.request().query('REVERT');
									await tx.commit();
									(isCost ? costPayloads : payloads).push(result.recordset[0]?.entries ?? null);
									return { rows: result.recordset };
								} catch (error) {
									await tx
										.request()
										.query('REVERT')
										.catch(() => {});
									await tx.rollback().catch(() => {});
									throw error;
								}
							}
							const request = bind(source.request(), compiled.parameters);
							const result =
								compiled.statement === undefined
									? await request.execute(compiled.procedure)
									: await request.query(compiled.statement);
							return { rows: result.recordset };
						},
						catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
					})
			});
			const admin = yield* t.as(t.admin);
			const sales = yield* t.as(t.member(['sales']));
			const logistics = yield* t.as(t.member(['logistics']));
			const instance = fixtureId('sys_integration', 'kingdee');
			const configure = (stockAvailabilityAccount: string, stockLotCostAccount?: string) =>
				admin.act({
					'sys_integration.update': [
						{
							target: { id: instance },
							set: {
								configuration: {
									baseCurrency: 'CNY',
									stockAvailabilityAccount,
									...(stockLotCostAccount ? { stockLotCostAccount } : {})
								}
							}
						}
					]
				});
			yield* t.pull('products');
			yield* t.pull('warehouses');
			yield* t.pull('stock_snapshots');
			const pull = () => t.pull('source_stock_commitments');
			yield* pull();
			expect(payloads).toEqual([]);
			expect(
				firstRow(stockAvailability(yield* sales.query(stockAvailabilityRead), Date.now(), false))
					.available
			).toBeNull();
			yield* configure('11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111');
			expect(Exit.isFailure(yield* Effect.exit(pull()))).toBe(true);
			yield* configure(account);
			yield* pull();
			const observed = yield* sales.query(stockAvailabilityRead);
			const snapshot = firstRow(observed.source_stock_commitments.rows);
			expect(snapshot.entries).toEqual([
				{ product_code: '210', unit: 'kg', warehouse: null, quantity: '7.000' }
			]);
			const totals = firstRow(stockAvailability(observed, Date.now(), false));
			expect(sameDecimal(totals.on_hand, '10.500')).toBe(true);
			expect(sameDecimal(totals.available, '3.500')).toBe(true);
			expect(
				stockAvailability(observed, Date.now(), true).every((row) => row.available === null)
			).toBe(true);
			const logisticsReport = yield* logistics.query(logisticsStockAvailabilityRead);
			expect(
				sameDecimal(
					firstRow(stockAvailability(logisticsReport, Date.now(), false)).available,
					'3.500'
				)
			).toBe(true);
			const stale = firstRow(stockAvailability(observed, Date.now() + 31 * 60_000, false));
			expect(stale.available).toBeNull();
			expect(sameDecimal(stale.on_hand, '10.500')).toBe(true);
			committed(
				'commercial_settings',
				yield* admin.act({
					'commercial_settings.update': [
						{
							target: yield* t.at('commercial_settings', SETTINGS),
							set: { stock_fresh_minutes: 45 }
						}
					]
				})
			);
			const configured = yield* logistics.query(logisticsStockAvailabilityRead);
			expect(
				sameDecimal(
					firstRow(stockAvailability(configured, Date.now() + 31 * 60_000, false)).available,
					'3.500'
				)
			).toBe(true);
			yield* pull();
			expect(payloads).toHaveLength(2);
			expect(payloads[1]).toBeNull();
			const unchanged = firstRow(
				(yield* sales.query(stockAvailabilityRead)).source_stock_commitments.rows
			);
			expect(unchanged.id).toBe(snapshot.id);
			expect(unchanged.entries).toEqual(snapshot.entries);
			yield* sql(
				"UPDATE dbo.SEOrderEntry SET FStockQty=4 WHERE FBrNO='0' AND FInterID=1 AND FMrpClosed=0"
			);
			yield* pull();
			const shipped = firstRow(
				stockAvailability(yield* sales.query(stockAvailabilityRead), Date.now(), false)
			);
			expect(sameDecimal(shipped.available, '5.500')).toBe(true);
			const pullCosts = () => t.pull('source_lot_costs');
			yield* pullCosts();
			expect(costPayloads).toEqual([]);
			yield* configure(
				account,
				'11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111'
			);
			expect(Exit.isFailure(yield* Effect.exit(pullCosts()))).toBe(true);
			yield* configure(account, account);
			yield* pullCosts();
			const configuration = yield* t.as(t.member(['configuration']));
			const sourceCosts = () =>
				configuration
					.query(purchaseLotCostRead(instance))
					.pipe(Effect.map((answer) => firstRow(answer.source_lot_costs.rows)));
			const costs = yield* sourceCosts();
			expect(
				costs.entries.map((entry) => [entry.lot_number, entry.received_on, entry.unit_cost])
			).toEqual([
				['LOT-01', '2026-09-01', '2.0000000000'],
				['LOT-02', '2026-10-01', '3.0000000000']
			]);
			expect(Exit.isFailure(yield* Effect.exit(sales.query(purchaseLotCostRead(instance))))).toBe(
				true
			);
			yield* pullCosts();
			expect(costPayloads).toHaveLength(2);
			expect(costPayloads[1]).toBeNull();
			expect((yield* sourceCosts()).entries).toEqual(costs.entries);
			yield* t.pull('parties');
			const masters = yield* admin.query({
				products: { where: { source: { eq: instance }, external_code: { eq: '210' } } },
				parties: { where: { source: { eq: instance }, external_code: { eq: '110' } } }
			});
			const product = firstRow(masters.products.rows).id;
			const onHand = yield* configuration.query(inventoryCostRead(product, 'WH'));
			const warehouse = firstRow(onHand.warehouses.rows).id;
			const estimate = (quantity: string, currency = 'CNY', as_of = new Date().toISOString()) =>
				estimateFifoCost(onHand.stock_snapshots.rows, costs, {
					product,
					productCode: '210',
					source: instance,
					warehouses: [warehouse],
					quantity,
					unit: 'kg',
					currency,
					as_of
				});
			expect(sameDecimal(estimate('5')?.unit_cost, '2')).toBe(true);
			expect(sameDecimal(estimate('8')?.unit_cost, '2.375')).toBe(true);
			expect(estimate('11')).toBeNull();
			expect(estimate('8', 'USD')).toBeNull();
			expect(estimate('8', 'CNY', new Date(Date.now() + 31 * 60_000).toISOString())).toBeNull();
			const order = committed(
				'orders',
				yield* admin.act({
					'orders.create': [
						{
							title: 'FIFO SQL probe',
							direction: 'sales',
							party: firstRow(masters.parties.rows).id,
							warehouse,
							currency: 'CNY',
							ordered_on: '2026-11-07',
							payment_terms: 'NET30'
						}
					]
				})
			);
			yield* admin.act({
				'order_lines.create': [5, 3].map((quantity) => ({
					order,
					product,
					quantity: String(quantity),
					unit_price: '2.25',
					tax_rate: '0'
				}))
			});
			const savedQuote = yield* admin.query(confirmationRead(order));
			const guidance = quotationFifoCosts(savedQuote, costs, new Date().toISOString());
			expect(guidance).toHaveLength(1);
			expect(guidance[0]?.below).toBe(true);
			expect(
				guidance[0]?.estimate?.lots.map((lot) => [lot.lot_number, lot.quantity.toString()])
			).toEqual([
				['LOT-01', '5.000'],
				['LOT-02', '3.000']
			]);
			yield* sql('UPDATE dbo.ICStockBill SET FROB=-1 WHERE FInterID=2');
			yield* pullCosts();
			expect((yield* sourceCosts()).entries.map((entry) => entry.lot_number)).toEqual(['LOT-01']);
			expect(
				quotationFifoCosts(savedQuote, yield* sourceCosts(), new Date().toISOString())[0]?.estimate
			).toBeNull();
			yield* sql(
				"INSERT dbo.t_Item (FItemID,FNumber,FName,FItemClassID,FDetail) VALUES (711,'box','box',7,1); UPDATE dbo.t_ICItem SET FUnitID=711 WHERE FItemID=210"
			);
			yield* pull();
			const mismatched = firstRow(
				stockAvailability(yield* sales.query(stockAvailabilityRead), Date.now(), false)
			);
			expect(mismatched.available).toBeNull();
			expect(mismatched.unit).toBe('kg / box');
			expect(sameDecimal(mismatched.awaiting, '5')).toBe(true);
			yield* sql('DELETE dbo.SEOrderEntry');
			yield* pull();
			const empty = yield* sales.query(stockAvailabilityRead);
			expect(firstRow(empty.source_stock_commitments.rows).entries).toEqual([]);
			expect(
				sameDecimal(firstRow(stockAvailability(empty, Date.now(), false)).available, '10.500')
			).toBe(true);
		}),
	120_000
);

it.effect.skipIf(!password)(
	'commits each product page and resumes its fixed SQL Server 2017 rowversion window after failure',
	() =>
		Effect.gen(function* () {
			const { source, sql } = yield* probeDatabase('TradePollingProbe');
			yield* sql(`INSERT dbo.t_Item (FItemID,FNumber,FName,FItemClassID,FDetail)
				VALUES (211,'PROBE-211','Second product',4,1);
				INSERT dbo.t_ICItem (FItemID,FModel,FUnitID) VALUES (211,'Before later commit',710);`);

			let pagesUntilFailure: number | undefined;
			let sourcePages: { after: unknown; to: unknown }[] = [];
			let requests = 0;
			const t = yield* workspace({
				source: (operation: DatabaseRequest) =>
					Effect.tryPromise({
						try: async () => {
							requests++;
							const compiled = compile_sql_server(
								await Effect.runPromise(validate_database_request(operation))
							);
							const args = compiled.parameters;
							const request = bind(source.request(), args);
							const result =
								compiled.statement === undefined
									? await request.execute(compiled.procedure)
									: await request.query(compiled.statement);
							if (typeof args['stmt'] === 'string' && args['stmt'].startsWith(sourcePage)) {
								sourcePages.push({ after: args['after'], to: args['to'] });
								if (pagesUntilFailure !== undefined && --pagesUntilFailure === 0)
									throw new Error('Probe discarded the second SQL page');
							}
							return { rows: result.recordset ?? [] };
						},
						catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
					})
			});
			const cursor = () =>
				t.db
					.rows(
						Schema.Struct({
							bookmark: Schema.String,
							after: Schema.NullOr(Schema.String),
							upper: Schema.NullOr(Schema.String),
							health: Schema.String
						}),
						{
							text: `SELECT cursor->>'bookmark' AS bookmark, cursor#>>'{continuation,after}' AS after,
							cursor#>>'{continuation,upper}' AS upper, health->>'state' AS health
							FROM sys_sync WHERE sync='products.sync.kingdee' AND instance='kingdee'`,
							params: []
						}
					)
					.pipe(Effect.map(firstRow));
			const products = () =>
				t.db.rows(
					Schema.Struct({
						id: Schema.String,
						external_code: Schema.String,
						spec: Schema.String,
						active: Schema.Boolean
					}),
					{
						text: "SELECT id::text, external_code, spec, active FROM products WHERE source='kingdee' AND external_code ~ '^(210|211|1[0-9]{3})$' ORDER BY external_code",
						params: []
					}
				);

			yield* t.pull('products');
			const original = yield* products();
			expect(original.map((row) => row.spec)).toEqual(['A-100', 'Before later commit']);
			expect(
				yield* t.db.rows(
					Schema.Struct({
						producing_area: Schema.NullOr(Schema.String),
						brand: Schema.NullOr(Schema.String),
						brand_en: Schema.NullOr(Schema.String)
					}),
					{
						text: "SELECT producing_area, brand, brand_en FROM products WHERE source='kingdee' AND external_code='210'",
						params: []
					}
				)
			).toEqual([{ producing_area: '中国', brand: '利华益', brand_en: 'TARFLON' }]);
			const held = new mssql.Transaction(source);
			yield* Effect.acquireRelease(
				Effect.promise(() => held.begin()),
				() => Effect.promise(() => held.rollback().catch(() => {}))
			);
			const pending = yield* Effect.promise(() =>
				held.request().query(`UPDATE dbo.t_ICItem
				SET FModel='Held update' OUTPUT CONVERT(varchar(18),CONVERT(binary(8),inserted.FModifyTime),1) AS marker
				WHERE FItemID=210`)
			);
			const marker = String(pending.recordset[0]?.marker).toLowerCase();
			yield* sql("UPDATE dbo.t_ICItem SET FModel='Later commit' WHERE FItemID=211");
			yield* t.pull('products');
			expect(yield* cursor()).toMatchObject({ bookmark: marker, upper: null, health: 'ready' });
			expect(yield* products()).toEqual(original);
			yield* Effect.promise(() => held.commit());

			yield* sql(`WITH numbers AS (SELECT 1000 AS id UNION ALL SELECT id+1 FROM numbers WHERE id<1999)
				INSERT dbo.t_Item (FItemID,FNumber,FName,FItemClassID,FDetail)
				SELECT id,CONCAT('PROBE-',id),CONCAT('Product ',id),4,1 FROM numbers OPTION (MAXRECURSION 0);
				INSERT dbo.t_ICItem (FItemID,FModel,FUnitID)
				SELECT FItemID,'Page fixture',710 FROM dbo.t_Item WHERE FItemID BETWEEN 1000 AND 1999;`);
			sourcePages = [];
			pagesUntilFailure = 2;
			expect(Exit.isFailure(yield* Effect.exit(t.pull('products')))).toBe(true);
			const failed = yield* cursor();
			expect(failed).toMatchObject({ bookmark: marker, after: '1998', health: 'attention' });
			expect(sourcePages).toEqual([
				{ after: '', to: failed.upper },
				{ after: '1998', to: failed.upper }
			]);
			expect(yield* products()).toHaveLength(1001);

			yield* sql("UPDATE dbo.t_ICItem SET FModel='After captured window' WHERE FItemID=1999");
			pagesUntilFailure = undefined;
			sourcePages = [];
			yield* t.pull('products');
			expect(sourcePages).toEqual([{ after: '1998', to: failed.upper }]);
			expect(yield* cursor()).toMatchObject({
				bookmark: failed.upper,
				after: null,
				health: 'ready'
			});
			const recovered = yield* products();
			expect(recovered.slice(-2)).toEqual([
				{ ...original[0], spec: 'Held update' },
				{ ...original[1], spec: 'Later commit' }
			]);
			expect(recovered).toHaveLength(1001);
			yield* t.pull('products');
			const complete = yield* products();
			expect(complete).toHaveLength(1002);
			expect(complete.find((row) => row.external_code === '1999')?.spec).toBe(
				'After captured window'
			);
			const beforeQuietPoll = requests;
			const beforeQuietPages = sourcePages.length;
			yield* t.pull('products');
			expect(requests - beforeQuietPoll).toBe(1);
			expect(sourcePages).toHaveLength(beforeQuietPages);
			expect(yield* products()).toEqual(complete);

			yield* sql('DELETE dbo.t_ICItem WHERE FItemID=211; DELETE dbo.t_Item WHERE FItemID=211');
			yield* t.pull('products');
			expect(yield* products()).toEqual(complete);
			// Expire the fixture's last full listing without waiting for the normal interval.
			yield* t.db.write({
				text: `UPDATE sys_sync SET cursor=jsonb_set(cursor,'{fullAt}','"2000-01-01T00:00:00Z"')
					WHERE sync='products.sync.kingdee' AND instance='kingdee'`,
				params: []
			});
			pagesUntilFailure = 2;
			expect(Exit.isFailure(yield* Effect.exit(t.pull('products')))).toBe(true);
			expect(yield* products()).toEqual(complete);
			pagesUntilFailure = undefined;
			yield* t.pull('products');
			expect(yield* products()).toEqual(
				complete.map((row) => (row.external_code === '211' ? { ...row, active: false } : row))
			);
		}),
	120_000
);

it.effect.skipIf(!password)(
	'keeps SQL Server 2017 delivery, invoice and receipt evidence on its order after an amendment',
	() =>
		Effect.gen(function* () {
			const { source, sql } = yield* probeDatabase('TradeLineageProbe');
			const orders = readFileSync(ordersFixture, 'utf8').split(/^GO\s*$/m)[1];
			if (!orders?.includes('CREATE TABLE dbo.SEOrder')) throw new Error('Expected order fixture');
			yield* sql(orders);
			let moveReceivablesDuringRead = false;
			let requests = 0;
			let deliveryCostReads = 0;
			const t = yield* workspace({
				now: '2026-11-06T00:00:00.000Z',
				source: (operation) =>
					Effect.tryPromise({
						try: async () => {
							const compiled = compile_sql_server(
								await Effect.runPromise(validate_database_request(operation))
							);
							requests++;
							if (String(compiled.parameters.stmt).includes('AS cost_amount')) deliveryCostReads++;
							const tx = source.transaction();
							await tx.begin(
								compiled.transaction === 'serializable'
									? mssql.ISOLATION_LEVEL.SERIALIZABLE
									: mssql.ISOLATION_LEVEL.READ_COMMITTED
							);
							try {
								await tx.request().query("EXECUTE AS USER='trade_order_probe'");
								const request = bind(tx.request(), compiled.parameters);
								const result =
									compiled.statement === undefined
										? await request.execute(compiled.procedure)
										: await request.query(compiled.statement);
								await tx.request().query('REVERT');
								await tx.commit();
								if (
									moveReceivablesDuringRead &&
									operation.op === 'call' &&
									String(operation.arguments.stmt).includes('kingdee-ar-entries')
								) {
									moveReceivablesDuringRead = false;
									await source
										.request()
										.query('UPDATE dbo.t_RP_Contact SET FRemainAmount=67 WHERE FID=10002');
								}
								return { rows: result.recordset ?? [] };
							} catch (error) {
								await tx
									.request()
									.query('REVERT')
									.catch(() => {});
								await tx.rollback().catch(() => {});
								throw error;
							}
						},
						catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
					})
			});
			const as = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			yield* t.pull('parties');
			yield* t.pull('products');
			const masters = yield* as.query({
				parties: { where: { source: { eq: instance }, external_code: { eq: '110' } } },
				products: { where: { source: { eq: instance }, external_code: { eq: '210' } } }
			});
			const order = committed(
				'orders',
				yield* as.act({
					'orders.create': [
						{
							title: 'SQL 2017 lineage probe',
							direction: 'sales',
							party: firstRow(masters.parties.rows).id,
							currency: 'CNY',
							ordered_on: '2026-10-26',
							payment_terms: 'NET30'
						}
					]
				})
			);
			const line = committed(
				'order_lines',
				yield* as.act({
					'order_lines.create': [
						{
							order,
							product: firstRow(masters.products.rows).id,
							quantity: '10',
							unit_price: '2',
							tax_rate: '13'
						}
					]
				})
			);
			const read = () =>
				as
					.query({ orders: { where: { id: { eq: order } } } })
					.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
			const { owner } = yield* read();
			const { account } = firstRow(
				(yield* Effect.promise(() =>
					source
						.request()
						.query<{ account: string }>(
							"SELECT LOWER(CONCAT(database_guid,'/',recovery_fork_guid)) AS account FROM sys.database_recovery_status WHERE database_id=DB_ID()"
						)
				)).recordset
			);
			const orderConfiguration = {
				baseCurrency: 'CNY',
				branchNo: '0',
				writeAccount: account,
				billerId: '41',
				salespersonBindings: JSON.stringify({ [owner]: { employeeId: '21', departmentId: '31' } }),
				currencyBindings: '{"CNY":{"id":"1","base":true}}',
				settlementRules: '{"NET30":{"creditDays":30,"fromMonthEnd":false}}'
			};
			const configureDeliveryCost = (deliveryCostAccount?: string) =>
				as.act({
					'sys_integration.update': [
						{
							target: { id: instance },
							set: {
								configuration: {
									...orderConfiguration,
									...(deliveryCostAccount ? { deliveryCostAccount } : {})
								}
							}
						}
					]
				});
			yield* configureDeliveryCost();
			yield* confirm(t, order);
			yield* t.deliver();
			const live = () =>
				Effect.promise(() =>
					source
						.request()
						.query<{ fid: number; version: string; checker: number | null }>(
							'SELECT FInterID AS fid,FVersionNo AS version,FCheckerID AS checker FROM dbo.SEOrder WHERE FChangeMark=0'
						)
				).pipe(
					Effect.map((answer) => {
						expect(answer.recordset).toHaveLength(1);
						return firstRow(answer.recordset);
					})
				);
			const original = yield* live();
			expect(original).toMatchObject({ version: '000', checker: null });
			yield* Effect.promise(() =>
				source.request().input('fid', mssql.Int, original.fid).query(`
			UPDATE dbo.SEOrder SET FCheckerID=42,FCheckDate='20261026',FStatus=1 WHERE FInterID=@fid;
			INSERT dbo.ICStockBill (FInterID,FBillNo,FDate,FTranType,FCheckDate,FCancellation,FROB)
			VALUES (20001,'DO-PROBE','20261026',21,'20261026',0,1);
			INSERT dbo.ICStockBillEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FOrderInterID,FItemID,FUnitID,FQty,FBatchNo,FAmount)
			VALUES (20001,1,81,@fid,1,@fid,210,710,4,'LOT-01',5.1234567891);
			INSERT dbo.ICSale (FInterID,FBillNo,FDate,FTranType,FCheckDate,FCancellation,FROB,FCurrencyID,FSettleDate)
			VALUES (30001,'INV-PROBE','20261102',80,'20261103',0,1,1,'20261202');
			INSERT dbo.ICSaleEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FItemID,FUnitID,FQty,FAmount,FAllAmount)
			VALUES (30001,1,21,20001,1,210,710,4,8,9.04);
			INSERT dbo.t_RP_Contact (FID,FRP,FType,FInvoiceID,FCustomer,FNumber,FDate,FRPDate,FRemainAmount)
			VALUES (10001,1,3,30001,110,'INV-PROBE','20261102','20261202',6.04);
			INSERT dbo.t_RP_NewReceiveBill VALUES (40001,'RC-PROBE',1,1);
			INSERT dbo.t_RP_NewCheckInfo VALUES (50001,1,3,10001,'20261104',3);
			INSERT dbo.t_rp_CheckEntry VALUES (60001,50001,3,5,30001,1,40001);
		`)
			);
			const synchronize = () =>
				Effect.gen(function* () {
					yield* t.pull('orders');
					yield* t.pull('order_lines');
					yield* t.pull('transactions');
					yield* t.pull('source_sales_lines');
					yield* t.pull('source_payments');
				});
			const evidence = () =>
				as.query({
					transactions: {
						where: { order: { eq: order } },
						fields: ['reference', 'erp_id', 'issued_on', 'due_on', 'total', 'items']
					},
					source_sales_lines: {
						where: { order: { eq: order } },
						fields: [
							'external_code',
							'kind',
							'business_on',
							'quantity',
							'net_amount',
							'tax_amount',
							'booked_cost',
							'booked_cost_currency'
						]
					},
					source_payments: {
						where: { order: { eq: order } },
						fields: ['reference', 'invoice', 'amount', 'settled_on']
					}
				});
			const beforeFirstInbound = requests;
			yield* synchronize();
			expect(requests - beforeFirstInbound).toBeLessThanOrEqual(33);
			expect(deliveryCostReads).toBe(0);
			expect(
				(yield* evidence()).source_sales_lines.rows.every((row) => row.booked_cost === null)
			).toBe(true);
			yield* configureDeliveryCost(account);
			yield* t.pull('transactions');
			expect(deliveryCostReads).toBe(0);
			yield* t.pull('source_sales_lines');
			expect(deliveryCostReads).toBe(1);
			const shipmentCost = () =>
				evidence().pipe(
					Effect.map((answer) =>
						answer.source_sales_lines.rows.find((row) => row.kind === 'shipment')
					)
				);
			const booked = yield* shipmentCost();
			expect(booked?.booked_cost_currency).toBe('CNY');
			expect(sameDecimal(booked?.booked_cost, '5.1234567891')).toBe(true);
			const invoiced = (yield* evidence()).source_sales_lines.rows.find(
				(row) => row.kind === 'invoice'
			);
			expect(invoiced?.booked_cost_currency).toBe('CNY');
			expect(sameDecimal(invoiced?.booked_cost, '5.1234567891')).toBe(true);
			yield* configureDeliveryCost(
				'11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111'
			);
			expect(Exit.isFailure(yield* Effect.exit(t.pull('source_sales_lines')))).toBe(true);
			expect(yield* shipmentCost()).toEqual(booked);
			yield* configureDeliveryCost(account);
			const before = yield* evidence();
			expect(before.transactions.rows).toHaveLength(2);
			expect(before.source_sales_lines.rows).toHaveLength(2);
			const invoice = before.transactions.rows.find((row) => row.reference === 'INV-PROBE');
			expect(invoice).toMatchObject({
				issued_on: '2026-11-02',
				due_on: '2026-12-02',
				items: [{ lot_number: 'LOT-01', order_line_id: line }]
			});
			expect(sameDecimal(invoice?.total, '9.04')).toBe(true);
			const payment = firstRow(before.source_payments.rows);
			expect(payment).toMatchObject({
				invoice: invoice?.id,
				settled_on: '2026-11-04'
			});
			expect(sameDecimal(payment.amount, '3')).toBe(true);

			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', line), set: { quantity: '12' } }
				]
			});
			yield* t.deliver();
			yield* synchronize();
			yield* synchronize();
			expect(yield* live()).toMatchObject({ fid: original.fid, version: '001' });
			expect((yield* read()).kingdee).toMatchObject({ fid: String(original.fid), version: '001' });
			const after = yield* evidence();
			expect(after.transactions.rows).toEqual(before.transactions.rows);
			expect(after.source_sales_lines.rows).toEqual(before.source_sales_lines.rows);
			expect(after.source_payments.rows).toEqual(before.source_payments.rows);
			const connection = (active: boolean) =>
				as.act({ 'sys_integration.update': [{ target: { id: instance }, set: { active } }] });
			yield* connection(false);
			for (const quantity of [13, 14]) {
				yield* as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', line), set: { quantity: String(quantity) } }
					]
				});
				yield* t.deliver();
				expect(yield* live()).toMatchObject({ fid: original.fid, version: '001' });
			}
			expect(
				yield* t.db.rows(Schema.Struct({ attempts: Schema.Number }), {
					text: "SELECT attempts FROM sys_outbox WHERE record=$1 AND status='queued'",
					params: [line]
				})
			).toEqual([{ attempts: 0 }]);
			yield* connection(true);
			yield* t.deliver();
			yield* synchronize();
			expect(yield* live()).toMatchObject({ fid: original.fid, version: '002' });
			expect((yield* read()).kingdee).toMatchObject({ version: '002' });
			expect(yield* evidence()).toEqual(before);
			const finance = yield* t.as(t.member(['finance']));
			for (const [basis, month, date] of [
				['delivery', '10', '26'],
				['invoice', '11', '02']
			] as const) {
				const rows = salesDetail(
					yield* finance.query(
						salesReadDuring({
							from: `2026-${month}-01`,
							to: `2026-${month}-30`,
							basis
						})
					),
					{ basis }
				);
				expect(rows).toHaveLength(1);
				expect(rows[0]?.business_on).toBe(`2026-${month}-${date}`);
				expect(sameDecimal(rows[0]?.source_net, '8')).toBe(true);
				expect(sameDecimal(rows[0]?.cost, '5.12')).toBe(true);
				expect(rows[0]?.cost_currency).toBe('CNY');
				const otherMonth = month === '10' ? '11' : '10';
				const absent = yield* finance.query(
					salesReadDuring({
						from: `2026-${otherMonth}-01`,
						to: `2026-${otherMonth}-30`,
						basis
					})
				);
				expect(salesDetail(absent, { basis })).toEqual([]);
			}
			for (const [date, balance] of [
				['2026-11-03', '9.04'],
				['2026-11-04', '6.04']
			] as const) {
				const cutoff = date;
				const aging = arAging(yield* finance.query(agingRead(cutoff)), cutoff);
				expect(aging).toHaveLength(1);
				expect(aging[0]).toMatchObject({
					reference: 'INV-PROBE',
					invoice: invoice?.id,
					currency: 'CNY',
					bucket: 'not_due'
				});
				expect(sameDecimal(aging[0]?.balance, balance)).toBe(true);
			}

			yield* sql('UPDATE dbo.ICSale SET FCheckDate=NULL WHERE FInterID=30001');
			yield* t.pull('transactions');
			yield* t.pull('source_sales_lines');
			yield* t.pull('source_payments');
			const afterUnaudit = yield* evidence();
			expect(afterUnaudit.transactions.rows).toEqual(before.transactions.rows);
			expect(afterUnaudit.source_sales_lines.rows).toEqual(before.source_sales_lines.rows);
			expect(afterUnaudit.source_payments.rows).toEqual(before.source_payments.rows);
			yield* sql("UPDATE dbo.ICSale SET FCheckDate='20261103' WHERE FInterID=30001");
			yield* synchronize();
			expect((yield* evidence()).transactions.rows).toEqual(before.transactions.rows);
			yield* sql(`
				INSERT dbo.ICStockBill (FInterID,FBillNo,FDate,FTranType,FCheckDate,FCancellation,FROB)
				VALUES (20002,'RETURN-PROBE','20261104',21,'20261104',0,-1);
				INSERT dbo.ICStockBillEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FOrderInterID,FItemID,FUnitID,FQty,FBatchNo,FAmount)
				VALUES (20002,1,21,20001,1,0,210,710,-1,'LOT-01',-1.25);
				INSERT dbo.ICSale (FInterID,FBillNo,FDate,FTranType,FCheckDate,FCancellation,FROB,FCurrencyID)
				VALUES (30005,'CREDIT-PROBE','20261105',86,'20261105',0,-1,1);
				INSERT dbo.ICSaleEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FItemID,FUnitID,FQty,FAmount,FAllAmount)
				VALUES (30005,1,21,20002,1,210,710,-1,-2,-2.26);
			`);
			yield* synchronize();
			const withReturn = yield* evidence();
			const returned = withReturn.transactions.rows.find((row) => row.reference === 'RETURN-PROBE');
			expect(returned?.reference).toBe('RETURN-PROBE');
			expect(sameDecimal(returned?.items?.[0]?.quantity, '-1')).toBe(true);
			for (const basis of ['delivery', 'invoice'] as const) {
				const request = salesReadDuring({ from: null, to: null, basis }, false, 1);
				const first = yield* finance.query(request);
				expect(first.source_sales_lines.next).not.toBeNull();
				const rows = yield* readSalesReport(finance, request, first, basis);
				expect(rows).toHaveLength(2);
				const reversal = rows.find((row) =>
					BigDecimal.isNegative(BigDecimal.fromStringUnsafe(row.quantity))
				);
				expect(sameDecimal(reversal?.source_net, '-2')).toBe(true);
				expect(sameDecimal(reversal?.cost, '-1.25')).toBe(true);
				expect(
					sameDecimal(
						BigDecimal.format(
							BigDecimal.sumAll(
								rows.map((row) => BigDecimal.fromStringUnsafe(row.source_net ?? '0'))
							)
						),
						'6'
					)
				).toBe(true);
			}
			const creditDay = '2026-11-05';
			const credit = arAging(yield* finance.query(agingRead(creditDay)), creditDay).find(
				(row) => row.reference === 'CREDIT-PROBE'
			);
			expect(sameDecimal(credit?.credit, '2.26')).toBe(true);
			expect(sameDecimal(credit?.overpaid, '0')).toBe(true);

			yield* sql(`
				INSERT dbo.ICSale (FInterID,FBillNo,FDate,FTranType,FCheckDate,FCancellation,FROB,FCurrencyID,FCustID,FEmpID)
				VALUES (30002,'INV-INDEPENDENT','20261031',80,'20261102',0,1,1,110,21),
					(30003,'RED-INDEPENDENT','20261101',86,'20261102',0,-1,1,110,21),
					(30004,'DRAFT-INDEPENDENT','20261102',80,NULL,0,1,1,110,21);
				INSERT dbo.ICSaleEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FItemID,FUnitID,FQty,FAmount,FAllAmount,FTaxAmount)
				VALUES (30002,1,0,0,0,210,710,3,30,33.90,3.90),
					(30003,1,80,30002,1,210,710,-3,-30,0,0),
					(30004,1,NULL,0,0,210,710,2,20,22.60,2.60);
			`);
			const feed = 'source_sales_lines.sync.invoice_only';
			const pullInvoices = () => t.syncs.read(feed, { instance: 'kingdee' });
			const independent = () =>
				as
					.query({
						source_sales_lines: { where: { order: { is_null: true } } }
					})
					.pipe(Effect.map((answer) => answer.source_sales_lines.rows));
			yield* pullInvoices();
			expect(yield* independent()).toEqual([]);
			const ledger = firstRow(
				(yield* as.query({
					sys_integration: { where: { id: { eq: instance } }, fields: ['configuration'] }
				})).sys_integration.rows
			);
			const configuration = ledger.configuration;
			if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
				throw new Error('Kingdee test ledger configuration is required');
			const pin = (invoiceAnalysisAccount: string) =>
				as.act({
					'sys_integration.update': [
						{
							target: { id: instance },
							set: { configuration: { ...configuration, invoiceAnalysisAccount } }
						}
					]
				});
			yield* pin('11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111');
			expect(Exit.isFailure(yield* Effect.exit(pullInvoices()))).toBe(true);
			expect(yield* independent()).toEqual([]);
			yield* pin(account);
			yield* pullInvoices();
			const captured = yield* independent();
			expect(captured).toHaveLength(3);
			expect(captured.filter((row) => row.active)).toHaveLength(2);
			const retainedMixed = yield* evidence();
			yield* sql(`
				INSERT dbo.ICSaleEntry (FInterID,FEntryID,FSourceTranType,FSourceInterID,FSourceEntryID,FItemID,FUnitID,FQty,FAmount,FAllAmount,FTaxAmount)
				VALUES (30001,2,0,0,0,210,710,1,10,11.30,1.30);
				UPDATE dbo.ICSale SET FBillNo=FBillNo WHERE FInterID=30001;
			`);
			yield* t.pull('transactions');
			yield* t.pull('source_payments');
			yield* t.pull('source_sales_lines');
			yield* pullInvoices();
			expect(yield* evidence()).toEqual(retainedMixed);
			expect(yield* independent()).toEqual(captured);
			yield* sql('DELETE dbo.ICSaleEntry WHERE FInterID=30001 AND FEntryID=2');
			yield* synchronize();
			expect(yield* evidence()).toEqual(retainedMixed);

			yield* pullInvoices();
			expect(yield* independent()).toEqual(captured);
			yield* t.pull('source_sales_lines');
			expect(yield* independent()).toEqual(captured);

			for (const [month, date, reference, amount] of [
				['10', '31', 'INV-INDEPENDENT/1', '30'],
				['11', '01', 'RED-INDEPENDENT/1', '-30']
			] as const) {
				const span = {
					from: `2026-${month}-01`,
					to: `2026-${month}-${month === '10' ? '31' : '30'}`
				};
				const query = salesReadDuring({ ...span, basis: 'invoice' });
				const answer = yield* finance.query(query);
				const facts = salesDetail(answer, { basis: 'invoice' }).filter((row) => !row.order);
				expect(facts).toHaveLength(1);
				const fact = firstRow(facts);
				expect(fact).toMatchObject({
					kind: 'invoice_only',
					order: null,
					order_number: '',
					reference,
					business_on: `2026-${month}-${date}`,
					owner: null,
					owner_name: 'Fixture salesperson',
					party_name: '客户测试',
					product_name: '树脂 A',
					cost: null,
					margin: null,
					currency: 'CNY'
				});
				expect(sameDecimal(fact.source_net, amount)).toBe(true);
				const summary = salesAnalysis(answer, { basis: 'invoice' }).find(
					(row) => row.owner === null
				);
				expect(summary).toMatchObject({ orders: 0, source_lines: 1 });
				expect(sameDecimal(summary?.source_net, amount)).toBe(true);
				expect(
					salesDetail(yield* finance.query(salesReadDuring({ ...span, basis: 'delivery' })), {
						basis: 'delivery'
					}).some((row) => row.kind === 'invoice_only')
				).toBe(false);
				const seller = yield* t.as(t.member(['sales']));
				expect(
					salesDetail(yield* seller.query(salesReadDuring({ ...span, basis: 'invoice' }, true)), {
						basis: 'invoice'
					})
				).toEqual([]);
			}
			yield* sql('UPDATE dbo.ICSale SET FCheckDate=NULL WHERE FInterID=30002');
			yield* pullInvoices();
			expect(
				(yield* independent()).find((row) => row.reference === 'INV-INDEPENDENT/1')
			).toMatchObject({
				active: false,
				id: captured.find((row) => row.reference === 'INV-INDEPENDENT/1')?.id
			});
			yield* sql('DELETE dbo.ICSaleEntry WHERE FInterID=30003');
			yield* t.db.write({
				text: `UPDATE sys_sync SET cursor=jsonb_set(cursor,'{fullAt}','"2000-01-01T00:00:00Z"')
					WHERE sync=$1 AND instance='kingdee'`,
				params: [feed]
			});
			yield* pullInvoices();
			expect(
				(yield* independent()).find((row) => row.reference === 'RED-INDEPENDENT/1')
			).toMatchObject({
				active: false,
				id: captured.find((row) => row.reference === 'RED-INDEPENDENT/1')?.id
			});
			expect((yield* as.query({ orders: { fields: ['number'] } })).orders.rows).toHaveLength(1);

			yield* sql(`
				INSERT dbo.t_RP_Contact (FID,FRP,FType,FInvoiceID,FCustomer,FNumber,FDate,FRPDate,FRemainAmount) VALUES
				(10002,1,3,30002,110,'AR-STANDALONE','20261031','20261231',70),
				(10003,1,5,40002,110,'AR-RECEIPT','20261102',NULL,20),
				(10004,1,3,0,110,'AR-OPENING','20181231',NULL,10),
				(10005,1,3,0,110,'AR-CREDIT','20261106',NULL,-5),
				(10006,1,3,0,110,'AR-EXCLUDED','20181231',NULL,99),
				(10007,0,3,0,110,'AP-EXCLUDED','20261102',NULL,500);
				INSERT dbo.t_RP_NewCheckInfo VALUES (50002,1,3,10002,'20261104',30),(50003,1,5,10003,'20261104',30);
				INSERT dbo.t_RP_Plan_Ar VALUES (30002,1,'20261103',70,70),(30002,1,'20261215',0,0);
			`);
			const pullReceivables = () =>
				t.syncs.read('source_receivables.sync.kingdee', { instance: 'kingdee' });
			const configureReceivables = (receivablesAccount: string) =>
				as.act({
					'sys_integration.update': [
						{
							target: { id: instance },
							set: {
								configuration: {
									...configuration,
									invoiceAnalysisAccount: account,
									receivablesAccount,
									receivablesExcludedContacts: '10006'
								}
							}
						}
					]
				});
			yield* pullReceivables();
			expect((yield* finance.query(receivablesRead)).source_receivables.rows).toEqual([]);
			yield* configureReceivables(
				'11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111'
			);
			expect(Exit.isFailure(yield* Effect.exit(pullReceivables()))).toBe(true);
			yield* configureReceivables(account);
			yield* pullReceivables();
			const snapshots = (yield* finance.query(receivablesRead)).source_receivables.rows;
			expect(snapshots).toHaveLength(1);
			expect(snapshots[0]?.source?.id).toBe(instance);
			expect(snapshots[0]?.entries).toHaveLength(5);
			const sellerSnapshot = yield* Effect.exit(
				(yield* t.as(t.member(['sales']))).query(receivablesRead)
			);
			expect(
				Exit.isFailure(sellerSnapshot) || sellerSnapshot.value.source_receivables.rows.length === 0
			).toBe(true);
			const opening = '2024-12-31';
			const openingRows = agingDetails(
				yield* finance.query(agingRead(opening)),
				opening,
				snapshots
			);
			expect(openingRows.map((row) => row.reference)).toEqual(['AR-OPENING']);
			expect(sameDecimal(firstRow(openingRows).balance, '10')).toBe(true);
			for (const [date, gross, cash, credit, net] of [
				['2026-11-03', '119.04', '50', '0', '69.04'],
				['2026-11-04', '86.04', '20', '0', '66.04'],
				['2026-11-06', '86.04', '20', '5', '61.04']
			] as const) {
				const cutoff = date;
				const answer = yield* finance.query(agingRead(cutoff));
				const details = agingDetails(answer, cutoff, snapshots);
				expect(details.filter((row) => row.reference === 'INV-PROBE')).toHaveLength(1);
				const independent = details.find((row) => row.reference === 'INV-INDEPENDENT');
				expect(independent).toMatchObject({
					order: null,
					due_on: '2026-11-03',
					bucket: date === '2026-11-03' ? 'not_due' : '1_30'
				});
				const customer = firstRow(agingSummary(details));
				expect(sameDecimal(customer.balance, gross)).toBe(true);
				expect(sameDecimal(customer.unapplied, cash)).toBe(true);
				expect(sameDecimal(customer.credit, credit)).toBe(true);
				expect(sameDecimal(customer.net, net)).toBe(true);
				const estimated = estimateAging(details);
				const estimatedInvoice = estimated.find((row) => row.reference === 'INV-INDEPENDENT');
				expect(
					sameDecimal(
						estimatedInvoice?.estimated_applied,
						BigDecimal.format(
							BigDecimal.sum(BigDecimal.fromStringUnsafe(cash), BigDecimal.fromStringUnsafe(credit))
						)
					)
				).toBe(true);
				expect(sameDecimal(firstRow(agingSummary(estimated)).estimated_balance, net)).toBe(true);
				const scoped = yield* finance.query(agingRead(cutoff, [instance]));
				expect(scoped.transactions.rows).toHaveLength(0);
				expect(scoped.source_payments.rows).toHaveLength(0);
			}
			yield* pullReceivables();
			expect((yield* finance.query(receivablesRead)).source_receivables.rows).toEqual(snapshots);
			yield* sql('UPDATE dbo.t_RP_Contact SET FRemainAmount=69 WHERE FID=10002');
			moveReceivablesDuringRead = true;
			expect(Exit.isFailure(yield* Effect.exit(pullReceivables()))).toBe(true);
			expect(moveReceivablesDuringRead).toBe(false);
			expect((yield* finance.query(receivablesRead)).source_receivables.rows).toEqual(snapshots);
			yield* pullReceivables();
			const revisedAr = firstRow((yield* finance.query(receivablesRead)).source_receivables.rows);
			expect(revisedAr.id).toBe(snapshots[0]?.id);
			const revisedBalance = revisedAr.entries.find(
				(entry) => entry.contact_id === '10002'
			)?.remaining;
			expect(sameDecimal(revisedBalance, '67')).toBe(true);
			yield* sql("UPDATE dbo.t_RP_NewCheckInfo SET FCheckDate='20261105' WHERE FInterID=50002");
			yield* pullReceivables();
			const correctedAr = firstRow((yield* finance.query(receivablesRead)).source_receivables.rows);
			expect(
				correctedAr.entries.find((entry) => entry.contact_id === '10002')?.settlements
			).toEqual([{ on: '2026-11-05', amount: '30.0000000000' }]);

			yield* sql(`
				INSERT dbo.t_RP_Contact (FID,FRP,FType,FInvoiceID,FCustomer,FNumber,FDate,FRemainAmount)
				VALUES (10008,1,99,0,110,'AR-UNKNOWN','20261106',1);
			`);
			expect(Exit.isFailure(yield* Effect.exit(pullReceivables()))).toBe(true);
			expect((yield* finance.query(receivablesRead)).source_receivables.rows).toEqual([
				correctedAr
			]);
		}),
	120_000
);

it.effect.skipIf(!password)(
	'the connector read login is db_datareader and cannot write or change schema',
	() =>
		Effect.gen(function* () {
			const { source, sql, database } = yield* probeDatabase('TradePollingProbe');
			const login = `connector_ro_${randomBytes(5).toString('hex')}`;
			const secret = `Fixture!7b-${randomBytes(12).toString('hex')}`;
			yield* sql(
				`CREATE LOGIN [${login}] WITH PASSWORD='${secret}'; CREATE USER [${login}] FOR LOGIN [${login}]; ALTER ROLE db_datareader ADD MEMBER [${login}];`
			);
			yield* Effect.addFinalizer(() =>
				Effect.promise(() =>
					source
						.request()
						.query(`DROP LOGIN [${login}]`)
						.catch(() => undefined)
				)
			);
			const reader = yield* Effect.acquireRelease(
				Effect.promise(() =>
					new mssql.ConnectionPool({
						server: '127.0.0.1',
						port,
						database,
						user: login,
						password: secret,
						options: { encrypt: true, trustServerCertificate: true, serverName: 'localhost' }
					}).connect()
				),
				(pool) => Effect.promise(() => pool.close())
			);
			const count = yield* Effect.promise(() =>
				reader.request().query('SELECT COUNT(*) AS n FROM dbo.t_ICItem')
			);
			expect(Number(firstRow(count.recordset).n)).toBeGreaterThan(0);
			for (const statement of [
				'UPDATE dbo.t_ICItem SET FNumber=FNumber WHERE FItemID=210',
				"INSERT INTO dbo.t_ICItem (FItemID,FNumber) VALUES (999999,'NOPE')",
				'CREATE TABLE dbo.ProbeWrite (id int)'
			])
				expect(
					yield* Effect.exit(Effect.promise(() => reader.request().query(statement)))
				).toMatchObject({ _tag: 'Failure' });
		})
);
