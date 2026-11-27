import { BigDecimal, Effect, Schema } from 'effect';
import type { InstanceId, Json, Row, SyncCtx } from '@norbital-ai/bolt';
import { sha256Hex } from '../../lib/commercial.js';
import { safeDueDate } from '../../lib/payables.js';
import {
	currencyDigits,
	earliestPurchaseListingDate,
	fixedDecimal,
	purchasePaymentStatus,
	summarizeExpenses,
	type ExpenseLine,
	type HookWeight
} from '../../lib/purchase-listing.js';
import {
	kingdeePurchaseListingAccount,
	kingdeeSettlementRules,
	type SettlementRules
} from './configuration.js';
import { settlementDate } from './order-batch.js';
import {
	checked,
	exactId,
	flag,
	nullableText,
	readNativeRows,
	sourceDate,
	text,
	type NativeProjection
} from './order-source.js';
import {
	columns,
	currency,
	Instant,
	SourceRowInvalid,
	SourceUnavailable,
	type DatabaseContext,
	type SqlRow
} from './polling.js';

const fromDate = earliestPurchaseListingDate.replaceAll('-', '');
const validDate = (expr: string) =>
	`CASE WHEN ${expr}>=CONVERT(datetime,'19000101',112) AND ${expr}<CONVERT(datetime,'30000101',112) THEN ${expr} END`;
const settledShare =
	'CASE WHEN ct.a IS NULL OR ct.a=0 THEN 0 ELSE (il.net+il.tax)*(ct.a-ct.r)/ct.a END';

/**
 * Single-request checkpoint over every source table that can change the purchase listing.
 * Each table is aggregated in one pass via CROSS JOIN; while the digest matches the stored
 * cursor, no listing join runs and nothing is written.
 */
