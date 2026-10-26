import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import mssql from 'mssql';
import { compileSqlServer } from '@norbital-ai/store/sqlserver';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { bindings } from '../src/integration/kingdee/source-bindings.js';
import {
	readSource,
	type DatabaseContext,
	type SqlRow
} from '../src/integration/kingdee/polling.js';
import {
	sourceClock,
	sourceKeys,
	sourceMetadata,
	sourcePage,
	type SourceProjection
} from '../src/integration/kingdee/sql.js';
import { submitOrder, type OrderPayload } from '../src/integration/kingdee/submission.js';

const enabled = process.env.KINGDEE_LOCAL_PROBE === '1';
const localPort = Number(process.env.KINGDEE_PROBE_PORT ?? '14341');
if (localPort !== 14341 && localPort !== 14351)
	throw new Error('Kingdee local probes require the dedicated local port 14341 or 14351');
const suffix = randomUUID().replaceAll('-', '');
const databaseName = `KingdeeLocalProbe_${suffix}`;
const readLogin = `kingdee_probe_ro_${suffix}`;
const writeLogin = `kingdee_probe_wr_${suffix}`;
const readPassword = `Read!7${randomBytes(24).toString('hex')}`;
const writePassword = `Write!7${randomBytes(24).toString('hex')}`;
const configuration = { fullSnapshotMinutes: 1440, maxWindowMinutes: 15, baseCurrency: 'CNY' };
const q = (name: string) => `[${name.replaceAll(']', ']]')}]`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
let admin: mssql.ConnectionPool | undefined;
let control: mssql.ConnectionPool | undefined;
let reader: mssql.ConnectionPool | undefined;
let writer: mssql.ConnectionPool | undefined;
let databaseCreated = false;
const createdLogins: string[] = [];

/** Only the dedicated loopback probe ports and this run's disposable database are admitted. */
function localTarget(config: Pick<mssql.config, 'server' | 'port' | 'database'>) {
	if (
		config.server !== '127.0.0.1' ||
		config.port !== localPort ||
		(config.database !== 'master' && config.database !== databaseName)
	)
		throw new Error(
			`Kingdee local probes require 127.0.0.1:${localPort} and their disposable database`
		);
}
async function connect(user: string, password: string, database: string) {
	const config: mssql.config = {
		server: '127.0.0.1',
		port: localPort,
		database,
		user,
		password,
		connectionTimeout: 8000,
		requestTimeout: 8000,
		pool: { min: 0, max: 2, idleTimeoutMillis: 1000 },
		// Loopback-only transport probe; production TLS admission is deliberately not bypassed or modified.
		options: { encrypt: false, trustServerCertificate: true, tdsVersion: '7_4', useUTC: true }
	};
	localTarget(config);
	return new mssql.ConnectionPool(config).connect();
}
const required = (pool: mssql.ConnectionPool | undefined) => {
	if (pool === undefined) throw new Error('The disposable local SQL fixture has not started');
	return pool;
};
function scalar(value: unknown): Json {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'bigint') return value.toString();
	if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
	if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
	throw new Error('The SQL probe received an unsupported wire value');
}
function safeMessage(cause: unknown) {
	let message = cause instanceof Error ? cause.message : 'Local SQL request failed';
	for (const password of [process.env.KINGDEE_PROBE_ADMIN_PASSWORD, readPassword, writePassword])
		if (password) message = message.replaceAll(password, '[credential]');
	return message;
}
/** Exercise the installed compiler and TDS RPC with the restricted account, never the setup administrator. */
async function execute(
	pool: mssql.ConnectionPool,
	operation: DatabaseRequest
): Promise<DatabaseResult> {
	const program = compileSqlServer(operation);
	const transaction =
		program.transaction === 'serializable' ? new mssql.Transaction(pool) : undefined;
	let active = false;
	try {
		if (transaction !== undefined) {
			await transaction.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);
			active = true;
		}
		const request = transaction?.request() ?? pool.request();
		for (const [name, value] of Object.entries(program.parameters))
			request.input(
				name,
				typeof value === 'number'
					? mssql.Float
					: typeof value === 'boolean'
						? mssql.Bit
						: mssql.NVarChar(mssql.MAX),
				value
			);
		const result =
			program.procedure === undefined
				? await request.query<Record<string, unknown>>(program.statement)
				: await request.execute<Record<string, unknown>>(program.procedure);
		if (transaction !== undefined) {
			await transaction.commit();
			active = false;
		}
		return {
			rows: (result.recordset ?? []).map((row) =>
				Object.fromEntries(Object.entries(row).map(([name, value]) => [name, scalar(value)]))
			)
		};
	} finally {
		if (active && transaction !== undefined) await transaction.rollback();
	}
}
const context = (pool: mssql.ConnectionPool): DatabaseContext => ({
	request: (operation) =>
		Effect.tryPromise({
			try: () => execute(pool, operation),
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: safeMessage(cause) })
		})
});
const readContext = () => context(required(reader));
async function clock() {
	const row = (await Effect.runPromise(sourceClock(readContext())))[0];
	if (typeof row?.maximum !== 'string') throw new Error('Native rowversion ceiling missing');
	return row.maximum.toLowerCase();
}
async function poll(projection: SourceProjection, cursor: Json | null = null) {
	const rows: SqlRow[] = [];
	let next = cursor;
	for (let page = 0; page < 20; page++) {
		const result = await Effect.runPromise(
			readSource(projection, next, { ...readContext(), configuration }, (row) => row)
		);
		rows.push(...result.rows);
		next = result.cursor;
		if (!result.more) return { rows, cursor: next };
	}
	throw new Error('Local fixture exceeded its bounded source-page count');
}
async function cleanup() {
	try {
		for (const pool of [reader, writer, control]) if (pool !== undefined) await pool.close();
	} finally {
		if (admin !== undefined) {
			try {
				if (databaseCreated) {
					await admin
						.request()
						.query(
							`ALTER DATABASE ${q(databaseName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${q(databaseName)};`
						);
					databaseCreated = false;
				}
			} finally {
				try {
					for (const login of createdLogins) await admin.request().query(`DROP LOGIN ${q(login)}`);
					createdLogins.length = 0;
				} finally {
					await admin.close();
				}
			}
		}
	}
}

