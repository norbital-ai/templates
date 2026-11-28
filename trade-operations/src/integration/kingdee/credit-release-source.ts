import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, InstanceId, Json, PlainDate, SyncCtx } from '@norbital-ai/bolt';
import {
	computeCreditExposure,
	evaluateCreditBlock,
	hashBillLines,
	ORG_CREDIT_PLAN,
	parseKingdeeReleaseLog,
	planCreditFormula,
	reconcileCreditRelease,
	type BillCreditObservation,
	type CreditBlockReason,
	type OpenCreditRelease,
	type ParsedReleaseLog
} from '../../lib/credit-release.js';
import { fixedDecimal } from '../../lib/purchase-listing.js';

type SourceReleaseStatus =
	'blocked' | 'released' | 'cleared' | 'superseded' | 'withdrawn' | 'bypassed';
import {
	kingdeeCreditAccount,
	kingdeeCreditPolicyOf,
	kingdeeOrgCreditPolicy
} from './configuration.js';
import { checked } from './order-source.js';
import {
	columns,
	Instant,
	PlainDate as decodePlainDate,
	query,
	SourceRowInvalid,
	SourceUnavailable,
	type DatabaseContext
} from './polling.js';
import { requireReadAccount } from './sql.js';
import {
	populateExposureSql,
	populateOverdueItemsSql,
	READ_CREDIT_ENABLED_SQL
} from './credit-sql.js';
import { restoreTempCreditBump } from './credit-limit-write.js';

const doLinesJsonSql = `JSON_QUERY(COALESCE((
     SELECT e.FEntryID AS entry_id,
      CONVERT(varchar(20),e.FItemID) AS item_id,
      CONVERT(varchar(100),e.FQty) AS quantity,
      CONVERT(varchar(100),e.FConsignAmount) AS amount,
      CONVERT(varchar(20),e.FSourceTranType) AS source_type,
      CONVERT(varchar(20),e.FSourceInterId) AS source_fid,
      LTRIM(RTRIM(ISNULL(st.FName,''))) AS settle_name
     FROM dbo.ICStockBillEntry e
     LEFT JOIN dbo.SEOrder o ON e.FSourceTranType=81 AND o.FInterID=e.FSourceInterId
     LEFT JOIN dbo.t_Settle st ON st.FItemID=o.FSettleID
     WHERE e.FInterID=b.FInterID
     ORDER BY e.FEntryID
     FOR JSON PATH, INCLUDE_NULL_VALUES
    ),'[]')) AS lines`;

const nativeReleaseCustomers = `SELECT DISTINCT c.FItemID
 FROM dbo.ICCreditObject c
 WHERE EXISTS (
  SELECT 1 FROM dbo.ICStockBill udo
  WHERE udo.FTranType=21 AND udo.FStatus=0 AND udo.FCancellation=0 AND udo.FROB<>-1
   AND udo.FSupplyID=c.FItemID
 )`;

const orgReleaseCustomers = `SELECT DISTINCT o.FItemID
 FROM dbo.t_Organization o
 WHERE o.FIsCreditMgr<>0 AND o.FDeleted=0
  AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
  AND (
   EXISTS (
    SELECT 1 FROM dbo.ICStockBill udo
    WHERE udo.FTranType=21 AND udo.FStatus=0 AND udo.FCancellation=0 AND udo.FROB<>-1
     AND udo.FSupplyID=o.FItemID
   )
   OR EXISTS (
    SELECT 1 FROM dbo.ICStockBill wdo
    WHERE wdo.FTranType=21 AND wdo.FSupplyID=o.FItemID
     AND wdo.FInterID IN (SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n))
   )
   OR (@last_fid<>'' AND EXISTS (
    SELECT 1 FROM dbo.ICStockBill ado
    WHERE ado.FTranType=21 AND ado.FStatus<>0 AND ado.FCancellation=0 AND ado.FROB<>-1
     AND ado.FInterID>CONVERT(int,@last_fid) AND ado.FSupplyID=o.FItemID
   ))
  )`;

// Snapshot of KIS sales-out credit policy, active unaudited DOs (limited customers), their customers' exposure,
// and the watched open delivery IDs. Zero customer exposure aggregates run when no unaudited DOs exist.
const creditReleaseSnapshot = `${requireReadAccount}
${READ_CREDIT_ENABLED_SQL}
${populateExposureSql(nativeReleaseCustomers)}
${populateOverdueItemsSql(nativeReleaseCustomers)}
DECLARE @data nvarchar(max) = (
 SELECT
  CONVERT(varchar(10),GETDATE(),23) AS today,
  @credit_enabled AS credit_enabled,
  JSON_QUERY(COALESCE((
   SELECT TOP (2) LTRIM(RTRIM(CONVERT(varchar(1000),FMainAmtCustom))) AS mask,
    LTRIM(RTRIM(CONVERT(varchar(1000),FRangeCustom))) AS control_range,
    FCreditControl AS control
   FROM dbo.ICCreditOption WHERE FGroupID=2
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS options,
  JSON_QUERY(COALESCE((
   SELECT TOP (65) FBitMask AS bit,
    LTRIM(RTRIM(FCaption)) AS caption,
    LTRIM(RTRIM(FOperator)) AS operator
   FROM dbo.ICCreditField WHERE FPreFixPara='0'
   ORDER BY FBitMask,FCaption
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS fields,
  JSON_QUERY(COALESCE((
   SELECT TOP (501)
    CONVERT(varchar(20),b.FInterID) AS fid,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    CONVERT(varchar(10),b.FDate,23) AS bill_on,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
    ${doLinesJsonSql}
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FStatus=0 AND b.FCancellation=0 AND b.FROB<>-1
    AND EXISTS (SELECT 1 FROM dbo.ICCreditObject c WHERE c.FItemID=b.FSupplyID)
   ORDER BY b.FInterID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS unaudited,
  JSON_QUERY(COALESCE((
   SELECT TOP (1001)
    CONVERT(varchar(20),c.FItemID) AS customer_id,
    CASE WHEN u.FDeleted=0 AND u.FNumber IN ('CNY','RMB') THEN 'CNY' ELSE LTRIM(RTRIM(ISNULL(u.FNumber,''))) END AS currency,
    CONVERT(varchar(100),c.FAmount) AS credit_limit,
    ISNULL(c.FCreditDays,0) AS credit_days,
    CONVERT(varchar(100),ISNULL(x.invoices_audited,0)) AS invoices_audited,
    CONVERT(varchar(100),ISNULL(x.invoices_paid,0)) AS invoices_paid,
    CONVERT(varchar(100),ISNULL(x.refunds_unsettled,0)) AS refunds_unsettled,
    CONVERT(varchar(100),ISNULL(x.receipts_unsettled,0)) AS receipts_unsettled,
    CONVERT(varchar(100),ISNULL(x.advances_unsettled,0)) AS advances_unsettled,
    CONVERT(varchar(100),ISNULL(x.stock_out_audited,0)) AS stock_out_audited,
    CONVERT(varchar(100),ISNULL(x.stock_out_hooked,0)) AS stock_out_hooked,
    COALESCE((SELECT SUM(CASE WHEN v.invalid_term=1 THEN 1 ELSE 0 END) FROM @ovItems v WHERE v.customer_id=c.FItemID),0) AS invalid_terms,
    JSON_QUERY(COALESCE((
     SELECT TOP (100) v.bill_no,
      v.basis_date,
      CONVERT(varchar(100),v.amount) AS amount
     FROM @ovItems v
     WHERE v.customer_id=c.FItemID AND v.basis_date IS NOT NULL
      AND DATEDIFF(day,CONVERT(date,v.basis_date),GETDATE())>ISNULL(c.FCreditDays,0)
     ORDER BY v.basis_date,v.bill_no
     FOR JSON PATH, INCLUDE_NULL_VALUES
    ),'[]')) AS overdue_invoices
   FROM dbo.ICCreditObject c
   LEFT JOIN dbo.t_Currency u ON u.FCurrencyID=c.FCurrencyID
   LEFT JOIN @exp x ON x.customer_id=c.FItemID
   WHERE EXISTS (
    SELECT 1 FROM dbo.ICStockBill udo
    WHERE udo.FTranType=21 AND udo.FStatus=0 AND udo.FCancellation=0 AND udo.FROB<>-1
     AND udo.FSupplyID=c.FItemID
   )
   ORDER BY c.FItemID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS customers,
  JSON_QUERY(COALESCE((
   SELECT
    CONVERT(varchar(20),b.FInterID) AS fid,
    b.FStatus AS status,
    b.FCancellation AS cancelled,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    CONVERT(varchar(10),b.FDate,23) AS bill_on,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
    ${doLinesJsonSql}
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FInterID IN (
    SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n)
   )
   ORDER BY b.FInterID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS watched
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
);
SET @data=COALESCE(@data,N'{}');
DECLARE @fingerprint varchar(64) = CONVERT(varchar(64),HASHBYTES('SHA2_256',@data),2);
SELECT @fingerprint AS fingerprint,
 CONVERT(bit,CASE WHEN DATALENGTH(@data)>1000000 THEN 1 ELSE 0 END) AS oversized,
 CASE WHEN DATALENGTH(@data)<=1000000 AND @fingerprint<>@prior THEN @data END AS entries,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at; /* kingdee-credit-release */`;

