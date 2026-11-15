-- 0002_schema.sql: 188 step(s), from c0820a4dae957725f4257c437fe4037a15003e145f26f7af0e1afb1d16d8ded3 to 2385447aa7c69719b088c345942073d7c40e2460e4c76e2b90f822eb9470636e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:index:drawdown.drawdown__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "drawdown__gin__73732636";

-- step replace:index:bank_document.bank_document__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "bank_document__gin__73732636";

-- step replace:index:month_end.month_end__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "month_end__gin__73732636";

-- step replace:index:month_end_line.month_end_line__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "month_end_line__gin__73732636";

-- step replace:index:supplier.supplier__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "supplier__gin__73732636";

-- step drop:constraint:drawdown.drawdown__ck__e5be4ef3 (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" drop constraint if exists "drawdown__ck__e5be4ef3";

-- step drop:constraint:drawdown.drawdown__ck__3e75e609 (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" drop constraint if exists "drawdown__ck__3e75e609";

-- step drop:constraint:invoice.invoice__ck__e5be4ef3 (additive)
-- operational risk: access-exclusive-lock
alter table "invoice" drop constraint if exists "invoice__ck__e5be4ef3";

-- step drop:constraint:po_line.po_line__ck__e5be4ef3 (additive)
-- operational risk: access-exclusive-lock
alter table "po_line" drop constraint if exists "po_line__ck__e5be4ef3";

-- step drop:constraint:po_line.po_line__ck__fd9e3d00 (additive)
-- operational risk: access-exclusive-lock
alter table "po_line" drop constraint if exists "po_line__ck__fd9e3d00";

-- step drop:notNull:drawdown_charge.is_estimate (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown_charge" alter column "is_estimate" drop not null;

-- step drop:default:drawdown_charge.is_estimate (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown_charge" alter column "is_estimate" drop default;

-- Estimated charges are now computed from the fee rules; only actual charges stay stored.
delete from "drawdown_charge" where "is_estimate";

-- step drop:column:drawdown_charge.is_estimate (destructive)
-- accept: drop:column:drawdown_charge.is_estimate
-- operational risk: access-exclusive-lock
alter table "drawdown_charge" drop column if exists "is_estimate" cascade;

-- step replace:column:drawdown.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "drawdown" drop column if exists "bolt_record_label" cascade;

-- step replace:column:drawdown.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "drawdown" drop column if exists bolt_search cascade;

-- step replace:column:bank_document.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "bank_document" drop column if exists "bolt_record_label" cascade;

-- step replace:column:bank_document.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "bank_document" drop column if exists bolt_search cascade;

-- step replace:column:month_end.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "month_end" drop column if exists "bolt_record_label" cascade;

-- step replace:column:month_end.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "month_end" drop column if exists bolt_search cascade;

-- step replace:column:month_end_line.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "month_end_line" drop column if exists "bolt_record_label" cascade;

-- step replace:column:month_end_line.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "month_end_line" drop column if exists bolt_search cascade;

-- step replace:column:supplier.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "supplier" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_bank_document_6d5469b9 (additive)
drop function if exists "bolt_record_label_bank_document_6d5469b9"(text) cascade;

-- step drop:function:bolt_record_label_drawdown_6e8ab94b (additive)
drop function if exists "bolt_record_label_drawdown_6e8ab94b"(text) cascade;

-- step drop:function:bolt_record_label_month_end_ee21dd4a (additive)
drop function if exists "bolt_record_label_month_end_ee21dd4a"(date) cascade;

-- step drop:function:bolt_record_label_month_end_line_813c0aa8 (additive)
drop function if exists "bolt_record_label_month_end_line_813c0aa8"(text) cascade;

-- step create:function:bolt_record_label_drawdown_c9bc55ae (additive)
create function "bolt_record_label_drawdown_c9bc55ae"(numeric, text, text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_3.left_value) = 'string' AND jsonb_typeof(label_3.right_value) = 'string' THEN to_jsonb((label_3.left_value #>> '{}') || (label_3.right_value #>> '{}')) WHEN jsonb_typeof(label_3.left_value) = 'array' AND jsonb_typeof(label_3.right_value) = 'array' THEN label_3.left_value || label_3.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_3.left_value) = 'number' THEN (label_3.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_3.right_value) = 'number' THEN (label_3.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_2.left_value) = 'string' AND jsonb_typeof(label_2.right_value) = 'string' THEN to_jsonb((label_2.left_value #>> '{}') || (label_2.right_value #>> '{}')) WHEN jsonb_typeof(label_2.left_value) = 'array' AND jsonb_typeof(label_2.right_value) = 'array' THEN label_2.left_value || label_2.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_2.left_value) = 'number' THEN (label_2.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_2.right_value) = 'number' THEN (label_2.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['product']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, coalesce((label_row.j #> ARRAY['currency']), 'null'::jsonb) AS right_value) label_1) AS left_value, to_jsonb(' '::text) AS right_value) label_2) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['amount']), 'null'::jsonb) #>> '{}')) AS right_value) label_3) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_reference', to_jsonb("bank_reference"), 'product', to_jsonb("product"), 'currency', to_jsonb("currency"), 'amount', to_jsonb(("amount")::text)) AS j FROM (SELECT $1 AS "amount", $2 AS "bank_reference", $3 AS "currency", $4 AS "product") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_bank_document_3dc52602 (additive)
create function "bolt_record_label_bank_document_3dc52602"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Advice'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('advice_reference', to_jsonb("advice_reference")) AS j FROM (SELECT $1 AS "advice_reference") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_month_end_907c8683 (additive)
create function "bolt_record_label_month_end_907c8683"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['month']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('month', to_jsonb("month"::text)) AS j FROM (SELECT $1 AS "month") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_month_end_line_7135a1d1 (additive)
create function "bolt_record_label_month_end_line_7135a1d1"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['bank_code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('—'::text) ELSE 'null'::jsonb END) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_code', to_jsonb("bank_code"), 'reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "bank_code", $2 AS "reference") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_facility_form_27022eb9 (additive)
create function "bolt_record_label_facility_form_27022eb9"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('po_number', to_jsonb("po_number")) AS j FROM (SELECT $1 AS "po_number") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_facility_attachment_06f5fc13 (additive)
create function "bolt_record_label_facility_attachment_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row) label_value$record_label$;

-- step create:table:facility_form (additive)
create table "facility_form" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"po_number" text not null,
	"po_date" date,
	"ship_date" date,
	"payment_terms" text,
	"shipping_terms" text,
	"customer_po_number" text,
	"requested_by" text,
	"buyer" text,
	"vendor" text,
	"facility_required" text default 'tt'::text not null,
	"currency" text default 'USD'::text not null,
	"amount" numeric,
	"latest_shipment_date" date,
	"partial_shipment" boolean default false not null,
	"transhipment" boolean default false not null,
	"shipment_from" text,
	"shipment_to" text,
	"freight" text,
	"lc_expiry_date" date,
	"documents_presentation_days" int,
	"expected_arrival" text,
	"intended_period_of_sales" text,
	"projected_sales" text,
	"purpose" text,
	"product_description" text,
	"pay_by_date" date,
	"remarks" text,
	"read_note" text,
	"bolt_record_label" text generated always as ("bolt_record_label_facility_form_27022eb9"("po_number")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_facility_form_27022eb9"("po_number"), '') || ' ' || coalesce("po_number"::text, '') || ' ' || coalesce("vendor"::text, '') || ' ' || coalesce("customer_po_number"::text, ''))) stored,
	"purchase_order" uuid,
	constraint "facility_form__ck__b601e9fa" check (char_length("po_number") <= 60),
	constraint "facility_form__ck__33ed5c43" check (isfinite("po_date")),
	constraint "facility_form__ck__69c93b17" check (isfinite("ship_date")),
	constraint "facility_form__ck__4f0f0b1e" check ("facility_required" in ('tt', 'lc')),
	constraint "facility_form__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "facility_form__ck__e5be4ef3" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", 2) = "amount"),
	constraint "facility_form__ck__7e0bb8b8" check (isfinite("latest_shipment_date")),
	constraint "facility_form__ck__1a1b051b" check (isfinite("lc_expiry_date")),
	constraint "facility_form__ck__252f409a" check ("documents_presentation_days" >= 0),
	constraint "facility_form__ck__740b4d8c" check (isfinite("pay_by_date"))
);

-- step create:table:facility_attachment (additive)
create table "facility_attachment" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"kind" text default 'other'::text not null,
	"title" text not null,
	"file" jsonb not null,
	"bolt_record_label" text generated always as ("bolt_record_label_facility_attachment_06f5fc13"("title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_facility_attachment_06f5fc13"("title"), ''))) stored,
	"form" uuid not null,
	constraint "facility_attachment__ck__90b8e62c" check ("kind" in ('proforma', 'purchase_order', 'customer_po', 'planning_detail', 'other')),
	constraint "facility_attachment__ck__c2203a9a" check (("file" is null or store_json_valid("file", '{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"}'::jsonb) is true))
);

-- step create:table:invoice_line (additive)
create table "invoice_line" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"quantity" numeric not null,
	"amount" numeric not null,
	"invoice" uuid not null,
	"po_line" uuid not null,
	constraint "invoice_line__ck__c25ace36" check ("quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("quantity", 3) = "quantity" and "quantity" >= 0),
	constraint "invoice_line__ck__6ed3a672" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", 2) = "amount" and "amount" >= 0)
);

-- step create:table:po_financing (additive)
create table "po_financing" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"is_lc" boolean default false not null,
	"purchase_order" uuid not null,
	"drawdown" uuid not null,
	constraint "po_financing__uq__f3b8208f" unique nulls not distinct ("purchase_order", "drawdown") deferrable initially immediate
);

-- step create:table:supplier_bank (additive)
create table "supplier_bank" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"supplier" uuid not null,
	"bank" uuid not null,
	constraint "supplier_bank__uq__d80ef5c3" unique nulls not distinct ("supplier", "bank") deferrable initially immediate
);

-- step replace:column:drawdown.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drawdown" add column "bolt_record_label" text generated always as ("bolt_record_label_drawdown_c9bc55ae"("amount", "bank_reference", "currency", "product")) stored;

-- step replace:column:drawdown.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drawdown" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_drawdown_c9bc55ae"("amount", "bank_reference", "currency", "product"), '') || ' ' || coalesce("bank_reference"::text, '') || ' ' || coalesce("lc_number"::text, '') || ' ' || coalesce("bill_number"::text, ''))) stored;

