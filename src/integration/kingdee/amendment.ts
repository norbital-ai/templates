import { Decimal } from '@norbital-ai/std/decimal';
import { SourceRowInvalid } from './polling.js';
import {
	headerTypes,
	itemTypes,
	type OrderPayload,
	type SourceOrderBatch,
	type SourceOrderBindings
} from './order-batch.js';

const escape = (value: string) =>
	value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&apos;';
		}
	});
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
const logText = (value: string, column: string) =>
	`LEFT(CONVERT(nvarchar(max),${value}),COALESCE((SELECT capacity FROM @log_limits WHERE name=N'${column}'),2147483647))`;
const header = [
	'FBrNo',
	'FBillNo',
	'FTranType',
	'FCurrencyID',
	'FCustID',
	'FDate',
	'FExchangeRate',
	'FDeptID',
	'FEmpID',
	'FSettleID',
	'FAreaPS',
	'FSaleStyle',
	'FSettleDate'
];
const amounts = [
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
	'FTaxAmt'
];
const targetFields = ['FEntryID', 'FItemID', 'FUnitID', ...amounts];
const targetMatches = targetFields
	.map((name) => `actual.${q(name)}=expected.${q(name)}`)
	.join(' AND ');
const noticeQty = (alias: string) =>
	`ISNULL((SELECT SUM(n.FQty) FROM dbo.SEOutStockEntry n WHERE n.FSourceTranType=81 AND n.FSourceInterId=${alias}.FInterID AND n.FItemID=${alias}.FItemID),0)`;
const deliveredQty = (alias: string) =>
	`ISNULL((SELECT SUM(d.FQty) FROM dbo.ICStockBillEntry d JOIN dbo.ICStockBill h ON h.FInterID=d.FInterID WHERE h.FTranType=21 AND h.FCheckDate IS NOT NULL AND h.FCancellation=0 AND h.FROB=1 AND ((d.FSourceTranType=81 AND d.FSourceInterId=${alias}.FInterID AND d.FSourceEntryID=${alias}.FEntryID) OR (d.FOrderInterID=${alias}.FInterID AND d.FItemID=${alias}.FItemID))),0)`;
const billedQty = (alias: string) =>
	`ISNULL((SELECT SUM(i.FQty) FROM dbo.ICSaleEntry i JOIN dbo.ICSale h ON h.FInterID=i.FInterID WHERE h.FCheckDate IS NOT NULL AND h.FCancellation=0 AND h.FROB=1 AND i.FSourceTranType=81 AND i.FSourceInterId=${alias}.FInterID AND i.FSourceEntryID=${alias}.FEntryID),0)`;
const linked = (alias: string) =>
	`EXISTS(SELECT 1 FROM dbo.ICStockBillEntry d JOIN dbo.ICStockBill h ON h.FInterID=d.FInterID WHERE h.FTranType=21 AND ((d.FSourceTranType=81 AND d.FSourceInterId=${alias}.FInterID AND d.FSourceEntryID=${alias}.FEntryID) OR (d.FOrderInterID=${alias}.FInterID AND d.FItemID=${alias}.FItemID))) OR EXISTS(SELECT 1 FROM dbo.SEOutStockEntry n WHERE n.FSourceTranType=81 AND n.FSourceInterId=${alias}.FInterID AND n.FItemID=${alias}.FItemID) OR EXISTS(SELECT 1 FROM dbo.ICSaleEntry i WHERE i.FSourceTranType=81 AND i.FSourceInterId=${alias}.FInterID AND i.FSourceEntryID=${alias}.FEntryID)`;

