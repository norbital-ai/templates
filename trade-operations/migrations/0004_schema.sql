-- 0004_schema.sql: 52 step(s), from 99a6e19214efba07722e3de80c7b23a937c6890f89058fd9215df4def6f9b709 to c6eea6a336ee6467f9843a0b35c4d11e1859200738bdba87776787d9983f186f.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:trigger:ext_purchase_orders.store_row_rules (additive)
drop trigger if exists store_row_rules on "ext_purchase_orders";

-- step drop:index:ext_purchase_orders.ext_purchase_orders__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_purchase_orders__gin__73732636";

-- step drop:index:ext_purchase_orders.ext_purchase_orders__ix__4d0bb674 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_purchase_orders__ix__4d0bb674";

-- step drop:index:ext_purchase_orders.ext_purchase_orders__ix__7703c55b (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ext_purchase_orders__ix__7703c55b";

-- step drop:index:transactions.transactions__ix__d9b6ef62 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "transactions__ix__d9b6ef62";

-- step drop:fk:ext_purchase_orders.ext_purchase_orders__fk__b4f64f88 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__fk__b4f64f88";

-- step drop:fk:ext_purchase_orders.ext_purchase_orders__fk__5ddafbd8 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__fk__5ddafbd8";

-- step drop:fk:transactions.transactions__fk__1f9cbe79 (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" drop constraint if exists "transactions__fk__1f9cbe79";

-- step drop:constraint:ext_purchase_orders.ext_purchase_orders__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__ck__7414a4a0";

-- step drop:constraint:ext_purchase_orders.ext_purchase_orders__ck__dcfa7025 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__ck__dcfa7025";

-- step drop:constraint:ext_purchase_orders.ext_purchase_orders__ck__838d5561 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__ck__838d5561";

-- step drop:constraint:ext_purchase_orders.ext_purchase_orders__uq__169e6809 (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop constraint if exists "ext_purchase_orders__uq__169e6809";

-- step drop:constraint:source_payments.source_payments__ck__b0e0e9b9 (additive)
-- operational risk: access-exclusive-lock
alter table "source_payments" drop constraint if exists "source_payments__ck__b0e0e9b9";

-- step drop:constraint:source_receivables.source_receivables__ck__46781a77 (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" drop constraint if exists "source_receivables__ck__46781a77";

-- step drop:constraint:stock_snapshots.stock_snapshots__ck__90f6f0c6 (additive)
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop constraint if exists "stock_snapshots__ck__90f6f0c6";

-- step drop:constraint:stock_snapshots.stock_snapshots__ck__055ee210 (additive)
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop constraint if exists "stock_snapshots__ck__055ee210";

-- step drop:notNull:ext_purchase_orders.currency (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "currency" drop not null;

-- step drop:notNull:ext_purchase_orders.external_id (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "external_id" drop not null;

-- step drop:notNull:ext_purchase_orders.reference (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "reference" drop not null;

-- step drop:notNull:ext_purchase_orders.status (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "status" drop not null;

-- step drop:notNull:ext_purchase_orders.source (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "source" drop not null;

-- step drop:notNull:ext_purchase_orders.order (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" alter column "order" drop not null;

-- step drop:column:ext_purchase_orders.currency (destructive)
-- accept: drop:column:ext_purchase_orders.currency
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "currency" cascade;

-- step drop:column:ext_purchase_orders.external_id (destructive)
-- accept: drop:column:ext_purchase_orders.external_id
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "external_id" cascade;

-- step drop:column:ext_purchase_orders.reference (destructive)
-- accept: drop:column:ext_purchase_orders.reference
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "reference" cascade;

-- step drop:column:ext_purchase_orders.source_updated_at (destructive)
-- accept: drop:column:ext_purchase_orders.source_updated_at
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "source_updated_at" cascade;

-- step drop:column:ext_purchase_orders.status (destructive)
-- accept: drop:column:ext_purchase_orders.status
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "status" cascade;

-- step drop:column:ext_purchase_orders.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "bolt_record_label" cascade;

-- step drop:column:ext_purchase_orders.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists bolt_search cascade;

-- step drop:column:stock_snapshots.erp_committed (destructive)
-- accept: drop:column:stock_snapshots.erp_committed
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop column if exists "erp_committed" cascade;

-- step drop:column:stock_snapshots.orders_as_of (destructive)
-- accept: drop:column:stock_snapshots.orders_as_of
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop column if exists "orders_as_of" cascade;

-- step drop:column:ext_purchase_orders.order (destructive)
-- accept: drop:column:ext_purchase_orders.order
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "order" cascade;

-- step drop:column:ext_purchase_orders.source (destructive)
-- accept: drop:column:ext_purchase_orders.source
-- operational risk: access-exclusive-lock
alter table "ext_purchase_orders" drop column if exists "source" cascade;

-- step drop:column:transactions.ext_purchase_order (destructive)
-- accept: drop:column:transactions.ext_purchase_order
-- operational risk: access-exclusive-lock
alter table "transactions" drop column if exists "ext_purchase_order" cascade;

-- step drop:table:ext_purchase_orders (destructive)
-- accept: drop:table:ext_purchase_orders
-- operational risk: access-exclusive-lock
drop table if exists "ext_purchase_orders" cascade;

-- step drop:function:bolt_record_label_ext_purchase_orders_813c0aa8 (additive)
drop function if exists "bolt_record_label_ext_purchase_orders_813c0aa8"(text) cascade;

-- step create:function:bolt_record_label_source_purchase_lines_813c0aa8 (additive)
create or replace function "bolt_record_label_source_purchase_lines_813c0aa8"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:source_purchase_lines (additive)
create table "source_purchase_lines" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"external_code" text not null,
	"kind" text not null,
	"reference" text not null,
	"business_on" date not null,
	"supplier_code" text,
	"supplier_name" text,
	"product_code" text not null,
	"product_name" text,
	"lot_number" text,
	"warehouse_code" text,
	"unit" text not null,
	"quantity" numeric not null,
	"currency" text not null,
	"net_amount" numeric,
	"tax_amount" numeric,
	"order_reference" text,
	"upstream" text,
	"billed_amount" numeric,
	"open_amount" numeric,
	"due_on" date,
	"paid_on" date,
	"active" boolean default true not null,
	"source_updated_at" timestamptz not null,
	"bolt_record_label" text generated always as ("bolt_record_label_source_purchase_lines_813c0aa8"("reference")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_source_purchase_lines_813c0aa8"("reference"), '') || ' ' || coalesce("reference"::text, '') || ' ' || coalesce("supplier_name"::text, '') || ' ' || coalesce("product_name"::text, '') || ' ' || coalesce("lot_number"::text, '') || ' ' || coalesce("order_reference"::text, ''))) stored,
	"source" text not null,
	constraint "source_purchase_lines__ck__89cacadd" check ("kind" in ('receipt', 'invoice')),
	constraint "source_purchase_lines__ck__0cbab224" check (isfinite("business_on")),
	constraint "source_purchase_lines__ck__fd9e3d00" check ("quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("quantity", 3) = "quantity"),
	constraint "source_purchase_lines__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "source_purchase_lines__ck__9d9aede9" check ("net_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("net_amount", bolt_minor_units("currency")) = "net_amount"),
	constraint "source_purchase_lines__ck__4d11a03c" check ("tax_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("tax_amount", bolt_minor_units("currency")) = "tax_amount"),
	constraint "source_purchase_lines__ck__51004070" check ("billed_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("billed_amount", bolt_minor_units("currency")) = "billed_amount"),
	constraint "source_purchase_lines__ck__cbe0fad4" check ("open_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("open_amount", bolt_minor_units("currency")) = "open_amount"),
	constraint "source_purchase_lines__ck__b0edcbda" check (isfinite("due_on")),
	constraint "source_purchase_lines__ck__09a1b7aa" check (isfinite("paid_on")),
	constraint "source_purchase_lines__ck__dcfa7025" check (isfinite("source_updated_at")),
	constraint "source_purchase_lines__uq__9a96c6fb" unique nulls not distinct ("source", "external_code")
);

-- step replace:history:schema:source_payments (additive)
select bolt_history_register('source_payments','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"amount":{"currency":"currency","kind":"money"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"invoice":{"kind":"ref","optional":true,"to":"transactions"},"kind":{"kind":"enum","values":["receipt","payment","refund"]},"order":{"inverse":"source_payments","kind":"ref","to":"orders"},"reference":{"kind":"text"},"settled_on":{"kind":"date"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant"}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"},{"fields":["order","reference"],"name":"one_source_receipt_per_order"}]}'::jsonb);

-- step replace:history:schema:transactions (additive)
select bolt_history_register('transactions','{"audit":true,"fields":{"currency":{"kind":"currency"},"documents":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"sha256":{"kind":"text"},"url":{"kind":"text"}},"kind":"object","many":true}},"due_on":{"kind":"date","optional":true},"erp_id":{"hidden":true,"kind":"text"},"issued_on":{"kind":"date","optional":true},"items":{"kind":"json","optional":true,"shape":{"fields":{"lot_number":{"kind":"text","optional":true},"net_amount":{"kind":"decimal","optional":true,"scale":8},"order_line_id":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"decimal","scale":3},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"unit_price":{"kind":"decimal","optional":true,"scale":4}},"kind":"object","many":true}},"kind":{"kind":"enum","values":["invoice","delivery"]},"order":{"inverse":"transactions","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"default":"issued","kind":"enum","values":["issued","void"]},"total":{"currency":"currency","kind":"money","optional":true}},"record_label":"record.reference","search":{"text":["reference","kind"]},"unique":[{"fields":["source","erp_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:stock_snapshots (additive)
select bolt_history_register('stock_snapshots','{"audit":true,"fields":{"as_of":{"kind":"instant"},"currency":{"kind":"currency","optional":true},"external_code":{"kind":"text"},"lot_number":{"kind":"text","optional":true},"on_hand":{"kind":"decimal","scale":3},"product":{"kind":"ref","to":"products"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"unit":{"kind":"text","optional":true},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"warehouse":{"kind":"ref","to":"warehouses"}},"record_label":"record.product.name + '' · '' + record.warehouse.name + (record.lot_number != null ? '' · '' + record.lot_number : '''')","search":{"text":["product","warehouse","lot_number","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:source_receivables (additive)
select bolt_history_register('source_receivables','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step create:history:schema:source_purchase_lines (additive)
select bolt_history_register('source_purchase_lines','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"billed_amount":{"currency":"currency","kind":"money","optional":true},"business_on":{"kind":"date"},"currency":{"kind":"currency"},"due_on":{"kind":"date","optional":true},"external_code":{"kind":"text"},"kind":{"kind":"enum","values":["receipt","invoice"]},"lot_number":{"kind":"text","optional":true},"net_amount":{"currency":"currency","kind":"money","optional":true},"open_amount":{"currency":"currency","kind":"money","optional":true},"order_reference":{"kind":"text","optional":true},"paid_on":{"kind":"date","optional":true},"product_code":{"kind":"text"},"product_name":{"kind":"text","optional":true},"quantity":{"kind":"decimal","scale":3},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant"},"supplier_code":{"kind":"text","optional":true},"supplier_name":{"kind":"text","optional":true},"tax_amount":{"currency":"currency","kind":"money","optional":true},"unit":{"kind":"text"},"upstream":{"kind":"text","optional":true},"warehouse_code":{"kind":"text","optional":true}},"record_label":"record.reference","search":{"text":["reference","supplier_name","product_name","lot_number","order_reference"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step data:source_receivables.entries (data)
-- hazard: the shape of source_receivables.entries changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over source_receivables); the check below counts the rows the new shape still refuses.
-- step check:source_receivables.entries (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "source_receivables" where "entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of source_receivables.entries refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:source_payments.source_payments__ck__3256edb7 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_payments" where ("kind" in (''receipt'', ''payment'', ''refund'')) is false' into n;
	if n > 0 then raise exception 'source_payments__ck__3256edb7 refuses % existing row(s)', n; end if;
end $store$;
alter table "source_payments" add constraint "source_payments__ck__3256edb7" check ("kind" in ('receipt', 'payment', 'refund'));

-- step create:constraint:source_receivables.source_receivables__ck__98e1a67d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_receivables" where (("entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'source_receivables__ck__98e1a67d refuses % existing row(s)', n; end if;
end $store$;
alter table "source_receivables" add constraint "source_receivables__ck__98e1a67d" check (("entries" is null or store_json_valid("entries", '{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}'::jsonb) is true));

-- step create:fk:source_purchase_lines.source_purchase_lines__fk__5ddafbd8 (additive)
alter table "source_purchase_lines" add constraint "source_purchase_lines__fk__5ddafbd8" foreign key ("source") references "sys_integration" ("id") on delete restrict on update restrict;

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_snapshots','document_templates','order_files','order_lines','orders','parties','pricing_floors','products','source_lot_costs','source_payments','source_purchase_lines','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','transactions','warehouses']::text[]));

-- step replace:engine:audit:transactions (additive)
drop trigger if exists bolt_audit_mark on "transactions";
drop trigger if exists bolt_audit on "transactions";
create trigger bolt_audit after insert or update or delete on "transactions" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["order","orders"],["source","sys_integration"]]');

-- step create:trigger:source_purchase_lines.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "source_purchase_lines" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:source_purchase_lines.source_purchase_lines__gin__73732636 (additive)
create index "source_purchase_lines__gin__73732636" on "source_purchase_lines" using gin (bolt_search);

-- step create:index:source_purchase_lines.source_purchase_lines__ix__7703c55b (additive)
create index "source_purchase_lines__ix__7703c55b" on "source_purchase_lines" ("source");

-- step create:engine:audit:source_purchase_lines (additive)
drop trigger if exists bolt_audit_mark on "source_purchase_lines";
drop trigger if exists bolt_audit on "source_purchase_lines";
create trigger bolt_audit after insert or update or delete on "source_purchase_lines" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["source","sys_integration"]]');