-- step replace:column:bank_document.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "bank_document" add column "bolt_record_label" text generated always as ("bolt_record_label_bank_document_3dc52602"("advice_reference")) stored;

-- step replace:column:bank_document.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "bank_document" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_bank_document_3dc52602"("advice_reference"), ''))) stored;

-- step replace:column:month_end.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "month_end" add column "bolt_record_label" text generated always as ("bolt_record_label_month_end_907c8683"("month")) stored;

-- step replace:column:month_end.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "month_end" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_month_end_907c8683"("month"), ''))) stored;

-- step replace:column:month_end_line.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "month_end_line" add column "bolt_record_label" text generated always as ("bolt_record_label_month_end_line_7135a1d1"("bank_code", "reference")) stored;

-- step replace:column:month_end_line.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "month_end_line" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_month_end_line_7135a1d1"("bank_code", "reference"), ''))) stored;

-- step create:column:supplier.aliases (additive)
-- operational risk: access-exclusive-lock
alter table "supplier" add column "aliases" text[];

-- step replace:column:supplier.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "supplier" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_supplier_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce(bolt_search_join("aliases"::text[]), ''))) stored;

-- step replace:history:schema:bank (additive)
select bolt_history_register('bank','{"audit":true,"fields":{"code":{"kind":"text","max":20},"cut_off_time":{"kind":"text","optional":true},"is_active":{"default":true,"kind":"bool"},"name":{"kind":"text"},"offered_products":{"kind":"enum","many":true,"optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"settlement_instructions":{"kind":"text","optional":true},"terms_notes":{"kind":"text","optional":true}},"record_label":"record.code","unique":[{"fields":["code"],"import_key":true,"name":"bank_code"}]}'::jsonb);

-- step replace:history:schema:drawdown (additive)
select bolt_history_register('drawdown','{"audit":true,"computed":{"amount_usd":{"expr":{"round":[{"times":[{"field":"amount"},{"field":"fx_rate_to_usd"}]},2]},"kind":"decimal","scale":2}},"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"application_date":{"kind":"date","optional":true},"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charge_rate_pct":{"kind":"decimal","optional":true,"scale":6},"converted_from":{"inverse":"converted_into","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"due_date":{"kind":"date","optional":true},"earliest_invoice_date":{"kind":"date","optional":true},"expected_draw_date":{"kind":"date","optional":true},"facility":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"facility"},"fx_rate_to_usd":{"default":1,"kind":"decimal","scale":12},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"interest_to_maturity":{"kind":"decimal","optional":true,"scale":2},"is_archived":{"default":false,"kind":"bool"},"latest_due_date":{"kind":"date","optional":true},"lc_expiry_date":{"kind":"date","optional":true},"lc_number":{"kind":"text","optional":true},"needs_review":{"default":false,"kind":"bool"},"notes":{"kind":"text","optional":true},"product":{"default":"if","kind":"enum","values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"purpose":{"kind":"text","optional":true},"rate_source":{"kind":"enum","optional":true,"values":["manual","bank_advice"]},"released_date":{"kind":"date","optional":true},"requested_by":{"kind":"text","optional":true},"review_note":{"kind":"text","optional":true},"settled_by":{"kind":"enum","optional":true,"values":["repaid","cash","converted"]},"settled_interest":{"kind":"decimal","optional":true,"scale":2},"settled_principal":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"start_date":{"kind":"date","optional":true},"status":{"default":"active","kind":"enum","values":["earmarked","applied","active","settled","cancelled","unclear"]},"supplier":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"supplier"},"tenor_days":{"kind":"int","optional":true},"terms_days":{"kind":"int","min":0,"optional":true}},"indexes":[{"on":["status","due_date"]}],"locks":{"sealed_line":{"except":["is_archived","needs_review","review_note","notes"],"where":{"status":{"in":["settled","cancelled"]}}}},"record_label":"(record.bank_reference != null ? record.bank_reference : string(record.product)) + '' · '' + record.currency + '' '' + string(record.amount)","search":{"text":["bank_reference","lc_number","bill_number"]}}'::jsonb);

-- step replace:history:schema:bank_document (additive)
select bolt_history_register('bank_document','{"audit":true,"fields":{"advice_date":{"kind":"date","optional":true},"advice_reference":{"kind":"text","optional":true},"bank":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"doc_type":{"default":"other","kind":"enum","values":["drawdown_advice","settlement_advice","other"]},"drawdown":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"extracted":{"kind":"json","optional":true,"shape":{"fields":{"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charges":{"fields":{"amount_usd":{"kind":"decimal","scale":2},"charge_type":{"kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"description":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"currency":{"kind":"currency","optional":true},"due_date":{"kind":"date","optional":true},"interest_amount":{"kind":"decimal","optional":true,"scale":2},"interest_days":{"kind":"int","optional":true},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"lc_number":{"kind":"text","optional":true},"principal":{"kind":"decimal","optional":true,"scale":2},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"start_date":{"kind":"date","optional":true},"supplier_name":{"kind":"text","optional":true},"total_debited":{"kind":"decimal","optional":true,"scale":2},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}},"file":{"accept":["application/pdf"],"kind":"file","max":"10MiB"},"notes":{"kind":"text","optional":true},"read_note":{"kind":"text","optional":true},"read_status":{"default":"uploaded","kind":"enum","values":["uploaded","checked","applied","failed"]}},"record_label":"record.advice_reference != null ? record.advice_reference : ''Advice''"}'::jsonb);