const checkpoint: NativeProjection = {
	sql: `/* kingdee-purchase-listing-checkpoint */
SELECT 'pl' AS __key,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at,
 CONVERT(varchar(20),po.n)+'|'+CONVERT(varchar(18),CONVERT(binary(8),po.rv),1)
 +'|'+CONVERT(varchar(20),pe.n)+'|'+CONVERT(varchar(40),pe.q)+'|'+CONVERT(varchar(40),pe.a)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),rch.rv),1)+'|'+CONVERT(varchar(40),rce.q)+'|'+CONVERT(varchar(40),rce.a)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),ivh.rv),1)+'|'+CONVERT(varchar(40),ive.n)+'|'+CONVERT(varchar(40),ive.t)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),ct.rv),1)+'|'+CONVERT(varchar(40),ct.r)
 +'|'+CONVERT(varchar(20),pl.n)+'|'+CONVERT(varchar(20),pl.d)
 +'|'+CONVERT(varchar(20),ck.n)+'|'+CONVERT(varchar(20),ck.m)
 +'|'+CONVERT(varchar(20),exh.n)+'|'+CONVERT(varchar(20),exh.h)+'|'+CONVERT(varchar(40),exe.a)
 +'|'+CONVERT(varchar(20),hk.n)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),COALESCE((SELECT MAX(FModifyTime) FROM dbo.t_Supplier),CONVERT(binary(8),'0x0000000000000000',1))),1)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),COALESCE((SELECT MAX(FModifyTime) FROM dbo.t_ICItem),CONVERT(binary(8),'0x0000000000000000',1))),1)
 +'|'+CONVERT(varchar(18),CONVERT(binary(8),COALESCE((SELECT MAX(FModifyTime) FROM dbo.t_Item WHERE FItemClassID=2037),CONVERT(binary(8),'0x0000000000000000',1))),1)
 +'|'+CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM dbo.t_Settle)) AS digest
FROM (
 SELECT SUM(CASE WHEN FDate>=CONVERT(datetime,'${fromDate}',112) THEN 1 ELSE 0 END) AS n,
  COALESCE(MAX(FOperDate),CONVERT(binary(8),'0x0000000000000000',1)) AS rv
 FROM dbo.POOrder
) po
CROSS JOIN (
 SELECT COUNT_BIG(*) AS n, COALESCE(SUM(e.FQty),0) AS q, COALESCE(SUM(e.FAllAmount),0) AS a
 FROM dbo.POOrderEntry e JOIN dbo.POOrder o ON o.FInterID=e.FInterID
 WHERE o.FCancellation=0 AND o.FDate>=CONVERT(datetime,'${fromDate}',112)
) pe
CROSS JOIN (
 SELECT COALESCE(MAX(FOperDate),CONVERT(binary(8),'0x0000000000000000',1)) AS rv
 FROM dbo.ICStockBill WHERE FTranType=1
) rch
CROSS JOIN (
 SELECT COALESCE(SUM(FQty),0) AS q, COALESCE(SUM(FAmount),0) AS a
 FROM dbo.ICStockBillEntry WHERE FSourceTranType=71
) rce
CROSS JOIN (
 SELECT COALESCE(MAX(FOperDate),CONVERT(binary(8),'0x0000000000000000',1)) AS rv
 FROM dbo.ICPurchase
) ivh
CROSS JOIN (
 SELECT COALESCE(SUM(FStdAmount),0) AS n, COALESCE(SUM(FStdTaxAmount),0) AS t
 FROM dbo.ICPurchaseEntry
) ive
CROSS JOIN (
 SELECT COALESCE(MAX(FModifyTime),CONVERT(binary(8),'0x0000000000000000',1)) AS rv,
  COALESCE(SUM(FRemainAmount),0) AS r
 FROM dbo.t_RP_Contact WHERE FRP=0 AND FType=4
) ct
CROSS JOIN (
 SELECT COUNT_BIG(*) AS n,
  COALESCE(SUM(CAST(FInterID AS bigint)*COALESCE(DATEDIFF(day,'20000101',${validDate('FDate')}),0)),0) AS d
 FROM dbo.t_RP_Plan_Ap WHERE FRP=0
) pl
CROSS JOIN (
 SELECT COUNT_BIG(*) AS n, COALESCE(MAX(FInterID),0) AS m
 FROM dbo.t_rp_CheckEntry WHERE FType=4 AND FType_SRC=6
) ck
CROSS JOIN (
 SELECT COUNT_BIG(*) AS n, COALESCE(SUM(CAST(FHookInterID AS bigint)),0) AS h
 FROM dbo.ICExpenses WHERE FCancellation=0
) exh
CROSS JOIN (
 SELECT COALESCE(SUM(FStdAmount),0) AS a FROM dbo.ICExpensesEntry
) exe
CROSS JOIN (
 SELECT COUNT_BIG(*) AS n FROM dbo.ICHookRelations WHERE FHookType=0 AND FTranType=1
) hk`
};

/**
 * One row per non-cancelled PO line from 2025-01-01 onward, with receipts (`rc`) and invoices (`iv`,
 * covering all three KIS invoice paths: via receipt `1`, direct `71`, and invoice-from-invoice `75`)
 * aggregated before joining so the PO-line grain cannot multiply. Invoice bill numbers ride a flat
 * companion query (`listingInvoiceNumbers`) to avoid a correlated per-line subquery.
 */
