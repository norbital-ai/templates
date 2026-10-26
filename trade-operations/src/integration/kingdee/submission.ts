import { Effect, Schema } from 'effect';
import { type DatabaseContext, query, SourceRowInvalid } from './polling.js';
import { sha256Hex } from '../../lib/commercial.js';
import { Decimal } from '@norbital-ai/std/decimal';
import {
	headerTypes,
	itemTypes,
	sourceInteger,
	sourceOrderBatch,
	sourceOrderDocument,
	type OrderPayload,
	type SourceOrderBindings
} from './order-batch.js';
export type { OrderPayload } from './order-batch.js';

const failure = (cause: unknown) =>
	cause instanceof SourceRowInvalid
		? cause
		: new SourceRowInvalid({ column: '$submission', reason: String(cause) });
const invalid = (column: string, reason: string): never => {
	throw new SourceRowInvalid({ column, reason });
};
const SourceId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,9}$/));
const Configuration = Schema.Struct({
	baseCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
	branchNo: Schema.NonEmptyString.check(Schema.isMaxLength(20)),
	billerId: SourceId,
	salespersonBindings: Schema.NonEmptyString,
	currencyBindings: Schema.NonEmptyString,
	settlementRules: Schema.NonEmptyString,
	packagingId: Schema.optionalKey(Schema.NullOr(Schema.String))
});
const Salespeople = Schema.Record(
	Schema.String,
	Schema.Struct({ employeeId: SourceId, departmentId: SourceId })
);
const Currencies = Schema.Record(
	Schema.String,
	Schema.Struct({ id: SourceId, base: Schema.Boolean })
);
const SettlementRules = Schema.Record(
	Schema.String,
	Schema.Struct({
		creditDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3660 })),
		fromMonthEnd: Schema.Boolean
	})
);
const LookupRow = Schema.Struct({
	kind: Schema.String,
	local: Schema.String,
	id: Schema.String,
	unit_id: Schema.String,
	unit_name: Schema.String,
	rate: Schema.String
});
const Receipt = Schema.Struct({
	rows: Schema.Array(Schema.Struct({ remote: SourceId, hash: Schema.String }))
});
const decode = <A>(schema: Schema.Codec<A, unknown>, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(failure));
const json = (value: string) =>
	Effect.try({ try: (): unknown => JSON.parse(value), catch: failure });

/** Existing ERP FUUID carries provenance; the namespace makes it independent of document numbering. */
export const sourceOrderUuid = (orderId: string, sealHash: string) =>
	sha256Hex(JSON.stringify(['norbital-kingdee-order-v1', orderId, sealHash])).pipe(
		Effect.map((digest) => {
			const hex = `${digest.slice(0, 12)}8${digest.slice(13, 16)}${((Number.parseInt(digest[16] ?? '0', 16) & 3) | 8).toString(16)}${digest.slice(17, 32)}`;
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		})
	);