/** The previous snapshot is evidence, never a fresh read that silently accepts someone else's changes. */
export function previousOrderDocument(
	payload: OrderPayload,
	bindings: Pick<SourceOrderBindings, 'rate' | 'baseCurrency'>
) {
	const previous = payload.previous;
	if (previous === undefined)
		throw new SourceRowInvalid({
			column: 'version',
			reason: 'The previous source version is required'
		});
	return `<previous>${previous.lines
		.map((line) => {
			const effective = Decimal.of(line.unit_price)
				.times(Decimal.of(100).minus(line.discount_pct))
				.div(100, 12);
			const factor = Decimal.of(1).plus(Decimal.of(line.tax_rate).div(100, 6));
			const exclusive = previous.tax_inclusive ? effective.div(factor, 8) : effective;
			const inclusive = previous.tax_inclusive ? effective : effective.times(factor).round(8);
			const values = {
				entry: line.source_entry_id,
				item: line.product_code,
				unit: line.unit,
				quantity: line.quantity,
				exclusive: exclusive.toString(),
				inclusive: inclusive.toString(),
				tax_rate: line.tax_rate,
				net: line.net,
				tax: line.tax,
				total: line.total,
				standard_total: Decimal.of(line.total)
					.times(previous.source_exchange_rate)
					.roundTo(bindings.baseCurrency)
					.toString()
			};
			return `<line ${Object.entries(values)
				.map(([key, value]) => `${key}="${escape(value)}"`)
				.join(' ')}/>`;
		})
		.join('')}</previous>`;
}

