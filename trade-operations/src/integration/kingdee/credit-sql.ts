/**
 * Shared SQL Server (compatibility level 100+) credit exposure & overdue queries.
 *
 * Uses runtime `OBJECT_ID` / `COL_LENGTH` feature detection via nested `sp_executesql` so:
 * - On full Kingdee KIS databases, it executes the exact `p_IC_InitCreditInstantData` & `v_IC_CreditPlan_AR`
 *   formula (partial DO hooking `FAllHookQty / FQty * FConsignAmount`, `t_rp_ARBillOfSH` audited receipts/advances/refunds,
 *   `ICSaleEntry` + `FAdjustAmount` + `t_Rp_BegData` + `t_RP_ARPBill`, and `v_IC_CreditPlan_AR` due dates).
 * - On minimal SQL test/simulator schemas where those KIS-only tables/columns are absent, it runs the
 *   clean 10-table fallback without SQL Server compile-time column binding errors (`Msg 207`).
 */

export const sqlLiteral = (sql: string) => `N'${sql.replaceAll("'", "''")}'`;

export const FULL_KIS_EXPOSURE_GUARD =
	"OBJECT_ID('dbo.t_rp_ARBillOfSH','U') IS NOT NULL" +
	" AND OBJECT_ID('dbo.t_Rp_BegData','U') IS NOT NULL" +
	" AND OBJECT_ID('dbo.t_Rp_BegDataEntry','U') IS NOT NULL" +
	" AND OBJECT_ID('dbo.t_RP_ARPBill','U') IS NOT NULL" +
	" AND OBJECT_ID('dbo.t_RP_ARPBillEntry','U') IS NOT NULL" +
	" AND COL_LENGTH('dbo.ICStockBillEntry','FAllHookQty') IS NOT NULL" +
	" AND COL_LENGTH('dbo.ICSaleEntry','FStdAmountIncludeTax') IS NOT NULL" +
	" AND COL_LENGTH('dbo.ICSale','FAdjustAmount') IS NOT NULL" +
	" AND COL_LENGTH('dbo.t_RP_NewReceiveBill','FClassTypeID') IS NOT NULL";

export const FULL_KIS_OVERDUE_GUARD = "OBJECT_ID('dbo.v_IC_CreditPlan_AR','V') IS NOT NULL";

export const EXPOSURE_TABLE_DECL = `DECLARE @exp TABLE (
 customer_id int PRIMARY KEY,
 invoices_audited numeric(28,4) NOT NULL,
 invoices_paid numeric(28,4) NOT NULL,
 refunds_unsettled numeric(28,4) NOT NULL,
 receipts_unsettled numeric(28,4) NOT NULL,
 advances_unsettled numeric(28,4) NOT NULL,
 stock_out_audited numeric(28,4) NOT NULL,
 stock_out_hooked numeric(28,4) NOT NULL
);`;

/**
 * Populates `@exp` for the distinct `FItemID` set produced by `customerSourceSql`.
 * Optional `paramDecl` / `paramPass` forward outer parameters (e.g. `@ids xml`) into `sp_executesql`.
 */