const lookupSql = `DECLARE @lines xml=CONVERT(xml,@items);
SELECT 'customer' AS kind,'' AS local,CONVERT(varchar(32),FItemID) AS id,'' AS unit_id,'' AS unit_name,'' AS rate FROM dbo.t_Organization WHERE FItemID=CAST(@customer AS int) AND FDeleted=0
UNION ALL SELECT 'settlement','',CONVERT(varchar(32),FItemID),'','','' FROM dbo.t_Settle WHERE FNumber=@settlement AND FDeleted=0 AND FItemID<>0
UNION ALL SELECT 'employee','',CONVERT(varchar(32),FItemID),'','','' FROM dbo.t_Emp WHERE FItemID=CAST(@employee AS int) AND FDeleted=0
UNION ALL SELECT 'department','',CONVERT(varchar(32),FItemID),'','','' FROM dbo.t_Department WHERE FItemID=CAST(@department AS int) AND FDeleted=0
UNION ALL SELECT 'currency','',CONVERT(varchar(32),FCurrencyID),'','',CONVERT(varchar(100),COALESCE((SELECT FExchangeRate FROM dbo.SEOrder WHERE FBrNo=@branch AND FUUID=CAST(@correlation AS uniqueidentifier)),FExchangeRate)) FROM dbo.t_Currency WHERE FCurrencyID=CAST(@currency AS int) AND FDeleted=0
UNION ALL SELECT 'item',line.value('(@id)[1]','nvarchar(100)'),CONVERT(varchar(32),item.FItemID),CONVERT(varchar(32),detail.FUnitID),unit.FName,''
FROM @lines.nodes('/items/item') AS requested(line)
JOIN dbo.t_Item item ON item.FItemID=line.value('(@item)[1]','int') AND item.FItemClassID=4 AND item.FDetail=1 AND item.FDeleted=0 AND item.FUnUsed=0
JOIN dbo.t_ICItem detail ON detail.FItemID=item.FItemID AND detail.FDeleted=0
JOIN dbo.t_Item unit ON unit.FItemID=detail.FUnitID AND unit.FItemClassID=7 AND unit.FDeleted=0;`;
const entities: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;'
};
const escape = (value: string) =>
	value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
const q = (name: string) => `[${name}]`;
const columns = (types: Readonly<Record<string, string>>) => Object.keys(types).map(q).join(',');
const declaration = (types: Readonly<Record<string, string>>) =>
	Object.entries(types)
		.map(([name, type]) => `${q(name)} ${type} NOT NULL`)
		.join(',');
const xmlValues = (types: Readonly<Record<string, string>>) =>
	Object.entries(types)
		.map(([name, type]) => `item.value('(@${name})[1]','${type}')`)
		.join(',');
const fail = (message: string) => `BEGIN RAISERROR('${message}',16,1); RETURN; END;`;
const sameText = (left: string, right: string) =>
	`CONVERT(nvarchar(max),${left}) COLLATE Latin1_General_BIN2=CONVERT(nvarchar(max),${right}) COLLATE Latin1_General_BIN2 AND DATALENGTH(CONVERT(nvarchar(max),${left}))=DATALENGTH(CONVERT(nvarchar(max),${right}))`;
