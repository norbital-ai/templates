ALTER TABLE "accounts" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "record_embedding" vector(256);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "record_embedding_fingerprint" text;
--> statement-breakpoint
CREATE INDEX "accounts_record_embedding_hnsw_idx" ON "accounts" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "activities_record_embedding_hnsw_idx" ON "activities" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "contacts_record_embedding_hnsw_idx" ON "contacts" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "contract_signings_record_embedding_hnsw_idx" ON "contract_signings" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "goods_receipts_record_embedding_hnsw_idx" ON "goods_receipts" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "products_record_embedding_hnsw_idx" ON "products" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_record_embedding_hnsw_idx" ON "purchase_invoice_lines" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "purchase_invoices_record_embedding_hnsw_idx" ON "purchase_invoices" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_record_embedding_hnsw_idx" ON "purchase_order_lines" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "purchase_orders_record_embedding_hnsw_idx" ON "purchase_orders" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "quote_lines_record_embedding_hnsw_idx" ON "quote_lines" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "quotes_record_embedding_hnsw_idx" ON "quotes" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_record_embedding_hnsw_idx" ON "sales_invoice_lines" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "sales_invoices_record_embedding_hnsw_idx" ON "sales_invoices" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "settlements_record_embedding_hnsw_idx" ON "settlements" USING hnsw ("record_embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "suppliers_record_embedding_hnsw_idx" ON "suppliers" USING hnsw ("record_embedding" vector_cosine_ops);
