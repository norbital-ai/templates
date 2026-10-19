-- Dedicated Microsoft SQL Server Developer test database only.
-- These colony tables are normalized simulation fixtures, not Kingdee physical tables.
EXEC sys.sp_cdc_enable_db;
GO
CREATE SCHEMA colony;
GO
IF OBJECT_ID('colony.OrderHeader') IS NULL BEGIN
 CREATE TABLE colony.OrderHeader(external_id varchar(36) PRIMARY KEY,local_key nvarchar(200) UNIQUE,submission_hash varchar(64),order_id varchar(36),reference nvarchar(100),direction varchar(20),agreement_hash varchar(64),currency varchar(3),party_code nvarchar(100),agreement nvarchar(max),contract nvarchar(max),status varchar(20),source_updated_at datetime2);
 CREATE TABLE colony.OrderItem(external_id varchar(36) REFERENCES colony.OrderHeader(external_id),line_id varchar(36),sku nvarchar(100),unit nvarchar(32),quantity decimal(18,3),unit_price decimal(18,4),discount_pct decimal(9,4),tax_rate decimal(9,4));
 CREATE TABLE colony.OrderTransaction(external_id varchar(36) PRIMARY KEY,parent_id varchar(36) REFERENCES colony.OrderHeader(external_id),order_id varchar(36),direction varchar(20),kind varchar(20),reference nvarchar(100),seal_hash varchar(64),currency varchar(3),status varchar(20),items nvarchar(max),documents nvarchar(max),issued_on varchar(10),due_on varchar(10),total nvarchar(32),source_updated_at datetime2);
 EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'OrderHeader',@role_name=NULL,@supports_net_changes=0;
 EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'OrderTransaction',@role_name=NULL,@supports_net_changes=0;
 END;
GO
CREATE TABLE colony.[parties] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [name] nvarchar(512) NULL,
 [kind] nvarchar(512) NULL,
 [currency] nvarchar(512) NULL,
 [active] bit NULL,
 [address] nvarchar(512) NULL,
 [phone] nvarchar(512) NULL,
 [source_updated_at] datetime2 NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'parties',@role_name=NULL,@supports_net_changes=0;
GO
INSERT colony.[parties] ([external_code],[name],[kind],[currency],[active],[source_updated_at]) VALUES (N'C-101',N'Northline Manufacturing',N'customer',N'SGD',1,N'2026-10-10T00:00:00Z');
INSERT colony.[parties] ([external_code],[name],[kind],[currency],[active],[source_updated_at]) VALUES (N'V-101',N'Meridian Materials',N'supplier',N'SGD',1,N'2026-10-10T00:00:00Z');
CREATE TABLE colony.[products] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [name] nvarchar(512) NULL,
 [spec] nvarchar(512) NULL,
 [unit] nvarchar(512) NULL,
 [currency] nvarchar(512) NULL,
 [unit_price] nvarchar(512) NULL,
 [tax_rate] nvarchar(512) NULL,
 [commission_basis_unit] nvarchar(512) NULL,
 [commission_factor] nvarchar(512) NULL,
 [active] bit NULL,
 [source_updated_at] datetime2 NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'products',@role_name=NULL,@supports_net_changes=0;
GO
INSERT colony.[products] ([external_code],[name],[unit],[currency],[unit_price],[tax_rate],[commission_basis_unit],[commission_factor],[active],[source_updated_at]) VALUES (N'RESIN-A',N'Resin A',N'kg',N'SGD',N'2.0000',N'9',N't',N'0.001000',1,N'2026-10-10T00:00:00Z');
CREATE TABLE colony.[warehouses] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [name] nvarchar(512) NULL,
 [group_code] nvarchar(512) NULL,
 [active] bit NULL,
 [source_updated_at] datetime2 NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'warehouses',@role_name=NULL,@supports_net_changes=0;
GO
INSERT colony.[warehouses] ([external_code],[name],[group_code],[active],[source_updated_at]) VALUES (N'WEST',N'West warehouse',N'WEST',1,N'2026-10-10T00:00:00Z');
CREATE TABLE colony.[stock_snapshots] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [lot_number] nvarchar(512) NULL, [currency] nvarchar(3) NULL, [unit_cost] nvarchar(512) NULL,
 [unit] nvarchar(512) NULL,
 [on_hand] nvarchar(512) NULL,
 [erp_committed] nvarchar(512) NULL,
 [as_of] datetime2 NULL,
 [orders_as_of] datetime2 NULL,
 [product_code] nvarchar(512) NULL,
 [warehouse_code] nvarchar(512) NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'stock_snapshots',@role_name=NULL,@supports_net_changes=0;