export function populateExposureSql(
	customerSourceSql: string,
	options?: { readonly paramDecl?: string; readonly paramPass?: string }
): string {
	const fullQuery = `SELECT c.FItemID AS customer_id,
 CONVERT(numeric(28,4), COALESCE(inv.invoiced,0) + COALESCE(adj.invoiced,0) + COALESCE(beg.invoiced,0) + COALESCE(oth.invoiced,0) + COALESCE(oth_adj.invoiced,0)) AS invoices_audited,
 CONVERT(numeric(28,4), COALESCE(inv.paid,0) + COALESCE(oth.paid,0)) AS invoices_paid,
 CONVERT(numeric(28,4), COALESCE(rc.refunds,0) + COALESCE(rc_adj.refunds,0)) AS refunds_unsettled,
 CONVERT(numeric(28,4), COALESCE(rc.receipts,0) + COALESCE(rc_adj.receipts,0)) AS receipts_unsettled,
 CONVERT(numeric(28,4), COALESCE(rc.advances,0) + COALESCE(rc_adj.advances,0) + COALESCE(beg_adv.advances,0)) AS advances_unsettled,
 CONVERT(numeric(28,4), COALESCE(d.issued,0)) AS stock_out_audited,
 CONVERT(numeric(28,4), COALESCE(d.hooked,0)) AS stock_out_hooked
FROM (${customerSourceSql}) c
OUTER APPLY (
 SELECT COALESCE(SUM(CASE WHEN s.FTranType IN (80,602) THEN e.FStdAmountIncludeTax ELSE e.FStdAmount END),0) AS invoiced,
  COALESCE(SUM(CASE WHEN s.FSaleStyle=100 THEN 0 ELSE e.FCheckAmount END),0) AS paid
 FROM dbo.ICSale s JOIN dbo.ICSaleEntry e ON e.FInterID=s.FInterID
 WHERE ISNULL(s.FCheckerID,0)>0 AND s.FTranType IN (80,86,602,601) AND s.FCancellation=0 AND s.FCustID=c.FItemID
) inv
OUTER APPLY (
 SELECT COALESCE(SUM(s.FAdjustAmount),0) AS invoiced
 FROM dbo.ICSale s
 WHERE ISNULL(s.FCheckerID,0)>0 AND s.FTranType IN (80,86,602,601) AND s.FCancellation=0
  AND s.FAdjustAmount<>0 AND s.FCustID=c.FItemID
) adj
OUTER APPLY (
 SELECT COALESCE(SUM(e.FRemainAmount),0) AS invoiced
 FROM dbo.t_Rp_BegData b JOIN dbo.t_Rp_BegDataEntry e ON e.FInterID=b.FInterID
 WHERE b.FClassTypeID IN (1000500,1000501,1000520) AND b.FComID=c.FItemID
) beg
OUTER APPLY (
 SELECT COALESCE(SUM(e.FAmount),0) AS invoiced, COALESCE(SUM(e.FCheckAmount),0) AS paid
 FROM dbo.t_RP_ARPBill b JOIN dbo.t_RP_ARPBillEntry e ON e.FBillID=b.FBillID
 WHERE ISNULL(b.FChecker,0)>0 AND b.FClassTypeID=1000021 AND b.FCustomer=c.FItemID
) oth
OUTER APPLY (
 SELECT COALESCE(SUM(b.FAdjustAmount),0) AS invoiced
 FROM dbo.t_RP_ARPBill b
 WHERE ISNULL(b.FChecker,0)>0 AND b.FClassTypeID=1000021 AND b.FCustomer=c.FItemID
) oth_adj
OUTER APPLY (
 SELECT
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000015 THEN e.FSettleAmount+e.FDiscount-(-e.FCheckAmount) ELSE 0 END),0) AS refunds,
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000005 THEN e.FSettleAmount+e.FDiscount-e.FCheckAmount ELSE 0 END),0) AS receipts,
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000014 THEN e.FSettleAmount+e.FDiscount-e.FCheckAmount ELSE 0 END),0) AS advances
 FROM dbo.t_RP_NewReceiveBill b JOIN dbo.t_rp_ARBillOfSH e ON e.FBillID=b.FBillID
 WHERE ISNULL(b.FChecker,0)>0 AND (b.FRP_CN=2 OR b.FConfirm=1)
  AND b.FClassTypeID IN (1000005,1000014,1000015) AND b.FCustomer=c.FItemID
) rc
OUTER APPLY (
 SELECT
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000015 THEN -b.FAdjustAmount ELSE 0 END),0) AS refunds,
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000005 THEN b.FAdjustAmount ELSE 0 END),0) AS receipts,
  COALESCE(SUM(CASE WHEN b.FClassTypeID=1000014 THEN b.FAdjustAmount ELSE 0 END),0) AS advances
 FROM dbo.t_RP_NewReceiveBill b
 WHERE ISNULL(b.FChecker,0)>0 AND (b.FRP_CN=2 OR b.FConfirm=1)
  AND b.FClassTypeID IN (1000005,1000014,1000015) AND b.FCustomer=c.FItemID
) rc_adj
OUTER APPLY (
 SELECT COALESCE(SUM(e.FRemainAmount),0) AS advances
 FROM dbo.t_Rp_BegData b JOIN dbo.t_Rp_BegDataEntry e ON e.FInterID=b.FInterID
 WHERE b.FClassTypeID=1000510 AND b.FComID=c.FItemID
) beg_adv
OUTER APPLY (
 SELECT COALESCE(SUM(e.FConsignAmount),0) AS issued,
  COALESCE(SUM(CASE WHEN e.FQty=0 THEN 0 ELSE CONVERT(numeric(18,2), ISNULL(e.FAllHookQty,0) / e.FQty * e.FConsignAmount) END),0) AS hooked
 FROM dbo.ICStockBill b JOIN dbo.ICStockBillEntry e ON e.FInterID=b.FInterID
 WHERE b.FTranType=21 AND b.FStatus>0 AND b.FCancellation=0 AND b.FSupplyID=c.FItemID
) d`;

	const minimalQuery = `SELECT c.FItemID AS customer_id,
 CONVERT(numeric(28,4), COALESCE(i.invoiced,0)) AS invoices_audited,
 CONVERT(numeric(28,4), COALESCE(i.paid,0)) AS invoices_paid,
 CONVERT(numeric(28,4), COALESCE(r.refunds,0)) AS refunds_unsettled,
 CONVERT(numeric(28,4), COALESCE(r.receipts,0)) AS receipts_unsettled,
 CONVERT(numeric(28,4), COALESCE(r.advances,0)) AS advances_unsettled,
 CONVERT(numeric(28,4), COALESCE(d.issued,0)) AS stock_out_audited,
 CONVERT(numeric(28,4), COALESCE(d.hooked,0)) AS stock_out_hooked
FROM (${customerSourceSql}) c
OUTER APPLY(SELECT COALESCE(SUM(a.FAmount),0) AS invoiced,
 COALESCE(SUM(a.FAmount-a.FRemainAmount),0) AS paid
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
 WHERE b.FTranType=21 AND b.FStatus<>0 AND b.FCancellation=0 AND b.FSupplyID=c.FItemID) d`;

	const execArgs = options?.paramDecl
		? `, N'${options.paramDecl}', ${options.paramPass ?? ''}`
		: '';
	return `${EXPOSURE_TABLE_DECL}
DECLARE @expSql nvarchar(max);
IF ${FULL_KIS_EXPOSURE_GUARD}
 SET @expSql = ${sqlLiteral(fullQuery)};
ELSE
 SET @expSql = ${sqlLiteral(minimalQuery)};
INSERT INTO @exp EXEC sys.sp_executesql @expSql${execArgs};`;
}

