import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mssql from 'mssql';
import { Effect, Schema } from 'effect';
import { input_schema } from '@norbital-ai/bolt';
import type { Id } from '@norbital-ai/bolt';
import {
	validate_database_request,
	type DatabaseRequest,
	type DatabaseResult
} from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { compile_sql_server } from '@norbital-ai/store/sqlserver';
import { type OrderPayload } from '../../src/integration/kingdee/order-batch.js';
import { readSourceOrderFamilies } from '../../src/integration/kingdee/order-source.js';
import { submitOrder, sourceOrderUuid } from '../../src/integration/kingdee/submission.js';

const password = process.env.MSSQL_SA_PASSWORD;
assert.ok(password, 'Set MSSQL_SA_PASSWORD for the disposable Docker instance.');
const server = {
	server: '127.0.0.1',
	port: 11434,
	user: 'sa',
	password,
	database: 'TradeOperationsProbe',
	options: { encrypt: true, trustServerCertificate: true, serverName: 'localhost' }
};
const inspect = await new mssql.ConnectionPool(server).connect();
const account = (
	await inspect.request().query<{ write_account: string }>(
		`SELECT CONCAT(database_guid,'/',recovery_fork_guid) AS write_account
FROM sys.database_recovery_status WHERE database_id=DB_ID()`
	)
).recordset[0]?.write_account.toLowerCase();
assert.ok(account);
const configuration = {
	baseCurrency: 'CNY',
	branchNo: '0',
	writeAccount: account,
	billerId: '41',
	salespersonBindings: '{"operator":{"employeeId":"21","departmentId":"31"}}',
	currencyBindings: '{"CNY":{"id":"1","base":true}}',
	settlementRules: '{"NET30":{"creditDays":30,"fromMonthEnd":false}}'
};
const orderId = randomUUID();
const reference = `PROBE-${orderId.slice(0, 8)}`;
const line = {
	id: 'first-line',
	product_code: '210',
	unit: 'kg',
	quantity: '10',
	unit_price: '2',
	discount_pct: '0',
	tax_rate: '13',
	net: '20',
	tax: '2.60',
	total: '22.60'
};
const initial: OrderPayload = {
	order_id: orderId,
	reference,
	direction: 'sales',
	write_target: { account, branch: '0' },
	key: 'initial',
	owner_id: 'operator',
	ordered_on: '2026-10-26',
	currency: 'CNY',
	tax_inclusive: false,
	party_code: '110',
	payment_terms: 'NET30',
	lines: [line]
};
const correlation = await Effect.runPromise(sourceOrderUuid(orderId, initial.key));

async function execute(operation: DatabaseRequest): Promise<DatabaseResult> {
	const compiled = compile_sql_server(
		await Effect.runPromise(validate_database_request(operation))
	);
	const pool = await new mssql.ConnectionPool(server).connect();
	const transaction = new mssql.Transaction(pool);
	try {
		await transaction.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);
		await transaction.request().query("EXECUTE AS USER='trade_order_probe'");
		const request = transaction.request();
		for (const [name, value] of Object.entries(compiled.parameters)) {
			request.input(
				name,
				typeof value === 'number'
					? mssql.Float
					: typeof value === 'boolean'
						? mssql.Bit
						: mssql.NVarChar(mssql.MAX),
				value
			);
		}
		const result =
			compiled.statement === undefined
				? await request.execute(compiled.procedure)
				: await request.query(compiled.statement);
		await transaction.request().query('REVERT');
		await transaction.commit();
		return { rows: result.recordset ?? [] };
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	} finally {
		await pool.close();
	}
}

const database = (loseReceipt = false, replaceWriteAccount = false) => ({
	configuration,
	request: (operation: DatabaseRequest) =>
		Effect.tryPromise({
			try: async () => {
				const result = await execute(
					replaceWriteAccount && operation.op === 'call' && operation.transaction
						? {
								...operation,
								arguments: {
									...operation.arguments,
									write_account:
										'11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
								}
							}
						: operation
				);
				if (loseReceipt && operation.op === 'call' && operation.transaction)
					throw new Error('Probe discarded the committed receipt');
				return result;
			},
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
		})
});
const submit = (payload: OrderPayload, loseReceipt = false) =>
	Effect.runPromise(submitOrder(payload, database(loseReceipt)));
const nativeId = Schema.decodeUnknownSync(
	Schema.declare<Id<'orders'>>((value): value is Id<'orders'> =>
		Schema.is(input_schema({ kind: 'ref', to: 'orders' }))(value)
	)
)(orderId);
const readFamilies = () =>
	Effect.runPromise(readSourceOrderFamilies([{ order: nativeId, uuid: correlation }], database()));
