-- Dedicated accounting mock only. FIFO and physical posting live on the source side.
CREATE OR ALTER PROCEDURE colony.PostStockDocument
 @external_id varchar(36), @movement nvarchar(120), @order_id varchar(36), @line_id varchar(36),
 @kind varchar(20), @quantity decimal(18,3), @receipt_lot nvarchar(120)=NULL, @receipt_cost decimal(18,8)=NULL
AS BEGIN
 SET NOCOUNT ON;
 DECLARE @parent varchar(36),@direction varchar(20),@currency varchar(3),@seal varchar(64),@sku nvarchar(100),@unit nvarchar(32),@price decimal(18,4),@discount decimal(9,4),@tax decimal(9,4),@items nvarchar(max),@posted datetime2;
 SELECT @parent=h.external_id,@direction=h.direction,@currency=h.currency,@seal=h.agreement_hash,@sku=i.sku,@unit=i.unit,@price=i.unit_price,@discount=i.discount_pct,@tax=i.tax_rate
 FROM colony.OrderHeader h JOIN colony.OrderItem i ON h.external_id=i.external_id
 WHERE h.order_id=@order_id AND h.status='issued' AND i.line_id=@line_id;
 IF @parent IS NULL OR @quantity<=0 OR @kind NOT IN ('delivery','invoice') THROW 51020,'Issued order and valid physical quantity required',1;
 SELECT @items=items,@posted=posted_at FROM colony.InventoryPosting WITH(UPDLOCK,HOLDLOCK) WHERE movement=@movement;
 IF @items IS NOT NULL AND EXISTS(SELECT 1 FROM colony.InventoryPosting WHERE movement=@movement AND (order_id<>@order_id OR quantity<>@quantity)) THROW 51021,'Physical movement identity cannot be reused for another quantity or order',1;
 IF @items IS NULL BEGIN
  SET @posted=SYSUTCDATETIME(); SET @items=N'[]';
  IF @direction='sales' BEGIN
   DECLARE @left decimal(18,3)=@quantity,@key nvarchar(200),@lot nvarchar(120),@available decimal(18,3),@cost decimal(18,8),@take decimal(18,3);
   WHILE @left>0 BEGIN
    SET @key=NULL;
    SELECT TOP(1) @key=external_code,@lot=lot_number,@available=CAST(on_hand AS decimal(18,3)),@cost=CAST(unit_cost AS decimal(18,8))
    FROM colony.stock_snapshots WITH(UPDLOCK,HOLDLOCK) WHERE product_code=@sku AND unit=@unit AND currency=@currency AND CAST(on_hand AS decimal(18,3))>0 ORDER BY received_on,external_code;
    IF @key IS NULL THROW 51022,'Insufficient physical stock',1;
    SET @take=CASE WHEN @left<@available THEN @left ELSE @available END;
    UPDATE colony.stock_snapshots SET on_hand=CAST(@available-@take AS nvarchar(32)),as_of=@posted,orders_as_of=@posted WHERE external_code=@key;
    SET @items=JSON_MODIFY(@items,'append $',JSON_QUERY((SELECT @line_id AS order_line_id,'Resin A' AS product_name,@unit AS unit,CAST(@take AS nvarchar(32)) AS quantity,CAST(@price AS nvarchar(32)) AS unit_price,@lot AS lot_number,CAST(@cost AS nvarchar(32)) AS unit_cost FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)));
    INSERT colony.source_sales_lines(external_code,order_id,order_line_id,kind,reference,business_on,source_updated_at,seal_hash,unit,quantity,currency,net_amount,tax_amount,freight,active,lot_number,unit_cost)
    VALUES(CONCAT(@movement,':',@key),@order_id,@line_id,'shipment',@movement,'2026-10-10',@posted,@seal,@unit,CAST(@take AS nvarchar(32)),@currency,CAST(CAST(@take*@price*(1-@discount/100) AS decimal(18,2)) AS nvarchar(32)),CAST(CAST(@take*@price*(1-@discount/100)*@tax/100 AS decimal(18,2)) AS nvarchar(32)),'0',1,@lot,CAST(@cost AS nvarchar(32)));
    SET @left=@left-@take;
   END
  END ELSE BEGIN
   IF @receipt_lot IS NULL OR @receipt_cost IS NULL OR @receipt_cost<0 THROW 51023,'Receipt requires its source lot and cost',1;
   INSERT colony.stock_snapshots(external_code,lot_number,unit_cost,currency,unit,on_hand,erp_committed,as_of,orders_as_of,product_code,warehouse_code,received_on)
   VALUES(CONCAT(@sku,':',@receipt_lot),@receipt_lot,CAST(@receipt_cost AS nvarchar(32)),@currency,@unit,CAST(@quantity AS nvarchar(32)),'0',@posted,@posted,@sku,'WEST','2026-10-10');
   SET @items=(SELECT @line_id AS order_line_id,'Resin A' AS product_name,@unit AS unit,CAST(@quantity AS nvarchar(32)) AS quantity,CAST(@price AS nvarchar(32)) AS unit_price,@receipt_lot AS lot_number,CAST(@receipt_cost AS nvarchar(32)) AS unit_cost FOR JSON PATH);
  END
  INSERT colony.InventoryPosting(movement,order_id,quantity,items,posted_at) VALUES(@movement,@order_id,@quantity,@items,@posted);
 END
 INSERT colony.OrderTransaction(external_id,parent_id,order_id,direction,kind,reference,seal_hash,currency,status,items,documents,issued_on,due_on,total,source_updated_at)
 VALUES(@external_id,@parent,@order_id,@direction,@kind,CONCAT(@movement,'-',@kind),@seal,@currency,'issued',@items,N'[{"name":"Mock document.pdf","url":"https://example.test/mock-document.pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]','2026-10-10','2026-11-10',CAST(CAST(@quantity*@price*(1-@discount/100)*(1+@tax/100) AS decimal(18,2)) AS nvarchar(32)),SYSUTCDATETIME());
END
