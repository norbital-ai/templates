-- Disposable local probe database only; never apply to a customer account set.
-- Synthetic dbo-shaped KIS objects exercise the real bindings and SQL transport.
-- This is not a complete Kingdee schema or evidence of live vendor compatibility.
-- SQL Server 2019 target; no CDC capture objects, Agent jobs, or source progress tables.

CREATE TABLE dbo.t_Item (
 FItemID int NOT NULL PRIMARY KEY,
 FItemClassID int NOT NULL,
 FNumber nvarchar(100) NOT NULL,
 FName nvarchar(255) NOT NULL,
 FDetail bit NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FUnUsed bit NOT NULL DEFAULT 0,
 FParentID int NULL,
 FModifyTime rowversion NOT NULL
);
CREATE TABLE dbo.t_Organization (
 FItemID int NOT NULL PRIMARY KEY,
 FNumber nvarchar(100) NOT NULL,
 FName nvarchar(255) NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FAddress nvarchar(500) NULL,
 FPhone nvarchar(100) NULL,
 FCurrencyID int NOT NULL DEFAULT 0,
 FModifyTime rowversion NOT NULL
);
CREATE TABLE dbo.t_Supplier (
 FItemID int NOT NULL PRIMARY KEY,
 FNumber nvarchar(100) NOT NULL,
 FName nvarchar(255) NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FModifyTime rowversion NOT NULL
);
CREATE TABLE dbo.t_ICItemCore (
 FItemID int NOT NULL PRIMARY KEY,
 FModel nvarchar(255) NULL,
 FUnitID int NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FModifyTime rowversion NOT NULL
);
GO
-- The physical source may expose the detail relation through a view. Its marker
-- still comes from the actual native rowversion column, not a computed counter.
CREATE VIEW dbo.t_ICItem AS
 SELECT FItemID,FModel,FUnitID,FDeleted,FModifyTime FROM dbo.t_ICItemCore;
GO
CREATE TABLE dbo.t_Stock (
 FItemID int NOT NULL PRIMARY KEY,
 FName nvarchar(255) NOT NULL,
 FAddress nvarchar(500) NULL,
 FPhone nvarchar(100) NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FModifyTime rowversion NOT NULL
);
CREATE TABLE dbo.t_Currency (
 FCurrencyID int NOT NULL PRIMARY KEY,
 FNumber nvarchar(20) NOT NULL,
 FName nvarchar(100) NOT NULL,
 FExchangeRate decimal(28,10) NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0
);
CREATE TABLE dbo.t_Emp (
 FItemID int NOT NULL PRIMARY KEY,
 FDeleted bit NOT NULL DEFAULT 0
);
CREATE TABLE dbo.t_Department (
 FItemID int NOT NULL PRIMARY KEY,
 FDeleted bit NOT NULL DEFAULT 0
);
CREATE TABLE dbo.t_User (
 FUserID int NOT NULL PRIMARY KEY,
 FName nvarchar(255) NOT NULL
);
CREATE TABLE dbo.t_Settle (
 FItemID int NOT NULL PRIMARY KEY,
 FNumber nvarchar(100) NOT NULL,
 FName nvarchar(255) NOT NULL,
 FDeleted bit NOT NULL DEFAULT 0,
 FModifyTime rowversion NOT NULL
);
CREATE TABLE dbo.ICInventory (
 FItemID int NOT NULL,
 FStockID int NOT NULL,
 FBatchNo nvarchar(100) NOT NULL,
 FQty decimal(28,10) NOT NULL,
 FStockPlaceID int NOT NULL DEFAULT 0,
 FAuxPropID int NOT NULL DEFAULT 0,
 FMTONo nvarchar(100) NOT NULL DEFAULT '',
 FQtyLock decimal(28,10) NOT NULL DEFAULT 0,
 FLastUpdateTime datetime NOT NULL DEFAULT GETDATE()
);