GO
INSERT colony.[stock_snapshots] ([external_code],[lot_number],[currency],[unit_cost],[unit],[on_hand],[erp_committed],[as_of],[orders_as_of],[product_code],[warehouse_code]) VALUES (N'RESIN-A:WEST',N'LOT-001',N'SGD',N'1.5',N'kg',N'100',N'0',N'2026-10-10T00:00:00Z',N'2026-10-10T00:00:00Z',N'RESIN-A',N'WEST');
CREATE TABLE colony.[credit_snapshots] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [currency] nvarchar(512) NULL,
 [credit_limit] nvarchar(512) NULL,
 [credit_used] nvarchar(512) NULL,
 [credit_hold] bit NULL,
 [as_of] datetime2 NULL,
 [party_code] nvarchar(512) NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'credit_snapshots',@role_name=NULL,@supports_net_changes=0;
GO
INSERT colony.[credit_snapshots] ([external_code],[currency],[credit_limit],[credit_used],[credit_hold],[as_of],[party_code]) VALUES (N'C-101:SGD',N'SGD',N'10000',N'0',0,N'2026-10-10T00:00:00Z',N'C-101');
CREATE TABLE colony.[source_sales_lines] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [lot_number] nvarchar(512) NULL, [unit_cost] nvarchar(512) NULL,
 [order_id] nvarchar(512) NULL,
 [order_line_id] nvarchar(512) NULL,
 [kind] nvarchar(512) NULL,
 [reference] nvarchar(512) NULL,
 [business_on] nvarchar(512) NULL,
 [source_updated_at] datetime2 NULL,
 [seal_hash] nvarchar(512) NULL,
 [unit] nvarchar(512) NULL,
 [quantity] nvarchar(512) NULL,
 [currency] nvarchar(512) NULL,
 [net_amount] nvarchar(512) NULL,
 [tax_amount] nvarchar(512) NULL,
 [freight] nvarchar(512) NULL,
 [active] bit NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'source_sales_lines',@role_name=NULL,@supports_net_changes=0;
GO
CREATE TABLE colony.[source_payments] ([external_code] nvarchar(200) NOT NULL PRIMARY KEY,
 [order_id] nvarchar(512) NULL,
 [invoice_id] nvarchar(512) NULL,
 [kind] nvarchar(512) NULL,
 [reference] nvarchar(512) NULL,
 [settled_on] nvarchar(512) NULL,
 [source_updated_at] datetime2 NULL,
 [seal_hash] nvarchar(512) NULL,
 [currency] nvarchar(512) NULL,
 [amount] nvarchar(512) NULL,
 [active] bit NULL);
EXEC sys.sp_cdc_enable_table @source_schema=N'colony',@source_name=N'source_payments',@role_name=NULL,@supports_net_changes=0;
GO
CREATE OR ALTER PROCEDURE colony.ApproveOrder @external_id varchar(36) AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM colony.OrderHeader h JOIN colony.parties p ON p.external_code=h.party_code WHERE h.external_id=@external_id AND p.active=1 AND p.kind IN (CASE WHEN h.direction='sales' THEN 'customer' ELSE 'supplier' END,'both')) THROW 51001,'Invalid order partner',1;
 IF NOT EXISTS(SELECT 1 FROM colony.OrderItem WHERE external_id=@external_id) THROW 51002,'Order items required',1;
 IF EXISTS(SELECT 1 FROM colony.OrderItem i LEFT JOIN colony.products p ON p.external_code=i.sku WHERE i.external_id=@external_id AND (p.external_code IS NULL OR p.active<>1 OR p.unit<>i.unit OR i.quantity<=0 OR i.unit_price<0)) THROW 51003,'Invalid order items',1;
 IF EXISTS(SELECT 1 FROM colony.OrderHeader WHERE external_id=@external_id AND (ISJSON(agreement)<>1 OR LEN(COALESCE(contract,''))=0 OR LEN(COALESCE(JSON_VALUE(agreement,'$.payment_terms'),''))=0)) THROW 51004,'Agreement terms required',1;
 UPDATE colony.OrderHeader SET status='issued',source_updated_at=SYSUTCDATETIME() WHERE external_id=@external_id;
 END
GO
CREATE OR ALTER TRIGGER colony.ValidateTransactions ON colony.OrderTransaction AFTER INSERT,UPDATE AS BEGIN
 IF EXISTS(SELECT 1 FROM inserted i JOIN colony.OrderHeader h ON h.external_id=i.parent_id WHERE i.order_id<>h.order_id OR i.seal_hash<>h.agreement_hash OR i.currency<>h.currency OR i.direction<>h.direction OR (i.status='issued' AND h.status<>'issued') OR ISJSON(i.items)<>1 OR ISJSON(i.documents)<>1) THROW 51005,'Issued transaction requires its approved agreement',1;
 END
GO
EXEC sys.sp_cdc_change_job @job_type=N'capture',@pollinginterval=1;
GO

EXEC sys.sp_cdc_change_job @job_type=N'cleanup',@retention=4320;
GO