-- step replace:history:schema:drawdown_charge (additive)
select bolt_history_register('drawdown_charge','{"audit":true,"fields":{"amount":{"kind":"decimal","scale":2},"charge_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"currency":{"default":"USD","kind":"currency"},"description":{"kind":"text","optional":true},"drawdown":{"inverse":"charges","kind":"ref","on_delete":"cascade","to":"drawdown"},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.charge_type"}'::jsonb);

-- step replace:history:schema:facility (additive)
select bolt_history_register('facility','{"audit":true,"fields":{"bank":{"inverse":"facilities","kind":"ref","to":"bank"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"early_settlement_penalty":{"kind":"text","optional":true},"entity":{"kind":"text","optional":true},"expiry_date":{"kind":"date","optional":true},"interest_rounding":{"default":"nearest_cent","kind":"enum","values":["nearest_cent","down_to_cent"]},"limit":{"default":0,"kind":"decimal","scale":2},"margin_pct":{"kind":"decimal","optional":true,"scale":6},"max_tenor_days":{"kind":"int","min":0,"optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"pledged_deposit":{"kind":"decimal","optional":true,"scale":2},"pricing_basis":{"kind":"text","optional":true},"pricing_notes":{"kind":"text","optional":true},"review_date":{"kind":"date","optional":true},"security":{"kind":"text","optional":true},"status":{"default":"active","kind":"enum","values":["active","expired"]},"tenor_start_rule":{"kind":"enum","optional":true,"values":["invoice_date","disbursement_date","bill_of_lading_date"]}},"record_label":"record.name","unique":[{"fields":["bank","name"],"name":"facility_name_per_bank"}]}'::jsonb);

-- step replace:history:schema:facility_fee (additive)
select bolt_history_register('facility_fee','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"currency":{"default":"USD","kind":"currency"},"facility":{"inverse":"fees","kind":"ref","on_delete":"cascade","to":"facility"},"fee_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"include_in_estimates":{"default":true,"kind":"bool"},"method":{"default":"percent","kind":"enum","values":["percent","flat"]},"minimum_amount":{"kind":"decimal","optional":true,"scale":2},"notes":{"kind":"text","optional":true},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"rate_pct":{"kind":"decimal","optional":true,"scale":6},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.fee_type"}'::jsonb);

-- step replace:history:schema:sub_limit (additive)
select bolt_history_register('sub_limit','{"audit":true,"fields":{"facility":{"inverse":"sub_limits","kind":"ref","on_delete":"cascade","to":"facility"},"limit":{"kind":"decimal","scale":2},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"supplier":{"inverse":"sub_limits","kind":"ref","on_delete":"set_null","optional":true,"to":"supplier"}},"record_label":"record.name"}'::jsonb);

-- step replace:history:schema:month_end (additive)
select bolt_history_register('month_end','{"audit":true,"fields":{"accrued_interest":{"kind":"decimal","optional":true,"scale":2},"available":{"kind":"decimal","optional":true,"scale":2},"average_tenor_days":{"kind":"decimal","optional":true,"scale":2},"bank_borrowings":{"kind":"decimal","optional":true,"scale":2},"banker_guarantee":{"kind":"decimal","optional":true,"scale":2},"credit_line":{"kind":"decimal","optional":true,"scale":2},"highest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"is_locked":{"default":false,"kind":"bool"},"letters_of_credit":{"kind":"decimal","optional":true,"scale":2},"locked_at":{"kind":"instant","optional":true},"lowest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"month":{"kind":"date"},"notes":{"kind":"text","optional":true},"simple_average_rate_pct":{"kind":"decimal","optional":true,"scale":6},"source":{"default":"portal","kind":"enum","values":["portal","excel"]},"term_bills":{"kind":"decimal","optional":true,"scale":2},"total_utilised":{"kind":"decimal","optional":true,"scale":2},"weighted_average_rate_pct":{"kind":"decimal","optional":true,"scale":6}},"locks":{"locked_month":{"except":["is_locked","notes"],"where":{"is_locked":{"eq":true}}}},"record_label":"string(record.month)","unique":[{"fields":["month"],"name":"one_report_per_month"}]}'::jsonb);

-- step replace:history:schema:month_end_line (additive)
select bolt_history_register('month_end_line','{"audit":true,"fields":{"accrued_days":{"kind":"int","optional":true},"accrued_interest":{"kind":"decimal","optional":true,"scale":2},"amount":{"kind":"decimal","scale":2},"amount_usd":{"kind":"decimal","optional":true,"scale":2},"bank_code":{"kind":"text"},"charges":{"kind":"decimal","optional":true,"scale":2},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"drawdown":{"inverse":"month_end_lines","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"due_date":{"kind":"date","optional":true},"fx_rate_to_usd":{"default":1,"kind":"decimal","scale":12},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"interest_to_maturity":{"kind":"decimal","optional":true,"scale":2},"month_end":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"month_end"},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"reference":{"kind":"text","optional":true},"start_date":{"kind":"date","optional":true},"supplier":{"kind":"text","optional":true},"tenor_days":{"kind":"int","optional":true}},"record_label":"record.bank_code + '' · '' + (record.reference != null ? record.reference : ''—'')"}'::jsonb);

-- step replace:history:schema:purchase_order (additive)
select bolt_history_register('purchase_order','{"audit":true,"fields":{"amount":{"kind":"sum","of":"lines.amount"},"currency":{"default":"USD","kind":"currency"},"invoice_count":{"kind":"count","of":"invoices"},"invoiced_amount":{"kind":"sum","of":"invoices.amount"},"is_cancelled":{"default":false,"kind":"bool"},"lc_links":{"kind":"count","of":"financings","where":{"is_lc":{"eq":true}}},"lc_requested":{"default":false,"kind":"bool"},"notes":{"kind":"text","optional":true},"po_date":{"kind":"date"},"po_number":{"kind":"text","max":60},"purchaser":{"kind":"text","optional":true},"quantity":{"kind":"sum","of":"lines.quantity"},"salesperson":{"kind":"text","optional":true},"ship_to_country":{"kind":"text","optional":true},"supplier":{"inverse":"purchase_orders","kind":"ref","to":"supplier"}},"record_label":"record.po_number","unique":[{"fields":["po_number"],"import_key":true,"name":"po_number"}]}'::jsonb);

-- step replace:history:schema:invoice (additive)
select bolt_history_register('invoice','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"bank_bill_number":{"kind":"text","optional":true},"currency":{"default":"USD","kind":"currency"},"drawdown":{"inverse":"invoices","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"invoice_date":{"kind":"date"},"invoice_number":{"kind":"text","max":60},"notes":{"kind":"text","optional":true},"po":{"inverse":"invoices","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"record.invoice_number","unique":[{"fields":["po","invoice_number"],"name":"invoice_per_po"}]}'::jsonb);

-- step replace:history:schema:po_line (additive)
select bolt_history_register('po_line','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"invoiced_quantity":{"kind":"sum","of":"invoice_lines.quantity"},"item":{"kind":"text"},"po":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"purchase_order"},"quantity":{"kind":"decimal","min":0,"scale":3}},"record_label":"record.item"}'::jsonb);

-- step replace:history:schema:supplier (additive)
select bolt_history_register('supplier','{"audit":true,"fields":{"aliases":{"kind":"text","many":true,"optional":true},"country":{"kind":"text","optional":true},"is_active":{"default":true,"kind":"bool"},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms":{"kind":"text","optional":true},"products":{"kind":"text","optional":true},"relationship_since":{"kind":"date","optional":true}},"record_label":"record.name","search":{"text":["name","aliases"]},"unique":[{"fields":["name"],"import_key":true,"name":"supplier_name"}]}'::jsonb);

-- step create:column:bank.settlement_instructions (additive)
-- operational risk: access-exclusive-lock
alter table "bank" add column "settlement_instructions" text;

-- step create:column:bank.offered_products (additive)
-- operational risk: access-exclusive-lock
alter table "bank" add column "offered_products" text[];