const listingLines = (whereExtra = ''): NativeProjection => ({
	sql: `/* kingdee-purchase-listing-lines */
SELECT
 RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),e.FInterID),20)+':'+RIGHT(REPLICATE('0',10)+CONVERT(varchar(10),e.FEntryID),10) AS __key,
 e.FInterID AS order_id, e.FEntryID AS entry_id,
 o.FBillNo AS order_number, CONVERT(varchar(10),o.FDate,23) AS ordered_on,
 o.FSupplyID AS supplier_id, sp.FName AS supplier_name,
 pc.FName AS product_category, it.FModel AS product_spec,
 CONVERT(varchar(40),e.FQty) AS quantity,
 cur.FNumber AS currency,
 CONVERT(varchar(40),e.FTaxPrice) AS unit_price,
 CONVERT(varchar(40),CONVERT(decimal(18,8),o.FExchangeRate)) AS exchange_rate,
 CONVERT(varchar(40),e.FAllAmount) AS amount,
 CONVERT(varchar(40),e.FAllAmount*CONVERT(decimal(18,8),o.FExchangeRate)) AS amount_base,
 CONVERT(varchar(40),ISNULL(rc.qty,0)) AS received_qty,
 CONVERT(varchar(10),rc.last_date,23) AS last_received_on,
 CONVERT(varchar(10),iv.invoice_date,23) AS invoiced_on,
 ISNULL(iv.lines,0) AS invoice_lines,
 CONVERT(varchar(40),iv.qty) AS invoiced_qty,
 CONVERT(varchar(40),iv.net) AS net_amount,
 CONVERT(varchar(40),iv.tax) AS invoice_tax,
 CONVERT(varchar(40),iv.paid) AS paid_amount,
 iv.status_min, iv.status_max,
 CONVERT(varchar(10),iv.due_date,23) AS due_on,
 CONVERT(varchar(10),iv.pay_date,23) AS paid_on,
 st.FNumber AS settlement_code, st.FName AS settlement,
 COALESCE(NULLIF(LTRIM(RTRIM(e.FNote)),''),o.FExplanation) AS note
FROM dbo.POOrderEntry e
JOIN dbo.POOrder o ON o.FInterID=e.FInterID
LEFT JOIN dbo.t_Supplier sp ON sp.FItemID=o.FSupplyID
LEFT JOIN dbo.t_ICItem it ON it.FItemID=e.FItemID
LEFT JOIN dbo.t_Item pc ON pc.FItemID=it.FComCategoryID AND pc.FItemClassID=2037
LEFT JOIN dbo.t_Currency cur ON cur.FCurrencyID=o.FCurrencyID
LEFT JOIN dbo.t_Settle st ON st.FItemID=o.FSettleID
LEFT JOIN (
 SELECT pe.FSourceInterID AS oid, pe.FSourceEntryID AS oentry,
  SUM(pe.FQty) AS qty, MAX(ph.FDate) AS last_date
 FROM dbo.ICStockBillEntry pe
 JOIN dbo.ICStockBill ph ON ph.FInterID=pe.FInterID AND ph.FTranType=1
 WHERE pe.FSourceTranType=71
 GROUP BY pe.FSourceInterID, pe.FSourceEntryID
) rc ON rc.oid=e.FInterID AND rc.oentry=e.FEntryID
LEFT JOIN (
 SELECT il.oid, il.oentry, COUNT(*) AS lines, MAX(il.inv_date) AS invoice_date, SUM(il.qty) AS qty,
  SUM(il.net) AS net, SUM(il.tax) AS tax, SUM(${settledShare}) AS paid,
  MIN(ct.status) AS status_min, MAX(ct.status) AS status_max,
  MAX(COALESCE(pl.open_due,pl.last_due)) AS due_date, MAX(pd.d) AS pay_date
 FROM (
  SELECT oe.FSourceInterID AS oid, oe.FSourceEntryID AS oentry, ve.FInterID AS inv,
   vh.FDate AS inv_date, ve.FQty AS qty, ve.FStdAmount AS net, ve.FStdTaxAmount AS tax
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  JOIN dbo.ICStockBillEntry oe ON ve.FSourceTranType=1 AND oe.FInterID=ve.FSourceInterID
   AND oe.FEntryID=ve.FSourceEntryID AND oe.FSourceTranType=71
  UNION ALL
  SELECT ve.FSourceInterID, ve.FSourceEntryID, ve.FInterID, vh.FDate, ve.FQty, ve.FStdAmount, ve.FStdTaxAmount
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  WHERE ve.FSourceTranType=71
  UNION ALL
  SELECT oe.FSourceInterID, oe.FSourceEntryID, ve.FInterID, vh.FDate, ve.FQty, ve.FStdAmount, ve.FStdTaxAmount
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  JOIN dbo.ICPurchaseEntry b ON ve.FSourceTranType=75 AND b.FInterID=ve.FSourceInterID
   AND b.FEntryID=ve.FSourceEntryID AND b.FSourceTranType=1
  JOIN dbo.ICStockBillEntry oe ON oe.FInterID=b.FSourceInterID
   AND oe.FEntryID=b.FSourceEntryID AND oe.FSourceTranType=71
 ) il
 LEFT JOIN (
  SELECT c.FInvoiceID, SUM(c.FAmount) AS a, SUM(c.FRemainAmount) AS r,
   MIN(CASE WHEN c.FRemainAmount=0 THEN 2 WHEN c.FRemainAmount=c.FAmount THEN 0 ELSE 1 END) AS status
  FROM dbo.t_RP_Contact c WHERE c.FRP=0 AND c.FType=4 GROUP BY c.FInvoiceID
 ) ct ON ct.FInvoiceID=il.inv
 LEFT JOIN (
  SELECT p.FInterID,
   MIN(CASE WHEN p.FRemainAmount<>0 OR p.FRemainAmountFor<>0 THEN ${validDate('p.FDate')} END) AS open_due,
   MAX(${validDate('p.FDate')}) AS last_due
  FROM dbo.t_RP_Plan_Ap p WHERE p.FRP=0 GROUP BY p.FInterID
 ) pl ON pl.FInterID=il.inv
 LEFT JOIN (
  SELECT ce.FInvoiceID, MAX(rb.FDate) AS d
  FROM dbo.t_rp_CheckEntry ce JOIN dbo.t_RP_NewReceiveBill rb ON rb.FBillID=ce.FBillID_SRC
  WHERE ce.FType=4 AND ce.FType_SRC=6 GROUP BY ce.FInvoiceID
 ) pd ON pd.FInvoiceID=il.inv
 GROUP BY il.oid, il.oentry
) iv ON iv.oid=e.FInterID AND iv.oentry=e.FEntryID
WHERE o.FCancellation=0 AND o.FDate>=CONVERT(datetime,'${fromDate}',112)${whereExtra}`
});