CREATE TABLE dbo.ICMaxNum (
 FTableName nvarchar(100) NOT NULL PRIMARY KEY,
 FMaxNum int NOT NULL
);
CREATE TABLE dbo.SEOrder (
 FBrNo nvarchar(20) NOT NULL,
 FInterID int NOT NULL,
 FUUID uniqueidentifier NOT NULL DEFAULT NEWID(),
 FBillNo nvarchar(100) NOT NULL,
 FTranType int NOT NULL DEFAULT 81,
 FCurrencyID int NOT NULL,
 FCustID int NOT NULL,
 FDate datetime NOT NULL,
 FExchangeRate decimal(28,10) NOT NULL,
 FDeptID int NOT NULL,
 FEmpID int NOT NULL,
 FBillerID int NOT NULL,
 FSettleID int NOT NULL,
 FSysStatus int NOT NULL DEFAULT 2,
 FAreaPS int NOT NULL DEFAULT 20302,
 FSaleStyle int NULL DEFAULT 102,
 FSendWay nvarchar(20) NOT NULL DEFAULT 'N',
 FWXCardCouponsMoney nvarchar(100) NOT NULL DEFAULT '',
 FDeliveryProvince nvarchar(100) NOT NULL DEFAULT '0',
 FDeliveryCity nvarchar(100) NOT NULL DEFAULT '0',
 FDeliveryDistrict nvarchar(100) NOT NULL DEFAULT '0',
 FDeliveryTownship nvarchar(100) NOT NULL DEFAULT '0',
 FMangerID int NOT NULL DEFAULT 0,
 FTransitAheadTime int NOT NULL DEFAULT 0,
 FManageType int NOT NULL DEFAULT 0,
 FValidaterName nvarchar(255) NOT NULL DEFAULT '',
 FFetchStyle nvarchar(255) NOT NULL DEFAULT '',
 FFetchAdd nvarchar(500) NOT NULL DEFAULT '',
 FOutStoreDate datetime NOT NULL DEFAULT '19000101',
 FOutStoreTime nvarchar(100) NOT NULL DEFAULT '',
 FTplOrderID nvarchar(100) NOT NULL DEFAULT '',
 FHeadSelfS0191 nvarchar(255) NOT NULL DEFAULT '',
 FHeadSelfS0192 nvarchar(255) NOT NULL DEFAULT '-',
 FSettleDate datetime NULL,
 FCheckerID int NULL,
 FCheckDate datetime NULL,
 FChangeDate datetime NULL,
 FChangeUser int NULL,
 FClosed bit NOT NULL DEFAULT 0,
 FCancellation bit NOT NULL DEFAULT 0,
 FChangeMark bit NOT NULL DEFAULT 0,
 FStatus int NOT NULL DEFAULT 0,
 FVersionNo nvarchar(30) NOT NULL DEFAULT '000',
 FOperDate rowversion NOT NULL,
 CONSTRAINT PK_Probe_SEOrder PRIMARY KEY (FBrNo,FInterID),
 CONSTRAINT UQ_Probe_SEOrder_UUID UNIQUE (FUUID)
);
CREATE TABLE dbo.SEOrderEntry (
 FDetailID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
 FBrNO nvarchar(20) NOT NULL,
 FInterID int NOT NULL,
 FEntryID int NOT NULL,
 FItemID int NOT NULL,
 FUnitID int NOT NULL,
 FQty decimal(28,10) NOT NULL,
 Fauxqty decimal(28,10) NOT NULL,
 FAuxStockAwaitQty decimal(28,10) NOT NULL,
 FComplexQty decimal(28,10) NOT NULL,
 Fauxprice decimal(28,10) NOT NULL,
 FPrice decimal(28,10) NOT NULL,
 FAuxTaxPrice decimal(28,10) NOT NULL,
 FTaxPrice decimal(28,10) NOT NULL,
 FPriceDiscount decimal(28,10) NOT NULL,
 FAuxPriceDiscount decimal(28,10) NOT NULL,
 FCESS decimal(28,10) NOT NULL,
 FAmount decimal(28,10) NOT NULL,
 FAllAmount decimal(28,10) NOT NULL,
 FAllStdAmount decimal(28,10) NOT NULL,
 FTaxAmt decimal(28,10) NOT NULL,
 FDate datetime NOT NULL,
 FAdviceConsignDate datetime NOT NULL,
 FNote nvarchar(1000) NOT NULL DEFAULT '',
 FICPrcPly_FName nvarchar(255) NOT NULL DEFAULT '',
 FTplExtendKey1 nvarchar(255) NOT NULL DEFAULT '',
 FMapModel nvarchar(255) NOT NULL DEFAULT '',
 FInForeCast int NOT NULL DEFAULT 0,
 FEntrySelfS0172 nvarchar(100) NOT NULL DEFAULT '',
 FEntrySelfS0173 nvarchar(100) NOT NULL DEFAULT '',
 FPlanMode int NOT NULL DEFAULT 14036,
 FStockQty decimal(28,10) NOT NULL DEFAULT 0,
 FMRPClosed bit NOT NULL DEFAULT 0,
 FMrpAutoClosed int NOT NULL DEFAULT 0,
 CONSTRAINT UQ_Probe_SEOrderEntry UNIQUE (FBrNO,FInterID,FEntryID),
 CONSTRAINT FK_Probe_SEOrderEntry FOREIGN KEY (FBrNO,FInterID)
  REFERENCES dbo.SEOrder(FBrNo,FInterID)
);