const immutableHeader = [
	'FBrNo',
	'FBillNo',
	'FTranType',
	'FCurrencyID',
	'FCustID',
	'FDate',
	'FExchangeRate',
	'FDeptID',
	'FEmpID',
	'FBillerID',
	'FSettleID',
	'FAreaPS',
	'FSaleStyle',
	'FSettleDate'
];
const immutableItems = [
	'FEntryID',
	'FItemID',
	'FUnitID',
	'FQty',
	'Fauxqty',
	'FComplexQty',
	'Fauxprice',
	'FPrice',
	'FAuxTaxPrice',
	'FTaxPrice',
	'FPriceDiscount',
	'FAuxPriceDiscount',
	'FCESS',
	'FAmount',
	'FAllAmount',
	'FAllStdAmount',
	'FTaxAmt',
	'FDate',
	'FAdviceConsignDate'
];
/** Only static template-authored SQL reaches this existing RPC; business values are bound XML/scalars. */
export const sourceOrderSql = `SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
DECLARE @payload xml=CONVERT(xml,@document),@remote int,@lock_result int;
DECLARE @header TABLE (${declaration(headerTypes)});
DECLARE @lines TABLE (${declaration(itemTypes)});
INSERT INTO @header SELECT ${xmlValues(headerTypes)} FROM @payload.nodes('/order/header') AS source(item);
INSERT INTO @lines SELECT ${xmlValues(itemTypes)} FROM @payload.nodes('/order/items/item') AS source(item);
IF (SELECT COUNT(*) FROM @header)<>1 OR (SELECT COUNT(*) FROM @lines) NOT BETWEEN 1 AND 200 ${fail('Incomplete source order')}
IF EXISTS(SELECT FEntryID FROM @lines GROUP BY FEntryID HAVING COUNT(*)<>1) ${fail('Duplicate source order line')}
IF EXISTS(SELECT 1 FROM @header WHERE FBrNo<>@branch) ${fail('Source branch mismatch')}
EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
IF @lock_result NOT IN (0,1) ${fail('Source order is busy')}
IF (SELECT COUNT(*) FROM dbo.SEOrder WHERE FBrNo=@branch AND FUUID=CAST(@correlation AS uniqueidentifier))>1 ${fail('Ambiguous source correlation')}
SELECT @remote=FInterID FROM dbo.SEOrder WITH (UPDLOCK,HOLDLOCK) WHERE FBrNo=@branch AND FUUID=CAST(@correlation AS uniqueidentifier);
IF @remote IS NULL BEGIN
 IF EXISTS(SELECT 1 FROM dbo.SEOrder actual WITH (UPDLOCK,HOLDLOCK) JOIN @header expected ON actual.FBillNo=expected.FBillNo WHERE actual.FBrNo=@branch) ${fail('Source document number is already in use')}
 IF EXISTS(SELECT 1 FROM @header expected WHERE NOT EXISTS(SELECT 1 FROM dbo.t_Organization WHERE FItemID=expected.FCustID AND FDeleted=0) OR NOT EXISTS(SELECT 1 FROM dbo.t_Settle WHERE FItemID=expected.FSettleID AND FDeleted=0) OR NOT EXISTS(SELECT 1 FROM dbo.t_Emp WHERE FItemID=expected.FEmpID AND FDeleted=0) OR NOT EXISTS(SELECT 1 FROM dbo.t_Department WHERE FItemID=expected.FDeptID AND FDeleted=0)) ${fail('Source order master data is unavailable')}
 IF EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.t_Item item JOIN dbo.t_ICItem detail ON detail.FItemID=item.FItemID WHERE item.FItemID=expected.FItemID AND item.FItemClassID=4 AND item.FDetail=1 AND item.FDeleted=0 AND item.FUnUsed=0 AND detail.FDeleted=0 AND detail.FUnitID=expected.FUnitID)) ${fail('Source item or base unit changed')}
 IF EXISTS(SELECT 1 FROM @lines expected WHERE expected.FEntrySelfS0172<>'' AND NOT EXISTS(SELECT 1 FROM dbo.t_Item WHERE FItemID=CAST(expected.FEntrySelfS0172 AS int) AND FItemClassID=3001 AND FDeleted=0 AND FUnUsed=0)) ${fail('Source packaging is unavailable')}
 UPDATE dbo.ICMaxNum WITH (UPDLOCK,ROWLOCK) SET FMaxNum=FMaxNum+1 WHERE FTableName='SEOrder';
 IF @@ROWCOUNT<>1 ${fail('Source allocator must identify exactly one row')}
 SELECT @remote=FMaxNum FROM dbo.ICMaxNum WHERE FTableName='SEOrder';
 IF @remote IS NULL OR @remote<=0 OR EXISTS(SELECT 1 FROM dbo.SEOrder WHERE FBrNo=@branch AND FInterID=@remote) ${fail('Source allocation is invalid')}
 INSERT INTO dbo.SEOrder (FInterID,FUUID,${columns(headerTypes)}) SELECT @remote,CAST(@correlation AS uniqueidentifier),${columns(headerTypes)} FROM @header;
 INSERT INTO dbo.SEOrderEntry (FInterID,FBrNO,${columns(itemTypes)}) SELECT @remote,@branch,${columns(itemTypes)} FROM @lines;
END;
IF (SELECT COUNT(*) FROM dbo.SEOrder WHERE FBrNo=@branch AND FUUID=CAST(@correlation AS uniqueidentifier))<>1 ${fail('Source correlation was not preserved')}
IF EXISTS(SELECT 1 FROM dbo.SEOrder WHERE FBrNo=@branch AND FInterID=@remote AND (ISNULL(FVersionNo,'')<>'000' OR ISNULL(FChangeMark,0)<>0)) ${fail('Source order is no longer the original unamended version')}
IF NOT EXISTS(SELECT 1 FROM dbo.SEOrder actual CROSS JOIN @header expected WHERE actual.FBrNo=@branch AND actual.FInterID=@remote AND actual.FUUID=CAST(@correlation AS uniqueidentifier) AND ${immutableHeader.map((name) => (name === 'FBrNo' || name === 'FBillNo' ? sameText(`actual.${q(name)}`, `expected.${q(name)}`) : `actual.${q(name)}=expected.${q(name)}`)).join(' AND ')}) ${fail('Source order header differs from the sealed submission')}
IF (SELECT COUNT(*) FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote)<>(SELECT COUNT(*) FROM @lines) ${fail('Source order line count differs from the sealed submission')}
IF EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.SEOrderEntry actual WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND ${immutableItems.map((name) => `actual.${q(name)}=expected.${q(name)}`).join(' AND ')} AND ((expected.FEntrySelfS0172='' AND (actual.FEntrySelfS0172 IS NULL OR CONVERT(nvarchar(100),actual.FEntrySelfS0172) IN ('','0'))) OR (expected.FEntrySelfS0172<>'' AND ${sameText('actual.FEntrySelfS0172', 'expected.FEntrySelfS0172')})))) ${fail('Source order lines differ from the sealed submission')}
SELECT CONVERT(varchar(32),@remote) AS remote,@fingerprint AS hash;`;