/** Flat distinct `(order_id, entry_id, invoice_id, invoice_number)` pairs across all 3 invoice paths. */
const listingInvoiceNumbers = (whereExtra = ''): NativeProjection => ({
	sql: `/* kingdee-purchase-listing-invoice-numbers */
SELECT
 RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),x.oid),20)+':'+RIGHT(REPLICATE('0',10)+CONVERT(varchar(10),x.oentry),10)+':'+RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),x.inv_id),20) AS __key,
 x.oid AS order_id, x.oentry AS entry_id, x.inv_no AS invoice_number
FROM (
 SELECT DISTINCT u.oid, u.oentry, u.inv_id, u.inv_no FROM (
  SELECT oe.FSourceInterID AS oid, oe.FSourceEntryID AS oentry, vh.FInterID AS inv_id, vh.FBillNo AS inv_no
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  JOIN dbo.ICStockBillEntry oe ON ve.FSourceTranType=1 AND oe.FInterID=ve.FSourceInterID
   AND oe.FEntryID=ve.FSourceEntryID AND oe.FSourceTranType=71
  UNION ALL
  SELECT ve.FSourceInterID, ve.FSourceEntryID, vh.FInterID, vh.FBillNo
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  WHERE ve.FSourceTranType=71
  UNION ALL
  SELECT oe.FSourceInterID, oe.FSourceEntryID, vh.FInterID, vh.FBillNo
  FROM dbo.ICPurchaseEntry ve
  JOIN dbo.ICPurchase vh ON vh.FInterID=ve.FInterID
  JOIN dbo.ICPurchaseEntry b ON ve.FSourceTranType=75 AND b.FInterID=ve.FSourceInterID
   AND b.FEntryID=ve.FSourceEntryID AND b.FSourceTranType=1
  JOIN dbo.ICStockBillEntry oe ON oe.FInterID=b.FSourceInterID
   AND oe.FEntryID=b.FSourceEntryID AND oe.FSourceTranType=71
 ) u
 JOIN dbo.POOrder o ON o.FInterID=u.oid
 WHERE o.FCancellation=0 AND o.FDate>=CONVERT(datetime,'${fromDate}',112)
  AND u.inv_no IS NOT NULL AND LTRIM(RTRIM(u.inv_no))<>''
) x WHERE 1=1${whereExtra}`
});