-- Formal SO amendments archive the old source rows and retain their field log.
-- The header stores the user ID; ICOrderAlter stores the user's display name.
CREATE TABLE dbo.ICOrderAlter (
 FInterID int NOT NULL,
 FBillType int NOT NULL,
 FTableName nvarchar(100) NOT NULL,
 FVersionNo nvarchar(30) NOT NULL,
 FChangeDate datetime NOT NULL,
 FChangeUser nvarchar(255) NOT NULL,
 FChangeType nvarchar(100) NOT NULL,
 FoldNo nvarchar(100) NOT NULL,
 FNumbers nvarchar(100) NOT NULL,
 FitemName nvarchar(255) NOT NULL,
 Fmodel nvarchar(255) NOT NULL,
 FChangeField nvarchar(255) NOT NULL,
 FBChangeValue nvarchar(1000) NOT NULL,
 FEChangeValue nvarchar(1000) NOT NULL,
 FChangeCauses nvarchar(1000) NOT NULL,
 FPage int NOT NULL
);
CREATE TABLE dbo.SEOutStockEntry (
 FInterID int NOT NULL DEFAULT 0,
 FEntryID int NOT NULL DEFAULT 0,
 FSourceTranType int NOT NULL DEFAULT 81,
 FSourceInterId int NOT NULL,
 FSourceEntryID int NOT NULL DEFAULT 0,
 FItemID int NOT NULL,
 FQty decimal(28,10) NOT NULL
);

-- Issued delivery/invoice sources. Pending rows have no FCheckDate and are not
-- published as issued local evidence; native source references retain line lineage.
CREATE TABLE dbo.ICStockBill (
 FInterID int NOT NULL PRIMARY KEY,
 FBillNo nvarchar(100) NOT NULL,
 FTranType int NOT NULL DEFAULT 21,
 FDate datetime NOT NULL,
 FCheckDate datetime NULL,
 FCancellation bit NOT NULL DEFAULT 0,
 FROB int NOT NULL DEFAULT 1
);
CREATE TABLE dbo.ICStockBillEntry (
 FInterID int NOT NULL,
 FEntryID int NOT NULL,
 FSourceTranType int NOT NULL DEFAULT 81,
 FSourceInterId int NOT NULL,
 FOrderInterID int NULL,
 FSourceEntryID int NOT NULL,
 FItemID int NOT NULL,
 FUnitID int NOT NULL,
 FQty decimal(28,10) NOT NULL,
 FBatchNo nvarchar(100) NULL,
 CONSTRAINT PK_Probe_ICStockBillEntry PRIMARY KEY (FInterID,FEntryID),
 CONSTRAINT FK_Probe_ICStockBillEntry_Header FOREIGN KEY (FInterID)
  REFERENCES dbo.ICStockBill(FInterID)
);
CREATE TABLE dbo.ICSale (
 FInterID int NOT NULL PRIMARY KEY,
 FBillNo nvarchar(100) NOT NULL,
 FTranType int NOT NULL DEFAULT 80,
 FDate datetime NOT NULL,
 FCheckDate datetime NULL,
 FCancellation bit NOT NULL DEFAULT 0,
 FROB int NOT NULL DEFAULT 1,
 FCurrencyID int NOT NULL,
 FSettleDate datetime NULL
);
CREATE TABLE dbo.ICSaleEntry (
 FDetailID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
 FInterID int NOT NULL,
 FEntryID int NOT NULL,
 FSourceTranType int NOT NULL DEFAULT 21,
 FSourceInterId int NOT NULL,
 FSourceEntryID int NOT NULL,
 FItemID int NOT NULL,
 FUnitID int NOT NULL,
 FQty decimal(28,10) NOT NULL,
 FAmount decimal(28,10) NOT NULL,
 FAllAmount decimal(28,10) NOT NULL,
 CONSTRAINT UQ_Probe_ICSaleEntry UNIQUE (FInterID,FEntryID),
 CONSTRAINT FK_Probe_ICSaleEntry_Header FOREIGN KEY (FInterID)
  REFERENCES dbo.ICSale(FInterID)
);

