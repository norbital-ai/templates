CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"external_code" text NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"website" text,
	"phone" text,
	"currency" text,
	"address" text,
	"credit_limit" numeric,
	"credit_used" numeric,
	"credit_hold" boolean,
	"active" boolean NOT NULL
);

--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("subject", ''))) STORED,
	"regarding_type" text NOT NULL,
	"regarding_id" uuid NOT NULL,
	"type" text,
	"subject" text NOT NULL,
	"description" text,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("first_name", '') || ' ' || coalesce("last_name", ''))) STORED,
	"account_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"title" text,
	"department" text,
	"active" boolean NOT NULL
);

--> statement-breakpoint
CREATE TABLE "contract_signings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("binding_hash", ''))) STORED,
	"quote_id" uuid NOT NULL,
	"variant" text,
	"status" text,
	"binding_hash" text NOT NULL,
	"generated_file" jsonb,
	"counterparty_file" jsonb,
	"share_token_hash" text,
	"share_expires_at" timestamp with time zone,
	"share_revoked_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"void_reason" text,
	"owner_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"quantity_received" numeric NOT NULL
);

--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("doc_no", ''))) STORED,
	"doc_no" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"received_date" timestamp with time zone,
	"note" text,
	"owner_id" uuid NOT NULL,
	"received_at" timestamp with time zone
);

--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"external_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"spec" text,
	"unit" text,
	"unit_price" numeric,
	"tax_rate" numeric,
	"qty_on_hand" numeric,
	"main_supplier_id" uuid,
	"active" boolean NOT NULL
);

--> statement-breakpoint
CREATE TABLE "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("product_name", ''))) STORED,
	"purchase_invoice_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit_cost" numeric NOT NULL,
	"tax_rate" numeric,
	"net" numeric,
	"tax" numeric,
	"line_total" numeric
);

--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("doc_no", ''))) STORED,
	"doc_no" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_code" text NOT NULL,
	"supplier_name" text NOT NULL,
	"invoice_reference" text,
	"invoice_date" timestamp with time zone,
	"status" text,
	"currency" text,
	"tax_inclusive" boolean NOT NULL,
	"net" numeric,
	"tax" numeric,
	"gross" numeric,
	"owner_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);

--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("product_name", ''))) STORED,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"product_unit" text,
	"quantity" numeric NOT NULL,
	"unit_cost" numeric NOT NULL,
	"tax_rate" numeric,
	"net" numeric,
	"tax" numeric,
	"line_total" numeric
);

--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("doc_no", ''))) STORED,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_code" text NOT NULL,
	"supplier_name" text NOT NULL,
	"status" text,
	"currency" text,
	"tax_inclusive" boolean NOT NULL,
	"expected_date" timestamp with time zone,
	"net" numeric,
	"tax" numeric,
	"gross" numeric,
	"owner_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);

--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("product_name", ''))) STORED,
	"quote_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"product_unit" text,
	"quantity" numeric NOT NULL,
	"unit_price" numeric NOT NULL,
	"discount_pct" numeric,
	"tax_rate" numeric,
	"net" numeric,
	"tax" numeric,
	"line_total" numeric
);

--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("doc_no", ''))) STORED,
	"doc_no" text NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"status" text,
	"currency" text,
	"tax_inclusive" boolean NOT NULL,
	"valid_until" timestamp with time zone,
	"payment_terms" text,
	"shipping_terms" text,
	"place_of_loading" text,
	"place_of_delivery" text,
	"packaging" text,
	"shipping_mark" text,
	"time_of_shipment" text,
	"other_terms" text,
	"net" numeric,
	"tax" numeric,
	"gross" numeric,
	"owner_id" uuid NOT NULL,
	"description" text,
	"revision_of" uuid,
	"revision_number" numeric,
	"confirmed_at" timestamp with time zone,
	"credit_acknowledged" boolean,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);

--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("product_name", ''))) STORED,
	"sales_invoice_id" uuid NOT NULL,
	"quote_line_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"product_unit" text,
	"quantity" numeric NOT NULL,
	"unit_price" numeric NOT NULL,
	"tax_rate" numeric,
	"net" numeric,
	"tax" numeric,
	"line_total" numeric
);