/** Hooked customs-duty (`005`) and import-VAT (`002`) expense-invoice lines. */
const expenseLines = (whereExtra = ''): NativeProjection => ({
	sql: `/* kingdee-purchase-listing-expense-lines */
SELECT
 RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),e.FInterID),20)+':'+RIGHT(REPLICATE('0',10)+CONVERT(varchar(10),e.FEntryID),10) AS __key,
 e.FInterID AS expense_id, e.FEntryID AS expense_entry_id,
 x.FHookInterID AS group_id,
 CONVERT(varchar(10),x.FDate,23) AS dated_on,
 CASE WHEN xi.FNumber='005' THEN 'duty' ELSE 'import_vat' END AS kind,
 CONVERT(varchar(40),e.FStdAmount) AS amount
FROM dbo.ICExpenses x
JOIN dbo.ICExpensesEntry e ON e.FInterID=x.FInterID
JOIN dbo.t_Item xi ON xi.FItemID=e.FItemID
WHERE xi.FNumber IN ('002','005') AND x.FCancellation=0 AND x.FHookInterID>0${whereExtra}`
});

/** Single-pass receipt weights per hook group referenced by hooked duty/import-VAT expenses. */
const hookWeights = (whereExtra = ''): NativeProjection => ({
	sql: `/* kingdee-purchase-listing-hook-weights */
SELECT
 RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),gl.grp),20)+':'+RIGHT(REPLICATE('0',20)+CONVERT(varchar(20),gl.oid),20)+':'+RIGHT(REPLICATE('0',10)+CONVERT(varchar(10),gl.oentry),10) AS __key,
 gl.grp AS group_id, gl.oid AS order_id, gl.oentry AS entry_id,
 CONVERT(varchar(40),gl.w) AS weight,
 CONVERT(bit,CASE WHEN o.FCancellation=0 AND o.FDate>=CONVERT(datetime,'${fromDate}',112) THEN 1 ELSE 0 END) AS in_report
FROM (
 SELECT h.FGroupNo AS grp, pe.FSourceInterID AS oid, pe.FSourceEntryID AS oentry, SUM(pe.FAmount) AS w
 FROM (SELECT DISTINCT FGroupNo, FIBInterID, FEntryID FROM dbo.ICHookRelations
  WHERE FHookType=0 AND FTranType=1) h
 JOIN dbo.ICStockBillEntry pe ON pe.FInterID=h.FIBInterID AND pe.FEntryID=h.FEntryID
  AND pe.FSourceTranType=71
 WHERE h.FGroupNo IN (
  SELECT DISTINCT x.FHookInterID
  FROM dbo.ICExpenses x
  JOIN dbo.ICExpensesEntry e ON e.FInterID=x.FInterID
  JOIN dbo.t_Item xi ON xi.FItemID=e.FItemID
  WHERE xi.FNumber IN ('002','005') AND x.FCancellation=0 AND x.FHookInterID>0
 )
 GROUP BY h.FGroupNo, pe.FSourceInterID, pe.FSourceEntryID
) gl
LEFT JOIN dbo.POOrder o ON o.FInterID=gl.oid
WHERE 1=1${whereExtra}`
});

const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const cleanOrNull = (value: string | null) => {
	if (value === null) return null;
	const trimmed = clean(value);
	return trimmed || null;
};
const optionalInt = (row: SqlRow, name: string): number | null => {
	const value = row[name];
	if (value === null || value === undefined) return null;
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof n !== 'number' || !Number.isInteger(n))
		throw invalid(name, 'Expected an integer value');
	return n;
};
const decimalOrNull = (row: SqlRow, name: string, scale: number): string | null => {
	const value = columns(row).decimal(name, null);
	return value === null ? null : fixedDecimal(value, scale);
};
const sumOptional = (a: string | null, b: string | null, scale: number): string | null =>
	a === null && b === null
		? null
		: fixedDecimal(
				BigDecimal.sum(
					BigDecimal.fromStringUnsafe(a ?? '0'),
					BigDecimal.fromStringUnsafe(b ?? '0')
				),
				scale
			);

type Entry = Row<'source_purchase_orders'>['entries'][number];

