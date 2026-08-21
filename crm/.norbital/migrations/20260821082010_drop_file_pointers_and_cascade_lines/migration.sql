ALTER TABLE "contract_signings" DROP COLUMN "generated_file";
--> statement-breakpoint
ALTER TABLE "contract_signings" DROP COLUMN "counterparty_file";
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" DROP CONSTRAINT "goods_receipt_lines_goods_receipt_id_goods_receipts_fk", ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_goods_receipts_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" DROP CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_purchase_invoices_fk", ADD CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_purchase_invoices_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_fk", ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_quote_id_quotes_fk", ADD CONSTRAINT "quote_lines_quote_id_quotes_fk" FOREIGN KEY ("quote_id") REFERENCES "quotes"("norbital_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_sales_invoice_id_sales_invoices_fk", ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_sales_invoices_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("norbital_id") ON DELETE CASCADE;
