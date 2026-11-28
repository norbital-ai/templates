import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, SyncCtx } from '@norbital-ai/bolt';
import {
	computeCreditExposure,
	evaluateCreditBlock,
	ORG_CREDIT_PLAN,
	parseKingdeeReleaseLog,
	planCreditFormula
} from '../../lib/credit-release.js';
import { fixedDecimal } from '../../lib/purchase-listing.js';
import {
	kingdeeCreditAccount,
	kingdeeCreditPolicyOf,
	kingdeeOrgCreditPolicy
} from './configuration.js';
import { populateExposureSql, populateOverdueItemsSql } from './credit-sql.js';
import { checked } from './order-source.js';
import { columns, Instant, query, type DatabaseContext } from './polling.js';
import { requireReadAccount } from './sql.js';

export type DeliveryCreditCheck = 'passed' | 'failed' | 'released' | 'bypassed' | 'unchecked';

export type DeliveryCreditVerdict = {
	readonly credit_check: DeliveryCreditCheck;
	readonly credit_check_detail: string;
	readonly credit_checked_at: ReturnType<typeof Instant>;
};

const deliveryCreditCustomers = `SELECT DISTINCT b.FSupplyID AS FItemID
 FROM dbo.ICStockBill b
 WHERE b.FTranType=21 AND b.FInterID IN (
  SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n)
 )`;

const nativeDeliveryCreditSql = `${requireReadAccount}
${populateExposureSql(deliveryCreditCustomers, { paramDecl: '@ids xml', paramPass: '@ids=@ids' })}
${populateOverdueItemsSql(deliveryCreditCustomers, { paramDecl: '@ids xml', paramPass: '@ids=@ids' })}
DECLARE @releaseLogs TABLE (
 log_id varchar(30) NOT NULL,
 logged_at varchar(34) NOT NULL,
 description nvarchar(max) NOT NULL
);
IF OBJECT_ID('dbo.t_Log','U') IS NOT NULL AND COL_LENGTH('dbo.t_Log','FLogID') IS NOT NULL BEGIN
 DECLARE @logSql nvarchar(max) = N'SELECT TOP (500) CONVERT(varchar(30),l.FLogID),
  CONVERT(varchar(33),l.FDate,126)+''Z'',
  LTRIM(RTRIM(ISNULL(l.FDescription,'''')))
 FROM dbo.t_Log l
 WHERE l.FFunctionID=''XS100016''
  AND EXISTS (
   SELECT 1 FROM dbo.ICStockBill b
   WHERE b.FTranType=21
    AND b.FInterID IN (SELECT CONVERT(int, n.value(''.'',''varchar(20)'')) FROM @ids.nodes(''/ids/id'') AS w(n))
    AND LTRIM(RTRIM(ISNULL(b.FBillNo,''''))) <> ''''
    AND l.FDescription LIKE N''销售出库 - '' + LTRIM(RTRIM(b.FBillNo)) + N'' 由 %''
  )
 ORDER BY l.FLogID DESC';
 INSERT INTO @releaseLogs EXEC sys.sp_executesql @logSql, N'@ids xml', @ids=@ids;
END;
SELECT CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at,
 (SELECT
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
   SELECT CONVERT(varchar(20),b.FInterID) AS fid,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    b.FStatus AS status,
    b.FCancellation AS cancelled,
    b.FROB AS rob,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(100),COALESCE((SELECT SUM(e.FConsignAmount) FROM dbo.ICStockBillEntry e WHERE e.FInterID=b.FInterID),0)) AS bill_amount
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FInterID IN (
    SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n)
   )
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS bills,
  JSON_QUERY(COALESCE((
   SELECT CONVERT(varchar(20),c.FItemID) AS customer_id,
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
     SELECT TOP (100) v.bill_no, v.basis_date, CONVERT(varchar(100),v.amount) AS amount
     FROM @ovItems v
     WHERE v.customer_id=c.FItemID AND v.basis_date IS NOT NULL
      AND DATEDIFF(day,CONVERT(date,v.basis_date),GETDATE())>ISNULL(c.FCreditDays,0)
     ORDER BY v.basis_date,v.bill_no
     FOR JSON PATH, INCLUDE_NULL_VALUES
    ),'[]')) AS overdue_invoices
   FROM dbo.ICCreditObject c
   LEFT JOIN dbo.t_Currency u ON u.FCurrencyID=c.FCurrencyID
   LEFT JOIN @exp x ON x.customer_id=c.FItemID
   WHERE c.FItemID IN (${deliveryCreditCustomers})
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS customers,
  JSON_QUERY(COALESCE((
   SELECT log_id, logged_at, description FROM @releaseLogs
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS logs
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
 ) AS payload; /* kingdee-delivery-credit-check */`;