// Snapshot of KIS customer-master credit (t_Organization.FIsCreditMgr / FCreditLimit), unaudited blue DOs
// for credit-managed customers, their exposure (including watched DOs for post-audit bypass checks), and watched DOs.
const orgCreditReleaseSnapshot = `${requireReadAccount}
${populateExposureSql(orgReleaseCustomers, { paramDecl: '@ids xml,@last_fid varchar(20)', paramPass: '@ids=@ids,@last_fid=@last_fid' })}
DECLARE @data nvarchar(max) = (
 SELECT
  CONVERT(varchar(10),GETDATE(),23) AS today,
  JSON_QUERY('[]') AS options,
  JSON_QUERY('[]') AS fields,
  JSON_QUERY(COALESCE((
   SELECT TOP (501)
    CONVERT(varchar(20),b.FInterID) AS fid,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    CONVERT(varchar(10),b.FDate,23) AS bill_on,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
    ${doLinesJsonSql}
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FStatus=0 AND b.FCancellation=0 AND b.FROB<>-1
    AND EXISTS (
     SELECT 1 FROM dbo.t_Organization o
     WHERE o.FItemID=b.FSupplyID AND o.FIsCreditMgr<>0 AND o.FDeleted=0
      AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
    )
   ORDER BY b.FInterID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS unaudited,
  JSON_QUERY(COALESCE((
   SELECT TOP (2001)
    CONVERT(varchar(20),o.FItemID) AS customer_id,
    'CNY' AS currency,
    REPLACE(LTRIM(RTRIM(o.FCreditLimit)),',','') AS credit_limit,
    0 AS credit_days,
    CONVERT(varchar(100),ISNULL(x.invoices_audited,0)) AS invoices_audited,
    CONVERT(varchar(100),ISNULL(x.invoices_paid,0)) AS invoices_paid,
    CONVERT(varchar(100),ISNULL(x.refunds_unsettled,0)) AS refunds_unsettled,
    CONVERT(varchar(100),ISNULL(x.receipts_unsettled,0)) AS receipts_unsettled,
    CONVERT(varchar(100),ISNULL(x.advances_unsettled,0)) AS advances_unsettled,
    CONVERT(varchar(100),ISNULL(x.stock_out_audited,0)) AS stock_out_audited,
    CONVERT(varchar(100),ISNULL(x.stock_out_hooked,0)) AS stock_out_hooked,
    0 AS invalid_terms,
    JSON_QUERY('[]') AS overdue_invoices
   FROM dbo.t_Organization o
   LEFT JOIN @exp x ON x.customer_id=o.FItemID
   WHERE o.FIsCreditMgr<>0 AND o.FDeleted=0
    AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
    AND (
     EXISTS (
      SELECT 1 FROM dbo.ICStockBill udo
      WHERE udo.FTranType=21 AND udo.FStatus=0 AND udo.FCancellation=0 AND udo.FROB<>-1
       AND udo.FSupplyID=o.FItemID
     )
     OR EXISTS (
      SELECT 1 FROM dbo.ICStockBill wdo
      WHERE wdo.FTranType=21 AND wdo.FSupplyID=o.FItemID
       AND wdo.FInterID IN (SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n))
     )
     OR (@last_fid<>'' AND EXISTS (
      SELECT 1 FROM dbo.ICStockBill ado
      WHERE ado.FTranType=21 AND ado.FStatus<>0 AND ado.FCancellation=0 AND ado.FROB<>-1
       AND ado.FInterID>CONVERT(int,@last_fid) AND ado.FSupplyID=o.FItemID
     ))
    )
   ORDER BY o.FItemID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS customers,
  JSON_QUERY(COALESCE((
   SELECT
    CONVERT(varchar(20),b.FInterID) AS fid,
    b.FStatus AS status,
    b.FCancellation AS cancelled,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    CONVERT(varchar(10),b.FDate,23) AS bill_on,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
    ${doLinesJsonSql}
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FInterID IN (
    SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n)
   )
   ORDER BY b.FInterID
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS watched,
  JSON_QUERY(COALESCE((
   SELECT TOP (501)
    CONVERT(varchar(20),b.FInterID) AS fid,
    b.FStatus AS status,
    b.FCancellation AS cancelled,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    CONVERT(varchar(10),b.FDate,23) AS bill_on,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
    ${doLinesJsonSql}
   FROM dbo.ICStockBill b
   WHERE @last_fid<>'' AND b.FTranType=21 AND b.FStatus<>0 AND b.FCancellation=0 AND b.FROB<>-1
    AND b.FInterID>CONVERT(int,@last_fid)
    AND EXISTS (
     SELECT 1 FROM dbo.t_Organization o
     WHERE o.FItemID=b.FSupplyID AND o.FIsCreditMgr<>0 AND o.FDeleted=0
      AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
    )
   ORDER BY b.FInterID ASC
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS recent_audited
 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
);
SET @data=COALESCE(@data,N'{}');
DECLARE @fingerprint varchar(64) = CONVERT(varchar(64),HASHBYTES('SHA2_256',@data),2);
SELECT @fingerprint AS fingerprint,
 CONVERT(bit,CASE WHEN DATALENGTH(@data)>1000000 THEN 1 ELSE 0 END) AS oversized,
 CASE WHEN DATALENGTH(@data)<=1000000 AND @fingerprint<>@prior THEN @data END AS entries,
 CONVERT(varchar(20),COALESCE((SELECT MAX(FInterID) FROM dbo.ICStockBill WHERE FTranType=21 AND FStatus<>0),0)) AS max_do_fid,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at; /* kingdee-org-credit-release */`;

// Incremental t_Log read: clustered PK seek on FLogID > @last_log_id; first poll reads last 7 days only.
const initialReleaseLogSql = `${requireReadAccount}
SELECT CONVERT(varchar(30),COALESCE((SELECT MAX(FLogID) FROM dbo.t_Log),0)) AS max_log_id,
 JSON_QUERY(COALESCE((
  SELECT TOP (200) CONVERT(varchar(30),l.FLogID) AS log_id,
   CONVERT(varchar(33),l.FDate,126)+'Z' AS logged_at,
   LTRIM(RTRIM(ISNULL(l.FDescription,''))) AS description
  FROM dbo.t_Log l
  WHERE l.FFunctionID='XS100016' AND l.FDate>=DATEADD(day,-7,GETDATE())
  ORDER BY l.FLogID DESC
  FOR JSON PATH, INCLUDE_NULL_VALUES
 ),'[]')) AS entries; /* kingdee-credit-release-log-init */`;

const incrementalReleaseLogSql = `${requireReadAccount}
SELECT CONVERT(varchar(30),COALESCE((SELECT MAX(FLogID) FROM dbo.t_Log),0)) AS max_log_id,
 JSON_QUERY(COALESCE((
  SELECT TOP (201) CONVERT(varchar(30),l.FLogID) AS log_id,
   CONVERT(varchar(33),l.FDate,126)+'Z' AS logged_at,
   LTRIM(RTRIM(ISNULL(l.FDescription,''))) AS description
  FROM dbo.t_Log l
  WHERE l.FLogID>CONVERT(bigint,@last_log_id) AND l.FFunctionID='XS100016'
  ORDER BY l.FLogID ASC
  FOR JSON PATH, INCLUDE_NULL_VALUES
 ),'[]')) AS entries; /* kingdee-credit-release-log-inc */`;