/** Existing lines keep their physical identity and source-only fields; only agreed monetary/quantity fields change. */
export const sourceAmendmentSql = `SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
DECLARE @payload xml=CONVERT(xml,@document),@prior xml=CONVERT(xml,@previous_document),@remote int=CAST(@source_id AS int),@archive int,@lock_result int,@actual_version nvarchar(30),@new_version nvarchar(3),@user nvarchar(255),@sql nvarchar(max),@cols nvarchar(max),@values nvarchar(max);
DECLARE @header TABLE (${declaration(headerTypes)});
DECLARE @lines TABLE (${declaration(itemTypes)});
DECLARE @previous TABLE (entry_id int NOT NULL PRIMARY KEY,item_id int NOT NULL,unit_name nvarchar(200) NOT NULL,quantity decimal(28,10) NOT NULL,exclusive decimal(28,10) NOT NULL,inclusive decimal(28,10) NOT NULL,tax_rate decimal(28,10) NOT NULL,net decimal(28,10) NOT NULL,tax decimal(28,10) NOT NULL,total decimal(28,10) NOT NULL,standard_total decimal(28,10) NOT NULL);
INSERT INTO @header SELECT ${xmlValues(headerTypes)} FROM @payload.nodes('/order/header') AS source(item);
INSERT INTO @lines SELECT ${xmlValues(itemTypes)} FROM @payload.nodes('/order/items/item') AS source(item);
INSERT INTO @previous SELECT item.value('(@entry)[1]','int'),item.value('(@item)[1]','int'),item.value('(@unit)[1]','nvarchar(200)'),item.value('(@quantity)[1]','decimal(28,10)'),item.value('(@exclusive)[1]','decimal(28,10)'),item.value('(@inclusive)[1]','decimal(28,10)'),item.value('(@tax_rate)[1]','decimal(28,10)'),item.value('(@net)[1]','decimal(28,10)'),item.value('(@tax)[1]','decimal(28,10)'),item.value('(@total)[1]','decimal(28,10)'),item.value('(@standard_total)[1]','decimal(28,10)') FROM @prior.nodes('/previous/line') AS source(item);
IF (SELECT COUNT(*) FROM @header)<>1 OR (SELECT COUNT(*) FROM @lines) NOT BETWEEN 1 AND 200 OR (SELECT COUNT(*) FROM @previous) NOT BETWEEN 1 AND 200 ${fail('Incomplete source amendment')}
IF EXISTS(SELECT FEntryID FROM @lines GROUP BY FEntryID HAVING COUNT(*)<>1) ${fail('Duplicate amendment entry identity')}
IF @source_version NOT LIKE '[0-9][0-9][0-9]' OR @source_version='999' ${fail('Source version is not amendable')}
SET @new_version=RIGHT('000'+CONVERT(varchar(3),CAST(@source_version AS int)+1),3);
EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
IF @lock_result NOT IN (0,1) ${fail('Source order is busy')}
SELECT @actual_version=FVersionNo FROM dbo.SEOrder WITH (UPDLOCK,HOLDLOCK) WHERE FBrNo=@branch AND FInterID=@remote AND FUUID=CAST(@correlation AS uniqueidentifier);
IF @actual_version IS NULL ${fail('The verified source order identity moved or disappeared')}
IF (SELECT COUNT(*) FROM dbo.SEOrder WHERE FBrNo=@branch AND FUUID=CAST(@correlation AS uniqueidentifier))<>1 ${fail('Ambiguous source correlation')}
IF NOT EXISTS(SELECT 1 FROM dbo.SEOrder WHERE FBrNo=@branch AND FInterID=@remote AND CAST(FExchangeRate AS decimal(28,10))=@source_exchange_rate) ${fail('Source exchange rate changed since the previous contract observation')}
IF NOT EXISTS(SELECT 1 FROM dbo.SEOrder actual CROSS JOIN @header expected WHERE actual.FBrNo=@branch AND actual.FInterID=@remote AND ${header.map((name) => (name === 'FBrNo' || name === 'FBillNo' ? sameText(`actual.${q(name)}`, `expected.${q(name)}`) : `actual.${q(name)}=expected.${q(name)}`)).join(' AND ')}) ${fail('Amendments cannot change the approved source header terms')}
IF EXISTS(SELECT FEntryID FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote GROUP BY FEntryID HAVING COUNT(*)<>1) ${fail('Source entry identities are ambiguous')}
IF @actual_version=@new_version BEGIN
 IF (SELECT COUNT(*) FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote)<>(SELECT COUNT(*) FROM @lines) OR EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.SEOrderEntry actual WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND ${targetMatches})) ${fail('The amended source order differs from the frozen submission')}
 IF NOT EXISTS(SELECT 1 FROM dbo.ICOrderAlter WHERE FInterID=@remote AND FBillType=81 AND FVersionNo=@new_version AND FChangeCauses=@change_cause) ${fail('This source version was changed by another amendment')}
 SELECT CONVERT(varchar(32),@remote) AS remote,@fingerprint AS hash; RETURN;
END;
IF @actual_version<>@source_version ${fail('Source business version changed; import it before amending')}
IF EXISTS(SELECT 1 FROM dbo.SEOrder WHERE FBrNo=@branch AND FInterID=@remote AND (FCancellation<>0 OR FChangeMark<>0 OR FClosed<>0 OR FStatus=3)) ${fail('Source order is void, archived or closed')}
IF (SELECT COUNT(*) FROM dbo.SEOrder actual CROSS JOIN @header expected WHERE actual.FBrNo=@branch AND actual.FBillNo=expected.FBillNo AND actual.FCancellation=0 AND actual.FChangeMark=0)<>1 ${fail('The source document family has an ambiguous live order')}
IF (SELECT COUNT(*) FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote)<>(SELECT COUNT(*) FROM @previous) OR EXISTS(SELECT 1 FROM @previous expected WHERE NOT EXISTS(SELECT 1 FROM dbo.SEOrderEntry actual JOIN dbo.t_Item unit ON unit.FItemID=actual.FUnitID AND unit.FItemClassID=7 WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND actual.FEntryID=expected.entry_id AND actual.FItemID=expected.item_id AND ${sameText('unit.FName', 'expected.unit_name')} AND actual.FQty=expected.quantity AND actual.Fauxqty=expected.quantity AND actual.FComplexQty=expected.quantity AND actual.FAuxPrice=expected.exclusive AND actual.FPrice=expected.exclusive AND actual.FAuxTaxPrice=expected.inclusive AND actual.FTaxPrice=expected.inclusive AND actual.FPriceDiscount=expected.inclusive AND actual.FAuxPriceDiscount=expected.inclusive AND actual.FCESS=expected.tax_rate AND actual.FAmount=expected.net AND actual.FTaxAmt=expected.tax AND actual.FAllAmount=expected.total AND actual.FAllStdAmount=expected.standard_total)) ${fail('Source contents changed since the previous contract observation')}
IF EXISTS(SELECT 1 FROM @lines target JOIN @previous old ON old.entry_id=target.FEntryID WHERE target.FItemID<>old.item_id) ${fail('A changed product requires a new line identity')}
IF EXISTS(SELECT 1 FROM dbo.SEOrderEntry old JOIN @lines target ON target.FEntryID=old.FEntryID WHERE old.FBrNO=@branch AND old.FInterID=@remote AND old.FUnitID<>target.FUnitID) ${fail('An existing source line cannot change its unit')}
IF EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.t_Item item JOIN dbo.t_ICItem detail ON detail.FItemID=item.FItemID WHERE item.FItemID=expected.FItemID AND item.FItemClassID=4 AND item.FDetail=1 AND item.FDeleted=0 AND item.FUnUsed=0 AND detail.FDeleted=0 AND detail.FUnitID=expected.FUnitID)) ${fail('Source item or base unit changed')}
IF (SELECT COUNT(*) FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote)=(SELECT COUNT(*) FROM @lines) AND NOT EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.SEOrderEntry actual WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND ${targetMatches})) BEGIN
 SELECT CONVERT(varchar(32),@remote) AS remote,@fingerprint AS hash; RETURN;
END;
IF EXISTS(SELECT 1 FROM dbo.SEOrderEntry old JOIN @lines target ON target.FEntryID=old.FEntryID WHERE old.FBrNO=@branch AND old.FInterID=@remote AND target.FQty<>old.FQty AND (target.FQty<ISNULL(old.FStockQty,0) OR target.FQty<${noticeQty('old')} OR target.FQty<${deliveredQty('old')} OR target.FQty<${billedQty('old')})) ${fail('Amended quantity is below shipped, notified or invoiced quantity')}
IF EXISTS(SELECT 1 FROM dbo.SEOrderEntry old WHERE old.FBrNO=@branch AND old.FInterID=@remote AND NOT EXISTS(SELECT 1 FROM @lines target WHERE target.FEntryID=old.FEntryID) AND (ISNULL(old.FStockQty,0)<>0 OR ${linked('old')})) ${fail('A linked or shipped source line cannot be removed')}
IF COLUMNPROPERTY(OBJECT_ID('dbo.SEOrderEntry'),'FDetailID','IsIdentity')<>1 ${fail('The source line allocator has not been verified')}
SELECT @user=FName FROM dbo.t_User WHERE FUserID=CAST(@biller AS int);
IF @user IS NULL OR NOT EXISTS(SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('dbo.ICOrderAlter') AND c.name='FChangeCauses' AND (c.max_length=-1 OR (t.name IN ('nvarchar','nchar') AND c.max_length>=DATALENGTH(@change_cause)) OR (t.name IN ('varchar','char') AND c.max_length>=DATALENGTH(CONVERT(varchar(max),@change_cause))))) ${fail('The source change log cannot preserve amendment provenance')}
UPDATE dbo.ICMaxNum WITH (UPDLOCK,ROWLOCK) SET FMaxNum=FMaxNum+1 WHERE FTableName='SEOrder';
IF @@ROWCOUNT<>1 ${fail('Source allocator must identify exactly one row')}
SELECT @archive=FMaxNum FROM dbo.ICMaxNum WHERE FTableName='SEOrder';
IF @archive IS NULL OR @archive<=0 OR EXISTS(SELECT 1 FROM dbo.SEOrder WHERE FBrNo=@branch AND FInterID=@archive) ${fail('Source archive allocation is invalid')}
SELECT @cols=STUFF((SELECT ','+QUOTENAME(name) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SEOrder') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,''),@values=STUFF((SELECT ','+CASE name WHEN 'FInterID' THEN '@arc' WHEN 'FCancellation' THEN '1' WHEN 'FChangeMark' THEN '1' WHEN 'FUUID' THEN 'NEWID()' ELSE QUOTENAME(name) END FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SEOrder') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
SET @sql=N'INSERT dbo.SEOrder('+@cols+') SELECT '+@values+' FROM dbo.SEOrder WHERE FBrNo=@br AND FInterID=@id; IF @@ROWCOUNT<>1 RAISERROR(''Source header archive failed'',16,1);';
EXEC sys.sp_executesql @sql,N'@id int,@arc int,@br nvarchar(20)',@id=@remote,@arc=@archive,@br=@branch;
SELECT @cols=STUFF((SELECT ','+QUOTENAME(name) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SEOrderEntry') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,''),@values=STUFF((SELECT ','+CASE name WHEN 'FInterID' THEN '@arc' ELSE QUOTENAME(name) END FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SEOrderEntry') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
SET @sql=N'INSERT dbo.SEOrderEntry('+@cols+') SELECT '+@values+' FROM dbo.SEOrderEntry WHERE FBrNO=@br AND FInterID=@id; IF @@ROWCOUNT<>@count RAISERROR(''Source line archive failed'',16,1);';
DECLARE @prior_count int=(SELECT COUNT(*) FROM @previous);
EXEC sys.sp_executesql @sql,N'@id int,@arc int,@br nvarchar(20),@count int',@id=@remote,@arc=@archive,@br=@branch,@count=@prior_count;
DECLARE @changes TABLE (entry_id int NOT NULL,item_id int NOT NULL,kind nvarchar(10) NOT NULL,field nvarchar(30) NOT NULL,before_value nvarchar(100) NOT NULL,after_value nvarchar(100) NOT NULL);
INSERT @changes SELECT target.FEntryID,target.FItemID,N'修改',N'数量',CONVERT(nvarchar(100),old.quantity),CONVERT(nvarchar(100),target.FQty) FROM @lines target JOIN @previous old ON old.entry_id=target.FEntryID WHERE target.FQty<>old.quantity;
INSERT @changes SELECT target.FEntryID,target.FItemID,N'修改',N'含税单价',CONVERT(nvarchar(100),old.inclusive),CONVERT(nvarchar(100),target.FAuxTaxPrice) FROM @lines target JOIN @previous old ON old.entry_id=target.FEntryID WHERE target.FAuxTaxPrice<>old.inclusive;
INSERT @changes SELECT target.FEntryID,target.FItemID,N'修改',N'未税单价',CONVERT(nvarchar(100),old.exclusive),CONVERT(nvarchar(100),target.FAuxPrice) FROM @lines target JOIN @previous old ON old.entry_id=target.FEntryID WHERE target.FAuxPrice<>old.exclusive;
INSERT @changes SELECT target.FEntryID,target.FItemID,N'修改',N'税率',CONVERT(nvarchar(100),old.tax_rate),CONVERT(nvarchar(100),target.FCESS) FROM @lines target JOIN @previous old ON old.entry_id=target.FEntryID WHERE target.FCESS<>old.tax_rate;
INSERT @changes SELECT target.FEntryID,target.FItemID,N'新增',N'明细','',CONVERT(nvarchar(100),target.FQty) FROM @lines target WHERE NOT EXISTS(SELECT 1 FROM @previous old WHERE old.entry_id=target.FEntryID);
INSERT @changes SELECT old.entry_id,old.item_id,N'删除',N'明细',CONVERT(nvarchar(100),old.quantity),'' FROM @previous old WHERE NOT EXISTS(SELECT 1 FROM @lines target WHERE target.FEntryID=old.entry_id);
IF NOT EXISTS(SELECT 1 FROM @changes) ${fail('Source financial values differ without a supported commercial change')}
UPDATE actual SET ${amounts.map((name) => `${q(name)}=target.${q(name)}`).join(',')},FAuxStockAwaitQty=CASE WHEN target.FQty<>actual.FQty THEN target.FQty-ISNULL(actual.FStockQty,0) ELSE actual.FAuxStockAwaitQty END FROM dbo.SEOrderEntry actual JOIN @lines target ON target.FEntryID=actual.FEntryID WHERE actual.FBrNO=@branch AND actual.FInterID=@remote;
DELETE actual FROM dbo.SEOrderEntry actual WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND NOT EXISTS(SELECT 1 FROM @lines target WHERE target.FEntryID=actual.FEntryID);
INSERT dbo.SEOrderEntry (FInterID,FBrNO,${columns(itemTypes)},FMrpAutoClosed,FPlanMode) SELECT @remote,@branch,${columns(itemTypes)},1,14036 FROM @lines target WHERE NOT EXISTS(SELECT 1 FROM @previous old WHERE old.entry_id=target.FEntryID);
UPDATE dbo.SEOrder SET FVersionNo=@new_version,FChangeDate=GETDATE(),FChangeUser=CAST(@biller AS int) WHERE FBrNo=@branch AND FInterID=@remote AND FVersionNo=@source_version;
IF @@ROWCOUNT<>1 ${fail('Source version update failed')}
DECLARE @log_limits TABLE (name sysname NOT NULL PRIMARY KEY,capacity int NOT NULL);
INSERT @log_limits SELECT c.name,CASE WHEN c.max_length=-1 THEN 2147483647 ELSE c.max_length/2 END FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('dbo.ICOrderAlter') AND t.name IN ('nvarchar','nchar','varchar','char');
INSERT dbo.ICOrderAlter (FInterID,FBillType,FTableName,FVersionNo,FChangeDate,FChangeUser,FChangeType,FoldNo,FNumbers,FitemName,Fmodel,FChangeField,FBChangeValue,FEChangeValue,FChangeCauses,FPage)
SELECT @remote,81,'SEOrderEntry',@new_version,GETDATE(),${logText('@user', 'FChangeUser')},${logText('changes.kind', 'FChangeType')},${logText('changes.entry_id', 'FoldNo')},${logText('item.FNumber', 'FNumbers')},${logText('item.FName', 'FitemName')},${logText("ISNULL(detail.FModel,'')", 'Fmodel')},${logText('changes.field', 'FChangeField')},${logText('changes.before_value', 'FBChangeValue')},${logText('changes.after_value', 'FEChangeValue')},@change_cause,0 FROM @changes changes JOIN dbo.t_Item item ON item.FItemID=changes.item_id LEFT JOIN dbo.t_ICItem detail ON detail.FItemID=changes.item_id;
IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @changes) ${fail('Source change log is incomplete')}
IF (SELECT COUNT(*) FROM dbo.SEOrderEntry WHERE FBrNO=@branch AND FInterID=@remote)<>(SELECT COUNT(*) FROM @lines) OR EXISTS(SELECT 1 FROM @lines expected WHERE NOT EXISTS(SELECT 1 FROM dbo.SEOrderEntry actual WHERE actual.FBrNO=@branch AND actual.FInterID=@remote AND ${targetMatches})) ${fail('Source amendment did not preserve the full target contract')}
SELECT CONVERT(varchar(32),@remote) AS remote,@fingerprint AS hash;`;

export function amendmentFingerprint(payload: OrderPayload, batch: SourceOrderBatch) {
	return JSON.stringify({
		key: `${payload.order_id}:${payload.agreement_hash}`,
		previous: payload.previous,
		header: batch.header,
		items: batch.items
	});
}
