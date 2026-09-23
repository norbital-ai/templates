DROP INDEX "accounts_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "activities_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "contacts_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "contract_signings_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "goods_receipts_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "products_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "purchase_invoice_lines_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "purchase_invoices_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "purchase_order_lines_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "purchase_orders_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "quote_lines_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "quotes_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "sales_invoice_lines_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "sales_invoices_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "settlements_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "suppliers_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("subject", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("first_name", '') || ' ' || coalesce("last_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "contract_signings" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("binding_hash", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("doc_no", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("product_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("doc_no", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("product_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("doc_no", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "quote_lines" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("product_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("doc_no", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("product_name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("doc_no", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "settlements" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("reference", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (bolt_search_document(coalesce("name", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "accounts_search_document_gin_idx" ON "accounts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "activities_search_document_gin_idx" ON "activities" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "contacts_search_document_gin_idx" ON "contacts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "contract_signings_search_document_gin_idx" ON "contract_signings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "goods_receipts_search_document_gin_idx" ON "goods_receipts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "products_search_document_gin_idx" ON "products" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_search_document_gin_idx" ON "purchase_invoice_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_search_document_gin_idx" ON "purchase_invoices" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_search_document_gin_idx" ON "purchase_order_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_orders_search_document_gin_idx" ON "purchase_orders" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "quote_lines_search_document_gin_idx" ON "quote_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "quotes_search_document_gin_idx" ON "quotes" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_search_document_gin_idx" ON "sales_invoice_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sales_invoices_search_document_gin_idx" ON "sales_invoices" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "settlements_search_document_gin_idx" ON "settlements" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suppliers_search_document_gin_idx" ON "suppliers" USING gin ("search_document");