// Only called when a new XS100016 release names a bill not already in the watched set.
const releaseBillsByNoSql = `${requireReadAccount}
SELECT JSON_QUERY(COALESCE((
 SELECT
  CONVERT(varchar(20),b.FInterID) AS fid,
  b.FStatus AS status,
  b.FCancellation AS cancelled,
  LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
  CONVERT(varchar(10),b.FDate,23) AS bill_on,
  CONVERT(varchar(20),b.FSupplyID) AS customer_id,
  CONVERT(varchar(18),CONVERT(binary(8),b.FOperDate),1) AS oper_date,
  ${doLinesJsonSql}
 FROM dbo.ICStockBill b
 WHERE b.FTranType=21 AND b.FBillNo IN (
  SELECT n.value('.','nvarchar(60)') FROM @ids.nodes('/ids/id') AS bn(n)
 )
 ORDER BY b.FInterID
 FOR JSON PATH, INCLUDE_NULL_VALUES
),'[]')) AS bills; /* kingdee-credit-release-bills */`;

const testReleaseLogSql = `${requireReadAccount}
SELECT TOP (0) FLogID,FFunctionID,FDate,FDescription FROM dbo.t_Log; /* kingdee-credit-release-test */`;

const precise = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/));
const integer = Schema.Number.check(Schema.isInt());
const positiveId = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/));
const hexRv = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{16}$/));

const BillLineSchema = Schema.Struct({
	entry_id: integer,
	item_id: Schema.String,
	quantity: precise,
	amount: precise,
	source_type: Schema.NullOr(Schema.String),
	source_fid: Schema.NullOr(Schema.String),
	settle_name: Schema.NullOr(Schema.String)
});

const UnauditedBillSchema = Schema.Struct({
	fid: positiveId,
	bill_no: Schema.String,
	bill_on: Schema.NullOr(Schema.String),
	customer_id: positiveId,
	oper_date: hexRv,
	lines: Schema.Array(BillLineSchema)
});

const WatchedBillSchema = Schema.Struct({
	fid: positiveId,
	status: integer,
	cancelled: Schema.Union([Schema.Boolean, integer]),
	bill_no: Schema.String,
	bill_on: Schema.NullOr(Schema.String),
	customer_id: positiveId,
	oper_date: hexRv,
	lines: Schema.Array(BillLineSchema)
});

const CustomerExposureSchema = Schema.Struct({
	customer_id: positiveId,
	currency: Schema.String,
	credit_limit: Schema.String,
	credit_days: integer,
	invoices_audited: precise,
	invoices_paid: precise,
	refunds_unsettled: precise,
	receipts_unsettled: precise,
	advances_unsettled: precise,
	stock_out_audited: precise,
	stock_out_hooked: precise,
	invalid_terms: integer,
	overdue_invoices: Schema.Array(
		Schema.Struct({
			bill_no: Schema.String,
			basis_date: Schema.String,
			amount: precise
		})
	)
});

const SnapshotPayload = Schema.fromJsonString(
	Schema.Struct({
		today: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
		credit_enabled: Schema.optionalKey(Schema.NullOr(Schema.String)),
		options: Schema.Array(
			Schema.Struct({ mask: Schema.String, control_range: Schema.String, control: integer })
		),
		fields: Schema.Array(
			Schema.Struct({ bit: integer, caption: Schema.String, operator: Schema.String })
		),
		unaudited: Schema.Array(UnauditedBillSchema),
		customers: Schema.Array(CustomerExposureSchema),
		watched: Schema.Array(WatchedBillSchema),
		recent_audited: Schema.optionalKey(Schema.Array(WatchedBillSchema))
	})
);

const LogEntriesSchema = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			log_id: Schema.String,
			logged_at: Schema.String,
			description: Schema.String
		})
	)
);

const ReleaseBillsSchema = Schema.fromJsonString(Schema.Array(WatchedBillSchema));

const CursorSchema = Schema.Struct({
	account: Schema.String,
	policy: Schema.optionalKey(Schema.String),
	fingerprint: Schema.optionalKey(Schema.String),
	last_log_id: Schema.optionalKey(Schema.String),
	last_org_fid: Schema.optionalKey(Schema.String),
	watched: Schema.optionalKey(Schema.Array(Schema.String)),
	grace_pending: Schema.optionalKey(Schema.Boolean)
});

const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });
const LOG_PAGE_LIMIT = 200;
const LOG_ADVANCE_THRESHOLD = 50_000n;
const ORG_FID_PAGE_LIMIT = 500;
const ORG_FID_ADVANCE_THRESHOLD = 500n;
const PRECISE_RE = /^-?\d+(\.\d+)?$/;

function idsXml(values: readonly string[], shape: RegExp, label: string): string {
	if (!values.length) return '<ids/>';
	return `<ids>${values
		.map((value) => {
			if (!shape.test(value)) throw invalid(label, `Malformed ${label}: ${value}`);
			return `<id>${value}</id>`;
		})
		.join('')}</ids>`;
}

const isFlag = (v: boolean | number) => (typeof v === 'boolean' ? v : v !== 0);

function firstLineLink(lines: readonly Schema.Schema.Type<typeof BillLineSchema>[]) {
	const first = lines[0];
	const fromOrder =
		first && first.source_type === '81' && first.source_fid && /^[1-9]\d*$/.test(first.source_fid)
			? first.source_fid
			: null;
	const settleRaw = first?.settle_name?.trim() || null;
	const settle = settleRaw && settleRaw !== '*' ? settleRaw : null;
	return { sourceSoFid: fromOrder, settlementName: fromOrder ? settle : null };
}

function validBillDate(value: string | null): PlainDate | null {
	if (!value || value.slice(0, 10) <= '1901-01-01') return null;
	return decodePlainDate(value.slice(0, 10));
}

export const testCreditReleaseSource = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string
) {
	yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		max_rows: 1,
		arguments: {
			stmt: testReleaseLogSql,
			params: '@read_account nvarchar(73)',
			read_account: account
		}
	});
});