export const OVERDUE_SUMMARY_TABLE_DECL = `DECLARE @ovSummary TABLE (
 customer_id int PRIMARY KEY,
 oldest_days int NULL,
 invalid_terms int NOT NULL
);`;

/** Populates `@ovSummary` (oldest open AR day count + invalid term count) from `v_IC_CreditPlan_AR` or `t_RP_Contact`. */
export function populateOverdueSummarySql(customerSourceSql: string): string {
	const fullQuery = `SELECT c.FItemID AS customer_id,
 MAX(CASE WHEN p.FRemainAmount>0 THEN DATEDIFF(day,p.FDate,GETDATE()) END) AS oldest_days,
 COALESCE(SUM(CASE WHEN p.FRemainAmount>0 AND (p.FDate IS NULL OR p.FDate<='19010101') THEN 1 ELSE 0 END),0) AS invalid_terms
FROM (${customerSourceSql}) c
LEFT JOIN dbo.v_IC_CreditPlan_AR p ON p.FCustID=c.FItemID AND p.FChecked=1
GROUP BY c.FItemID`;

	const minimalQuery = `SELECT c.FItemID AS customer_id,
 MAX(CASE WHEN a.FRemainAmount>0 THEN DATEDIFF(day,COALESCE(s.FSettleDate,s.FDate),GETDATE()) END) AS oldest_days,
 COALESCE(SUM(CASE WHEN a.FRemainAmount>0 AND (COALESCE(s.FSettleDate,s.FDate) IS NULL OR COALESCE(s.FSettleDate,s.FDate)<='19010101') THEN 1 ELSE 0 END),0) AS invalid_terms
FROM (${customerSourceSql}) c
LEFT JOIN dbo.t_RP_Contact a ON a.FCustomer=c.FItemID AND a.FRP=1 AND a.FType=3
LEFT JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID AND s.FStatus<>0 AND s.FCancellation=0
GROUP BY c.FItemID`;

	return `${OVERDUE_SUMMARY_TABLE_DECL}
DECLARE @ovSql nvarchar(max);
IF ${FULL_KIS_OVERDUE_GUARD}
 SET @ovSql = ${sqlLiteral(fullQuery)};
ELSE
 SET @ovSql = ${sqlLiteral(minimalQuery)};
INSERT INTO @ovSummary EXEC sys.sp_executesql @ovSql;`;
}