/** Creates one initial SO draft; the native outbox owns delivery and polling observes source approval. */
export const submitOrder = Effect.fnUntraced(function* (
	payload: OrderPayload,
	key: string,
	ctx: DatabaseContext & { readonly configuration: unknown }
) {
	if (payload.direction !== 'sales')
		return yield* new SourceRowInvalid({
			column: 'direction',
			reason: 'Purchase-order write semantics have not been verified'
		});
	if (payload.version !== 1)
		return yield* new SourceRowInvalid({
			column: 'version',
			reason: 'Kingdee amendment writes have not been verified'
		});
	if (key !== `${payload.order_id}:${payload.agreement_hash}`)
		return yield* new SourceRowInvalid({
			column: '$key',
			reason: 'Submission identity does not match the sealed agreement'
		});
	const config = yield* decode(Configuration, ctx.configuration);
	const people = yield* decode(Salespeople, yield* json(config.salespersonBindings));
	const currencies = yield* decode(Currencies, yield* json(config.currencyBindings));
	const rules = yield* decode(SettlementRules, yield* json(config.settlementRules));
	const selected = yield* Effect.try({
		try: () => {
			const person = people[payload.owner_id];
			const denomination = currencies[payload.currency];
			const rule = rules[payload.payment_terms];
			if (person === undefined)
				return invalid('owner', 'The order owner needs a source employee and department binding');
			const bases = Object.entries(currencies).filter(([, value]) => value.base);
			if (denomination === undefined || bases.length !== 1 || bases[0]?.[0] !== config.baseCurrency)
				return invalid(
					'currency',
					'The currency bindings must identify the verified ledger base currency'
				);
			if (rule === undefined)
				return invalid(
					'payment_terms',
					'The source settlement code needs an explicit credit-day rule'
				);
			if (
				payload.lines.length === 0 ||
				payload.lines.length > 200 ||
				new Set(payload.lines.map((line) => line.id)).size !== payload.lines.length
			)
				return invalid('lines', 'A bounded complete set of unique sealed lines is required');
			sourceInteger(payload.party_code, 'party_code');
			for (const line of payload.lines) sourceInteger(line.product_code, 'product_code');
			return { person, denomination, rule };
		},
		catch: failure
	});
	const correlation = yield* sourceOrderUuid(payload.order_id, payload.agreement_hash);
	const lookup = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		arguments: {
			stmt: lookupSql,
			params:
				'@items nvarchar(max),@customer nvarchar(200),@settlement nvarchar(200),@employee nvarchar(32),@department nvarchar(32),@currency nvarchar(32),@branch nvarchar(20),@correlation nvarchar(36)',
			items: `<items>${payload.lines.map((line) => `<item id="${escape(line.id)}" item="${escape(line.product_code)}"/>`).join('')}</items>`,
			customer: payload.party_code,
			settlement: payload.payment_terms,
			employee: selected.person.employeeId,
			department: selected.person.departmentId,
			currency: selected.denomination.id,
			branch: config.branchNo,
			correlation
		},
		maxRows: 1000
	});
	const source = yield* decode(Schema.Array(LookupRow), lookup);
	const bindings = yield* Effect.try({
		try: (): SourceOrderBindings => {
			const one = (kind: string, local = '') => {
				const rows = source.filter((row) => row.kind === kind && row.local === local);
				if (rows.length !== 1 || rows[0] === undefined)
					return invalid(kind, 'Source mapping must identify exactly one active row');
				return rows[0];
			};
			const sourceCurrency = one('currency');
			const rate = Decimal.of(sourceCurrency.rate);
			if (rate.lte(0) || (selected.denomination.base && !rate.eq(1)))
				return invalid('currency', 'Source exchange rate is invalid for this currency binding');
			if (
				one('employee').id !== selected.person.employeeId ||
				one('department').id !== selected.person.departmentId
			)
				return invalid('owner', 'Source employee binding changed');
			return {
				branchNo: config.branchNo,
				billerId: sourceInteger(config.billerId, 'billerId'),
				employeeId: selected.person.employeeId,
				departmentId: selected.person.departmentId,
				customerId: one('customer').id,
				settlementId: one('settlement').id,
				currencyId: sourceCurrency.id,
				baseCurrency: config.baseCurrency,
				rate: rate.toString(),
				packagingId: config.packagingId ? sourceInteger(config.packagingId, 'packagingId') : '',
				creditDays: selected.rule.creditDays,
				fromMonthEnd: selected.rule.fromMonthEnd,
				items: payload.lines.map((line) => {
					const item = one('item', line.id);
					if (item.unit_name !== line.unit)
						return invalid('unit', 'The sealed unit does not match the source base unit');
					return { itemId: item.id, unitId: item.unit_id };
				})
			};
		},
		catch: failure
	});
	const batch = yield* Effect.try({
		try: () => sourceOrderBatch(payload, bindings),
		catch: failure
	});
	const document = sourceOrderDocument(batch);
	if (document.length > 262144)
		return yield* new SourceRowInvalid({
			column: 'lines',
			reason: 'Source order exceeds its payload bound'
		});
	const fingerprint = yield* sha256Hex(
		JSON.stringify({ key, header: batch.header, items: batch.items })
	);
	const result = yield* decode(
		Receipt,
		yield* ctx.request({
			op: 'call',
			procedure: { schema: 'sys', name: 'sp_executesql' },
			arguments: {
				stmt: sourceOrderSql,
				params:
					'@document nvarchar(max),@branch nvarchar(20),@correlation nvarchar(36),@resource nvarchar(255),@fingerprint nvarchar(64)',
				document,
				branch: config.branchNo,
				correlation,
				resource: `norbital:trade:order:${correlation}`,
				fingerprint
			},
			transaction: 'serializable',
			maxRows: 1
		})
	);
	const receipt = result.rows[0];
	if (result.rows.length !== 1 || receipt === undefined || receipt.hash !== fingerprint)
		return yield* new SourceRowInvalid({
			column: '$receipt',
			reason: 'Source receipt does not match the sealed submission'
		});
	return `sales:${config.branchNo}:${receipt.remote}:${payload.agreement_hash}`;
});