-- Empty AR relations let ordinary invoice polling observe the verified case of
-- no settlements. Their fields match the narrow native allocation projection.
CREATE TABLE dbo.t_RP_Contact (
 FID int NOT NULL PRIMARY KEY,
 FRP int NOT NULL,
 FType int NOT NULL,
 FInvoiceID int NOT NULL
);
CREATE TABLE dbo.t_RP_NewCheckInfo (
 FInterID int NOT NULL PRIMARY KEY,
 FRP int NOT NULL,
 FType int NOT NULL,
 FContactID int NOT NULL,
 FCheckDate datetime NOT NULL,
 FCheckAmount decimal(28,10) NOT NULL
);
CREATE TABLE dbo.t_RP_NewReceiveBill (
 FBillID int NOT NULL PRIMARY KEY,
 FNumber nvarchar(100) NOT NULL,
 FRP int NOT NULL,
 FCurrencyID int NOT NULL
);
CREATE TABLE dbo.t_rp_CheckEntry (
 FDetailID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
 FInterID int NOT NULL,
 FType int NOT NULL,
 FType_SRC int NOT NULL,
 FInvoiceID int NOT NULL,
 FEntryID int NOT NULL,
 FBillID_SRC int NOT NULL
);

-- Only synthetic identities; these values are local test inputs, not account-set defaults.
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(101,1,N'PROBE-CUSTOMER',N'Probe customer',1,NULL);
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(201,8,N'PROBE-SUPPLIER',N'Probe supplier',1,NULL);
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(301,4,N'PROBE-RESIN',N'Probe resin',1,NULL);
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(401,7,N'PROBE-KG',N'kg',1,NULL);
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(501,5,N'PROBE-GROUP',N'Probe warehouse group',0,NULL);
INSERT dbo.t_Item(FItemID,FItemClassID,FNumber,FName,FDetail,FParentID)
 VALUES(502,5,N'PROBE-WEST',N'Probe warehouse',1,501);
INSERT dbo.t_Organization(FItemID,FNumber,FName,FAddress,FPhone,FCurrencyID)
 VALUES(101,N'PROBE-CUSTOMER',N'Probe customer',N'Local probe address',N'0000',1);
INSERT dbo.t_Supplier(FItemID,FNumber,FName)
 VALUES(201,N'PROBE-SUPPLIER',N'Probe supplier');
INSERT dbo.t_ICItemCore(FItemID,FModel,FUnitID)
 VALUES(301,N'Probe grade A',401);
INSERT dbo.t_Stock(FItemID,FName,FAddress,FPhone)
 VALUES(502,N'Probe warehouse',N'Local stock address',N'0001');
INSERT dbo.t_Currency(FCurrencyID,FNumber,FName,FExchangeRate)
 VALUES(1,N'CNY',N'Chinese yuan',1);
INSERT dbo.t_Currency(FCurrencyID,FNumber,FName,FExchangeRate)
 VALUES(133,N'USD',N'US dollar',7.2);
INSERT dbo.t_Emp(FItemID) VALUES(12);
INSERT dbo.t_Emp(FItemID) VALUES(1);
INSERT dbo.t_Emp(FItemID) VALUES(701);
INSERT dbo.t_Department(FItemID) VALUES(13);
INSERT dbo.t_Department(FItemID) VALUES(601);
INSERT dbo.t_User(FUserID,FName) VALUES(1,N'Probe biller');
INSERT dbo.t_Settle(FItemID,FNumber,FName)
 VALUES(1,N'PROBE-NET30',N'Net 30');
INSERT dbo.ICInventory(FItemID,FStockID,FBatchNo,FQty)
 VALUES(301,502,N'PROBE-LOT-A',40);
INSERT dbo.ICInventory(FItemID,FStockID,FBatchNo,FQty)
 VALUES(301,502,N'PROBE-LOT-A',10);
INSERT dbo.ICInventory(FItemID,FStockID,FBatchNo,FQty)
 VALUES(301,502,N'PROBE-LOT-B',20);
INSERT dbo.ICMaxNum(FTableName,FMaxNum) VALUES(N'SEOrder',9001);
INSERT dbo.SEOrder(FBrNo,FInterID,FUUID,FBillNo,FCurrencyID,FCustID,FDate,FExchangeRate,
 FDeptID,FEmpID,FBillerID,FSettleID,FSettleDate)
 VALUES(N'0',9001,'11111111-1111-4111-8111-111111111111',N'PROBE-SO-0001',1,101,
 '20261026',1,601,701,1,1,'20261125');
INSERT dbo.SEOrderEntry(FBrNO,FInterID,FEntryID,FItemID,FUnitID,FQty,Fauxqty,
 FAuxStockAwaitQty,FComplexQty,Fauxprice,FPrice,FAuxTaxPrice,FTaxPrice,
 FPriceDiscount,FAuxPriceDiscount,FCESS,FAmount,FAllAmount,FAllStdAmount,FTaxAmt,
 FDate,FAdviceConsignDate)
 VALUES(N'0',9001,1,301,401,10,10,10,10,2,2,2.26,2.26,2.26,2.26,13,20,22.60,22.60,2.60,
 '20261026','20261026');
GO