const orgDeliveryCreditSql = `${requireReadAccount}
${populateExposureSql(deliveryCreditCustomers, { paramDecl: '@ids xml', paramPass: '@ids=@ids' })}
SELECT CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at,
 (SELECT
  CONVERT(varchar(10),GETDATE(),23) AS today,
  JSON_QUERY('[]') AS options,
  JSON_QUERY('[]') AS fields,
  JSON_QUERY(COALESCE((
   SELECT CONVERT(varchar(20),b.FInterID) AS fid,
    LTRIM(RTRIM(ISNULL(b.FBillNo,''))) AS bill_no,
    b.FStatus AS status,
    b.FCancellation AS cancelled,
    b.FROB AS rob,
    CONVERT(varchar(20),b.FSupplyID) AS customer_id,
    CONVERT(varchar(100),COALESCE((SELECT SUM(e.FConsignAmount) FROM dbo.ICStockBillEntry e WHERE e.FInterID=b.FInterID),0)) AS bill_amount
   FROM dbo.ICStockBill b
   WHERE b.FTranType=21 AND b.FInterID IN (
    SELECT CONVERT(int, n.value('.','varchar(20)')) FROM @ids.nodes('/ids/id') AS w(n)
   )
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS bills,
  JSON_QUERY(COALESCE((
   SELECT CONVERT(varchar(20),o.FItemID) AS customer_id,
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
   WHERE o.FItemID IN (${deliveryCreditCustomers})
    AND o.FIsCreditMgr<>0 AND o.FDeleted=0
    AND LTRIM(RTRIM(ISNULL(o.FCreditLimit,'')))<>''
   FOR JSON PATH, INCLUDE_NULL_VALUES
  ),'[]')) AS customers,
  JSON_QUERY('[]') AS logs
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
 ) AS payload; /* kingdee-org-delivery-credit-check */`;

const precise = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/));
const integer = Schema.Number.check(Schema.isInt());

const DeliveryCreditPayload = Schema.fromJsonString(
	Schema.Struct({
		today: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
		options: Schema.Array(
			Schema.Struct({ mask: Schema.String, control_range: Schema.String, control: integer })
		),
		fields: Schema.Array(
			Schema.Struct({ bit: integer, caption: Schema.String, operator: Schema.String })
		),
		bills: Schema.Array(
			Schema.Struct({
				fid: Schema.String,
				bill_no: Schema.String,
				status: integer,
				cancelled: Schema.Union([Schema.Boolean, integer]),
				rob: integer,
				customer_id: Schema.String,
				bill_amount: precise
			})
		),
		customers: Schema.Array(
			Schema.Struct({
				customer_id: Schema.String,
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
			})
		),
		logs: Schema.Array(
			Schema.Struct({
				log_id: Schema.String,
				logged_at: Schema.String,
				description: Schema.String
			})
		)
	})
);

const PRECISE_RE = /^-?\d+(\.\d+)?$/;

/**
 * Deterministically evaluates Kingdee credit pass/fail/released/bypassed/unchecked for a set of
 * sales delivery order `FInterID`s. Returns an empty map when no KIS credit policy is configured.
 */