export const OVERDUE_ITEMS_TABLE_DECL = `DECLARE @ovItems TABLE (
 customer_id int NOT NULL,
 bill_no nvarchar(200) NOT NULL,
 basis_date varchar(10) NULL,
 amount numeric(28,4) NOT NULL,
 invalid_term bit NOT NULL
);`;

/** Populates `@ovItems` (open AR rows per customer) from `v_IC_CreditPlan_AR` or `t_RP_Contact` + `ICSale`. */
export function populateOverdueItemsSql(
	customerSourceSql: string,
	options?: { readonly paramDecl?: string; readonly paramPass?: string }
): string {
	const fullQuery = `SELECT p.FCustID AS customer_id,
 LTRIM(RTRIM(ISNULL(p.FBillNo,''))) AS bill_no,
 CASE WHEN p.FDate>'19010101' THEN CONVERT(varchar(10),p.FDate,23) END AS basis_date,
 CONVERT(numeric(28,4), p.FRemainAmount) AS amount,
 CONVERT(bit, CASE WHEN p.FDate IS NULL OR p.FDate<='19010101' THEN 1 ELSE 0 END) AS invalid_term
FROM (${customerSourceSql}) c
JOIN dbo.v_IC_CreditPlan_AR p ON p.FCustID=c.FItemID AND p.FChecked=1 AND p.FRemainAmount>0`;

	const minimalQuery = `SELECT a.FCustomer AS customer_id,
 LTRIM(RTRIM(ISNULL(s.FBillNo,''))) AS bill_no,
 CASE WHEN COALESCE(s.FSettleDate,s.FDate)>'19010101' THEN CONVERT(varchar(10),COALESCE(s.FSettleDate,s.FDate),23) END AS basis_date,
 CONVERT(numeric(28,4), a.FRemainAmount) AS amount,
 CONVERT(bit, CASE WHEN COALESCE(s.FSettleDate,s.FDate) IS NULL OR COALESCE(s.FSettleDate,s.FDate)<='19010101' THEN 1 ELSE 0 END) AS invalid_term
FROM (${customerSourceSql}) c
JOIN dbo.t_RP_Contact a ON a.FCustomer=c.FItemID AND a.FRP=1 AND a.FType=3 AND a.FRemainAmount>0
JOIN dbo.ICSale s ON s.FInterID=a.FInvoiceID AND s.FStatus<>0 AND s.FCancellation=0`;

	const execArgs = options?.paramDecl
		? `, N'${options.paramDecl}', ${options.paramPass ?? ''}`
		: '';
	return `${OVERDUE_ITEMS_TABLE_DECL}
DECLARE @ovItemsSql nvarchar(max);
IF ${FULL_KIS_OVERDUE_GUARD}
 SET @ovItemsSql = ${sqlLiteral(fullQuery)};
ELSE
 SET @ovItemsSql = ${sqlLiteral(minimalQuery)};
INSERT INTO @ovItems EXEC sys.sp_executesql @ovItemsSql${execArgs};`;
}

/** Reads KIS `t_SystemProfile` `IC/CreditEnable` into `@credit_enabled` when the table exists. */
export const READ_CREDIT_ENABLED_SQL = `DECLARE @credit_enabled varchar(20) = NULL;
IF OBJECT_ID('dbo.t_SystemProfile','U') IS NOT NULL BEGIN
 DECLARE @ceSql nvarchar(max) = N'SELECT TOP (1) @val = LTRIM(RTRIM(ISNULL(CONVERT(varchar(20),FValue),''''))) FROM dbo.t_SystemProfile WHERE FCategory=''IC'' AND FKey=''CreditEnable''';
 EXEC sys.sp_executesql @ceSql, N'@val varchar(20) OUTPUT', @val=@credit_enabled OUTPUT;
END;`;