--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("doc_no", ''))) STORED,
	"doc_no" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text,
	"currency" text,
	"tax_inclusive" boolean NOT NULL,
	"net" numeric,
	"tax" numeric,
	"gross" numeric,
	"owner_id" uuid NOT NULL,
	"issued_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);

--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("reference", ''))) STORED,
	"regarding_type" text,
	"regarding_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text,
	"settled_on" timestamp with time zone,
	"reference" text,
	"owner_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("name", ''))) STORED,
	"external_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"category" text,
	"currency" text,
	"payment_terms_days" integer,
	"phone" text,
	"email" text,
	"address" text,
	"active" boolean NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_external_code_index" ON "accounts" ("external_code");
--> statement-breakpoint
CREATE INDEX "accounts_search_document_gin_idx" ON "accounts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "accounts_search_text_trgm_idx" ON "accounts" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "activities_regarding_type_regarding_id_index" ON "activities" ("regarding_type","regarding_id");
--> statement-breakpoint
CREATE INDEX "activities_due_date_idx" ON "activities" ("due_date");
--> statement-breakpoint
CREATE INDEX "activities_owner_id_idx" ON "activities" ("owner_id");
--> statement-breakpoint
CREATE INDEX "activities_search_document_gin_idx" ON "activities" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "activities_search_text_trgm_idx" ON "activities" USING gin ((coalesce("subject", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "contacts_account_id_idx" ON "contacts" ("account_id");
--> statement-breakpoint
CREATE INDEX "contacts_search_document_gin_idx" ON "contacts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "contacts_search_text_trgm_idx" ON "contacts" USING gin ((coalesce("first_name", '') || ' ' || coalesce("last_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "contract_signings_quote_id_idx" ON "contract_signings" ("quote_id");
--> statement-breakpoint
CREATE INDEX "contract_signings_status_idx" ON "contract_signings" ("status");
--> statement-breakpoint
CREATE INDEX "contract_signings_search_document_gin_idx" ON "contract_signings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "contract_signings_search_text_trgm_idx" ON "contract_signings" USING gin ((coalesce("binding_hash", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_goods_receipt_id_idx" ON "goods_receipt_lines" ("goods_receipt_id");
--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines" ("purchase_order_line_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_doc_no_index" ON "goods_receipts" ("doc_no");
--> statement-breakpoint
CREATE INDEX "goods_receipts_owner_id_idx" ON "goods_receipts" ("owner_id");
--> statement-breakpoint
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts" ("purchase_order_id");
--> statement-breakpoint
CREATE INDEX "goods_receipts_search_document_gin_idx" ON "goods_receipts" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "goods_receipts_search_text_trgm_idx" ON "goods_receipts" USING gin ((coalesce("doc_no", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "products_external_code_index" ON "products" ("external_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_index" ON "products" ("code");
--> statement-breakpoint
CREATE INDEX "products_search_document_gin_idx" ON "products" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_purchase_invoice_id_idx" ON "purchase_invoice_lines" ("purchase_invoice_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_purchase_order_line_id_idx" ON "purchase_invoice_lines" ("purchase_order_line_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_search_document_gin_idx" ON "purchase_invoice_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_search_text_trgm_idx" ON "purchase_invoice_lines" USING gin ((coalesce("product_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_doc_no_index" ON "purchase_invoices" ("doc_no");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_purchase_order_id_idx" ON "purchase_invoices" ("purchase_order_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_status_idx" ON "purchase_invoices" ("status");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_id_idx" ON "purchase_invoices" ("supplier_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_search_document_gin_idx" ON "purchase_invoices" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_invoices_search_text_trgm_idx" ON "purchase_invoices" USING gin ((coalesce("doc_no", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_product_id_idx" ON "purchase_order_lines" ("product_id");
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines" ("purchase_order_id");
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_search_document_gin_idx" ON "purchase_order_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_order_lines_search_text_trgm_idx" ON "purchase_order_lines" USING gin ((coalesce("product_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_doc_no_index" ON "purchase_orders" ("doc_no");
--> statement-breakpoint
CREATE INDEX "purchase_orders_expected_date_idx" ON "purchase_orders" ("expected_date");
--> statement-breakpoint
CREATE INDEX "purchase_orders_owner_id_idx" ON "purchase_orders" ("owner_id");
--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" ("status");
--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders" ("supplier_id");
--> statement-breakpoint
CREATE INDEX "purchase_orders_search_document_gin_idx" ON "purchase_orders" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "purchase_orders_search_text_trgm_idx" ON "purchase_orders" USING gin ((coalesce("doc_no", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "quote_lines_product_id_idx" ON "quote_lines" ("product_id");
--> statement-breakpoint
CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines" ("quote_id");
--> statement-breakpoint
CREATE INDEX "quote_lines_search_document_gin_idx" ON "quote_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "quote_lines_search_text_trgm_idx" ON "quote_lines" USING gin ((coalesce("product_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_doc_no_index" ON "quotes" ("doc_no");
--> statement-breakpoint
CREATE INDEX "quotes_account_id_idx" ON "quotes" ("account_id");
--> statement-breakpoint
CREATE INDEX "quotes_owner_id_idx" ON "quotes" ("owner_id");
--> statement-breakpoint
CREATE INDEX "quotes_revision_of_idx" ON "quotes" ("revision_of");
--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" ("status");
--> statement-breakpoint
CREATE INDEX "quotes_search_document_gin_idx" ON "quotes" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "quotes_search_text_trgm_idx" ON "quotes" USING gin ((coalesce("doc_no", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_quote_line_id_idx" ON "sales_invoice_lines" ("quote_line_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_sales_invoice_id_idx" ON "sales_invoice_lines" ("sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_search_document_gin_idx" ON "sales_invoice_lines" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_search_text_trgm_idx" ON "sales_invoice_lines" USING gin ((coalesce("product_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_doc_no_index" ON "sales_invoices" ("doc_no");
--> statement-breakpoint
CREATE INDEX "sales_invoices_account_id_idx" ON "sales_invoices" ("account_id");
--> statement-breakpoint
CREATE INDEX "sales_invoices_quote_id_idx" ON "sales_invoices" ("quote_id");
--> statement-breakpoint
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices" ("status");
--> statement-breakpoint
CREATE INDEX "sales_invoices_search_document_gin_idx" ON "sales_invoices" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "sales_invoices_search_text_trgm_idx" ON "sales_invoices" USING gin ((coalesce("doc_no", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "settlements_regarding_id_idx" ON "settlements" ("regarding_id");
--> statement-breakpoint
CREATE INDEX "settlements_regarding_type_idx" ON "settlements" ("regarding_type");
--> statement-breakpoint
CREATE INDEX "settlements_search_document_gin_idx" ON "settlements" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "settlements_search_text_trgm_idx" ON "settlements" USING gin ((coalesce("reference", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_external_code_index" ON "suppliers" ("external_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_index" ON "suppliers" ("code");
--> statement-breakpoint
CREATE INDEX "suppliers_active_idx" ON "suppliers" ("active");
--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" ("name");
--> statement-breakpoint
CREATE INDEX "suppliers_search_document_gin_idx" ON "suppliers" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "suppliers_search_text_trgm_idx" ON "suppliers" USING gin ((coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD CONSTRAINT "contract_signings_quote_id_quotes_fk" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id");
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD CONSTRAINT "contract_signings_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_goods_receipts_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_purchase_order_lines_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id");
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id");
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_main_supplier_id_suppliers_fk" FOREIGN KEY ("main_supplier_id") REFERENCES "suppliers"("id");
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_purchase_invoices_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_order_line_id_purchase_order_lines_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id");
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_purchase_orders_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id");
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id");
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id");
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id");
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_fk" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id");
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_accounts_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id");
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_revision_of_quotes_fk" FOREIGN KEY ("revision_of") REFERENCES "quotes"("id");
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_sales_invoices_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_quote_line_id_quote_lines_fk" FOREIGN KEY ("quote_line_id") REFERENCES "quote_lines"("id");
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_quote_id_quotes_fk" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id");
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_account_id_accounts_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_owner_id_user_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id");
