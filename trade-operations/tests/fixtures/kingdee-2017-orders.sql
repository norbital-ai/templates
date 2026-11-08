-- Synthetic order-side extension of kingdee-2017.sql. Apply only to the disposable account set.
USE TradeOperationsProbe;
GO
CREATE TABLE dbo.t_Settle (FItemID int PRIMARY KEY, FNumber nvarchar(40) NOT NULL, FDeleted bit NOT NULL DEFAULT 0);
CREATE TABLE dbo.t_Emp (FItemID int PRIMARY KEY, FName nvarchar(100), FDeleted bit NOT NULL DEFAULT 0);
CREATE TABLE dbo.t_Department (FItemID int PRIMARY KEY, FDeleted bit NOT NULL DEFAULT 0);
CREATE TABLE dbo.t_Currency (FCurrencyID int PRIMARY KEY, FNumber nvarchar(10) NOT NULL, FExchangeRate decimal(28,10) NOT NULL, FDeleted bit NOT NULL DEFAULT 0);
CREATE TABLE dbo.t_User (FUserID int PRIMARY KEY, FName nvarchar(100) NOT NULL);
CREATE TABLE dbo.ICMaxNum (FTableName varchar(100) PRIMARY KEY, FMaxNum int NOT NULL);
CREATE TABLE dbo.SEOrder (
  FInterID int NOT NULL, FUUID uniqueidentifier NOT NULL,
  FBrNo nvarchar(20) NOT NULL,
  FBillNo nvarchar(200) NOT NULL,
  FTranType int NOT NULL,
  FCurrencyID int NOT NULL,
  FCustID int NOT NULL,
  FDate datetime NOT NULL,
  FExchangeRate decimal(28,10) NOT NULL,
  FDeptID int NOT NULL,
  FEmpID int NOT NULL,
  FBillerID int NOT NULL,
  FSettleID int NOT NULL,
  FSysStatus int NOT NULL,
  FAreaPS int NOT NULL,
  FSaleStyle int NOT NULL,
  FSendWay nvarchar(100) NOT NULL,
  FWXCardCouponsMoney nvarchar(100) NOT NULL,
  FDeliveryProvince nvarchar(100) NOT NULL,
  FDeliveryCity nvarchar(100) NOT NULL,
  FDeliveryDistrict nvarchar(100) NOT NULL,
  FDeliveryTownship nvarchar(100) NOT NULL,
  FMangerID int NOT NULL,
  FTransitAheadTime int NOT NULL,
  FManageType int NOT NULL,
  FValidaterName nvarchar(100) NOT NULL,
  FFetchStyle nvarchar(100) NOT NULL,
  FFetchAdd nvarchar(100) NOT NULL,
  FOutStoreDate datetime NOT NULL,
  FOutStoreTime nvarchar(100) NOT NULL,
  FTplOrderID nvarchar(100) NOT NULL,
  FHeadSelfS0191 nvarchar(100) NOT NULL,
  FHeadSelfS0192 nvarchar(100) NOT NULL,
  FSettleDate datetime NOT NULL,
  FStatus int NOT NULL DEFAULT 0, FCheckerID int NULL, FCheckDate datetime NULL,
  FVersionNo nvarchar(3) NOT NULL DEFAULT '000', FChangeMark bit NOT NULL DEFAULT 0,
  FCancellation bit NOT NULL DEFAULT 0, FClosed bit NOT NULL DEFAULT 0,
  FChangeDate datetime NULL, FChangeUser int NULL, FOperDate rowversion,
  PRIMARY KEY (FBrNo,FInterID)
);
CREATE TABLE dbo.SEOrderEntry (
  FDetailID int IDENTITY PRIMARY KEY, FInterID int NOT NULL, FBrNO nvarchar(20) NOT NULL,
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
  FNote nvarchar(100) NOT NULL,
  FICPrcPly_FName nvarchar(100) NOT NULL,
  FTplExtendKey1 nvarchar(100) NOT NULL,
  FMapModel nvarchar(100) NOT NULL,
  FInForeCast int NOT NULL,
  FEntrySelfS0172 int NULL,
  FEntrySelfS0173 nvarchar(100) NOT NULL,
  FStockQty decimal(28,10) NOT NULL DEFAULT 0, FMrpClosed bit NOT NULL DEFAULT 0,
  FMrpAutoClosed bit NOT NULL DEFAULT 0,
  FPlanMode int NOT NULL DEFAULT 0,
  FOREIGN KEY (FBrNO,FInterID) REFERENCES dbo.SEOrder(FBrNo,FInterID)
);
CREATE TABLE dbo.SEOutStockEntry (FSourceTranType int, FSourceInterID int, FItemID int, FQty decimal(28,10));
CREATE TABLE dbo.ICStockBill (
  FInterID int PRIMARY KEY, FBillNo nvarchar(200), FDate datetime, FTranType int,
  FCheckDate datetime, FCancellation bit, FROB int
);
CREATE TABLE dbo.ICStockBillEntry (
  FInterID int, FEntryID int, FSourceTranType int, FSourceInterID int, FSourceEntryID int,
  FOrderInterID int, FItemID int, FUnitID int, FQty decimal(28,10), FBatchNo nvarchar(40),
  FAmount decimal(28,10) NULL
);
CREATE TABLE dbo.ICSale (
  FInterID int PRIMARY KEY, FBillNo nvarchar(200), FDate datetime, FTranType int,
  FCheckDate datetime, FCancellation bit, FROB int, FCurrencyID int, FSettleDate datetime,
  FCustID int, FEmpID int, FOperDate rowversion
);
CREATE TABLE dbo.ICSaleEntry (
  FInterID int, FDetailID int IDENTITY PRIMARY KEY, FEntryID int, FSourceTranType int,
  FSourceInterID int, FSourceEntryID int, FItemID int, FUnitID int, FQty decimal(28,10),
  FAmount decimal(28,10), FAllAmount decimal(28,10), FTaxAmount decimal(28,10)
);
CREATE TABLE dbo.t_rp_CheckEntry (
  FDetailID int PRIMARY KEY, FInterID int, FType int, FType_SRC int,
  FInvoiceID int, FEntryID int, FBillID_SRC int
);
CREATE TABLE dbo.t_RP_NewCheckInfo (
  FInterID int PRIMARY KEY, FRP int, FType int, FContactID int,
  FCheckDate datetime, FCheckAmount decimal(28,10)
);
CREATE TABLE dbo.t_RP_Contact (
  FID int PRIMARY KEY, FRP int, FType int, FInvoiceID int, FCustomer int,
  FNumber nvarchar(100), FDate datetime, FRPDate datetime, FRemainAmount decimal(28,10), FModifyTime rowversion
);
CREATE TABLE dbo.t_RP_Plan_Ar (
  FInterID int, FRP int, FDate datetime, FRemainAmount decimal(28,10), FRemainAmountFor decimal(28,10)
);
CREATE TABLE dbo.t_RP_NewReceiveBill (FBillID int PRIMARY KEY, FNumber nvarchar(100), FRP int, FCurrencyID int);
CREATE TABLE dbo.ICOrderAlter (
  FID int IDENTITY PRIMARY KEY, FInterID int, FBillType int, FTableName varchar(50),
  FVersionNo nvarchar(3), FChangeDate datetime, FChangeUser nvarchar(30), FChangeType nvarchar(10),
  FoldNo nvarchar(10), FNumbers nvarchar(40), FitemName nvarchar(100), Fmodel nvarchar(100),
  FChangeField nvarchar(30), FBChangeValue nvarchar(100), FEChangeValue nvarchar(100),
  FChangeCauses nvarchar(200), FPage int
);
INSERT dbo.t_Settle (FItemID,FNumber) VALUES (11,'NET30');
INSERT dbo.t_Emp (FItemID,FName) VALUES (21,N'Fixture salesperson');
INSERT dbo.t_Department (FItemID) VALUES (31);
INSERT dbo.t_Currency (FCurrencyID,FNumber,FExchangeRate) VALUES (1,'CNY',1);
INSERT dbo.t_User VALUES (41,'Probe biller'), (42,'Probe checker');
INSERT dbo.ICMaxNum VALUES ('SEOrder',9000);

CREATE USER trade_order_probe WITHOUT LOGIN;
GRANT SELECT ON SCHEMA::dbo TO trade_order_probe;
GRANT INSERT ON dbo.SEOrder TO trade_order_probe;
GRANT UPDATE (FVersionNo,FChangeDate,FChangeUser) ON dbo.SEOrder TO trade_order_probe;
GRANT INSERT, UPDATE, DELETE ON dbo.SEOrderEntry TO trade_order_probe;
GRANT UPDATE (FMaxNum) ON dbo.ICMaxNum TO trade_order_probe;
GRANT INSERT ON dbo.ICOrderAlter TO trade_order_probe;
GO