function mapExpenseLine(row: SqlRow, moneyScale: number): ExpenseLine {
	const kind = text(row, 'kind');
	if (kind !== 'duty' && kind !== 'import_vat')
		throw invalid('kind', 'Expected duty or import_vat expense kind');
	const dated_on = sourceDate(row, 'dated_on');
	const amount = decimalOrNull(row, 'amount', moneyScale);
	if (!dated_on || amount === null)
		throw invalid('ICExpensesEntry', 'Expense line requires a date and numeric amount');
	return {
		expense_id: exactId(row, 'expense_id'),
		expense_entry_id: exactId(row, 'expense_entry_id'),
		group_id: exactId(row, 'group_id'),
		dated_on,
		kind,
		amount
	};
}

function mapHookWeight(row: SqlRow): HookWeight {
	const weight = decimalOrNull(row, 'weight', 8);
	if (weight === null) throw invalid('ICHookRelations', 'Hook weight requires a numeric amount');
	return {
		group_id: exactId(row, 'group_id'),
		order_id: exactId(row, 'order_id'),
		entry_id: exactId(row, 'entry_id'),
		weight,
		in_report: flag(row, 'in_report')
	};
}

export function mapPurchaseListingEntry(
	row: SqlRow,
	share: { readonly duty: string | null; readonly import_vat: string | null },
	rules: typeof SettlementRules.Type,
	moneyScale = 2,
	invoiceNumbers?: string | null
): Entry {
	const order_id = exactId(row, 'order_id');
	const entry_id = exactId(row, 'entry_id');
	const ordered_on = sourceDate(row, 'ordered_on');
	if (!ordered_on) throw invalid('FDate', 'Purchase order line requires an order date');
	const quantity = decimalOrNull(row, 'quantity', 3);
	const received_qty = decimalOrNull(row, 'received_qty', 3);
	if (quantity === null || received_qty === null)
		throw invalid('FQty', 'Purchase order line requires valid quantities');
	const rawCategory = cleanOrNull(nullableText(row, 'product_category'));
	const rawSettle = cleanOrNull(nullableText(row, 'settlement'));
	const settlement = rawSettle === '*' ? null : rawSettle;
	const settleCode = cleanOrNull(nullableText(row, 'settlement_code'));
	const rule = settleCode ? rules[settleCode] : undefined;
	const rawCurrency = cleanOrNull(nullableText(row, 'currency'));
	const currencyCode = rawCurrency === 'RMB' ? 'CNY' : rawCurrency;
	const invoiced_on = sourceDate(row, 'invoiced_on');
	const invoiced_qty = decimalOrNull(row, 'invoiced_qty', 3);
	const net_amount = decimalOrNull(row, 'net_amount', moneyScale);
	const invoice_tax = decimalOrNull(row, 'invoice_tax', moneyScale);
	const invoice_amount =
		net_amount === null ? null : sumOptional(net_amount, invoice_tax, moneyScale);
	const vat_amount = sumOptional(invoice_tax, share.import_vat, moneyScale);
	const planDue = safeDueDate(sourceDate(row, 'due_on'));
	const due_on =
		planDue ??
		(invoiced_on !== null && rule !== undefined
			? settlementDate(invoiced_on, rule.creditDays, rule.fromMonthEnd)
			: null);
	const invoiceLines = optionalInt(row, 'invoice_lines') ?? 0;
	const resolvedInvoiceNos =
		invoiceNumbers !== undefined
			? invoiceNumbers
			: cleanOrNull(nullableText(row, 'invoice_numbers'));
	return {
		order_id,
		entry_id,
		order_number: cleanOrNull(nullableText(row, 'order_number')) ?? '',
		ordered_on,
		supplier_id: row['supplier_id'] == null ? null : exactId(row, 'supplier_id'),
		supplier_name: cleanOrNull(nullableText(row, 'supplier_name')),
		product_category: rawCategory === '*' ? null : rawCategory,
		product_spec: cleanOrNull(nullableText(row, 'product_spec')),
		quantity,
		currency: currencyCode,
		unit_price: decimalOrNull(row, 'unit_price', 8),
		exchange_rate: decimalOrNull(row, 'exchange_rate', 8),
		amount: decimalOrNull(row, 'amount', moneyScale),
		amount_base: decimalOrNull(row, 'amount_base', moneyScale),
		received_qty,
		last_received_on: sourceDate(row, 'last_received_on'),
		invoice_numbers: resolvedInvoiceNos,
		invoiced_on,
		invoiced_qty,
		invoice_amount,
		duty: share.duty,
		vat_amount,
		net_amount,
		settlement,
		due_on,
		paid_amount: decimalOrNull(row, 'paid_amount', moneyScale),
		paid_on: sourceDate(row, 'paid_on'),
		payment_status: purchasePaymentStatus(
			invoiceLines,
			optionalInt(row, 'status_min'),
			optionalInt(row, 'status_max'),
			invoiced_qty,
			quantity
		),
		note: cleanOrNull(nullableText(row, 'note'))
	};
}