describe.skipIf(!enabled)('Kingdee restricted-account local SQL probes', () => {
	beforeAll(async () => {
		const password = process.env.KINGDEE_PROBE_ADMIN_PASSWORD;
		if (!password)
			throw new Error('KINGDEE_PROBE_ADMIN_PASSWORD is required for the local fixture');
		try {
			admin = await connect('sa', password, 'master');
			await admin.request().query(`CREATE DATABASE ${q(databaseName)}`);
			databaseCreated = true;
			await admin
				.request()
				.query(`ALTER DATABASE ${q(databaseName)} SET COMPATIBILITY_LEVEL = 150`);
			control = await connect('sa', password, databaseName);
			const fixture = await readFile(
				new URL('./fixtures/kingdee-onprem.sql', import.meta.url),
				'utf8'
			);
			for (const batch of fixture.split(/^\s*GO\s*(?:--[^\r\n]*)?$/gim))
				if (batch.trim()) await control.request().batch(batch);
			for (const [login, secret] of [
				[readLogin, readPassword],
				[writeLogin, writePassword]
			]) {
				if (login === undefined || secret === undefined) throw new Error('Probe login missing');
				await admin
					.request()
					.query(
						`CREATE LOGIN ${q(login)} WITH PASSWORD=${literal(secret)}, CHECK_POLICY=OFF, CHECK_EXPIRATION=OFF`
					);
				createdLogins.push(login);
				await control
					.request()
					.query(
						`CREATE USER ${q(login)} FOR LOGIN ${q(login)}; EXEC sp_addrolemember 'db_datareader', ${literal(login)};`
					);
			}
			await control.request().query(`GRANT INSERT ON dbo.SEOrder TO ${q(writeLogin)};
GRANT INSERT ON dbo.SEOrderEntry TO ${q(writeLogin)};
GRANT UPDATE ON dbo.ICMaxNum TO ${q(writeLogin)};`);
			reader = await connect(readLogin, readPassword, databaseName);
			writer = await connect(writeLogin, writePassword, databaseName);
		} catch (cause) {
			await cleanup();
			throw new Error(safeMessage(cause));
		}
	}, 60000);
	afterAll(cleanup, 30000);

	it('restricts the endpoint and runs real master/stock queries without CDC or administrator authority', async () => {
		expect(() =>
			localTarget({ server: '192.168.0.206', port: localPort, database: databaseName })
		).toThrow(/127\.0\.0\.1/);
		expect(() => localTarget({ server: '127.0.0.1', port: 1433, database: databaseName })).toThrow(
			/127\.0\.0\.1/
		);
		expect(() =>
			localTarget({ server: '127.0.0.1', port: localPort, database: 'customer' })
		).toThrow(/disposable/);
		const state = await required(admin)
			.request()
			.input('database', mssql.NVarChar(128), databaseName)
			.query<{ compatibility_level: number; is_cdc_enabled: boolean }>(
				'SELECT compatibility_level,is_cdc_enabled FROM sys.databases WHERE name=@database'
			);
		expect(state.recordset).toEqual([{ compatibility_level: 150, is_cdc_enabled: false }]);
		for (const pool of [required(reader), required(writer)]) {
			const roles = await pool
				.request()
				.query<{ administrator: number; owner: number }>(
					"SELECT IS_SRVROLEMEMBER('sysadmin') AS administrator,IS_MEMBER('db_owner') AS owner"
				);
			expect(roles.recordset).toEqual([{ administrator: 0, owner: 0 }]);
		}
		await expect(
			required(reader).request().query("UPDATE dbo.t_Item SET FName=N'forbidden' WHERE FItemID=301")
		).rejects.toThrow(/permission/i);
		const metadata = await Effect.runPromise(sourceMetadata(readContext(), bindings.products));
		expect(metadata).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ alias: 'products', rowversion_type: 189 }),
				expect.objectContaining({ alias: 'detail', rowversion_type: 189 }),
				expect.objectContaining({ alias: 'unit', rowversion_type: 189 })
			])
		);
		const parties = await poll(bindings.parties);
		expect(parties.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					$id: '101',
					name: 'Probe customer',
					kind: 'customer',
					active: true
				}),
				expect.objectContaining({
					$id: '201',
					name: 'Probe supplier',
					kind: 'supplier',
					active: true
				})
			])
		);
		const stock = await poll(bindings.stock_snapshots);
		expect(stock.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					product_code: '301',
					warehouse_code: '502',
					lot_number: 'PROBE-LOT-A',
					on_hand: '50.0000000000'
				}),
				expect.objectContaining({
					product_code: '301',
					warehouse_code: '502',
					lot_number: 'PROBE-LOT-B',
					on_hand: '20.0000000000'
				})
			])
		);
	}, 30000);

	it('polls joined detail/unit changes and retains soft-deleted rows with their native markers', async () => {
		const initial = await poll(bindings.products);
		const before = await required(reader)
			.request()
			.query<{ marker: string }>(
				'SELECT CONVERT(varchar(18),CONVERT(binary(8),FModifyTime),1) AS marker FROM dbo.t_Item WHERE FItemID=301'
			);
		try {
			await required(control)
				.request()
				.query("UPDATE dbo.t_ICItemCore SET FModel=N'Probe grade B' WHERE FItemID=301");
			const detail = await poll(bindings.products, initial.cursor);
			expect(detail.rows).toEqual([
				expect.objectContaining({ $id: '301', spec: 'Probe grade B', active: true })
			]);
			const after = await required(reader)
				.request()
				.query<{ marker: string }>(
					'SELECT CONVERT(varchar(18),CONVERT(binary(8),FModifyTime),1) AS marker FROM dbo.t_Item WHERE FItemID=301'
				);
			expect(after.recordset).toEqual(before.recordset);
			await required(control)
				.request()
				.query("UPDATE dbo.t_Item SET FName=N'kilogram' WHERE FItemID=401");
			const unit = await poll(bindings.products, detail.cursor);
			expect(unit.rows).toEqual([expect.objectContaining({ $id: '301', unit: 'kilogram' })]);
			await required(control)
				.request()
				.query('UPDATE dbo.t_ICItemCore SET FDeleted=1 WHERE FItemID=301');
			const deleted = await poll(bindings.products, unit.cursor);
			expect(deleted.rows).toEqual([expect.objectContaining({ $id: '301', active: false })]);
		} finally {
			await required(control)
				.request()
				.query(
					"UPDATE dbo.t_ICItemCore SET FDeleted=0,FModel=N'Probe grade A' WHERE FItemID=301; UPDATE dbo.t_Item SET FName=N'kg' WHERE FItemID=401;"
				);
		}
	}, 30000);

	it('holds the exclusive ceiling behind a real uncommitted transaction and captures it after commit', async () => {
		const from = await clock();
		const transaction = new mssql.Transaction(required(control));
		let active = false;
		try {
			await transaction.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
			active = true;
			const pending = await transaction.request().query<{
				marker: string;
			}>(`INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail) VALUES(802,1,N'PROBE-PENDING',N'Pending customer',1);
INSERT dbo.t_Organization(FItemID,FNumber,FName) VALUES(802,N'PROBE-PENDING',N'Pending customer');
SELECT CONVERT(varchar(18),CONVERT(binary(8),FModifyTime),1) AS marker FROM dbo.t_Item WHERE FItemID=802;`);
			const upper = await clock();
			expect(upper).toBe(pending.recordset[0]?.marker.toLowerCase());
			await transaction.commit();
			active = false;
			const prior = await Effect.runPromise(
				sourcePage(readContext(), bindings.parties, '', { from, to: upper })
			);
			expect(prior.some((row) => row.__key === '802')).toBe(false);
			const next = await clock();
			expect(BigInt(next)).toBeGreaterThan(BigInt(upper));
			const committed = await Effect.runPromise(
				sourcePage(readContext(), bindings.parties, '', { from: upper, to: next })
			);
			expect(committed).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ __key: '802', customer_name: 'Pending customer' })
				])
			);
		} finally {
			if (active) await transaction.rollback();
		}
	}, 30000);

	it('rechecks explicit local keys before treating a hard-deleted source row as absent', async () => {
		await required(control).request()
			.query(`INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail) VALUES(803,1,N'PROBE-DELETE',N'Deleted customer',1);
INSERT dbo.t_Organization(FItemID,FNumber,FName) VALUES(803,N'PROBE-DELETE',N'Deleted customer');`);
		expect(
			await Effect.runPromise(sourceKeys(readContext(), bindings.parties, ['101', '803']))
		).toEqual([{ __key: '101' }, { __key: '803' }]);
		await required(control)
			.request()
			.query('DELETE dbo.t_Organization WHERE FItemID=803; DELETE dbo.t_Item WHERE FItemID=803;');
		expect(
			await Effect.runPromise(sourceKeys(readContext(), bindings.parties, ['101', '803']))
		).toEqual([{ __key: '101' }]);
	}, 30000);

	it('submits and replays a real sales order using only the restricted writer account', async () => {
		const payload: OrderPayload = {
			order_id: randomUUID(),
			reference: `PROBE-${randomUUID()}`,
			direction: 'sales',
			agreement_hash: 'a'.repeat(64),
			version: 1,
			owner_id: 'probe-owner',
			ordered_on: '2026-10-26',
			currency: 'CNY',
			tax_inclusive: false,
			party_code: '101',
			payment_terms: 'PROBE-NET30',
			lines: [
				{
					id: randomUUID(),
					product_code: '301',
					unit: 'kg',
					quantity: '10',
					unit_price: '2',
					discount_pct: '0',
					tax_rate: '13',
					net: '20',
					tax: '2.60',
					total: '22.60'
				}
			]
		};
		const ctx = {
			...context(required(writer)),
			configuration: {
				baseCurrency: 'CNY',
				branchNo: '0',
				billerId: '1',
				salespersonBindings: JSON.stringify({
					'probe-owner': { employeeId: '701', departmentId: '601' }
				}),
				currencyBindings: JSON.stringify({ CNY: { id: '1', base: true } }),
				settlementRules: JSON.stringify({ 'PROBE-NET30': { creditDays: 30, fromMonthEnd: false } })
			}
		};
		const key = `${payload.order_id}:${payload.agreement_hash}`;
		const first = await Effect.runPromise(submitOrder(payload, key, ctx));
		// Discarding the first acknowledgement emulates a committed write whose response was lost.
		expect(await Effect.runPromise(submitOrder(payload, key, ctx))).toBe(first);
		const orders = await required(writer)
			.request()
			.input('reference', mssql.NVarChar(100), payload.reference).query<{
			headers: number;
			lines: number;
			checked: number;
			quantity: string;
			amount: string;
		}>(`SELECT
(SELECT COUNT(*) FROM dbo.SEOrder WHERE FBillNo=@reference) AS headers,
(SELECT COUNT(*) FROM dbo.SEOrderEntry line JOIN dbo.SEOrder head ON head.FBrNo=line.FBrNO AND head.FInterID=line.FInterID WHERE head.FBillNo=@reference) AS lines,
(SELECT COUNT(*) FROM dbo.SEOrder WHERE FBillNo=@reference AND (FCheckerID IS NOT NULL OR FCheckDate IS NOT NULL)) AS checked,
(SELECT CONVERT(varchar(100),line.FQty) FROM dbo.SEOrderEntry line JOIN dbo.SEOrder head ON head.FBrNo=line.FBrNO AND head.FInterID=line.FInterID WHERE head.FBillNo=@reference) AS quantity,
(SELECT CONVERT(varchar(100),line.FAllAmount) FROM dbo.SEOrderEntry line JOIN dbo.SEOrder head ON head.FBrNo=line.FBrNO AND head.FInterID=line.FInterID WHERE head.FBillNo=@reference) AS amount`);
		expect(orders.recordset).toEqual([
			{ headers: 1, lines: 1, checked: 0, quantity: '10.0000000000', amount: '22.6000000000' }
		]);
		await expect(
			Effect.runPromise(
				submitOrder({ ...payload, reference: `${payload.reference}-changed` }, key, ctx)
			)
		).rejects.toThrow(/differs/);
		const mutate = (statement: string) =>
			required(control)
				.request()
				.input('reference', mssql.NVarChar(100), payload.reference)
				.query(statement);
		try {
			await mutate(
				'UPDATE line SET FQty=11 FROM dbo.SEOrderEntry line JOIN dbo.SEOrder head ON head.FBrNo=line.FBrNO AND head.FInterID=line.FInterID WHERE head.FBillNo=@reference'
			);
			await expect(Effect.runPromise(submitOrder(payload, key, ctx))).rejects.toThrow(
				/lines differ/
			);
		} finally {
			await mutate(
				'UPDATE line SET FQty=10 FROM dbo.SEOrderEntry line JOIN dbo.SEOrder head ON head.FBrNo=line.FBrNO AND head.FInterID=line.FInterID WHERE head.FBillNo=@reference'
			);
		}
		try {
			await mutate("UPDATE dbo.SEOrder SET FVersionNo='001' WHERE FBillNo=@reference");
			await expect(Effect.runPromise(submitOrder(payload, key, ctx))).rejects.toThrow(/unamended/);
		} finally {
			await mutate("UPDATE dbo.SEOrder SET FVersionNo='000' WHERE FBillNo=@reference");
		}
		const allocator = await required(writer)
			.request()
			.query("SELECT FMaxNum FROM dbo.ICMaxNum WHERE FTableName='SEOrder'");
		const changed = {
			...payload,
			order_id: randomUUID(),
			reference: `PROBE-ROLLBACK-${randomUUID()}`
		};
		await required(control)
			.request()
			.batch(
				'CREATE TRIGGER dbo.Probe_ChangeInsertedLine ON dbo.SEOrderEntry AFTER INSERT AS UPDATE target SET FQty=target.FQty+1 FROM dbo.SEOrderEntry target JOIN inserted ON inserted.FDetailID=target.FDetailID;'
			);
		try {
			await expect(
				Effect.runPromise(
					submitOrder(changed, `${changed.order_id}:${changed.agreement_hash}`, ctx)
				)
			).rejects.toThrow(/lines differ/);
			const absent = await required(writer)
				.request()
				.input('reference', mssql.NVarChar(100), changed.reference)
				.query('SELECT COUNT(*) AS records FROM dbo.SEOrder WHERE FBillNo=@reference');
			expect(absent.recordset).toEqual([{ records: 0 }]);
			expect(
				(
					await required(writer)
						.request()
						.query("SELECT FMaxNum FROM dbo.ICMaxNum WHERE FTableName='SEOrder'")
				).recordset
			).toEqual(allocator.recordset);
		} finally {
			await required(control).request().query('DROP TRIGGER dbo.Probe_ChangeInsertedLine');
		}
		await expect(
			required(writer)
				.request()
				.query("UPDATE dbo.SEOrder SET FBillNo=N'forbidden' WHERE FInterID=9001")
		).rejects.toThrow(/permission/i);
	}, 30000);
});
