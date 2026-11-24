import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, InstanceId, Json, PlainDate, SyncCtx } from '@norbital-ai/bolt';
import {
	computeCreditExposure,
	evaluateCreditBlock,
	hashBillLines,
	parseKingdeeReleaseLog,
	planCreditFormula,
	reconcileCreditRelease,
	type BillCreditObservation,
	type CreditBlockReason,
	type OpenCreditRelease,
	type ParsedReleaseLog
} from '../../lib/credit-release.js';

type SourceReleaseStatus =
	'blocked' | 'released' | 'cleared' | 'superseded' | 'withdrawn' | 'bypassed';
import {
	kingdeeCreditAccount,
	kingdeeCreditPolicy,
	kingdeeCreditPolicyOf
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

// Snapshot of KIS sales-out credit policy, active unaudited DOs (limited customers), their customers' exposure,
// and the watched open delivery IDs. Zero customer exposure aggregates run when no unaudited DOs exist.
const creditReleaseSnapshot = `${requireReadAccount}
DECLARE @data nvarchar(max) = (
 SELECT
  CONVERT(varchar(10),GETDATE(),23) AS today,
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
    JSON_QUERY(COALESCE((
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
    ),'[]')) AS lines
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
    CONVERT(varchar(100),i.invoiced) AS invoices_audited,
    CONVERT(varchar(100),i.paid) AS invoices_paid,
    CONVERT(varchar(100),r.refunds) AS refunds_unsettled,
    CONVERT(varchar(100),r.receipts) AS receipts_unsettled,
    CONVERT(varchar(100),r.advances) AS advances_unsettled,
    CONVERT(varchar(100),d.issued) AS stock_out_audited,
    CONVERT(varchar(100),d.hooked) AS stock_out_hooked,
    i.invalid_terms,
    JSON_QUERY(COALESCE((
     SELECT TOP (100) LTRIM(RTRIM(ISNULL(s.FBillNo,''))) AS bill_no,
      CONVERT(varchar(10),COALESCE(s.FSettleDate,s.FDate),23) AS basis_date,
      CONVERT(varchar(100),a.FRemainAmount) AS amount
     FROM dbo.t_RP_Contact a
     JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID AND s.FStatus<>0 AND s.FCancellation=0
     WHERE a.FRP=1 AND a.FType=3 AND a.FRemainAmount>0 AND a.FCustomer=c.FItemID
      AND COALESCE(s.FSettleDate,s.FDate)>'19010101'
      AND DATEDIFF(day,COALESCE(s.FSettleDate,s.FDate),GETDATE())>ISNULL(c.FCreditDays,0)
     ORDER BY COALESCE(s.FSettleDate,s.FDate),s.FBillNo
     FOR JSON PATH, INCLUDE_NULL_VALUES
    ),'[]')) AS overdue_invoices
   FROM dbo.ICCreditObject c
   LEFT JOIN dbo.t_Currency u ON u.FCurrencyID=c.FCurrencyID
   OUTER APPLY(SELECT COALESCE(SUM(a.FAmount),0) AS invoiced,
    COALESCE(SUM(a.FAmount-a.FRemainAmount),0) AS paid,
    COALESCE(SUM(CASE WHEN a.FRemainAmount>0 AND
     (COALESCE(s.FSettleDate,s.FDate) IS NULL OR COALESCE(s.FSettleDate,s.FDate)<='19010101') THEN 1 ELSE 0 END),0) AS invalid_terms
    FROM dbo.t_RP_Contact a JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID
     AND s.FStatus<>0 AND s.FCancellation=0
    WHERE a.FRP=1 AND a.FType=3 AND a.FCustomer=c.FItemID) i
   OUTER APPLY(SELECT COALESCE(-SUM(CASE WHEN a.FPre=-1 THEN a.FRemainAmount ELSE 0 END),0) AS refunds,
    COALESCE(SUM(CASE WHEN a.FPre=0 THEN a.FRemainAmount ELSE 0 END),0) AS receipts,
    COALESCE(SUM(CASE WHEN a.FPre=1 THEN a.FRemainAmount ELSE 0 END),0) AS advances
    FROM dbo.t_RP_Contact a JOIN dbo.t_RP_NewReceiveBill b ON b.FBillID=a.FBillID AND b.FStatus<>0
    WHERE a.FRP=1 AND a.FType=5 AND a.FCustomer=c.FItemID) r
   OUTER APPLY(SELECT COALESCE(SUM(e.FConsignAmount),0) AS issued,
    COALESCE(SUM(CASE WHEN b.FHookStatus=2 THEN e.FConsignAmount ELSE 0 END),0) AS hooked
    FROM dbo.ICStockBill b JOIN dbo.ICStockBillEntry e ON e.FInterID=b.FInterID
    WHERE b.FTranType=21 AND b.FStatus<>0 AND b.FCancellation=0 AND b.FSupplyID=c.FItemID) d
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
    JSON_QUERY(COALESCE((
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
    ),'[]')) AS lines
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
  SELECT TOP (200) CONVERT(varchar(30),l.FLogID) AS log_id,
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
  JSON_QUERY(COALESCE((
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
  ),'[]')) AS lines
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
	credit_limit: precise,
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
		options: Schema.Array(
			Schema.Struct({ mask: Schema.String, control_range: Schema.String, control: integer })
		),
		fields: Schema.Array(
			Schema.Struct({ bit: integer, caption: Schema.String, operator: Schema.String })
		),
		unaudited: Schema.Array(UnauditedBillSchema),
		customers: Schema.Array(CustomerExposureSchema),
		watched: Schema.Array(WatchedBillSchema)
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
	fingerprint: Schema.optionalKey(Schema.String),
	last_log_id: Schema.optionalKey(Schema.String),
	watched: Schema.optionalKey(Schema.Array(Schema.String)),
	grace_pending: Schema.optionalKey(Schema.Boolean)
});

const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });
const LOG_ADVANCE_THRESHOLD = 50_000n;

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
	// Dormant unless native KIS sales-out credit control is explicitly configured.
	if (
		policy !== kingdeeCreditPolicy ||
		account === null ||
		ctx.configuration.baseCurrency !== 'CNY'
	)
		return { rows: [], cursor, more: false };

	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(CursorSchema)(cursor));
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The credit account changed. Review the retained credit releases before resetting.'
		);

	const watchedFids = prior?.watched ?? [];
	const priorFingerprint = prior?.grace_pending ? '' : (prior?.fingerprint ?? '');
	const [snapRow] = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		max_rows: 1,
		arguments: {
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
		return { fingerprint, entries, observedAt: Instant(r.text('observed_at')) };
	});

	// Query 2: incremental clustered-PK seek on t_Log (FLogID > @last_log_id) for XS100016 releases.
	const priorLogId = prior?.last_log_id ?? null;
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
	const logResult = yield* checked(() => {
		if (!logRow) throw invalid('$result', 'Missing t_Log checkpoint');
		const r = columns(logRow);
		const maxLogId = r.text('max_log_id');
		if (!/^\d+$/.test(maxLogId)) throw invalid('max_log_id', 'Invalid t_Log max FLogID');
		const rawEntries = Schema.decodeUnknownSync(LogEntriesSchema)(r.text('entries'));
		const releases: ParsedReleaseLog[] = [];
		for (const item of rawEntries) {
			const parsed = parseKingdeeReleaseLog(item);
			if (parsed) releases.push(parsed);
		}
		return { maxLogId, releases };
	});

	// Keep the workspace asleep on quiet ticks: advance last_log_id only on real writes or large log gaps.
	const logGap =
		priorLogId === null
			? true
			: BigInt(logResult.maxLogId) - BigInt(priorLogId) >= LOG_ADVANCE_THRESHOLD;
	if (snapshot.entries === null && logResult.releases.length === 0 && unchanged && !logGap)
		return { rows: [], cursor, more: false };

	// If nothing changed in the snapshot and no new XS100016 lines arrived, only advance log cursor if gap exceeded.
	if (snapshot.entries === null && logResult.releases.length === 0) {
		return {
			rows: [],
			cursor: {
				account,
				fingerprint: snapshot.fingerprint,
				last_log_id: logResult.maxLogId,
				...(watchedFids.length ? { watched: watchedFids } : {})
			},
			more: false
		};
	}

	const snapshotEntries = snapshot.entries;
	const page =
		snapshotEntries !== null
			? yield* checked(() => Schema.decodeUnknownSync(SnapshotPayload)(snapshotEntries))
			: null;

	// Newest XS100016 release per bill number.
	const newestReleaseByBillNo = new Map<string, ParsedReleaseLog>();
	for (const rel of logResult.releases) {
		const prev = newestReleaseByBillNo.get(rel.billNo);
		if (!prev || BigInt(rel.logId) > BigInt(prev.logId)) newestReleaseByBillNo.set(rel.billNo, rel);
	}

	// Read workspace state: existing credit_releases + parties + orders + transactions for linking.
	const { credit_releases: existingReleases, sys_integration: ledgers } = yield* ctx.query({
		credit_releases: {
			where: { source: { eq: instance } },
			fields: [
				'external_code',
				'delivery_fid',
				'bill_number',
				'source_status',
				'approval_status',
				'bill_amount',
				'credit_limit',
				'credit_used',
				'over_limit',
				'overdue_days',
				'oldest_overdue_bill',
				'block_reasons',
				'source_oper_date',
				'content_hash',
				'approved_content_hash',
				'audit_seen_at',
				'release_log_key',
				'order',
				'delivery',
				'settlement_name'
			],
			limit: 5000
		},
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
	});
	if (
		ledgers.rows.some(
			(row) => row.id !== instance && kingdeeCreditAccount(row.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable account-wide credit on one ledger per account set'
		});

	const seenReleaseLogKeys = new Set(
		existingReleases.rows.flatMap((row) => (row.release_log_key ? [row.release_log_key] : []))
	);
	const allExistingKeys = new Set(existingReleases.rows.map((row) => row.external_code));
	const openByFid = new Map<string, OpenCreditRelease<Id<'orders'>, Id<'transactions'>>>();
	for (const row of existingReleases.rows) {
		if (row.source_status === 'blocked') {
			openByFid.set(row.delivery_fid, {
				external_code: row.external_code,
				delivery_fid: row.delivery_fid,
				status: row.approval_status === 'approved' ? 'approved' : 'blocked',
				bill_amount: row.bill_amount,
				credit_limit: row.credit_limit,
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
				settlement_name: row.settlement_name
			});
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
				ids: yield* checked(() => idsXml(missingReleaseBillNos, /^[A-Za-z0-9_-]{1,40}$/, 'bill_no'))
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
		}
	}

	// Validate global KIS credit option & formula (refusing detection never blocks closing audited/gone/released rows).
	const detection = (() => {
		if (!page) return { ok: false as const };
		const option = page.options[0];
		if (
			page.options.length !== 1 ||
			!option ||
			option.control !== 2 ||
			!['1', '2', '3'].includes(option.control_range)
		)
			return { ok: false as const };
		const plan = planCreditFormula(option.mask, page.fields);
		if (!plan.ok) return { ok: false as const };
		return {
			ok: true as const,
			today: page.today,
			controlRange: Number(option.control_range),
			plan: plan.items
		};
	})();

	// Index customers from snapshot; refuse invalid/non-CNY customers individually without failing valid CNY ones.
	const customerById = new Map<
		string,
		| { readonly usable: true; readonly row: Schema.Schema.Type<typeof CustomerExposureSchema> }
		| { readonly usable: false }
	>();
	if (page) {
		const grouped = Map.groupBy(page.customers, (c) => c.customer_id);
		for (const [cid, list] of grouped) {
			const c = list[0];
			const limit = c ? BigDecimal.fromStringUnsafe(c.credit_limit) : null;
			const invalidTerms =
				detection.ok && (detection.controlRange & 2) !== 0 && (c?.invalid_terms ?? 0) !== 0;
			if (
				list.length !== 1 ||
				!c ||
				c.currency !== 'CNY' ||
				limit === null ||
				BigDecimal.isNegative(limit) ||
				c.credit_days < 0 ||
				invalidTerms
			) {
				customerById.set(cid, { usable: false });
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
	const allFids = new Set<string>(
		page === null
			? [...releaseByFid.keys()]
			: [...openByFid.keys(), ...unauditedByFid.keys(), ...releaseByFid.keys()]
	);
	const customerIds = new Set<string>();
	const deliveryErpIds = new Set<string>();
	for (const fid of allFids) {
		const bill = unauditedByFid.get(fid) ?? watchedByFid.get(fid) ?? releaseByFid.get(fid)?.bill;
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
		const bill = unauditedByFid.get(fid) ?? watchedByFid.get(fid) ?? releaseByFid.get(fid)?.bill;
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
		readonly credit_used?: string | null;
		readonly over_limit?: string | null;
		readonly overdue_days?: number | null;
		readonly oldest_overdue_bill?: string | null;
		readonly block_reasons?: readonly CreditBlockReason[] | null;
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

	for (const fid of [...allFids].sort()) {
		const open = openByFid.get(fid) ?? null;
		const relEntry = releaseByFid.get(fid) ?? null;
		const unaudited = unauditedByFid.get(fid) ?? null;
		const watched = watchedByFid.get(fid) ?? null;
		const bill = relEntry?.bill ?? unaudited ?? watched ?? null;

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
					observation = {
						kind: 'audited',
						oper_date: bill.oper_date,
						content_hash: contentHash,
						release: relEntry?.release ?? null
					};
				} else if (!detection.ok) {
					observation = {
						kind: 'undetectable',
						oper_date: bill.oper_date,
						content_hash: contentHash
					};
				} else {
					const customer = customerById.get(bill.customer_id);
					if (!customer) {
						// Customer has no ICCreditObject row anymore -> not blocked.
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
						const verdict = evaluateCreditBlock({
							controlRange: detection.controlRange,
							limit: customer.row.credit_limit,
							used,
							creditDays: customer.row.credit_days,
							overdueInvoices: customer.row.overdue_invoices,
							today: detection.today
						});
						observation = {
							kind: 'unaudited',
							oper_date: bill.oper_date,
							content_hash: contentHash,
							bill_amount: total,
							credit_limit: customer.row.credit_limit,
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
		switch (action.op) {
			case 'none':
				if (open) nextWatched.add(fid);
				break;
			case 'close':
				if (open) {
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: action.status,
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
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: action.status,
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
					outRows.push({
						$id: open.external_code,
						external_code: open.external_code,
						source_status: 'superseded',
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
				if (billMeta) {
					const code = `bypass:${fid}:${action.release_log_key}`;
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
	return {
		rows: outRows,
		cursor: {
			account,
			fingerprint: snapshot.fingerprint,
			last_log_id: logResult.maxLogId,
			...(nextWatchedList.length ? { watched: nextWatchedList } : {}),
			...(gracePending ? { grace_pending: true } : {})
		},
		more: false
	};
});