export const readCreditReleaseSource = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>,
	unchanged: boolean
) {
	const account = kingdeeCreditAccount(ctx.configuration);
	const policy = kingdeeCreditPolicyOf(ctx.configuration.creditPolicy);
	// Dormant unless a verified KIS credit policy is configured on CNY.
	if (policy === null || account === null || ctx.configuration.baseCurrency !== 'CNY')
		return { rows: [], cursor, more: false };
	const isOrgPolicy = policy === kingdeeOrgCreditPolicy;

	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(CursorSchema)(cursor));
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The credit account changed. Review the retained credit releases before resetting.'
		);

	const policyChanged = prior?.policy !== undefined && prior.policy !== policy;
	const watchedFids = prior?.watched ?? [];
	const priorLastOrgFid = isOrgPolicy && !policyChanged ? (prior?.last_org_fid ?? null) : null;
	const priorFingerprint = prior?.grace_pending || policyChanged ? '' : (prior?.fingerprint ?? '');
	const [snapRow] = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		max_rows: 1,
		arguments: isOrgPolicy
			? {
					stmt: orgCreditReleaseSnapshot,
					params: '@read_account nvarchar(73),@prior varchar(64),@ids xml,@last_fid varchar(20)',
					read_account: account,
					prior: priorFingerprint,
					ids: yield* checked(() => idsXml(watchedFids, /^[1-9]\d*$/, 'watched_fid')),
					last_fid: priorLastOrgFid ?? ''
				}
			: {
					stmt: creditReleaseSnapshot,
					params: '@read_account nvarchar(73),@prior varchar(64),@ids xml',
					read_account: account,
					prior: priorFingerprint,
					ids: yield* checked(() => idsXml(watchedFids, /^[1-9]\d*$/, 'watched_fid'))
				}
	});
	const snapshot = yield* checked(() => {
		if (!snapRow) throw invalid('$result', 'Missing credit release snapshot checkpoint');
		const r = columns(snapRow);
		if (r.bool('oversized'))
			throw invalid('$result', 'Credit release snapshot exceeds its 1 MB transfer bound');
		const fingerprint = r.text('fingerprint');
		if (!/^[0-9A-F]{64}$/.test(fingerprint))
			throw invalid('fingerprint', 'Invalid credit release snapshot fingerprint');
		const entries = r.text('entries', null);
		if (entries === null && fingerprint !== priorFingerprint)
			throw invalid('$result', 'Incomplete credit release snapshot checkpoint');
		const maxDoFid = isOrgPolicy ? r.text('max_do_fid', '0') : null;
		if (maxDoFid !== null && !/^\d+$/.test(maxDoFid))
			throw invalid('max_do_fid', 'Invalid ICStockBill max FInterID');
		return { fingerprint, entries, maxDoFid, observedAt: Instant(r.text('observed_at')) };
	});

	// Query 2 (sales-out policy only): incremental clustered-PK seek on t_Log (FLogID > @last_log_id) for XS100016 releases.
	const priorLogId = isOrgPolicy || policyChanged ? null : (prior?.last_log_id ?? null);
	let logResult: {
		readonly nextLogId: string | null;
		readonly releases: readonly ParsedReleaseLog[];
		readonly unparsedLogs: readonly string[];
		readonly more: boolean;
		readonly logGap: boolean;
	};
	if (isOrgPolicy) {
		logResult = {
			nextLogId: null,
			releases: [],
			unparsedLogs: [],
			more: false,
			logGap: false
		};
	} else {
		const [logRow] = yield* query(ctx, {
			op: 'call',
			procedure: { schema: 'sys', name: 'sp_executesql' },
			max_rows: 1,
			arguments: {
				stmt: priorLogId ? incrementalReleaseLogSql : initialReleaseLogSql,
				params: priorLogId
					? '@read_account nvarchar(73),@last_log_id varchar(30)'
					: '@read_account nvarchar(73)',
				read_account: account,
				...(priorLogId ? { last_log_id: priorLogId } : {})
			}
		});
		logResult = yield* checked(() => {
			if (!logRow) throw invalid('$result', 'Missing t_Log checkpoint');
			const r = columns(logRow);
			const maxLogId = r.text('max_log_id');
			if (!/^\d+$/.test(maxLogId)) throw invalid('max_log_id', 'Invalid t_Log max FLogID');
			const rawEntries = Schema.decodeUnknownSync(LogEntriesSchema)(r.text('entries'));
			const paged = priorLogId !== null && rawEntries.length > LOG_PAGE_LIMIT;
			const pageEntries = paged ? rawEntries.slice(0, LOG_PAGE_LIMIT) : rawEntries;
			const releases: ParsedReleaseLog[] = [];
			const unparsedLogs: string[] = [];
			for (const item of pageEntries) {
				const parsed = parseKingdeeReleaseLog(item);
				if (parsed) {
					releases.push(parsed);
				} else if (item.description.includes('销售出库') && item.description.includes('信用')) {
					unparsedLogs.push(`Unparseable Kingdee XS100016 release log #${item.log_id}.`);
				}
			}
			const nextLogId = paged ? (pageEntries.at(-1)?.log_id ?? maxLogId) : maxLogId;
			const logGap =
				priorLogId === null
					? true
					: BigInt(nextLogId) - BigInt(priorLogId) >= LOG_ADVANCE_THRESHOLD;
			return { nextLogId, releases, unparsedLogs, more: paged, logGap };
		});
	}

	const orgFidGap =
		isOrgPolicy &&
		(priorLastOrgFid === null ||
			(snapshot.maxDoFid !== null &&
				BigInt(snapshot.maxDoFid) - BigInt(priorLastOrgFid) >= ORG_FID_ADVANCE_THRESHOLD));

	// Keep the workspace asleep on quiet ticks: advance watermarks only on real writes or large gaps.
	if (
		snapshot.entries === null &&
		logResult.releases.length === 0 &&
		logResult.unparsedLogs.length === 0 &&
		!logResult.more &&
		unchanged &&
		!logResult.logGap &&
		!orgFidGap &&
		!policyChanged
	)
		return { rows: [], cursor, more: false };

	// If nothing changed in the snapshot and no new XS100016 lines arrived, only advance watermarks if needed.
	if (
		snapshot.entries === null &&
		logResult.releases.length === 0 &&
		logResult.unparsedLogs.length === 0 &&
		!logResult.more
	) {
		return {
			rows: [],
			cursor: {
				account,
				policy,
				fingerprint: snapshot.fingerprint,
				...(logResult.nextLogId !== null ? { last_log_id: logResult.nextLogId } : {}),
				...(snapshot.maxDoFid !== null ? { last_org_fid: snapshot.maxDoFid } : {}),
				...(watchedFids.length ? { watched: watchedFids } : {})
			},
			more: false,
			health: { state: 'ready' as const }
		};
	}

	const snapshotEntries = snapshot.entries;
	const page =
		snapshotEntries !== null
			? yield* checked(() => Schema.decodeUnknownSync(SnapshotPayload)(snapshotEntries))
			: null;

	const issues: string[] = [...logResult.unparsedLogs];
	if (page) {
		if (!isOrgPolicy && page.credit_enabled === '0' && page.customers.length === 0)
			issues.push(
				'Kingdee KIS credit management (IC/CreditEnable) is disabled (0) and ICCreditObject has no customer limits.'
			);
		if (page.unaudited.length > 500)
			issues.push('Unaudited delivery orders exceed the 500-bill credit detection bound.');
		const customerBound = isOrgPolicy ? 2000 : 1000;
		if (page.customers.length > customerBound)
			issues.push(`Credit-managed customers exceed the ${customerBound}-customer detection bound.`);
	}
	const rawRecentAudited = isOrgPolicy ? (page?.recent_audited ?? []) : [];
	const orgRecentPaged = rawRecentAudited.length > ORG_FID_PAGE_LIMIT;
	const recentAudited = orgRecentPaged
		? rawRecentAudited.slice(0, ORG_FID_PAGE_LIMIT)
		: rawRecentAudited;
	const nextOrgFid = isOrgPolicy
		? orgRecentPaged
			? (recentAudited.at(-1)?.fid ?? snapshot.maxDoFid)
			: snapshot.maxDoFid
		: null;

	// Newest XS100016 release per bill number.
	const newestReleaseByBillNo = new Map<string, ParsedReleaseLog>();
	for (const rel of logResult.releases) {
		const prev = newestReleaseByBillNo.get(rel.billNo);
		if (!prev || BigInt(rel.logId) > BigInt(prev.logId)) newestReleaseByBillNo.set(rel.billNo, rel);
	}

	// Read workspace state: query open/active-bump rows separately from recent closed rows so historical volume
	// never truncates open releases or pending temporary bumps.
	const directWriteCreditLimit = ctx.configuration.directWriteCreditLimit === true;
	const releaseFields = [
		'external_code',
		'delivery_fid',
		'bill_number',
		'party',
		'route',
		'source_status',
		'approval_status',
		'bill_amount',
		'credit_limit',
		'credit_days',
		'credit_used',
		'over_limit',
		'overdue_days',
		'oldest_overdue_bill',
		'block_reasons',
		'temp_bump_amount',
		'temp_bump_days',
		'temp_bump_status',
		'source_oper_date',
		'content_hash',
		'approved_content_hash',
		'audit_seen_at',
		'release_log_key',
		'order',
		'delivery',
		'settlement_name'
	] as const;
	const { credit_releases: openAndActiveReleases, sys_integration: ledgers } = yield* ctx.query({
		credit_releases: {
			where: {
				source: { eq: instance },
				or: [{ source_status: { eq: 'blocked' } }, { temp_bump_status: { eq: 'active' } }]
			},
			fields: releaseFields,
			limit: 5000
		},
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
	});
	const { credit_releases: recentReleases } = yield* ctx.query({
		credit_releases: {
			where: { source: { eq: instance } },
			fields: ['external_code', 'delivery_fid', 'source_status', 'release_log_key'],
			order_by: { observed_at: 'desc' },
			limit: 5000
		}
	});
	if (
		ledgers.rows.some(
			(row) => row.id !== instance && kingdeeCreditAccount(row.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable account-wide credit on one ledger per account set'
		});

	const seenReleaseLogKeys = new Set([
		...openAndActiveReleases.rows.flatMap((row) =>
			row.release_log_key ? [row.release_log_key] : []
		),
		...recentReleases.rows.flatMap((row) => (row.release_log_key ? [row.release_log_key] : []))
	]);
	const closedReleaseFids = new Set([
		...openAndActiveReleases.rows
			.filter((row) => row.source_status === 'released' || row.source_status === 'bypassed')
			.map((row) => row.delivery_fid),
		...recentReleases.rows
			.filter((row) => row.source_status === 'released' || row.source_status === 'bypassed')
			.map((row) => row.delivery_fid)
	]);
	const allExistingKeys = new Set([
		...openAndActiveReleases.rows.map((row) => row.external_code),
		...recentReleases.rows.map((row) => row.external_code)
	]);
	const openByFid = new Map<string, OpenCreditRelease<Id<'orders'>, Id<'transactions'>>>();
	const openMetaByFid = new Map<
		string,
		{
			readonly party: Id<'parties'>;
			readonly temp_bump_amount: string | null;
			readonly temp_bump_days: number | null;
			readonly temp_bump_status: 'none' | 'active' | 'restored';
			readonly tempBumpEnabled: boolean;
		}
	>();
	const deferredClosedBumpsByParty = new Map<
		Id<'parties'>,
		{
			readonly external_code: string;
			readonly credit_limit: string | null;
			readonly credit_days: number | null;
			readonly temp_bump_amount: string | null;
			readonly temp_bump_days: number | null;
		}[]
	>();
	for (const row of openAndActiveReleases.rows) {
		if (row.source_status === 'blocked') {
			const tempBumpEnabled =
				!isOrgPolicy &&
				directWriteCreditLimit &&
				row.approval_status === 'approved' &&
				row.route === 'one_time' &&
				row.temp_bump_status !== 'restored' &&
				(row.temp_bump_amount != null || row.temp_bump_days != null);
			openByFid.set(row.delivery_fid, {
				external_code: row.external_code,
				delivery_fid: row.delivery_fid,
				status: row.approval_status === 'approved' ? 'approved' : 'blocked',
				bill_amount: row.bill_amount,
				credit_limit: row.credit_limit,
				credit_days: row.credit_days,
				credit_used: row.credit_used,
				over_limit: row.over_limit,
				overdue_days: row.overdue_days,
				oldest_overdue_bill: row.oldest_overdue_bill,
				block_reasons: row.block_reasons,
				source_oper_date: row.source_oper_date,
				content_hash: row.content_hash,
				approved_content_hash: row.approved_content_hash,
				audit_seen_at: row.audit_seen_at,
				order: row.order,
				delivery: row.delivery,
				settlement_name: row.settlement_name,
				temp_bump_active: tempBumpEnabled
			});
			openMetaByFid.set(row.delivery_fid, {
				party: row.party,
				temp_bump_amount: row.temp_bump_amount,
				temp_bump_days: row.temp_bump_days,
				temp_bump_status: row.temp_bump_status,
				tempBumpEnabled
			});
		} else if (
			!isOrgPolicy &&
			directWriteCreditLimit &&
			row.route === 'one_time' &&
			row.temp_bump_status === 'active'
		) {
			const list = deferredClosedBumpsByParty.get(row.party) ?? [];
			list.push({
				external_code: row.external_code,
				credit_limit: row.credit_limit,
				credit_days: row.credit_days,
				temp_bump_amount: row.temp_bump_amount,
				temp_bump_days: row.temp_bump_days
			});
			deferredClosedBumpsByParty.set(row.party, list);
		}
	}

	// Track the true unbumped baseline limit/days for any customer currently carrying an active one-time temp bump,
	// so a second blocked DO detected while the bump is active never captures the inflated temporary limit as its floor.
	const activeBaselineByParty = new Map<
		Id<'parties'>,
		{ limit: string | null; days: number | null }
	>();
	const recordBaseline = (
		partyId: Id<'parties'>,
		limit: string | null,
		days: number | null | undefined
	) => {
		const cur = activeBaselineByParty.get(partyId) ?? { limit: null, days: null };
		let nextLimit = cur.limit;
		if (limit !== null) {
			if (
				nextLimit === null ||
				BigDecimal.isLessThan(
					BigDecimal.fromStringUnsafe(limit),
					BigDecimal.fromStringUnsafe(nextLimit)
				)
			)
				nextLimit = limit;
		}
		let nextDays = cur.days;
		if (days != null && (nextDays === null || days < nextDays)) nextDays = days;
		activeBaselineByParty.set(partyId, { limit: nextLimit, days: nextDays });
	};
	for (const [fid, meta] of openMetaByFid) {
		if (!meta.tempBumpEnabled) continue;
		const open = openByFid.get(fid);
		if (open) recordBaseline(meta.party, open.credit_limit, open.credit_days);
	}
	for (const [partyId, deferred] of deferredClosedBumpsByParty) {
		for (const item of deferred) recordBaseline(partyId, item.credit_limit, item.credit_days);
	}

	const activeBumpPartyIds = [
		...new Set([
			...[...openMetaByFid.values()].filter((m) => m.tempBumpEnabled).map((m) => m.party),
			...deferredClosedBumpsByParty.keys()
		])
	];
	const partyExternalById = new Map<Id<'parties'>, string>();
	if (activeBumpPartyIds.length > 0) {
		const { parties: bumpParties } = yield* ctx.query({
			parties: {
				where: { id: { in: activeBumpPartyIds } },
				fields: ['external_code'],
				limit: 500
			}
		});
		for (const p of bumpParties.rows) {
			partyExternalById.set(p.id, p.external_code);
		}
	}

	// Fetch bill headers/lines for any unseen XS100016 release whose bill isn't already in page.watched.
	const watchedByFid = new Map((page?.watched ?? []).map((bill) => [bill.fid, bill]));
	const watchedBillNos = new Set((page?.watched ?? []).map((bill) => bill.bill_no));
	const missingReleaseBillNos = [...newestReleaseByBillNo.values()]
		.filter((rel) => !seenReleaseLogKeys.has(rel.logId) && !watchedBillNos.has(rel.billNo))
		.map((rel) => rel.billNo);
	const releaseBillsByNo = new Map<string, Schema.Schema.Type<typeof WatchedBillSchema>[]>();
	if (missingReleaseBillNos.length > 0) {
		const [rbRow] = yield* query(ctx, {
			op: 'call',
			procedure: { schema: 'sys', name: 'sp_executesql' },
			max_rows: 1,
			arguments: {
				stmt: releaseBillsByNoSql,
				params: '@read_account nvarchar(73),@ids xml',
				read_account: account,
				ids: yield* checked(() =>
					idsXml(missingReleaseBillNos, /^[A-Za-z0-9._/-]{1,40}$/, 'bill_no')
				)
			}
		});
		const fetched = yield* checked(() =>
			Schema.decodeUnknownSync(ReleaseBillsSchema)(columns(rbRow ?? {}).text('bills'))
		);
		for (const bill of fetched) {
			const list = releaseBillsByNo.get(bill.bill_no) ?? [];
			list.push(bill);
			releaseBillsByNo.set(bill.bill_no, list);
		}
	}

	// Map releases to their unique delivery FInterID.
	const releaseByFid = new Map<
		string,
		{
			readonly release: ParsedReleaseLog;
			readonly bill: Schema.Schema.Type<typeof WatchedBillSchema>;
		}
	>();
	for (const rel of newestReleaseByBillNo.values()) {
		if (seenReleaseLogKeys.has(rel.logId)) continue;
		const matchingWatched = (page?.watched ?? []).filter((b) => b.bill_no === rel.billNo);
		const candidates = matchingWatched.length
			? matchingWatched
			: (releaseBillsByNo.get(rel.billNo) ?? []);
		if (candidates.length === 1 && candidates[0]) {
			releaseByFid.set(candidates[0].fid, { release: rel, bill: candidates[0] });
		} else {
			issues.push(
				`Kingdee release log for ${rel.billNo} matched ${candidates.length} delivery order(s).`
			);
		}
	}

	// Validate global KIS credit option & formula (refusing detection surfaces attention health without stalling closes).
	const detection = (() => {
		if (!page) return { ok: false as const, reason: null };
		if (isOrgPolicy)
			return {
				ok: true as const,
				today: page.today,
				controlRange: 1,
				plan: ORG_CREDIT_PLAN
			};
		const option = page.options[0];
		if (
			page.options.length !== 1 ||
			!option ||
			option.control !== 2 ||
			!['1', '2', '3'].includes(option.control_range)
		)
			return {
				ok: false as const,
				reason:
					'Kingdee ICCreditOption must have one blocking sales-out rule (FCreditControl=2, FRangeCustom in 1..3).'
			};
		const plan = planCreditFormula(option.mask, page.fields);
		if (!plan.ok) return { ok: false as const, reason: `${plan.column}: ${plan.reason}` };
		return {
			ok: true as const,
			today: page.today,
			controlRange: Number(option.control_range),
			plan: plan.items
		};
	})();
	if (!detection.ok && detection.reason) issues.push(detection.reason);

	// Index customers from snapshot; refuse invalid/non-CNY customers individually without breaking valid CNY ones.
	const customerById = new Map<
		string,
		| { readonly usable: true; readonly row: Schema.Schema.Type<typeof CustomerExposureSchema> }
		| { readonly usable: false; readonly reason: string }
	>();
	if (page) {
		const grouped = Map.groupBy(page.customers, (c) => c.customer_id);
		for (const [cid, list] of grouped) {
			const c = list[0];
			const validLimitText = c !== undefined && PRECISE_RE.test(c.credit_limit);
			const limit = validLimitText ? BigDecimal.fromStringUnsafe(c.credit_limit) : null;
			const invalidTerms =
				detection.ok && (detection.controlRange & 2) !== 0 && (c?.invalid_terms ?? 0) !== 0;
			if (list.length !== 1 || !c) {
				customerById.set(cid, { usable: false, reason: 'duplicate credit profile' });
			} else if (c.currency !== 'CNY') {
				customerById.set(cid, {
					usable: false,
					reason: `non-CNY currency ${c.currency || 'empty'}`
				});
			} else if (!validLimitText || limit === null || BigDecimal.isNegative(limit)) {
				customerById.set(cid, {
					usable: false,
					reason: `invalid credit limit '${c.credit_limit}'`
				});
			} else if (c.credit_days < 0) {
				customerById.set(cid, { usable: false, reason: 'negative credit days' });
			} else if (invalidTerms) {
				customerById.set(cid, { usable: false, reason: 'open invoices have invalid term dates' });
			} else {
				customerById.set(cid, { usable: true, row: c });
			}
		}
	}

	// Gather every customer ID, SO FID, and DO FID we may evaluate, to batch workspace lookups cleanly.
	// When the snapshot payload was unchanged (`page === null`), only evaluate newly observed XS100016 releases
	// and keep other open rows watched without treating them as gone.
	const watchedSet = new Set(watchedFids);
	const unauditedByFid = new Map((page?.unaudited ?? []).map((bill) => [bill.fid, bill]));
	const recentAuditedByFid = new Map(recentAudited.map((bill) => [bill.fid, bill]));
	const allFids = new Set<string>(
		page === null
			? [...releaseByFid.keys()]
			: [
					...openByFid.keys(),
					...unauditedByFid.keys(),
					...recentAuditedByFid.keys(),
					...releaseByFid.keys()
				]
	);
	const customerIds = new Set<string>();
	const deliveryErpIds = new Set<string>();
	for (const fid of allFids) {
		const bill =
			unauditedByFid.get(fid) ??
			watchedByFid.get(fid) ??
			recentAuditedByFid.get(fid) ??
			releaseByFid.get(fid)?.bill;
		if (bill) customerIds.add(bill.customer_id);
		deliveryErpIds.add(`delivery:${fid}`);
	}

	const partyByExternal = new Map<string, Id<'parties'>>();
	const customerIdList = [...customerIds];
	for (let i = 0; i < customerIdList.length; i += 500) {
		const { parties } = yield* ctx.query({
			parties: {
				where: {
					source: { eq: instance },
					active: { eq: true },
					external_code: { in: customerIdList.slice(i, i + 500) }
				},
				fields: ['external_code', 'kind', 'currency'],
				limit: 1000
			}
		});
		for (const p of parties.rows) {
			if (p.kind !== 'supplier' && p.currency === 'CNY') partyByExternal.set(p.external_code, p.id);
		}
	}

	const deliveryByFid = new Map<
		string,
		{ readonly id: Id<'transactions'>; readonly order: Id<'orders'> }
	>();
	const erpIdList = [...deliveryErpIds];
	for (let i = 0; i < erpIdList.length; i += 500) {
		const { transactions } = yield* ctx.query({
			transactions: {
				where: { source: { eq: instance }, erp_id: { in: erpIdList.slice(i, i + 500) } },
				fields: ['erp_id', 'order'],
				limit: 1000
			}
		});
		for (const tx of transactions.rows) {
			const match = /^delivery:(\d+)$/.exec(tx.erp_id);
			if (match?.[1]) deliveryByFid.set(match[1], { id: tx.id, order: tx.order });
		}
	}

	// Also match source SO fid -> orders only when a bill references an SO not already resolved via transactions.
	const needsOrderLookup = [...allFids].some((fid) => {
		if (deliveryByFid.has(fid)) return false;
		const bill =
			unauditedByFid.get(fid) ??
			watchedByFid.get(fid) ??
			recentAuditedByFid.get(fid) ??
			releaseByFid.get(fid)?.bill;
		return bill ? firstLineLink(bill.lines).sourceSoFid !== null : false;
	});
	const orderBySoFid = new Map<string, Id<'orders'>>();
	if (needsOrderLookup) {
		const { orders } = yield* ctx.query({
			orders: {
				where: { ledger: { eq: instance }, direction: { eq: 'sales' } },
				fields: ['kingdee'],
				limit: 5000
			}
		});
		for (const order of orders.rows) {
			if (order.kingdee?.fid) orderBySoFid.set(order.kingdee.fid, order.id);
		}
	}

	type SyncOutRow = {
		readonly $id: string;
		readonly external_code: string;
		readonly delivery_fid?: string;
		readonly bill_number?: string;
		readonly bill_on?: PlainDate | null;
		readonly party?: Id<'parties'>;
		readonly order?: Id<'orders'> | null;
		readonly delivery?: Id<'transactions'> | null;
		readonly settlement_name?: string | null;
		readonly currency?: 'CNY';
		readonly source_status?: SourceReleaseStatus;
		readonly bill_amount?: string | null;
		readonly credit_limit?: string | null;
		readonly credit_days?: number | null;
		readonly credit_used?: string | null;
		readonly over_limit?: string | null;
		readonly overdue_days?: number | null;
		readonly oldest_overdue_bill?: string | null;
		readonly block_reasons?: readonly CreditBlockReason[] | null;
		readonly temp_bump_status?: 'none' | 'active' | 'restored';
		readonly source_oper_date?: string | null;
		readonly content_hash?: string | null;
		readonly audit_seen_at?: ReturnType<typeof Instant> | null;
		readonly released_by?: string | null;
		readonly released_at?: ReturnType<typeof Instant> | null;
		readonly release_log_key?: string | null;
		readonly observed_at: ReturnType<typeof Instant>;
	};

	const outRows: SyncOutRow[] = [];
	const nextWatched = new Set<string>();
	let gracePending = false;
	if (page === null) {
		for (const fid of openByFid.keys()) {
			if (!allFids.has(fid)) nextWatched.add(fid);
		}
	}

	const nextExternalCode = (fid: string, operDate: string) => {
		const base = `do:${fid}`;
		return allExistingKeys.has(base) ? `${base}:${operDate.toLowerCase()}` : base;
	};

	const closedBumpsThisTick = new Set<string>();
	const restoredDeferredCodes = new Set<string>();
	const restoreIfActive = Effect.fnUntraced(function* (fid: string, kind: 'release' | 'close') {
		const open = openByFid.get(fid);
		const meta = openMetaByFid.get(fid);
		if (!open || !meta?.tempBumpEnabled) return 'none';
		const partyCode = partyExternalById.get(meta.party);
		if (!partyCode) return 'none';
		closedBumpsThisTick.add(fid);
		// Check whether any OTHER open approved one-time bump on this customer is still waiting to audit.
		const otherActiveOpen: {
			readonly fid: string;
			readonly bumpAmount: string | null;
			readonly bumpDays: number | null;
		}[] = [];
		for (const [otherFid, otherMeta] of openMetaByFid) {
			if (otherFid === fid || closedBumpsThisTick.has(otherFid)) continue;
			if (otherMeta.party !== meta.party || !otherMeta.tempBumpEnabled) continue;
			otherActiveOpen.push({
				fid: otherFid,
				bumpAmount: otherMeta.temp_bump_amount,
				bumpDays: otherMeta.temp_bump_days
			});
		}
		const baseline = activeBaselineByParty.get(meta.party);
		const baseLimit = baseline?.limit ?? open.credit_limit;
		const baseDays = baseline?.days ?? open.credit_days ?? null;
		if (otherActiveOpen.length > 0) {
			if (kind === 'release') {
				// This DO just audited (increasing audited exposure), while another one-time DO on this
				// customer still needs the combined temporary headroom. Keep temp_bump_status='active' so
				// the last closing bump in the wave unwinds the full combined amount back to baseLimit.
				const list = deferredClosedBumpsByParty.get(meta.party) ?? [];
				list.push({
					external_code: open.external_code,
					credit_limit: open.credit_limit,
					credit_days: open.credit_days ?? null,
					temp_bump_amount: meta.temp_bump_amount,
					temp_bump_days: meta.temp_bump_days
				});
				deferredClosedBumpsByParty.set(meta.party, list);
				return 'deferred';
			}
			// DO was withdrawn/superseded without auditing: reduce KIS down to the remaining active wave target.
			let remainingFloorLimit = baseLimit;
			if (baseLimit !== null) {
				let sumOther = BigDecimal.fromStringUnsafe(baseLimit);
				for (const o of otherActiveOpen) {
					if (o.bumpAmount != null)
						sumOther = BigDecimal.sum(sumOther, BigDecimal.fromStringUnsafe(o.bumpAmount));
				}
				for (const d of deferredClosedBumpsByParty.get(meta.party) ?? []) {
					if (!restoredDeferredCodes.has(d.external_code) && d.temp_bump_amount != null)
						sumOther = BigDecimal.sum(sumOther, BigDecimal.fromStringUnsafe(d.temp_bump_amount));
				}
				remainingFloorLimit = fixedDecimal(sumOther, 2);
			}
			let remainingFloorDays = baseDays;
			if (baseDays !== null) {
				let maxOtherDays = 0;
				for (const o of otherActiveOpen) {
					if (o.bumpDays != null && o.bumpDays > maxOtherDays) maxOtherDays = o.bumpDays;
				}
				remainingFloorDays = baseDays + maxOtherDays;
			}
			const result = yield* restoreTempCreditBump(
				{
					partyCode,
					floorLimit: remainingFloorLimit,
					bumpAmount: meta.temp_bump_amount,
					floorDays: remainingFloorDays,
					bumpDays: meta.temp_bump_days
				},
				ctx
			);
			return result !== null ? 'restored' : 'none';
		}
		// Last active temporary bump on this customer is closing: unwind this bump plus any deferred bumps in the wave.
		const deferred = (deferredClosedBumpsByParty.get(meta.party) ?? []).filter(
			(d) => !restoredDeferredCodes.has(d.external_code)
		);
		let totalBump = BigDecimal.fromBigInt(0n);
		let hasBumpAmt = false;
		let maxBumpDays: number | null = null;
		const addPart = (amt: string | null, days: number | null) => {
			if (amt != null) {
				const parsed = BigDecimal.fromStringUnsafe(amt);
				if (BigDecimal.isPositive(parsed)) {
					totalBump = BigDecimal.sum(totalBump, parsed);
					hasBumpAmt = true;
				}
			}
			if (days != null && days > 0 && (maxBumpDays === null || days > maxBumpDays))
				maxBumpDays = days;
		};
		addPart(meta.temp_bump_amount, meta.temp_bump_days);
		for (const d of deferred) addPart(d.temp_bump_amount, d.temp_bump_days);
		const result = yield* restoreTempCreditBump(
			{
				partyCode,
				floorLimit: baseLimit,
				bumpAmount: hasBumpAmt ? fixedDecimal(totalBump, 2) : null,
				floorDays: baseDays,
				bumpDays: maxBumpDays
			},
			ctx
		);
		if (result === null) return 'none';
		for (const d of deferred) {
			restoredDeferredCodes.add(d.external_code);
			const existingIdx = outRows.findIndex((r) => r.$id === d.external_code);
			const existingRow = existingIdx >= 0 ? outRows[existingIdx] : undefined;
			if (existingRow) {
				outRows[existingIdx] = { ...existingRow, temp_bump_status: 'restored' };
			} else {
				outRows.push({
					$id: d.external_code,
					external_code: d.external_code,
					temp_bump_status: 'restored',
					observed_at: snapshot.observedAt
				});
			}
		}
		return 'restored';
	});

	for (const fid of [...allFids].sort()) {
		const open = openByFid.get(fid) ?? null;
		const relEntry = releaseByFid.get(fid) ?? null;
		const unaudited = unauditedByFid.get(fid) ?? null;
		const watched = watchedByFid.get(fid) ?? recentAuditedByFid.get(fid) ?? null;
		const bill = relEntry?.bill ?? unaudited ?? watched ?? null;

		if (!open && !relEntry && !unaudited && closedReleaseFids.has(fid)) continue;

		// An open row whose fid wasn't in this tick's watched query yet cannot be declared gone: watch it next tick.
		if (!bill && open && !watchedSet.has(fid)) {
			nextWatched.add(fid);
			continue;
		}

		let observation: BillCreditObservation<Id<'orders'>, Id<'transactions'>>;
		let billMeta: {
			readonly bill_no: string;
			readonly bill_on: PlainDate | null;
			readonly party: Id<'parties'>;
			readonly order: Id<'orders'> | null;
			readonly delivery: Id<'transactions'> | null;
			readonly settlement_name: string | null;
			readonly bill_amount: string;
			readonly oper_date: string;
			readonly content_hash: string;
		} | null = null;

		if (!bill) {
			observation = { kind: 'gone' };
		} else {
			const watchedBill = relEntry?.bill ?? watched;
			const cancelled = watchedBill ? isFlag(watchedBill.cancelled) : false;
			const audited = relEntry !== null || (watchedBill ? watchedBill.status !== 0 : false);
			if (cancelled && !relEntry) {
				observation = { kind: 'gone' };
			} else {
				const { total, contentHash } = yield* hashBillLines(
					bill.lines.map((line) => ({
						item_id: line.item_id,
						quantity: line.quantity,
						amount: line.amount
					}))
				);
				const { sourceSoFid, settlementName } = firstLineLink(bill.lines);
				const linkedTx = deliveryByFid.get(fid);
				const orderId =
					linkedTx?.order ?? (sourceSoFid ? (orderBySoFid.get(sourceSoFid) ?? null) : null);
				const partyId = partyByExternal.get(bill.customer_id);
				if (partyId) {
					billMeta = {
						bill_no: bill.bill_no,
						bill_on: validBillDate(bill.bill_on),
						party: partyId,
						order: orderId,
						delivery: linkedTx?.id ?? null,
						settlement_name: settlementName,
						bill_amount: total,
						oper_date: bill.oper_date,
						content_hash: contentHash
					};
				}

				if (audited) {
					if (isOrgPolicy) {
						const customer = customerById.get(bill.customer_id);
						if ((customer && !customer.usable) || (customer?.usable && !partyId)) {
							issues.push(
								customer && !customer.usable
									? `Delivery ${bill.bill_no}: customer ${bill.customer_id} post-audit check failed (${customer.reason}).`
									: `Delivery ${bill.bill_no}: customer ${bill.customer_id} is not synchronized as an active CNY party.`
							);
							observation = {
								kind: 'undetectable',
								oper_date: bill.oper_date,
								content_hash: contentHash
							};
						} else if (customer?.usable) {
							const used = computeCreditExposure(ORG_CREDIT_PLAN, customer.row, null);
							const usedBd = BigDecimal.fromStringUnsafe(used);
							const limitBd = BigDecimal.fromStringUnsafe(customer.row.credit_limit);
							const overLimit = BigDecimal.isGreaterThan(usedBd, limitBd);
							const overLimitAmount = overLimit
								? fixedDecimal(BigDecimal.subtract(usedBd, limitBd), 2)
								: null;
							observation = {
								kind: 'audited',
								oper_date: bill.oper_date,
								content_hash: contentHash,
								release: null,
								org_audit: {
									fid,
									over_limit: overLimit,
									credit_limit: customer.row.credit_limit,
									credit_used: used,
									over_limit_amount: overLimitAmount
								}
							};
						} else {
							observation = {
								kind: 'audited',
								oper_date: bill.oper_date,
								content_hash: contentHash,
								release: null,
								org_audit: { fid, over_limit: false }
							};
						}
					} else {
						observation = {
							kind: 'audited',
							oper_date: bill.oper_date,
							content_hash: contentHash,
							release: relEntry?.release ?? null
						};
					}
				} else if (!detection.ok) {
					observation = {
						kind: 'undetectable',
						oper_date: bill.oper_date,
						content_hash: contentHash
					};
				} else {
					const customer = customerById.get(bill.customer_id);
					if (!customer) {
						// Customer no longer has a credit limit -> not blocked.
						observation = {
							kind: 'unaudited',
							oper_date: bill.oper_date,
							content_hash: contentHash,
							bill_amount: total,
							credit_limit: null,
							credit_used: null,
							verdict: { blocked: false },
							order: orderId,
							delivery: linkedTx?.id ?? null,
							settlement_name: settlementName
						};
					} else if (!customer.usable || !partyId) {
						issues.push(
							!customer.usable
								? `Delivery ${bill.bill_no}: customer ${bill.customer_id} credit check skipped (${customer.reason}).`
								: `Delivery ${bill.bill_no}: customer ${bill.customer_id} is not synchronized as an active CNY party.`
						);
						observation = {
							kind: 'undetectable',
							oper_date: bill.oper_date,
							content_hash: contentHash
						};
					} else {
						const used = computeCreditExposure(
							detection.plan,
							{
								invoices_audited: customer.row.invoices_audited,
								invoices_paid: customer.row.invoices_paid,
								refunds_unsettled: customer.row.refunds_unsettled,
								receipts_unsettled: customer.row.receipts_unsettled,
								advances_unsettled: customer.row.advances_unsettled,
								stock_out_audited: customer.row.stock_out_audited,
								stock_out_hooked: customer.row.stock_out_hooked
							},
							total
						);
						// When another one-time temporary bump is already active on this customer, evaluate new/unapproved DOs
						// against the true unbumped baseline so the temporary bump never leaks into another DO's floor.
						const activeBaseline = open?.temp_bump_active
							? undefined
							: activeBaselineByParty.get(partyId);
						const effectiveLimit =
							activeBaseline?.limit !== undefined && activeBaseline.limit !== null
								? activeBaseline.limit
								: customer.row.credit_limit;
						const effectiveDays =
							activeBaseline?.days !== undefined && activeBaseline.days !== null
								? activeBaseline.days
								: customer.row.credit_days;
						const verdict = evaluateCreditBlock({
							controlRange: detection.controlRange,
							limit: effectiveLimit,
							used,
							creditDays: effectiveDays,
							overdueInvoices: customer.row.overdue_invoices,
							today: detection.today
						});
						observation = {
							kind: 'unaudited',
							oper_date: bill.oper_date,
							content_hash: contentHash,
							bill_amount: total,
							credit_limit: effectiveLimit,
							credit_days: effectiveDays,
							credit_used: used,
							verdict,
							order: orderId,
							delivery: linkedTx?.id ?? null,
							settlement_name: settlementName
						};
					}
				}
			}
		}

		const action = reconcileCreditRelease(open, observation, snapshot.observedAt);
		const openMeta = openMetaByFid.get(fid);
		switch (action.op) {
			case 'none':
				if (open) {
					if (
						openMeta?.tempBumpEnabled &&
						openMeta.temp_bump_status === 'none' &&
						observation.kind === 'unaudited' &&
						!observation.verdict.blocked
					) {
						outRows.push({
							$id: open.external_code,
							external_code: open.external_code,
							temp_bump_status: 'active',
							observed_at: snapshot.observedAt
						});
					}
					nextWatched.add(fid);
				}
				break;
			case 'close':
				if (open) {
					const restoreState = yield* restoreIfActive(fid, 'close');
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: action.status,
						...(restoreState === 'restored' ? { temp_bump_status: 'restored' as const } : {}),
						audit_seen_at: null,
						observed_at: snapshot.observedAt
					});
				}
				break;
			case 'mark_audit_seen':
				if (open) {
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						audit_seen_at: Instant(action.audit_seen_at),
						observed_at: snapshot.observedAt
					});
					nextWatched.add(fid);
					gracePending = true;
				}
				break;
			case 'clear_audit_seen':
				if (open) {
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						audit_seen_at: null,
						observed_at: snapshot.observedAt
					});
					nextWatched.add(fid);
				}
				break;
			case 'release':
				if (open) {
					const restoreState = yield* restoreIfActive(fid, 'release');
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: action.status,
						...(restoreState === 'restored'
							? { temp_bump_status: 'restored' as const }
							: restoreState === 'deferred'
								? { temp_bump_status: 'active' as const }
								: {}),
						released_by: action.released_by,
						released_at: Instant(action.released_at),
						release_log_key: action.release_log_key,
						content_hash: action.content_hash,
						source_oper_date: action.source_oper_date,
						audit_seen_at: null,
						observed_at: snapshot.observedAt
					});
				}
				break;
			case 'refresh':
				if (open) {
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						bill_amount: action.bill_amount,
						credit_limit: action.credit_limit,
						credit_days:
							observation.kind === 'unaudited' ? (observation.credit_days ?? null) : null,
						credit_used: action.credit_used,
						over_limit: action.over_limit,
						overdue_days: action.overdue_days,
						oldest_overdue_bill: action.oldest_overdue_bill,
						block_reasons: action.block_reasons,
						source_oper_date: action.source_oper_date,
						content_hash: action.content_hash,
						order: action.order,
						delivery: action.delivery,
						settlement_name: action.settlement_name,
						audit_seen_at: null,
						observed_at: snapshot.observedAt
					});
					nextWatched.add(fid);
				}
				break;
			case 'supersede_and_reopen':
				if (open) {
					const restoreState = yield* restoreIfActive(fid, 'close');
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: 'superseded',
						...(restoreState === 'restored' ? { temp_bump_status: 'restored' as const } : {}),
						audit_seen_at: null,
						observed_at: snapshot.observedAt
					});
				}
				if (billMeta && observation.kind === 'unaudited' && observation.verdict.blocked) {
					const code = nextExternalCode(fid, billMeta.oper_date);
					allExistingKeys.add(code);
					outRows.push({
						$id: code,
						external_code: code,
						delivery_fid: fid,
						bill_number: billMeta.bill_no,
						bill_on: billMeta.bill_on,
						party: billMeta.party,
						order: billMeta.order,
						delivery: billMeta.delivery,
						settlement_name: billMeta.settlement_name,
						currency: 'CNY',
						source_status: 'blocked',
						bill_amount: billMeta.bill_amount,
						credit_limit: observation.credit_limit,
						credit_days: observation.credit_days ?? null,
						credit_used: observation.credit_used,
						over_limit: observation.verdict.over_limit,
						overdue_days: observation.verdict.overdue_days,
						oldest_overdue_bill: observation.verdict.oldest_overdue_bill,
						block_reasons: observation.verdict.reasons,
						source_oper_date: billMeta.oper_date,
						content_hash: billMeta.content_hash,
						observed_at: snapshot.observedAt
					});
					nextWatched.add(fid);
				}
				break;
			case 'open_blocked':
				if (billMeta && observation.kind === 'unaudited' && observation.verdict.blocked) {
					const code = nextExternalCode(fid, billMeta.oper_date);
					allExistingKeys.add(code);
					outRows.push({
						$id: code,
						external_code: code,
						delivery_fid: fid,
						bill_number: billMeta.bill_no,
						bill_on: billMeta.bill_on,
						party: billMeta.party,
						order: billMeta.order,
						delivery: billMeta.delivery,
						settlement_name: billMeta.settlement_name,
						currency: 'CNY',
						source_status: 'blocked',
						bill_amount: billMeta.bill_amount,
						credit_limit: observation.credit_limit,
						credit_days: observation.credit_days ?? null,
						credit_used: observation.credit_used,
						over_limit: observation.verdict.over_limit,
						overdue_days: observation.verdict.overdue_days,
						oldest_overdue_bill: observation.verdict.oldest_overdue_bill,
						block_reasons: observation.verdict.reasons,
						source_oper_date: billMeta.oper_date,
						content_hash: billMeta.content_hash,
						observed_at: snapshot.observedAt
					});
					nextWatched.add(fid);
				}
				break;
			case 'open_bypass':
				if (billMeta && !seenReleaseLogKeys.has(action.release_log_key)) {
					const code = `bypass:${fid}:${action.release_log_key}`;
					const orgAudit =
						observation.kind === 'audited' && observation.org_audit?.over_limit
							? observation.org_audit
							: null;
					outRows.push({
						$id: code,
						external_code: code,
						delivery_fid: fid,
						bill_number: billMeta.bill_no,
						bill_on: billMeta.bill_on,
						party: billMeta.party,
						order: billMeta.order,
						delivery: billMeta.delivery,
						settlement_name: billMeta.settlement_name,
						currency: 'CNY',
						source_status: 'bypassed',
						bill_amount: billMeta.bill_amount,
						...(orgAudit
							? {
									credit_limit: orgAudit.credit_limit ?? null,
									credit_used: orgAudit.credit_used ?? null,
									over_limit: orgAudit.over_limit_amount ?? null,
									block_reasons: ['over_limit'] as const
								}
							: {}),
						source_oper_date: billMeta.oper_date,
						content_hash: billMeta.content_hash,
						released_by: action.released_by,
						released_at: Instant(action.released_at),
						release_log_key: action.release_log_key,
						observed_at: snapshot.observedAt
					});
				}
				break;
		}
	}

	const nextWatchedList = [...nextWatched].sort();
	const recheckNext = gracePending || issues.length > 0;
	return {
		rows: outRows,
		cursor: {
			account,
			policy,
			fingerprint: snapshot.fingerprint,
			...(logResult.nextLogId !== null ? { last_log_id: logResult.nextLogId } : {}),
			...(nextOrgFid !== null ? { last_org_fid: nextOrgFid } : {}),
			...(nextWatchedList.length ? { watched: nextWatchedList } : {}),
			...(recheckNext ? { grace_pending: true } : {})
		},
		more: logResult.more || orgRecentPaged,
		health:
			issues.length > 0
				? {
						state: 'attention' as const,
						code: 'creditDetection',
						message: issues.slice(0, 3).join(' ')
					}
				: { state: 'ready' as const }
	};
});