-- step create:column:drawdown.terms_days (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "terms_days" int;

-- step create:column:drawdown.fx_rate_to_usd (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "fx_rate_to_usd" numeric default '1'::numeric;

-- step create:column:drawdown.tenor_days (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "tenor_days" int;

-- step create:column:drawdown.rate_source (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "rate_source" text;

-- step create:column:drawdown.interest_to_maturity (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "interest_to_maturity" numeric;

-- step create:column:drawdown.latest_due_date (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "latest_due_date" date;

-- step create:column:drawdown.requested_by (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "requested_by" text;

-- step create:column:drawdown.settled_by (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "settled_by" text;

-- step create:column:drawdown.needs_review (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "needs_review" boolean default false;

-- step create:column:drawdown.review_note (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "review_note" text;

-- step create:column:drawdown.amount_usd (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drawdown" add column "amount_usd" numeric generated always as ((round(((("amount")::numeric * ("fx_rate_to_usd")::numeric))::numeric, 2))::numeric) stored;

-- step create:column:bank_document.extracted (additive)
-- operational risk: access-exclusive-lock
alter table "bank_document" add column "extracted" jsonb;

-- step create:column:facility.pricing_notes (additive)
-- operational risk: access-exclusive-lock
alter table "facility" add column "pricing_notes" text;

-- step create:column:facility.tenor_start_rule (additive)
-- operational risk: access-exclusive-lock
alter table "facility" add column "tenor_start_rule" text;

-- step create:column:facility.early_settlement_penalty (additive)
-- operational risk: access-exclusive-lock
alter table "facility" add column "early_settlement_penalty" text;

-- step create:column:facility.pledged_deposit (additive)
-- operational risk: access-exclusive-lock
alter table "facility" add column "pledged_deposit" numeric;

-- step create:column:facility_fee.currency (additive)
-- operational risk: access-exclusive-lock
alter table "facility_fee" add column "currency" text default 'USD'::text;

-- step create:column:month_end.locked_at (additive)
-- operational risk: access-exclusive-lock
alter table "month_end" add column "locked_at" timestamptz;

-- step create:column:month_end.available (additive)
-- operational risk: access-exclusive-lock
alter table "month_end" add column "available" numeric;

-- step create:column:month_end_line.fx_rate_to_usd (additive)
-- operational risk: access-exclusive-lock
alter table "month_end_line" add column "fx_rate_to_usd" numeric default '1'::numeric;

-- step create:column:month_end_line.day_count_basis (additive)
-- operational risk: access-exclusive-lock
alter table "month_end_line" add column "day_count_basis" text default 'actual_360'::text;

-- step create:column:month_end_line.start_date (additive)
-- operational risk: access-exclusive-lock
alter table "month_end_line" add column "start_date" date;

-- step create:column:month_end_line.due_date (additive)
-- operational risk: access-exclusive-lock
alter table "month_end_line" add column "due_date" date;

-- step create:column:month_end_line.tenor_days (additive)
-- operational risk: access-exclusive-lock
alter table "month_end_line" add column "tenor_days" int;

-- step create:column:purchase_order.amount (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "amount" numeric default 0;

-- step create:column:purchase_order.quantity (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "quantity" numeric default 0;

-- step create:column:purchase_order.invoiced_amount (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "invoiced_amount" numeric default 0;

-- step create:column:purchase_order.invoice_count (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "invoice_count" int default 0;

-- step create:column:purchase_order.lc_links (backfill)
-- operational risk: access-exclusive-lock
alter table "purchase_order" add column "lc_links" int default 0;

-- step create:column:po_line.invoiced_quantity (backfill)
-- operational risk: access-exclusive-lock
alter table "po_line" add column "invoiced_quantity" numeric default 0;

-- step create:column:supplier.relationship_since (additive)
-- operational risk: access-exclusive-lock
alter table "supplier" add column "relationship_since" date;

-- step create:column:drawdown.converted_from (additive)
-- operational risk: access-exclusive-lock
alter table "drawdown" add column "converted_from" uuid;

-- step create:history:schema:facility_form (additive)
select bolt_history_register('facility_form','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"buyer":{"kind":"text","optional":true},"currency":{"default":"USD","kind":"currency"},"customer_po_number":{"kind":"text","optional":true},"documents_presentation_days":{"kind":"int","min":0,"optional":true},"expected_arrival":{"kind":"text","optional":true},"facility_required":{"default":"tt","kind":"enum","values":["tt","lc"]},"freight":{"kind":"text","optional":true},"intended_period_of_sales":{"kind":"text","optional":true},"latest_shipment_date":{"kind":"date","optional":true},"lc_expiry_date":{"kind":"date","optional":true},"partial_shipment":{"default":false,"kind":"bool"},"pay_by_date":{"kind":"date","optional":true},"payment_terms":{"kind":"text","optional":true},"po_date":{"kind":"date","optional":true},"po_number":{"kind":"text","max":60},"product_description":{"kind":"text","optional":true},"projected_sales":{"kind":"text","optional":true},"purchase_order":{"inverse":"facility_forms","kind":"ref","on_delete":"set_null","optional":true,"to":"purchase_order"},"purpose":{"kind":"text","optional":true},"read_note":{"kind":"text","optional":true},"remarks":{"kind":"text","optional":true},"requested_by":{"kind":"text","optional":true},"ship_date":{"kind":"date","optional":true},"shipment_from":{"kind":"text","optional":true},"shipment_to":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"transhipment":{"default":false,"kind":"bool"},"vendor":{"kind":"text","optional":true}},"record_label":"record.po_number","search":{"text":["po_number","vendor","customer_po_number"]}}'::jsonb);

-- step create:history:schema:facility_attachment (additive)
select bolt_history_register('facility_attachment','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"form":{"inverse":"attachments","kind":"ref","on_delete":"cascade","to":"facility_form"},"kind":{"default":"other","kind":"enum","values":["proforma","purchase_order","customer_po","planning_detail","other"]},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

-- step create:history:schema:invoice_line (additive)
select bolt_history_register('invoice_line','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"invoice":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"invoice"},"po_line":{"inverse":"invoice_lines","kind":"ref","on_delete":"restrict","to":"po_line"},"quantity":{"kind":"decimal","min":0,"scale":3}},"record_label":"record.po_line.item"}'::jsonb);

-- step create:history:schema:po_financing (additive)
select bolt_history_register('po_financing','{"audit":true,"fields":{"drawdown":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"drawdown"},"is_lc":{"default":false,"kind":"bool"},"purchase_order":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"record.purchase_order.po_number + '' · '' + (record.drawdown.bank_reference != null ? record.drawdown.bank_reference : string(record.drawdown.product))","unique":[{"fields":["purchase_order","drawdown"],"name":"one_link"}]}'::jsonb);

-- step create:history:schema:supplier_bank (additive)
select bolt_history_register('supplier_bank','{"audit":true,"fields":{"bank":{"inverse":"eligible_suppliers","kind":"ref","on_delete":"cascade","to":"bank"},"supplier":{"inverse":"eligible_banks","kind":"ref","on_delete":"cascade","to":"supplier"}},"record_label":"record.bank.code","unique":[{"fields":["supplier","bank"],"name":"one_per_pair"}]}'::jsonb);

-- step create:backfill:purchase_order.amount (backfill)
-- operational risk: writes-blocked, table-scan
update "purchase_order" p set "amount" = (select coalesce(sum(c."amount"), 0) from "po_line" c where c."po" = p.id);

-- step create:backfill:purchase_order.quantity (backfill)
-- operational risk: writes-blocked, table-scan
update "purchase_order" p set "quantity" = (select coalesce(sum(c."quantity"), 0) from "po_line" c where c."po" = p.id);

-- step create:backfill:purchase_order.invoiced_amount (backfill)
-- operational risk: writes-blocked, table-scan
update "purchase_order" p set "invoiced_amount" = (select coalesce(sum(c."amount"), 0) from "invoice" c where c."po" = p.id);

-- step create:backfill:purchase_order.invoice_count (backfill)
-- operational risk: writes-blocked, table-scan
update "purchase_order" p set "invoice_count" = (select count(*)::int from "invoice" c where c."po" = p.id);

-- step create:backfill:purchase_order.lc_links (backfill)
-- operational risk: writes-blocked, table-scan
update "purchase_order" p set "lc_links" = (select count(*)::int from "po_financing" c where c."purchase_order" = p.id and (coalesce(c."is_lc" = true, false)));

-- step create:backfill:po_line.invoiced_quantity (backfill)
-- operational risk: writes-blocked, table-scan
update "po_line" p set "invoiced_quantity" = (select coalesce(sum(c."quantity"), 0) from "invoice_line" c where c."po_line" = p.id);

-- step create:notNull:drawdown.fx_rate_to_usd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where "fx_rate_to_usd" is null' into n;
	if n > 0 then raise exception 'notNull:drawdown.fx_rate_to_usd refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" alter column "fx_rate_to_usd" set not null;

-- step create:notNull:drawdown.needs_review (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where "needs_review" is null' into n;
	if n > 0 then raise exception 'notNull:drawdown.needs_review refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" alter column "needs_review" set not null;

-- step create:notNull:facility_fee.currency (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility_fee" where "currency" is null' into n;
	if n > 0 then raise exception 'notNull:facility_fee.currency refuses % existing row(s)', n; end if;
end $store$;
alter table "facility_fee" alter column "currency" set not null;

-- step create:notNull:month_end_line.fx_rate_to_usd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where "fx_rate_to_usd" is null' into n;
	if n > 0 then raise exception 'notNull:month_end_line.fx_rate_to_usd refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" alter column "fx_rate_to_usd" set not null;

-- step create:notNull:month_end_line.day_count_basis (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where "day_count_basis" is null' into n;
	if n > 0 then raise exception 'notNull:month_end_line.day_count_basis refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" alter column "day_count_basis" set not null;

-- step create:notNull:purchase_order.amount (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "amount" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.amount refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "amount" set not null;

-- step create:notNull:purchase_order.quantity (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "quantity" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.quantity refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "quantity" set not null;

-- step create:notNull:purchase_order.invoiced_amount (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "invoiced_amount" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.invoiced_amount refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "invoiced_amount" set not null;

-- step create:notNull:purchase_order.invoice_count (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "invoice_count" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.invoice_count refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "invoice_count" set not null;

-- step create:notNull:purchase_order.lc_links (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "purchase_order" where "lc_links" is null' into n;
	if n > 0 then raise exception 'notNull:purchase_order.lc_links refuses % existing row(s)', n; end if;
end $store$;
alter table "purchase_order" alter column "lc_links" set not null;

-- step create:notNull:po_line.invoiced_quantity (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "po_line" where "invoiced_quantity" is null' into n;
	if n > 0 then raise exception 'notNull:po_line.invoiced_quantity refuses % existing row(s)', n; end if;
end $store$;
alter table "po_line" alter column "invoiced_quantity" set not null;

-- step create:constraint:bank.bank__ck__2aa057f7 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "bank" where (not jsonb_path_exists(to_jsonb("offered_products"), ''strict $[*] ? (@.type() != "string")'') and "offered_products" <@ array[''lc'', ''import_bill'', ''da'', ''dp'', ''tb'', ''ba'', ''bad'', ''if'', ''if_after_lc_or_da'', ''pif'', ''twc'', ''oaf'', ''apf'', ''psil'', ''psbl'', ''ofcl'', ''mctf'', ''tradepay'', ''packing'', ''fbep'', ''dbep'', ''ecr'', ''badd'', ''stl'', ''term'', ''efs'', ''lis'', ''tbl'', ''ma'', ''property'', ''bg'', ''sg'', ''awb'', ''sblc'', ''fx'', ''card'', ''cash'']::text[]) is false' into n;
	if n > 0 then raise exception 'bank__ck__2aa057f7 refuses % existing row(s)', n; end if;
end $store$;
alter table "bank" add constraint "bank__ck__2aa057f7" check (not jsonb_path_exists(to_jsonb("offered_products"), 'strict $[*] ? (@.type() != "string")') and "offered_products" <@ array['lc', 'import_bill', 'da', 'dp', 'tb', 'ba', 'bad', 'if', 'if_after_lc_or_da', 'pif', 'twc', 'oaf', 'apf', 'psil', 'psbl', 'ofcl', 'mctf', 'tradepay', 'packing', 'fbep', 'dbep', 'ecr', 'badd', 'stl', 'term', 'efs', 'lis', 'tbl', 'ma', 'property', 'bg', 'sg', 'awb', 'sblc', 'fx', 'card', 'cash']::text[]);

-- step create:constraint:drawdown.drawdown__ck__7db82e38 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("product" in (''lc'', ''import_bill'', ''da'', ''dp'', ''tb'', ''ba'', ''bad'', ''if'', ''if_after_lc_or_da'', ''pif'', ''twc'', ''oaf'', ''apf'', ''psil'', ''psbl'', ''ofcl'', ''mctf'', ''tradepay'', ''packing'', ''fbep'', ''dbep'', ''ecr'', ''badd'', ''stl'', ''term'', ''efs'', ''lis'', ''tbl'', ''ma'', ''property'', ''bg'', ''sg'', ''awb'', ''sblc'', ''fx'', ''card'', ''cash'')) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__7db82e38 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__7db82e38" check ("product" in ('lc', 'import_bill', 'da', 'dp', 'tb', 'ba', 'bad', 'if', 'if_after_lc_or_da', 'pif', 'twc', 'oaf', 'apf', 'psil', 'psbl', 'ofcl', 'mctf', 'tradepay', 'packing', 'fbep', 'dbep', 'ecr', 'badd', 'stl', 'term', 'efs', 'lis', 'tbl', 'ma', 'property', 'bg', 'sg', 'awb', 'sblc', 'fx', 'card', 'cash'));

-- step create:constraint:drawdown.drawdown__ck__47d4ed26 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("terms_days" >= 0) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__47d4ed26 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__47d4ed26" check ("terms_days" >= 0);

-- step create:constraint:drawdown.drawdown__ck__6ed3a672 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("amount" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("amount", 2) = "amount" and "amount" >= 0) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__6ed3a672 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__6ed3a672" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", 2) = "amount" and "amount" >= 0);

-- step create:constraint:drawdown.drawdown__ck__48a45d78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("fx_rate_to_usd" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd") is false' into n;
	if n > 0 then raise exception 'drawdown__ck__48a45d78 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__48a45d78" check ("fx_rate_to_usd" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd");

-- step create:constraint:drawdown.drawdown__ck__70e8e49a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("rate_source" in (''manual'', ''bank_advice'')) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__70e8e49a refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__70e8e49a" check ("rate_source" in ('manual', 'bank_advice'));

-- step create:constraint:drawdown.drawdown__ck__ffcf24de (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("interest_to_maturity" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("interest_to_maturity", 2) = "interest_to_maturity") is false' into n;
	if n > 0 then raise exception 'drawdown__ck__ffcf24de refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__ffcf24de" check ("interest_to_maturity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("interest_to_maturity", 2) = "interest_to_maturity");

-- step create:constraint:drawdown.drawdown__ck__89dc3d27 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where (isfinite("latest_due_date")) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__89dc3d27 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__89dc3d27" check (isfinite("latest_due_date"));

-- step create:constraint:drawdown.drawdown__ck__d91f106d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" where ("settled_by" in (''repaid'', ''cash'', ''converted'')) is false' into n;
	if n > 0 then raise exception 'drawdown__ck__d91f106d refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__ck__d91f106d" check ("settled_by" in ('repaid', 'cash', 'converted'));

-- step create:constraint:bank_document.bank_document__ck__3ac5e389 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "bank_document" where (("extracted" is null or store_json_valid("extracted", ''{"kind":"json","optional":true,"shape":{"fields":{"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charges":{"fields":{"amount_usd":{"kind":"decimal","scale":2},"charge_type":{"kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"description":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"currency":{"kind":"currency","optional":true},"due_date":{"kind":"date","optional":true},"interest_amount":{"kind":"decimal","optional":true,"scale":2},"interest_days":{"kind":"int","optional":true},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"lc_number":{"kind":"text","optional":true},"principal":{"kind":"decimal","optional":true,"scale":2},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"start_date":{"kind":"date","optional":true},"supplier_name":{"kind":"text","optional":true},"total_debited":{"kind":"decimal","optional":true,"scale":2},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'bank_document__ck__3ac5e389 refuses % existing row(s)', n; end if;
end $store$;
alter table "bank_document" add constraint "bank_document__ck__3ac5e389" check (("extracted" is null or store_json_valid("extracted", '{"kind":"json","optional":true,"shape":{"fields":{"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charges":{"fields":{"amount_usd":{"kind":"decimal","scale":2},"charge_type":{"kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"description":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"currency":{"kind":"currency","optional":true},"due_date":{"kind":"date","optional":true},"interest_amount":{"kind":"decimal","optional":true,"scale":2},"interest_days":{"kind":"int","optional":true},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"lc_number":{"kind":"text","optional":true},"principal":{"kind":"decimal","optional":true,"scale":2},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"start_date":{"kind":"date","optional":true},"supplier_name":{"kind":"text","optional":true},"total_debited":{"kind":"decimal","optional":true,"scale":2},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:facility.facility__ck__1a60ac93 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility" where ("max_tenor_days" >= 0) is false' into n;
	if n > 0 then raise exception 'facility__ck__1a60ac93 refuses % existing row(s)', n; end if;
end $store$;
alter table "facility" add constraint "facility__ck__1a60ac93" check ("max_tenor_days" >= 0);

-- step create:constraint:facility.facility__ck__b9945651 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility" where ("tenor_start_rule" in (''invoice_date'', ''disbursement_date'', ''bill_of_lading_date'')) is false' into n;
	if n > 0 then raise exception 'facility__ck__b9945651 refuses % existing row(s)', n; end if;
end $store$;
alter table "facility" add constraint "facility__ck__b9945651" check ("tenor_start_rule" in ('invoice_date', 'disbursement_date', 'bill_of_lading_date'));

-- step create:constraint:facility.facility__ck__b40f27b0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility" where ("pledged_deposit" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("pledged_deposit", 2) = "pledged_deposit") is false' into n;
	if n > 0 then raise exception 'facility__ck__b40f27b0 refuses % existing row(s)', n; end if;
end $store$;
alter table "facility" add constraint "facility__ck__b40f27b0" check ("pledged_deposit" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("pledged_deposit", 2) = "pledged_deposit");

-- step create:constraint:facility_fee.facility_fee__ck__7db82e38 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility_fee" where ("product" in (''lc'', ''import_bill'', ''da'', ''dp'', ''tb'', ''ba'', ''bad'', ''if'', ''if_after_lc_or_da'', ''pif'', ''twc'', ''oaf'', ''apf'', ''psil'', ''psbl'', ''ofcl'', ''mctf'', ''tradepay'', ''packing'', ''fbep'', ''dbep'', ''ecr'', ''badd'', ''stl'', ''term'', ''efs'', ''lis'', ''tbl'', ''ma'', ''property'', ''bg'', ''sg'', ''awb'', ''sblc'', ''fx'', ''card'', ''cash'')) is false' into n;
	if n > 0 then raise exception 'facility_fee__ck__7db82e38 refuses % existing row(s)', n; end if;
end $store$;
alter table "facility_fee" add constraint "facility_fee__ck__7db82e38" check ("product" in ('lc', 'import_bill', 'da', 'dp', 'tb', 'ba', 'bad', 'if', 'if_after_lc_or_da', 'pif', 'twc', 'oaf', 'apf', 'psil', 'psbl', 'ofcl', 'mctf', 'tradepay', 'packing', 'fbep', 'dbep', 'ecr', 'badd', 'stl', 'term', 'efs', 'lis', 'tbl', 'ma', 'property', 'bg', 'sg', 'awb', 'sblc', 'fx', 'card', 'cash'));

-- step create:constraint:facility_fee.facility_fee__ck__7414a4a0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "facility_fee" where ("currency" ~ ''^[A-Z]{3}$'') is false' into n;
	if n > 0 then raise exception 'facility_fee__ck__7414a4a0 refuses % existing row(s)', n; end if;
end $store$;
alter table "facility_fee" add constraint "facility_fee__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$');

-- step create:constraint:sub_limit.sub_limit__ck__7db82e38 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sub_limit" where ("product" in (''lc'', ''import_bill'', ''da'', ''dp'', ''tb'', ''ba'', ''bad'', ''if'', ''if_after_lc_or_da'', ''pif'', ''twc'', ''oaf'', ''apf'', ''psil'', ''psbl'', ''ofcl'', ''mctf'', ''tradepay'', ''packing'', ''fbep'', ''dbep'', ''ecr'', ''badd'', ''stl'', ''term'', ''efs'', ''lis'', ''tbl'', ''ma'', ''property'', ''bg'', ''sg'', ''awb'', ''sblc'', ''fx'', ''card'', ''cash'')) is false' into n;
	if n > 0 then raise exception 'sub_limit__ck__7db82e38 refuses % existing row(s)', n; end if;
end $store$;
alter table "sub_limit" add constraint "sub_limit__ck__7db82e38" check ("product" in ('lc', 'import_bill', 'da', 'dp', 'tb', 'ba', 'bad', 'if', 'if_after_lc_or_da', 'pif', 'twc', 'oaf', 'apf', 'psil', 'psbl', 'ofcl', 'mctf', 'tradepay', 'packing', 'fbep', 'dbep', 'ecr', 'badd', 'stl', 'term', 'efs', 'lis', 'tbl', 'ma', 'property', 'bg', 'sg', 'awb', 'sblc', 'fx', 'card', 'cash'));

-- step create:constraint:month_end.month_end__ck__5be068ac (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end" where (isfinite("locked_at")) is false' into n;
	if n > 0 then raise exception 'month_end__ck__5be068ac refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end" add constraint "month_end__ck__5be068ac" check (isfinite("locked_at"));

-- step create:constraint:month_end.month_end__ck__81a11a90 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end" where ("available" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("available", 2) = "available") is false' into n;
	if n > 0 then raise exception 'month_end__ck__81a11a90 refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end" add constraint "month_end__ck__81a11a90" check ("available" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("available", 2) = "available");

-- step create:constraint:month_end_line.month_end_line__ck__7db82e38 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where ("product" in (''lc'', ''import_bill'', ''da'', ''dp'', ''tb'', ''ba'', ''bad'', ''if'', ''if_after_lc_or_da'', ''pif'', ''twc'', ''oaf'', ''apf'', ''psil'', ''psbl'', ''ofcl'', ''mctf'', ''tradepay'', ''packing'', ''fbep'', ''dbep'', ''ecr'', ''badd'', ''stl'', ''term'', ''efs'', ''lis'', ''tbl'', ''ma'', ''property'', ''bg'', ''sg'', ''awb'', ''sblc'', ''fx'', ''card'', ''cash'')) is false' into n;
	if n > 0 then raise exception 'month_end_line__ck__7db82e38 refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" add constraint "month_end_line__ck__7db82e38" check ("product" in ('lc', 'import_bill', 'da', 'dp', 'tb', 'ba', 'bad', 'if', 'if_after_lc_or_da', 'pif', 'twc', 'oaf', 'apf', 'psil', 'psbl', 'ofcl', 'mctf', 'tradepay', 'packing', 'fbep', 'dbep', 'ecr', 'badd', 'stl', 'term', 'efs', 'lis', 'tbl', 'ma', 'property', 'bg', 'sg', 'awb', 'sblc', 'fx', 'card', 'cash'));

-- step create:constraint:month_end_line.month_end_line__ck__48a45d78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where ("fx_rate_to_usd" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd") is false' into n;
	if n > 0 then raise exception 'month_end_line__ck__48a45d78 refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" add constraint "month_end_line__ck__48a45d78" check ("fx_rate_to_usd" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("fx_rate_to_usd", 12) = "fx_rate_to_usd");

-- step create:constraint:month_end_line.month_end_line__ck__8011bd28 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where ("day_count_basis" in (''actual_360'', ''actual_365'')) is false' into n;
	if n > 0 then raise exception 'month_end_line__ck__8011bd28 refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" add constraint "month_end_line__ck__8011bd28" check ("day_count_basis" in ('actual_360', 'actual_365'));

-- step create:constraint:month_end_line.month_end_line__ck__790737cd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where (isfinite("start_date")) is false' into n;
	if n > 0 then raise exception 'month_end_line__ck__790737cd refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" add constraint "month_end_line__ck__790737cd" check (isfinite("start_date"));

-- step create:constraint:month_end_line.month_end_line__ck__fcf7f1c2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "month_end_line" where (isfinite("due_date")) is false' into n;
	if n > 0 then raise exception 'month_end_line__ck__fcf7f1c2 refuses % existing row(s)', n; end if;
end $store$;
alter table "month_end_line" add constraint "month_end_line__ck__fcf7f1c2" check (isfinite("due_date"));

-- step create:constraint:invoice.invoice__ck__6ed3a672 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "invoice" where ("amount" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("amount", 2) = "amount" and "amount" >= 0) is false' into n;
	if n > 0 then raise exception 'invoice__ck__6ed3a672 refuses % existing row(s)', n; end if;
end $store$;
alter table "invoice" add constraint "invoice__ck__6ed3a672" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", 2) = "amount" and "amount" >= 0);

-- step create:constraint:invoice.invoice__uq__2ccf7806 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "invoice" group by "po", "invoice_number" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'invoice__uq__2ccf7806 refuses % existing row(s)', n; end if;
end $store$;
alter table "invoice" add constraint "invoice__uq__2ccf7806" unique nulls not distinct ("po", "invoice_number") deferrable initially immediate;

-- step create:constraint:po_line.po_line__ck__c25ace36 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "po_line" where ("quantity" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("quantity", 3) = "quantity" and "quantity" >= 0) is false' into n;
	if n > 0 then raise exception 'po_line__ck__c25ace36 refuses % existing row(s)', n; end if;
end $store$;
alter table "po_line" add constraint "po_line__ck__c25ace36" check ("quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("quantity", 3) = "quantity" and "quantity" >= 0);

-- step create:constraint:po_line.po_line__ck__6ed3a672 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "po_line" where ("amount" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("amount", 2) = "amount" and "amount" >= 0) is false' into n;
	if n > 0 then raise exception 'po_line__ck__6ed3a672 refuses % existing row(s)', n; end if;
end $store$;
alter table "po_line" add constraint "po_line__ck__6ed3a672" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", 2) = "amount" and "amount" >= 0);

-- step create:constraint:supplier.supplier__ck__82bbedb7 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "supplier" where (not jsonb_path_exists(to_jsonb("aliases"), ''strict $[*] ? (@.type() != "string")'')) is false' into n;
	if n > 0 then raise exception 'supplier__ck__82bbedb7 refuses % existing row(s)', n; end if;
end $store$;
alter table "supplier" add constraint "supplier__ck__82bbedb7" check (not jsonb_path_exists(to_jsonb("aliases"), 'strict $[*] ? (@.type() != "string")'));

-- step create:constraint:supplier.supplier__ck__2a4562b4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "supplier" where (isfinite("relationship_since")) is false' into n;
	if n > 0 then raise exception 'supplier__ck__2a4562b4 refuses % existing row(s)', n; end if;
end $store$;
alter table "supplier" add constraint "supplier__ck__2a4562b4" check (isfinite("relationship_since"));

-- step create:fk:drawdown.drawdown__fk__5c336046 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "drawdown" c where c."converted_from" is not null and not exists (select 1 from "drawdown" p where p."id" = c."converted_from")' into n;
	if n > 0 then raise exception 'drawdown__fk__5c336046 refuses % existing row(s)', n; end if;
end $store$;
alter table "drawdown" add constraint "drawdown__fk__5c336046" foreign key ("converted_from") references "drawdown" ("id") on delete set null on update restrict;

-- step create:fk:facility_form.facility_form__fk__2bce541b (additive)
alter table "facility_form" add constraint "facility_form__fk__2bce541b" foreign key ("purchase_order") references "purchase_order" ("id") on delete set null on update restrict;

-- step create:fk:facility_attachment.facility_attachment__fk__1499c133 (additive)
alter table "facility_attachment" add constraint "facility_attachment__fk__1499c133" foreign key ("form") references "facility_form" ("id") on delete cascade on update restrict;

-- step create:fk:invoice_line.invoice_line__fk__45850dbf (additive)
alter table "invoice_line" add constraint "invoice_line__fk__45850dbf" foreign key ("invoice") references "invoice" ("id") on delete cascade on update restrict;

-- step create:fk:invoice_line.invoice_line__fk__eb9fcbaa (additive)
alter table "invoice_line" add constraint "invoice_line__fk__eb9fcbaa" foreign key ("po_line") references "po_line" ("id") on delete restrict on update restrict;

-- step create:fk:po_financing.po_financing__fk__f47a3884 (additive)
alter table "po_financing" add constraint "po_financing__fk__f47a3884" foreign key ("purchase_order") references "purchase_order" ("id") on delete cascade on update restrict;

-- step create:fk:po_financing.po_financing__fk__e9d40258 (additive)
alter table "po_financing" add constraint "po_financing__fk__e9d40258" foreign key ("drawdown") references "drawdown" ("id") on delete cascade on update restrict;

-- step create:fk:supplier_bank.supplier_bank__fk__33b7ddaa (additive)
alter table "supplier_bank" add constraint "supplier_bank__fk__33b7ddaa" foreign key ("supplier") references "supplier" ("id") on delete cascade on update restrict;

-- step create:fk:supplier_bank.supplier_bank__fk__297cf64e (additive)
alter table "supplier_bank" add constraint "supplier_bank__fk__297cf64e" foreign key ("bank") references "bank" ("id") on delete cascade on update restrict;

-- step replace:index:drawdown.drawdown__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "drawdown__gin__73732636" on "drawdown" using gin (bolt_search);

-- step replace:index:bank_document.bank_document__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "bank_document__gin__73732636" on "bank_document" using gin (bolt_search);

-- step replace:index:month_end.month_end__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "month_end__gin__73732636" on "month_end" using gin (bolt_search);

-- step replace:index:month_end_line.month_end_line__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "month_end_line__gin__73732636" on "month_end_line" using gin (bolt_search);

-- step replace:index:supplier.supplier__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "supplier__gin__73732636" on "supplier" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['approval_request','bank','bank_contact','bank_document','drawdown','drawdown_charge','facility','facility_attachment','facility_fee','facility_form','fx_rate','invoice','invoice_line','letter_of_offer','month_end','month_end_line','po_document','po_financing','po_line','purchase_order','sub_limit','supplier','supplier_bank','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','watch_point']::text[]));

-- step replace:engine:audit:drawdown (additive)
drop trigger if exists bolt_audit_mark on "drawdown";
drop trigger if exists bolt_audit on "drawdown";
create trigger bolt_audit after insert or update or delete on "drawdown" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["converted_from","drawdown"],["facility","facility"],["supplier","supplier"]]');

-- step create:index:bank.bank__gin__3ce77b84 (additive)
-- operational risk: writes-blocked, table-scan
create index "bank__gin__3ce77b84" on "bank" using gin ("offered_products");

-- step create:trigger:drawdown.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "drawdown" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"application_date":["application_date"],"bank_reference":["bank_reference"],"bill_number":["bill_number"],"charge_rate_pct":["charge_rate_pct"],"converted_from":["converted_from"],"currency":["currency"],"day_count_basis":["day_count_basis"],"due_date":["due_date"],"earliest_invoice_date":["earliest_invoice_date"],"expected_draw_date":["expected_draw_date"],"facility":["facility"],"fx_rate_to_usd":["fx_rate_to_usd"],"interest_rate_pct":["interest_rate_pct"],"interest_to_maturity":["interest_to_maturity"],"is_archived":["is_archived"],"latest_due_date":["latest_due_date"],"lc_expiry_date":["lc_expiry_date"],"lc_number":["lc_number"],"needs_review":["needs_review"],"notes":["notes"],"product":["product"],"purpose":["purpose"],"rate_source":["rate_source"],"released_date":["released_date"],"requested_by":["requested_by"],"review_note":["review_note"],"settled_by":["settled_by"],"settled_interest":["settled_interest"],"settled_principal":["settled_principal"],"settlement_date":["settlement_date"],"start_date":["start_date"],"status":["status"],"supplier":["supplier"],"tenor_days":["tenor_days"],"terms_days":["terms_days"]},"key":["id"],"locks":[{"constraint":"drawdown__lock__e8982d0f","except":["is_archived","needs_review","review_note","notes"],"name":"sealed_line","sql":"(coalesce(t.\"status\" = any(array[''settled''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{}}');

-- step create:trigger:drawdown.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "drawdown" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"application_date":["application_date"],"bank_reference":["bank_reference"],"bill_number":["bill_number"],"charge_rate_pct":["charge_rate_pct"],"converted_from":["converted_from"],"currency":["currency"],"day_count_basis":["day_count_basis"],"due_date":["due_date"],"earliest_invoice_date":["earliest_invoice_date"],"expected_draw_date":["expected_draw_date"],"facility":["facility"],"fx_rate_to_usd":["fx_rate_to_usd"],"interest_rate_pct":["interest_rate_pct"],"interest_to_maturity":["interest_to_maturity"],"is_archived":["is_archived"],"latest_due_date":["latest_due_date"],"lc_expiry_date":["lc_expiry_date"],"lc_number":["lc_number"],"needs_review":["needs_review"],"notes":["notes"],"product":["product"],"purpose":["purpose"],"rate_source":["rate_source"],"released_date":["released_date"],"requested_by":["requested_by"],"review_note":["review_note"],"settled_by":["settled_by"],"settled_interest":["settled_interest"],"settled_principal":["settled_principal"],"settlement_date":["settlement_date"],"start_date":["start_date"],"status":["status"],"supplier":["supplier"],"tenor_days":["tenor_days"],"terms_days":["terms_days"]},"key":["id"],"locks":[{"constraint":"drawdown__lock__e8982d0f","except":["is_archived","needs_review","review_note","notes"],"name":"sealed_line","sql":"(coalesce(t.\"status\" = any(array[''settled''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{}}');

-- step create:trigger:month_end.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "month_end" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"accrued_interest":["accrued_interest"],"available":["available"],"average_tenor_days":["average_tenor_days"],"bank_borrowings":["bank_borrowings"],"banker_guarantee":["banker_guarantee"],"credit_line":["credit_line"],"highest_rate_pct":["highest_rate_pct"],"is_locked":["is_locked"],"letters_of_credit":["letters_of_credit"],"locked_at":["locked_at"],"lowest_rate_pct":["lowest_rate_pct"],"month":["month"],"notes":["notes"],"simple_average_rate_pct":["simple_average_rate_pct"],"source":["source"],"term_bills":["term_bills"],"total_utilised":["total_utilised"],"weighted_average_rate_pct":["weighted_average_rate_pct"]},"key":["id"],"locks":[{"constraint":"month_end__lock__5067032f","except":["is_locked","notes"],"name":"locked_month","sql":"(coalesce(t.\"is_locked\" = true, false))"}],"parents":[],"states":{}}');

-- step create:trigger:month_end.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "month_end" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"accrued_interest":["accrued_interest"],"available":["available"],"average_tenor_days":["average_tenor_days"],"bank_borrowings":["bank_borrowings"],"banker_guarantee":["banker_guarantee"],"credit_line":["credit_line"],"highest_rate_pct":["highest_rate_pct"],"is_locked":["is_locked"],"letters_of_credit":["letters_of_credit"],"locked_at":["locked_at"],"lowest_rate_pct":["lowest_rate_pct"],"month":["month"],"notes":["notes"],"simple_average_rate_pct":["simple_average_rate_pct"],"source":["source"],"term_bills":["term_bills"],"total_utilised":["total_utilised"],"weighted_average_rate_pct":["weighted_average_rate_pct"]},"key":["id"],"locks":[{"constraint":"month_end__lock__5067032f","except":["is_locked","notes"],"name":"locked_month","sql":"(coalesce(t.\"is_locked\" = true, false))"}],"parents":[],"states":{}}');

-- step create:trigger:facility_form.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "facility_form" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:facility_form.facility_form__gin__73732636 (additive)
create index "facility_form__gin__73732636" on "facility_form" using gin (bolt_search);

-- step create:trigger:facility_attachment.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "facility_attachment" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:facility_attachment.facility_attachment__gin__73732636 (additive)
create index "facility_attachment__gin__73732636" on "facility_attachment" using gin (bolt_search);

-- step create:trigger:invoice_line.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "invoice_line" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:trigger:po_financing.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "po_financing" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:supplier.supplier__gin__ca5f1447 (additive)
-- operational risk: writes-blocked, table-scan
create index "supplier__gin__ca5f1447" on "supplier" using gin ("aliases");

-- step create:trigger:supplier_bank.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "supplier_bank" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:drawdown.drawdown__ix__3bb5d64f (additive)
-- operational risk: writes-blocked, table-scan
create index "drawdown__ix__3bb5d64f" on "drawdown" ("converted_from");

-- step create:index:facility_form.facility_form__ix__c323e145 (additive)
create index "facility_form__ix__c323e145" on "facility_form" ("purchase_order");

-- step create:index:facility_attachment.facility_attachment__ix__565bff54 (additive)
create index "facility_attachment__ix__565bff54" on "facility_attachment" ("form");

-- step create:index:invoice_line.invoice_line__ix__56cadccd (additive)
create index "invoice_line__ix__56cadccd" on "invoice_line" ("invoice");

-- step create:index:invoice_line.invoice_line__ix__34f85bd1 (additive)
create index "invoice_line__ix__34f85bd1" on "invoice_line" ("po_line");

-- step create:index:po_financing.po_financing__ix__c323e145 (additive)
create index "po_financing__ix__c323e145" on "po_financing" ("purchase_order");

-- step create:index:po_financing.po_financing__ix__c812023b (additive)
create index "po_financing__ix__c812023b" on "po_financing" ("drawdown");

-- step create:index:supplier_bank.supplier_bank__ix__a75d4d17 (additive)
create index "supplier_bank__ix__a75d4d17" on "supplier_bank" ("supplier");

-- step create:index:supplier_bank.supplier_bank__ix__1d24c71e (additive)
create index "supplier_bank__ix__1d24c71e" on "supplier_bank" ("bank");

-- step create:engine:audit:facility_form (additive)
drop trigger if exists bolt_audit_mark on "facility_form";
drop trigger if exists bolt_audit on "facility_form";
create trigger bolt_audit after insert or update or delete on "facility_form" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["purchase_order","purchase_order"]]');

-- step create:engine:audit:facility_attachment (additive)
drop trigger if exists bolt_audit_mark on "facility_attachment";
drop trigger if exists bolt_audit on "facility_attachment";
create trigger bolt_audit after insert or update or delete on "facility_attachment" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["form","facility_form"]]');

-- step create:engine:audit:invoice_line (additive)
drop trigger if exists bolt_audit_mark on "invoice_line";
drop trigger if exists bolt_audit on "invoice_line";
create trigger bolt_audit after insert or update or delete on "invoice_line" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["invoice","invoice"],["po_line","po_line"]]');

-- step create:engine:audit:po_financing (additive)
drop trigger if exists bolt_audit_mark on "po_financing";
drop trigger if exists bolt_audit on "po_financing";
create trigger bolt_audit after insert or update or delete on "po_financing" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["drawdown","drawdown"],["purchase_order","purchase_order"]]');

-- step create:engine:audit:supplier_bank (additive)
drop trigger if exists bolt_audit_mark on "supplier_bank";
drop trigger if exists bolt_audit on "supplier_bank";
create trigger bolt_audit after insert or update or delete on "supplier_bank" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["bank","bank"],["supplier","supplier"]]');