const sourceCheckpoint = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string) {
	const [row] = yield* readNativeRows(ctx, checkpoint, { account });
	if (!row) return yield* invalid('POOrder', 'Purchase listing checkpoint returned no row');
	return yield* checked(() => {
		const r = columns(row);
		return {
			digest: r.text('digest'),
			observed_at: r.instant('observed_at')
		};
	});
});

export const testPurchaseListing = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string
) {
	yield* sourceCheckpoint(ctx, account);
	// SQL Server checks every table, column and SELECT permission even with 0 rows returned.
	yield* readNativeRows(ctx, listingLines(' AND 1=0'), { account });
	yield* readNativeRows(ctx, listingInvoiceNumbers(' AND 1=0'), { account });
	yield* readNativeRows(ctx, expenseLines(' AND 1=0'), { account });
	yield* readNativeRows(ctx, hookWeights(' AND 1=0'), { account });
});

const Cursor = Schema.Struct({
	protocol: Schema.Literal('kingdee-purchase-listing-v1'),
	account: Schema.String,
	scope: Schema.String,
	checkpoint: Schema.String,
	observed_at: Schema.String,
	periods: Schema.Record(Schema.String, Schema.String),
	notice_digest: Schema.String,
	latest_period: Schema.NullOr(Schema.String)
});