export const evaluateDeliveriesCredit = Effect.fnUntraced(function* (
	instance: Id<'sys_integration'>,
	fids: readonly string[],
	ctx: DatabaseContext & Pick<SyncCtx<'kingdee'>, 'query' | 'configuration'>
) {
	const results = new Map<string, DeliveryCreditVerdict>();
	const account = kingdeeCreditAccount(ctx.configuration);
	const policy = kingdeeCreditPolicyOf(ctx.configuration.creditPolicy);
	const uniqueFids = [...new Set(fids)].filter((fid) => /^[1-9]\d*$/.test(fid));
	if (
		policy === null ||
		account === null ||
		ctx.configuration.baseCurrency !== 'CNY' ||
		uniqueFids.length === 0
	)
		return results;

	const isOrgPolicy = policy === kingdeeOrgCreditPolicy;
	const { credit_releases } = yield* ctx.query({
		credit_releases: {
			where: { source: { eq: instance }, delivery_fid: { in: uniqueFids } },
			fields: [
				'delivery_fid',
				'approval_status',
				'source_status',
				'route',
				'temp_bump_amount',
				'temp_bump_days',
				'temp_bump_status',
				'released_by'
			],
			limit: 1000
		}
	});
	const directWriteCreditLimit = ctx.configuration.directWriteCreditLimit === true;
	const approvedByFid = new Set(
		credit_releases.rows
			.filter((row) => row.approval_status === 'approved')
			.map((row) => row.delivery_fid)
	);
	const tempBumpReleasedByFid = new Set(
		credit_releases.rows
			.filter(
				(row) =>
					row.approval_status === 'approved' &&
					row.route === 'one_time' &&
					(row.source_status === 'released' ||
						row.temp_bump_status === 'active' ||
						row.temp_bump_status === 'restored' ||
						(directWriteCreditLimit &&
							(row.temp_bump_amount != null || row.temp_bump_days != null)))
			)
			.map((row) => row.delivery_fid)
	);

	for (let i = 0; i < uniqueFids.length; i += 200) {
		const chunk = uniqueFids.slice(i, i + 200);
		const idsXml = `<ids>${chunk.map((fid) => `<id>${fid}</id>`).join('')}</ids>`;
		const [row] = yield* query(ctx, {
			op: 'call',
			procedure: { schema: 'sys', name: 'sp_executesql' },
			max_rows: 1,
			arguments: {
				stmt: isOrgPolicy ? orgDeliveryCreditSql : nativeDeliveryCreditSql,
				params: '@read_account nvarchar(73),@ids xml',
				read_account: account,
				ids: idsXml
			}
		});
		if (!row) continue;
		const parsed = yield* checked(() => {
			const r = columns(row);
			const observedAt = Instant(r.text('observed_at'));
			const payload = Schema.decodeUnknownSync(DeliveryCreditPayload)(r.text('payload'));
			return { observedAt, payload };
		});
		const { observedAt, payload } = parsed;
		const formula = (() => {
			if (isOrgPolicy)
				return { ok: true as const, controlRange: 1, plan: ORG_CREDIT_PLAN, reason: null };
			const option = payload.options[0];
			if (
				payload.options.length !== 1 ||
				!option ||
				option.control !== 2 ||
				!['1', '2', '3'].includes(option.control_range)
			)
				return {
					ok: false as const,
					reason: 'Kingdee ICCreditOption does not enforce blocking sales-out credit control'
				};
			const plan = planCreditFormula(option.mask, payload.fields);
			if (!plan.ok) return { ok: false as const, reason: `${plan.column}: ${plan.reason}` };
			return {
				ok: true as const,
				controlRange: Number(option.control_range),
				plan: plan.items,
				reason: null
			};
		})();
		const customerById = new Map(payload.customers.map((c) => [c.customer_id, c]));
		const releaseByBillNo = new Map<string, { readonly kisUser: string }>();
		for (const log of payload.logs) {
			const parsedLog = parseKingdeeReleaseLog(log);
			if (parsedLog && !releaseByBillNo.has(parsedLog.billNo))
				releaseByBillNo.set(parsedLog.billNo, { kisUser: parsedLog.kisUser });
		}

		for (const bill of payload.bills) {
			const cancelled = typeof bill.cancelled === 'boolean' ? bill.cancelled : bill.cancelled !== 0;
			if (cancelled) {
				results.set(bill.fid, {
					credit_check: 'unchecked',
					credit_check_detail: 'Cancelled delivery order',
					credit_checked_at: observedAt
				});
				continue;
			}
			if (bill.rob === -1) {
				results.set(bill.fid, {
					credit_check: 'unchecked',
					credit_check_detail: 'Return delivery (red bill)',
					credit_checked_at: observedAt
				});
				continue;
			}
			if (!formula.ok) {
				results.set(bill.fid, {
					credit_check: 'unchecked',
					credit_check_detail: formula.reason,
					credit_checked_at: observedAt
				});
				continue;
			}
			const customer = customerById.get(bill.customer_id);
			if (!customer) {
				results.set(bill.fid, {
					credit_check: 'unchecked',
					credit_check_detail: 'No Kingdee credit limit configured for customer',
					credit_checked_at: observedAt
				});
				continue;
			}
			if (
				customer.currency !== 'CNY' ||
				!PRECISE_RE.test(customer.credit_limit) ||
				BigDecimal.isNegative(BigDecimal.fromStringUnsafe(customer.credit_limit)) ||
				customer.credit_days < 0 ||
				((formula.controlRange & 2) !== 0 && customer.invalid_terms !== 0)
			) {
				results.set(bill.fid, {
					credit_check: 'unchecked',
					credit_check_detail: 'Customer credit profile could not be evaluated',
					credit_checked_at: observedAt
				});
				continue;
			}
			const limitFmt = fixedDecimal(BigDecimal.fromStringUnsafe(customer.credit_limit), 2);
			const audited = bill.status !== 0;
			if (!audited) {
				const used = computeCreditExposure(formula.plan, customer, bill.bill_amount);
				const verdict = evaluateCreditBlock({
					controlRange: formula.controlRange,
					limit: customer.credit_limit,
					used,
					creditDays: customer.credit_days,
					overdueInvoices: customer.overdue_invoices,
					today: payload.today
				});
				if (verdict.blocked) {
					const parts: string[] = [];
					if (verdict.over_limit !== null)
						parts.push(`Over limit by ${verdict.over_limit} (used ${used} / limit ${limitFmt})`);
					if (verdict.overdue_days !== null)
						parts.push(
							`Overdue ${verdict.overdue_days}d (${verdict.oldest_overdue_bill ?? 'invoice'})`
						);
					results.set(bill.fid, {
						credit_check: 'failed',
						credit_check_detail: parts.join('; '),
						credit_checked_at: observedAt
					});
				} else {
					results.set(bill.fid, {
						credit_check: 'passed',
						credit_check_detail: `Within credit policy (used ${used} / limit ${limitFmt})`,
						credit_checked_at: observedAt
					});
				}
				continue;
			}
			// Audited DO
			const release = releaseByBillNo.get(bill.bill_no);
			if (release) {
				const approved = approvedByFid.has(bill.fid);
				results.set(bill.fid, {
					credit_check: approved ? 'released' : 'bypassed',
					credit_check_detail: approved
						? `Released in Kingdee by ${release.kisUser}`
						: `Released in Kingdee by ${release.kisUser} without approval`,
					credit_checked_at: observedAt
				});
				continue;
			}
			if (tempBumpReleasedByFid.has(bill.fid)) {
				results.set(bill.fid, {
					credit_check: 'released',
					credit_check_detail: 'Released via approved temporary credit bump',
					credit_checked_at: observedAt
				});
				continue;
			}
			const used = computeCreditExposure(formula.plan, customer, null);
			if (isOrgPolicy) {
				const usedBd = BigDecimal.fromStringUnsafe(used);
				const limitBd = BigDecimal.fromStringUnsafe(customer.credit_limit);
				if (BigDecimal.isGreaterThan(usedBd, limitBd)) {
					const over = fixedDecimal(BigDecimal.subtract(usedBd, limitBd), 2);
					const approved = approvedByFid.has(bill.fid);
					results.set(bill.fid, {
						credit_check: approved ? 'released' : 'bypassed',
						credit_check_detail: approved
							? `Audited with approval (used ${used} / limit ${limitFmt})`
							: `Audited over limit by ${over} without approval (used ${used} / limit ${limitFmt})`,
						credit_checked_at: observedAt
					});
					continue;
				}
			}
			results.set(bill.fid, {
				credit_check: 'passed',
				credit_check_detail: `Audited within credit policy (used ${used} / limit ${limitFmt})`,
				credit_checked_at: observedAt
			});
		}
	}
	return results;
});
