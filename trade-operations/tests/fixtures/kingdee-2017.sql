-- Disposable SQL Server 2017 account set for the Kingdee master and stock sync probes.
CREATE DATABASE TradeOperationsProbe;
GO
ALTER DATABASE TradeOperationsProbe SET COMPATIBILITY_LEVEL = 140;
GO
USE TradeOperationsProbe;
GO
CREATE TABLE dbo.t_Item (
  FItemID int PRIMARY KEY, FNumber nvarchar(40) NOT NULL, FName nvarchar(100) NOT NULL,
  FItemClassID int NOT NULL, FDetail bit NOT NULL, FParentID int NOT NULL DEFAULT 0,
  FDeleted bit NOT NULL DEFAULT 0, FUnUsed bit NOT NULL DEFAULT 0, FModifyTime rowversion
);
CREATE TABLE dbo.t_Organization (
  FItemID int PRIMARY KEY, FName nvarchar(100) NOT NULL, FDeleted bit NOT NULL DEFAULT 0,
  FAddress nvarchar(200), FPhone nvarchar(30), FCurrencyID int, FModifyTime rowversion
);
CREATE TABLE dbo.t_Supplier (
  FItemID int PRIMARY KEY, FName nvarchar(100) NOT NULL, FDeleted bit NOT NULL DEFAULT 0,
  FModifyTime rowversion
);
CREATE TABLE dbo.t_ICItem (
  FItemID int PRIMARY KEY, FModel nvarchar(100), FUnitID int NOT NULL,
  FProducingArea nvarchar(200), FComBrandID int, F_102 nvarchar(100),
  FDeleted bit NOT NULL DEFAULT 0, FModifyTime rowversion
);
CREATE TABLE dbo.t_Stock (FItemID int PRIMARY KEY, FModifyTime rowversion);
CREATE TABLE dbo.ICInventory (
  FItemID int NOT NULL, FStockID int NOT NULL, FBatchNo nvarchar(40) NOT NULL,
  FQty decimal(18,3) NOT NULL
);
INSERT dbo.t_Item (FItemID,FNumber,FName,FItemClassID,FDetail,FParentID) VALUES
  (110,'C-110',N'客户测试',1,1,0), (120,'S-120',N'供应商测试',8,1,0),
  (210,'RESIN-A',N'树脂 A',4,1,0), (310,'WH','Local warehouses',5,0,0),
  (311,'WH-01','Test warehouse',5,1,310), (710,'kg','kg',7,1,0),
  (212,'BRAND-A',N'利华益',2038,1,0);
INSERT dbo.t_Organization (FItemID,FName,FAddress,FPhone,FCurrencyID)
  VALUES (110,N'客户测试',N'测试路 1 号','010-12345678',1);
INSERT dbo.t_Supplier (FItemID,FName) VALUES (120,N'供应商测试');
INSERT dbo.t_ICItem (FItemID,FModel,FUnitID,FProducingArea,FComBrandID,F_102)
  VALUES (210,'A-100',710,N'中国',212,'TARFLON');
INSERT dbo.t_Stock (FItemID) VALUES (311);
INSERT dbo.ICInventory VALUES (210,311,'LOT-01',8.125), (210,311,'LOT-01',2.375);
GO