export const readPurchaseListing = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>,
	unchanged: boolean
) {
	if (!ctx.configuration.purchaseListingAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeePurchaseListingAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Purchase listing requires a verified account identity'
		});
	if (!unchanged) {
		const { sys_integration: ledgers } = yield* ctx.query({
			sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
		});
		if (
			ledgers.rows.some(
				(row) => row.id !== instance && kingdeePurchaseListingAccount(row.configuration) === account
			)
		)
			return yield* new SourceUnavailable({
				reason: 'Enable purchase listing on one ledger per account set'
			});
	}
	const prior =
		cursor === null
			? null
			: yield* Schema.decodeUnknownEffect(Cursor)(cursor).pipe(
					Effect.mapError(() => invalid('$cursor', 'The purchase listing checkpoint is invalid'))
				);
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The verified purchase listing account changed. Review its retained snapshot before resetting.'
		);
	const denomination = yield* checked(() => currency(ctx.configuration.baseCurrency));
	const digits = currencyDigits(denomination);
	const rules = kingdeeSettlementRules(ctx.configuration);
	const scope = yield* sha256Hex(JSON.stringify([account, denomination, rules]));
	const before = yield* sourceCheckpoint(ctx, account);
	// When nothing changed in Kingdee or local settlement rules, wake neither the read joins nor the tenant DB.
	if (prior !== null && prior.scope === scope && prior.checkpoint === before.digest)
		return { rows: [], cursor, more: false };

	const [rawLines, rawInvoices, rawExpenses, rawWeights] = yield* Effect.all(
		[
			readNativeRows(ctx, listingLines(), { account }),
			readNativeRows(ctx, listingInvoiceNumbers(), { account }),
			readNativeRows(ctx, expenseLines(), { account }),
			readNativeRows(ctx, hookWeights(), { account })
		],
		{ concurrency: 4 }
	);
	const after = yield* sourceCheckpoint(ctx, account);
	if (after.digest !== before.digest)
		return yield* invalid(
			'POOrder',
			'Purchase documents changed during this read. The previous snapshot is retained.'
		);

	const { entries, notice } = yield* checked(() => {
		const invoicesByLine = new Map<string, Set<string>>();
		for (const row of rawInvoices) {
			const no = cleanOrNull(nullableText(row, 'invoice_number'));
			if (!no) continue;
			const key = `${exactId(row, 'order_id')}/${exactId(row, 'entry_id')}`;
			const set = invoicesByLine.get(key);
			if (set) set.add(no);
			else invoicesByLine.set(key, new Set([no]));
		}
		const seen = new Set<string>();
		for (const row of rawLines) {
			const key = `${exactId(row, 'order_id')}/${exactId(row, 'entry_id')}`;
			if (seen.has(key))
				throw invalid('POOrderEntry', `Purchase listing returned duplicate PO line ${key}`);
			seen.add(key);
		}
		const expenses = rawExpenses.map((row) => mapExpenseLine(row, digits));
		const weights = rawWeights.map(mapHookWeight);
		const { shares, notice } = summarizeExpenses(expenses, weights, seen, digits);
		const mapped = rawLines.map((row) => {
			const key = `${exactId(row, 'order_id')}/${exactId(row, 'entry_id')}`;
			const share = shares.get(key) ?? { duty: null, import_vat: null };
			const nos = invoicesByLine.get(key);
			const invoiceNumbers = nos ? [...nos].sort().join(', ') : null;
			return mapPurchaseListingEntry(row, share, rules, digits, invoiceNumbers);
		});
		return { entries: mapped, notice };
	});

	const byPeriod = new Map<string, Entry[]>();
	for (const entry of entries) {
		const period = entry.ordered_on.slice(0, 7);
		const list = byPeriod.get(period);
		if (list) list.push(entry);
		else byPeriod.set(period, [entry]);
	}
	const periods = [...byPeriod.keys()].sort();
	const latestPeriod = periods.at(-1) ?? null;
	const noticeDigest = yield* sha256Hex(JSON.stringify([latestPeriod, notice]));
	const nextDigests: Record<string, string> = {};
	const rows: {
		readonly $id: string;
		readonly period: string;
		readonly currency: Row<'source_purchase_orders'>['currency'];
		readonly observed_at: Row<'source_purchase_orders'>['observed_at'];
		readonly entries: Entry[];
		readonly expense_notice: typeof notice | null;
	}[] = [];

	for (const period of periods) {
		const list = byPeriod.get(period) ?? [];
		const payload = JSON.stringify(list);
		if (new TextEncoder().encode(payload).byteLength > 5 * 1024 * 1024)
			return yield* invalid(
				'POOrderEntry',
				`Purchase listing period ${period} exceeds its atomic publish bound`
			);
		const digest = yield* sha256Hex(payload);
		nextDigests[period] = digest;
		const isLatest = period === latestPeriod;
		const noticeChanged =
			prior === null ||
			prior.scope !== scope ||
			(isLatest && prior.notice_digest !== noticeDigest) ||
			(!isLatest && prior.latest_period === period);
		if (
			prior === null ||
			prior.scope !== scope ||
			prior.periods[period] !== digest ||
			noticeChanged
		)
			rows.push({
				$id: `purchase-listing:${period}`,
				period,
				currency: denomination,
				observed_at: Instant(after.observed_at),
				entries: list,
				expense_notice: isLatest ? notice : null
			});
	}
	// Any previously published month whose POs were all cancelled empties cleanly.
	if (prior !== null) {
		for (const previous of Object.keys(prior.periods)) {
			if (!byPeriod.has(previous))
				rows.push({
					$id: `purchase-listing:${previous}`,
					period: previous,
					currency: denomination,
					observed_at: Instant(after.observed_at),
					entries: [],
					expense_notice: null
				});
		}
	}

	return {
		rows,
		cursor: {
			protocol: 'kingdee-purchase-listing-v1' as const,
			account,
			scope,
			checkpoint: after.digest,
			observed_at: after.observed_at,
			periods: nextDigests,
			notice_digest: noticeDigest,
			latest_period: latestPeriod
		},
		more: false
	};
});
