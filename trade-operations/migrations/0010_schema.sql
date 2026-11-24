-- 0010_schema.sql: 40 step(s), from 4c554bc428b71e9ded416f75851a1f38e53cfc5e7c1985bdb03464096a343e7f to 6e50c6d3c9a3b86471a97603aab8cb9d90d068079c22d1a6faa147b3e2bfe605.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:constraint:source_sales_lines.source_sales_lines__ck__3476e622 (additive)
-- operational risk: access-exclusive-lock
alter table "source_sales_lines" drop constraint if exists "source_sales_lines__ck__3476e622";

-- step drop:constraint:transactions.transactions__ck__6ef0f643 (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" drop constraint if exists "transactions__ck__6ef0f643";

-- step create:function:bolt_record_label_credit_releases_599f5a00 (additive)
create or replace function "bolt_record_label_credit_releases_599f5a00"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['bill_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('bill_number', to_jsonb("bill_number")) AS j FROM (SELECT $1 AS "bill_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:credit_releases (additive)
create table "credit_releases" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"external_code" text not null,
	"delivery_fid" text not null,
	"bill_number" text not null,
	"bill_on" date,
	"settlement_name" text,
	"currency" text not null,
	"source_status" text default 'blocked'::text not null,
	"approval_status" text default 'none'::text not null,
	"bill_amount" numeric,
	"credit_limit" numeric,
	"credit_used" numeric,
	"over_limit" numeric,
	"overdue_days" int,
	"oldest_overdue_bill" text,
	"block_reasons" text[],
	"route" text,
	"proposed_limit" numeric,
	"reason" text,
	"source_oper_date" text,
	"content_hash" text,
	"approved_content_hash" text,
	"audit_seen_at" timestamptz,
	"released_by" text,
	"released_at" timestamptz,
	"release_log_key" text,
	"observed_at" timestamptz not null,
	"status" text generated always as (((case when (("source_status" = 'blocked'::text) and ("approval_status" = 'approved'::text)) then 'approved'::text else "source_status" end))::text) stored,
	"bolt_record_label" text generated always as ("bolt_record_label_credit_releases_599f5a00"("bill_number")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_credit_releases_599f5a00"("bill_number"), '') || ' ' || coalesce("bill_number"::text, '') || ' ' || coalesce("delivery_fid"::text, '') || ' ' || coalesce("oldest_overdue_bill"::text, '') || ' ' || coalesce("released_by"::text, ''))) stored,
	"source" text not null,
	"party" uuid not null,
	"order" uuid,
	"delivery" uuid,
	constraint "credit_releases__ck__c87d8053" check (isfinite("bill_on")),
	constraint "credit_releases__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "credit_releases__ck__b2186d3b" check ("source_status" in ('blocked', 'released', 'cleared', 'superseded', 'withdrawn', 'bypassed')),
	constraint "credit_releases__ck__f16d1ffd" check ("approval_status" in ('none', 'approved')),
	constraint "credit_releases__ck__07db8f3f" check ("bill_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("bill_amount", bolt_minor_units("currency")) = "bill_amount"),
	constraint "credit_releases__ck__a40b6cc8" check ("credit_limit" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("credit_limit", bolt_minor_units("currency")) = "credit_limit"),
	constraint "credit_releases__ck__04532e9c" check ("credit_used" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("credit_used", bolt_minor_units("currency")) = "credit_used"),
	constraint "credit_releases__ck__2999727d" check ("over_limit" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("over_limit", bolt_minor_units("currency")) = "over_limit"),
	constraint "credit_releases__ck__d02fd2a2" check (not jsonb_path_exists(to_jsonb("block_reasons"), 'strict $[*] ? (@.type() != "string")') and "block_reasons" <@ array['over_limit', 'overdue']::text[]),
	constraint "credit_releases__ck__9dccc31a" check ("route" in ('one_time', 'permanent')),
	constraint "credit_releases__ck__08e79ac6" check ("proposed_limit" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("proposed_limit", bolt_minor_units("currency")) = "proposed_limit"),
	constraint "credit_releases__ck__1cdc5961" check (isfinite("audit_seen_at")),
	constraint "credit_releases__ck__bf86cc5c" check (isfinite("released_at")),
	constraint "credit_releases__ck__50d89d25" check (isfinite("observed_at")),
	constraint "credit_releases__uq__9a96c6fb" unique nulls not distinct ("source", "external_code")
);

-- step create:table:source_payables (additive)
create table "source_payables" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"shard" int default '0'::int not null,
	"currency" text not null,
	"observed_at" timestamptz not null,
	"entries" jsonb not null,
	"accruals" jsonb,
	"source" text not null,
	constraint "source_payables__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "source_payables__ck__50d89d25" check (isfinite("observed_at")),
	constraint "source_payables__ck__80bbe7a2" check (("entries" is null or store_json_valid("entries", '{"kind":"json","shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","expense","payment"]},"kingdee_due_on":{"kind":"date","optional":true},"received_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true},"supplier":{"kind":"text"},"supplier_id":{"kind":"text"}},"kind":"object","many":true}}'::jsonb) is true)),
	constraint "source_payables__ck__83faede1" check (("accruals" is null or store_json_valid("accruals", '{"kind":"json","optional":true,"shape":{"fields":{"amount":{"kind":"text"},"period":{"kind":"text"}},"kind":"object","many":true}}'::jsonb) is true)),
	constraint "source_payables__uq__12a169a0" unique nulls not distinct ("source", "shard")
);

-- step create:table:source_purchase_orders (additive)
create table "source_purchase_orders" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"period" text not null,
	"currency" text not null,
	"observed_at" timestamptz not null,
	"entries" jsonb not null,
	"expense_notice" jsonb,
	"source" text not null,
	constraint "source_purchase_orders__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "source_purchase_orders__ck__50d89d25" check (isfinite("observed_at")),
	constraint "source_purchase_orders__ck__38973cf1" check (("entries" is null or store_json_valid("entries", '{"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"amount_base":{"kind":"text","optional":true},"currency":{"kind":"text","optional":true},"due_on":{"kind":"date","optional":true},"duty":{"kind":"text","optional":true},"entry_id":{"kind":"text"},"exchange_rate":{"kind":"text","optional":true},"invoice_amount":{"kind":"text","optional":true},"invoice_numbers":{"kind":"text","optional":true},"invoiced_on":{"kind":"date","optional":true},"invoiced_qty":{"kind":"text","optional":true},"last_received_on":{"kind":"date","optional":true},"net_amount":{"kind":"text","optional":true},"note":{"kind":"text","optional":true},"order_id":{"kind":"text"},"order_number":{"kind":"text"},"ordered_on":{"kind":"date"},"paid_amount":{"kind":"text","optional":true},"paid_on":{"kind":"date","optional":true},"payment_status":{"kind":"enum","optional":true,"values":["uninvoiced","unpaid","partial","paid"]},"product_category":{"kind":"text","optional":true},"product_spec":{"kind":"text","optional":true},"quantity":{"kind":"text"},"received_qty":{"kind":"text"},"settlement":{"kind":"text","optional":true},"supplier_id":{"kind":"text","optional":true},"supplier_name":{"kind":"text","optional":true},"unit_price":{"kind":"text","optional":true},"vat_amount":{"kind":"text","optional":true}},"kind":"object","many":true}}'::jsonb) is true)),
	constraint "source_purchase_orders__ck__b44a1c53" check (("expense_notice" is null or store_json_valid("expense_notice", '{"kind":"json","optional":true,"shape":{"fields":{"before_start_amount":{"kind":"text"},"before_start_rows":{"kind":"int"},"unattached_amount":{"kind":"text"},"unattached_rows":{"kind":"int"}},"kind":"object"}}'::jsonb) is true)),
	constraint "source_purchase_orders__uq__a15eca0b" unique nulls not distinct ("source", "period")
);

-- step replace:history:schema:source_sales_lines (additive)
select bolt_history_register('source_sales_lines','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"booked_cost":{"kind":"decimal","optional":true,"scale":10},"booked_cost_currency":{"kind":"currency","optional":true},"business_on":{"kind":"date"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"freight":{"currency":"currency","kind":"money","optional":true},"kind":{"kind":"enum","values":["shipment","return","invoice_only","invoice"]},"lot_number":{"kind":"text","optional":true},"net_amount":{"currency":"currency","kind":"money","optional":true},"order":{"inverse":"source_sales_lines","kind":"ref","optional":true,"to":"orders"},"order_line":{"hidden":true,"kind":"text","optional":true},"quantity":{"kind":"decimal","scale":3},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_dimensions":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"customer_id":{"kind":"text","optional":true},"customer_region":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true},"product_category":{"kind":"text","optional":true}},"kind":"object"}},"source_updated_at":{"kind":"instant"},"tax_amount":{"currency":"currency","kind":"money","optional":true},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:transactions (additive)
select bolt_history_register('transactions','{"audit":true,"fields":{"currency":{"kind":"currency"},"documents":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"sha256":{"kind":"text"},"url":{"kind":"text"}},"kind":"object","many":true}},"due_on":{"kind":"date","optional":true},"erp_id":{"hidden":true,"kind":"text"},"issued_on":{"kind":"date","optional":true},"items":{"kind":"json","optional":true,"shape":{"fields":{"lot_number":{"kind":"text","optional":true},"net_amount":{"kind":"decimal","optional":true,"scale":8},"order_line_id":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"decimal","scale":3},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"unit_price":{"kind":"decimal","optional":true,"scale":4}},"kind":"object","many":true}},"kind":{"kind":"enum","values":["invoice","delivery"]},"order":{"inverse":"transactions","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"default":"issued","kind":"enum","values":["draft","issued","void"]},"total":{"currency":"currency","kind":"money","optional":true}},"record_label":"record.reference","search":{"text":["reference","kind"]},"unique":[{"fields":["source","erp_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:parties (additive)
select bolt_history_register('parties','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"address":{"kind":"text","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"kind":{"kind":"enum","values":["customer","supplier","both"]},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"region":{"kind":"text","optional":true},"related_party":{"default":false,"kind":"bool"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"}},"record_label":"record.name","search":{"text":["name","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:products (additive)
select bolt_history_register('products','{"audit":true,"check":{"unit_price_nonnegative":{"or":[{"unit_price":{"is_null":true}},{"unit_price":{"gte":"0"}}]}},"fields":{"active":{"default":true,"kind":"bool"},"brand":{"kind":"text","optional":true},"brand_en":{"kind":"text","optional":true},"category":{"kind":"text","optional":true},"commission_basis_unit":{"kind":"text","optional":true},"commission_factor":{"kind":"decimal","min":0,"optional":true,"scale":6},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"name":{"kind":"text"},"producing_area":{"kind":"text","optional":true},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"},"spec":{"kind":"text","optional":true},"tax_rate":{"kind":"decimal","max":100,"min":0,"optional":true,"scale":2},"unit":{"kind":"text","optional":true},"unit_price":{"currency":"currency","kind":"money","optional":true,"scale":4}},"record_label":"record.name","search":{"text":["name","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:column:parties.region (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "region" text;

-- step create:column:parties.related_party (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "related_party" boolean default false;

-- step create:column:products.category (additive)
-- operational risk: access-exclusive-lock
alter table "products" add column "category" text;

-- step create:history:schema:credit_releases (additive)
select bolt_history_register('credit_releases','{"audit":true,"computed":{"status":{"expr":{"when":[{"and":[{"eq":[{"field":"source_status"},"blocked"]},{"eq":[{"field":"approval_status"},"approved"]}]},"approved",{"field":"source_status"}]},"kind":"text"}},"fields":{"approval_status":{"default":"none","kind":"enum","values":["none","approved"]},"approved_content_hash":{"hidden":true,"kind":"text","optional":true},"audit_seen_at":{"hidden":true,"kind":"instant","optional":true},"bill_amount":{"currency":"currency","kind":"money","optional":true},"bill_number":{"kind":"text"},"bill_on":{"kind":"date","optional":true},"block_reasons":{"kind":"enum","many":true,"optional":true,"values":["over_limit","overdue"]},"content_hash":{"hidden":true,"kind":"text","optional":true},"credit_limit":{"currency":"currency","kind":"money","optional":true},"credit_used":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"delivery":{"kind":"ref","optional":true,"to":"transactions"},"delivery_fid":{"kind":"text"},"external_code":{"hidden":true,"kind":"text"},"observed_at":{"kind":"instant"},"oldest_overdue_bill":{"kind":"text","optional":true},"order":{"kind":"ref","optional":true,"to":"orders"},"over_limit":{"currency":"currency","kind":"money","optional":true},"overdue_days":{"kind":"int","optional":true},"party":{"kind":"ref","to":"parties"},"proposed_limit":{"currency":"currency","kind":"money","optional":true},"reason":{"kind":"text","optional":true},"release_log_key":{"hidden":true,"kind":"text","optional":true},"released_at":{"kind":"instant","optional":true},"released_by":{"kind":"text","optional":true},"route":{"kind":"enum","optional":true,"values":["one_time","permanent"]},"settlement_name":{"kind":"text","optional":true},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_oper_date":{"hidden":true,"kind":"text","optional":true},"source_status":{"default":"blocked","kind":"enum","values":["blocked","released","cleared","superseded","withdrawn","bypassed"]}},"record_label":"record.bill_number","search":{"text":["bill_number","delivery_fid","oldest_overdue_bill","released_by"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:history:schema:source_payables (additive)
select bolt_history_register('source_payables','{"audit":true,"fields":{"accruals":{"kind":"json","optional":true,"shape":{"fields":{"amount":{"kind":"text"},"period":{"kind":"text"}},"kind":"object","many":true}},"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","expense","payment"]},"kingdee_due_on":{"kind":"date","optional":true},"received_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true},"supplier":{"kind":"text"},"supplier_id":{"kind":"text"}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"shard":{"default":0,"kind":"int"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source","shard"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step create:history:schema:source_purchase_orders (additive)
select bolt_history_register('source_purchase_orders','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"amount_base":{"kind":"text","optional":true},"currency":{"kind":"text","optional":true},"due_on":{"kind":"date","optional":true},"duty":{"kind":"text","optional":true},"entry_id":{"kind":"text"},"exchange_rate":{"kind":"text","optional":true},"invoice_amount":{"kind":"text","optional":true},"invoice_numbers":{"kind":"text","optional":true},"invoiced_on":{"kind":"date","optional":true},"invoiced_qty":{"kind":"text","optional":true},"last_received_on":{"kind":"date","optional":true},"net_amount":{"kind":"text","optional":true},"note":{"kind":"text","optional":true},"order_id":{"kind":"text"},"order_number":{"kind":"text"},"ordered_on":{"kind":"date"},"paid_amount":{"kind":"text","optional":true},"paid_on":{"kind":"date","optional":true},"payment_status":{"kind":"enum","optional":true,"values":["uninvoiced","unpaid","partial","paid"]},"product_category":{"kind":"text","optional":true},"product_spec":{"kind":"text","optional":true},"quantity":{"kind":"text"},"received_qty":{"kind":"text"},"settlement":{"kind":"text","optional":true},"supplier_id":{"kind":"text","optional":true},"supplier_name":{"kind":"text","optional":true},"unit_price":{"kind":"text","optional":true},"vat_amount":{"kind":"text","optional":true}},"kind":"object","many":true}},"expense_notice":{"kind":"json","optional":true,"shape":{"fields":{"before_start_amount":{"kind":"text"},"before_start_rows":{"kind":"int"},"unattached_amount":{"kind":"text"},"unattached_rows":{"kind":"int"}},"kind":"object"}},"observed_at":{"kind":"instant"},"period":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name + '' · '' + record.period","unique":[{"fields":["source","period"],"import_key":true,"name":"one_per_period"}]}'::jsonb);

-- step data:source_sales_lines.source_dimensions (data)
-- hazard: the shape of source_sales_lines.source_dimensions changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over source_sales_lines); the check below counts the rows the new shape still refuses.
-- step check:source_sales_lines.source_dimensions (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "source_sales_lines" where "source_dimensions" is not null and store_json_valid("source_dimensions", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"customer_id":{"kind":"text","optional":true},"customer_region":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true},"product_category":{"kind":"text","optional":true}},"kind":"object"}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of source_sales_lines.source_dimensions refuses % existing row(s)', n; end if;
end $store$;

-- step create:notNull:parties.related_party (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "parties" where "related_party" is null' into n;
	if n > 0 then raise exception 'notNull:parties.related_party refuses % existing row(s)', n; end if;
end $store$;
alter table "parties" alter column "related_party" set not null;

-- step create:constraint:source_sales_lines.source_sales_lines__ck__2d4d5f68 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_sales_lines" where (("source_dimensions" is null or store_json_valid("source_dimensions", ''{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"customer_id":{"kind":"text","optional":true},"customer_region":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true},"product_category":{"kind":"text","optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'source_sales_lines__ck__2d4d5f68 refuses % existing row(s)', n; end if;
end $store$;
alter table "source_sales_lines" add constraint "source_sales_lines__ck__2d4d5f68" check (("source_dimensions" is null or store_json_valid("source_dimensions", '{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"customer_id":{"kind":"text","optional":true},"customer_region":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true},"product_category":{"kind":"text","optional":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:transactions.transactions__ck__838d5561 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "transactions" where ("status" in (''draft'', ''issued'', ''void'')) is false' into n;
	if n > 0 then raise exception 'transactions__ck__838d5561 refuses % existing row(s)', n; end if;
end $store$;
alter table "transactions" add constraint "transactions__ck__838d5561" check ("status" in ('draft', 'issued', 'void'));

-- step create:fk:credit_releases.credit_releases__fk__5ddafbd8 (additive)
alter table "credit_releases" add constraint "credit_releases__fk__5ddafbd8" foreign key ("source") references "sys_integration" ("id") on delete restrict on update restrict;

-- step create:fk:credit_releases.credit_releases__fk__33fd37de (additive)
alter table "credit_releases" add constraint "credit_releases__fk__33fd37de" foreign key ("party") references "parties" ("id") on delete restrict on update restrict;

-- step create:fk:credit_releases.credit_releases__fk__b4f64f88 (additive)
alter table "credit_releases" add constraint "credit_releases__fk__b4f64f88" foreign key ("order") references "orders" ("id") on delete restrict on update restrict;

-- step create:fk:credit_releases.credit_releases__fk__bfcbeeea (additive)
alter table "credit_releases" add constraint "credit_releases__fk__bfcbeeea" foreign key ("delivery") references "transactions" ("id") on delete restrict on update restrict;

-- step create:fk:source_payables.source_payables__fk__5ddafbd8 (additive)
alter table "source_payables" add constraint "source_payables__fk__5ddafbd8" foreign key ("source") references "sys_integration" ("id") on delete restrict on update restrict;

-- step create:fk:source_purchase_orders.source_purchase_orders__fk__5ddafbd8 (additive)
alter table "source_purchase_orders" add constraint "source_purchase_orders__fk__5ddafbd8" foreign key ("source") references "sys_integration" ("id") on delete restrict on update restrict;

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_releases','credit_snapshots','document_templates','order_files','order_lines','orders','parties','pricing_floors','products','settlements','source_lot_costs','source_payables','source_payments','source_purchase_lines','source_purchase_orders','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','transactions','warehouses']::text[]));

-- step create:trigger:credit_releases.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "credit_releases" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:credit_releases.credit_releases__gin__03ecf4ce (additive)
create index "credit_releases__gin__03ecf4ce" on "credit_releases" using gin ("block_reasons");

-- step create:index:credit_releases.credit_releases__gin__73732636 (additive)
create index "credit_releases__gin__73732636" on "credit_releases" using gin (bolt_search);

-- step create:trigger:source_payables.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "source_payables" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:trigger:source_purchase_orders.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "source_purchase_orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:credit_releases.credit_releases__ix__7703c55b (additive)
create index "credit_releases__ix__7703c55b" on "credit_releases" ("source");

-- step create:index:credit_releases.credit_releases__ix__0152d43f (additive)
create index "credit_releases__ix__0152d43f" on "credit_releases" ("party");

-- step create:index:credit_releases.credit_releases__ix__4d0bb674 (additive)
create index "credit_releases__ix__4d0bb674" on "credit_releases" ("order");

-- step create:index:credit_releases.credit_releases__ix__a25ea8b3 (additive)
create index "credit_releases__ix__a25ea8b3" on "credit_releases" ("delivery");

-- step create:index:source_payables.source_payables__ix__7703c55b (additive)
create index "source_payables__ix__7703c55b" on "source_payables" ("source");

-- step create:index:source_purchase_orders.source_purchase_orders__ix__7703c55b (additive)
create index "source_purchase_orders__ix__7703c55b" on "source_purchase_orders" ("source");

-- step create:engine:audit:credit_releases (additive)
drop trigger if exists bolt_audit_mark on "credit_releases";
drop trigger if exists bolt_audit on "credit_releases";
create trigger bolt_audit after insert or update or delete on "credit_releases" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["delivery","transactions"],["order","orders"],["party","parties"],["source","sys_integration"]]');

-- step create:engine:audit:source_payables (additive)
drop trigger if exists bolt_audit_mark on "source_payables";
drop trigger if exists bolt_audit on "source_payables";
create trigger bolt_audit after insert or update or delete on "source_payables" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["source","sys_integration"]]');

-- step create:engine:audit:source_purchase_orders (additive)
drop trigger if exists bolt_audit_mark on "source_purchase_orders";
drop trigger if exists bolt_audit on "source_purchase_orders";
create trigger bolt_audit after insert or update or delete on "source_purchase_orders" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["source","sys_integration"]]');