const family = () =>
	inspect
		.request()
		.input('bill', mssql.NVarChar, reference)
		.query(
			`SELECT o.FInterID AS id,o.FVersionNo AS version,o.FCheckDate AS audited,o.FChangeMark AS archived,
	e.FEntryID AS entry,CONVERT(varchar(40),e.FQty) AS qty,CONVERT(varchar(40),e.FAllAmount) AS gross
	FROM dbo.SEOrder o JOIN dbo.SEOrderEntry e ON e.FInterID=o.FInterID AND e.FBrNO=o.FBrNo
	WHERE o.FBillNo=@bill ORDER BY o.FInterID,e.FEntryID`
		);

try {
	const metadata = (
		await inspect
			.request()
			.query(
				"SELECT CONVERT(varchar(40),SERVERPROPERTY('ProductVersion')) AS version, compatibility_level FROM sys.databases WHERE name=DB_NAME()"
			)
	).recordset[0];
	assert.match(metadata.version, /^14\./);
	assert.equal(metadata.compatibility_level, 140);
	const allocator = () =>
		inspect.request().query("SELECT FMaxNum FROM dbo.ICMaxNum WHERE FTableName='SEOrder'");
	const beforeRefusal = (await allocator()).recordset;
	await assert.rejects(
		Effect.runPromise(submitOrder(initial, database(false, true))),
		/write account identity does not match/
	);
	assert.deepEqual((await allocator()).recordset, beforeRefusal);
	assert.equal((await family()).recordset.length, 0);
	await assert.rejects(submit(initial, true), /discarded the committed receipt/);
	const [created] = (await family()).recordset;
	assert.deepEqual((await family()).recordset, [
		{
			id: created.id,
			version: '000',
			audited: null,
			archived: false,
			entry: 1,
			qty: '10.0000000000',
			gross: '22.6000000000'
		}
	]);
	const remote = String(created.id);
	assert.deepEqual(await Promise.all([submit(initial), submit(initial)]), [remote, remote]);
	assert.equal((await family()).recordset.length, 1);
	const before = (await readFamilies()).find((family) => family.order === nativeId);
	assert.deepEqual(
		before?.headers.map(({ version, checker, checked_on }) => [version, checker, checked_on]),
		[['000', null, null]]
	);
	await assert.rejects(
		submit({ ...initial, order_id: randomUUID() }),
		/document number is already in use/
	);
	await assert.rejects(
		submit({
			...initial,
			lines: [{ ...line, quantity: '11', net: '22', tax: '2.86', total: '24.86' }]
		}),
		/lines differ from the submission/
	);

	const amendment: OrderPayload = {
		...initial,
		lines: [
			{ ...line, source_entry_id: '1', quantity: '12', net: '24', tax: '3.12', total: '27.12' }
		],
		previous: {
			source_id: String(created.id),
			source_uuid: correlation,
			source_version: '000',
			source_exchange_rate: '1',
			lines: [
				{
					entry: '1',
					item: line.product_code,
					unit: line.unit,
					quantity: line.quantity,
					exclusive: line.unit_price,
					inclusive: '2.26',
					tax_rate: line.tax_rate,
					net: line.net,
					tax: line.tax,
					total: line.total
				}
			]
		}
	};
	await assert.rejects(submit(amendment), /no longer audited/);
	assert.equal((await family()).recordset.length, 1);
	// The fixture has no Kingdee application. Seed the recorded audit on the saved header.
	await inspect
		.request()
		.input('id', mssql.Int, created.id)
		.query(
			'UPDATE dbo.SEOrder SET FCheckerID=42,FCheckDate=GETDATE(),FStatus=1 WHERE FInterID=@id'
		);
	await assert.rejects(submit(amendment, true), /discarded the committed receipt/);
	assert.equal(await submit(amendment), remote);
	const [live, archive] = (await family()).recordset;
	assert.equal((await family()).recordset.length, 2);
	assert.deepEqual(
		[live.id, live.version, live.entry, live.qty, live.gross, live.archived],
		[created.id, '001', 1, '12.0000000000', '27.1200000000', false]
	);
	assert.deepEqual(
		[archive.version, archive.entry, archive.qty, archive.gross, archive.archived],
		['000', 1, '10.0000000000', '22.6000000000', true]
	);
	assert.equal(live.audited.toISOString(), archive.audited.toISOString());
	const logs = await inspect
		.request()
		.input('id', mssql.Int, created.id)
		.query(
			'SELECT FChangeField AS field,FEChangeValue AS value FROM dbo.ICOrderAlter WHERE FInterID=@id'
		);
	assert.deepEqual(logs.recordset, [{ field: '数量', value: '12.0000000000' }]);
	const after = (await readFamilies()).find((family) => family.order === nativeId);
	assert.deepEqual(
		after?.headers.map(({ version, checker, archive }) => [version, checker, archive]),
		[
			['001', '42', false],
			['000', '42', true]
		]
	);
	assert.deepEqual(
		after?.lines.map(({ quantity }) => quantity),
		['12.0000000000', '10.0000000000']
	);
	console.log(
		`SQL Server ${metadata.version} / 140: ${reference} created once, replayed concurrently, amended in place and archived once.`
	);
} finally {
	await inspect.close();
}
