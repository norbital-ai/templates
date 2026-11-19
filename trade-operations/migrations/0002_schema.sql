-- 0002_schema.sql: 49 step(s), from deae3ce0a1164af41e4fc1a5a83afaa21973f07adc1a32b69f7a29d826de4dc8 to 57b8bb78f804f18e5d9a66911cbc3960c8a9a2147b7bac5dfe837df70203e58a.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:orders.orders__ix__a4f090a6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "orders__ix__a4f090a6";

-- step replace:trigger:orders.store_row_rules (additive)
drop trigger if exists store_row_rules on "orders";

-- step drop:fk:orders.orders__fk__b576e0c7 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__fk__b576e0c7";

-- step drop:constraint:commercial_settings.commercial_settings__ck__fa091954 (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop constraint if exists "commercial_settings__ck__fa091954";

-- step drop:constraint:orders.orders__ck__38ef8dc0 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__38ef8dc0";

-- step drop:constraint:orders.orders__ck__b9cda4d5 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__b9cda4d5";

-- step drop:notNull:commercial_settings.credit_fresh_minutes (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" alter column "credit_fresh_minutes" drop not null;

-- step drop:notNull:commercial_settings.require_floor (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" alter column "require_floor" drop not null;

-- step drop:notNull:orders.payment_terms (additive)
-- operational risk: access-exclusive-lock
alter table "orders" alter column "payment_terms" drop not null;

-- step drop:default:commercial_settings.credit_fresh_minutes (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" alter column "credit_fresh_minutes" drop default;

-- step drop:default:commercial_settings.require_floor (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" alter column "require_floor" drop default;

-- step drop:column:commercial_settings.credit_fresh_minutes (destructive)
-- accept: drop:column:commercial_settings.credit_fresh_minutes
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists "credit_fresh_minutes" cascade;

-- step drop:column:commercial_settings.require_floor (destructive)
-- accept: drop:column:commercial_settings.require_floor
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists "require_floor" cascade;

-- step drop:column:orders.buyer_mobile (destructive)
-- accept: drop:column:orders.buyer_mobile
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "buyer_mobile" cascade;

-- step drop:column:orders.check_hash (destructive)
-- accept: drop:column:orders.check_hash
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "check_hash" cascade;

-- step drop:column:orders.delivery_date (destructive)
-- accept: drop:column:orders.delivery_date
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "delivery_date" cascade;

-- step drop:column:orders.delivery_terms (destructive)
-- accept: drop:column:orders.delivery_terms
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "delivery_terms" cascade;

-- step drop:column:orders.time_of_shipment (destructive)
-- accept: drop:column:orders.time_of_shipment
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "time_of_shipment" cascade;

-- step drop:column:orders.document_template (destructive)
-- accept: drop:column:orders.document_template
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "document_template" cascade;

-- step replace:column:orders.payment_terms (destructive)
-- accept: replace:column:orders.payment_terms
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "payment_terms" cascade;

-- step replace:column:orders.buyer_contact (destructive)
-- accept: replace:column:orders.buyer_contact
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "buyer_contact" cascade;

-- step create:function:bolt_record_label_settlements_93340fdd (additive)
create or replace function "bolt_record_label_settlements_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:settlements (additive)
create table "settlements" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"external_code" text not null,
	"code" text not null,
	"name" text not null,
	"active" boolean default true not null,
	"source_updated_at" timestamptz not null,
	"bolt_record_label" text generated always as ("bolt_record_label_settlements_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_settlements_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("code"::text, ''))) stored,
	"source" text not null,
	constraint "settlements__ck__dcfa7025" check (isfinite("source_updated_at")),
	constraint "settlements__uq__9a96c6fb" unique nulls not distinct ("source", "external_code")
);

-- step replace:column:orders.payment_terms (destructive)
-- accept: replace:column:orders.payment_terms
-- operational risk: access-exclusive-lock
alter table "orders" add column "payment_terms" uuid;

-- step replace:column:orders.buyer_contact (destructive)
-- accept: replace:column:orders.buyer_contact
-- operational risk: access-exclusive-lock
alter table "orders" add column "buyer_contact" uuid;

-- step replace:history:schema:commercial_settings (additive)
select bolt_history_register('commercial_settings','{"audit":true,"fields":{"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"floor_rule":{"default":"warn","kind":"enum","values":["warn","approve","refuse"]},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"stock_fresh_minutes":{"default":30,"kind":"int","min":1}},"record_label":"''Commercial settings''","unique":[{"fields":["code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:orders (additive)
select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"ref","optional":true,"to":"contacts"},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"delivery_address":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_locale":{"default":"en","kind":"enum","values":["en","zh"]},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user"},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"other_terms":{"kind":"text","optional":true},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"enum","optional":true,"values":["wire_transfer","acceptance_bill"]},"payment_terms":{"kind":"ref","optional":true,"to":"settlements","where":{"active":{"eq":true}}},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"shipment":{"kind":"period","of":"date","optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","many":true,"max":"20MiB","optional":true},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:contacts (additive)
select bolt_history_register('contacts','{"audit":true,"fields":{"email":{"format":"email","kind":"text","optional":true},"job_title":{"kind":"text","optional":true},"name":{"kind":"text"},"party":{"inverse":"contacts","kind":"ref","to":"parties"},"phone":{"format":"phone","kind":"text","optional":true},"primary":{"default":false,"kind":"bool"}},"record_label":"record.name","search":{"text":["name","email","phone"]}}'::jsonb);

-- step create:column:commercial_settings.floor_rule (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" add column "floor_rule" text default 'warn'::text;

-- step create:column:orders.shipment (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "shipment" daterange;

-- step create:column:contacts.primary (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" add column "primary" boolean default false;

-- step create:history:schema:settlements (additive)
select bolt_history_register('settlements','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"code":{"kind":"text"},"external_code":{"kind":"text"},"name":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant"}},"record_label":"record.name","search":{"text":["name","code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"source_code"}]}'::jsonb);

-- step create:notNull:commercial_settings.floor_rule (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "commercial_settings" where "floor_rule" is null' into n;
	if n > 0 then raise exception 'notNull:commercial_settings.floor_rule refuses % existing row(s)', n; end if;
end $store$;
alter table "commercial_settings" alter column "floor_rule" set not null;

-- step create:notNull:contacts.primary (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where "primary" is null' into n;
	if n > 0 then raise exception 'notNull:contacts.primary refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" alter column "primary" set not null;

-- step create:constraint:commercial_settings.commercial_settings__ck__fd8cd98a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "commercial_settings" where ("floor_rule" in (''warn'', ''approve'', ''refuse'')) is false' into n;
	if n > 0 then raise exception 'commercial_settings__ck__fd8cd98a refuses % existing row(s)', n; end if;
end $store$;
alter table "commercial_settings" add constraint "commercial_settings__ck__fd8cd98a" check ("floor_rule" in ('warn', 'approve', 'refuse'));

-- step create:constraint:orders.orders__ck__0c5580b8 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where (not isempty("shipment") and not lower_inf("shipment")) is false' into n;
	if n > 0 then raise exception 'orders__ck__0c5580b8 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__0c5580b8" check (not isempty("shipment") and not lower_inf("shipment"));

-- step create:constraint:orders.orders__ck__0a70b894 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where ("payment_method" in (''wire_transfer'', ''acceptance_bill'')) is false' into n;
	if n > 0 then raise exception 'orders__ck__0a70b894 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__0a70b894" check ("payment_method" in ('wire_transfer', 'acceptance_bill'));

-- step create:fk:orders.orders__fk__4686f5b3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" c where c."payment_terms" is not null and not exists (select 1 from "settlements" p where p."id" = c."payment_terms")' into n;
	if n > 0 then raise exception 'orders__fk__4686f5b3 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__fk__4686f5b3" foreign key ("payment_terms") references "settlements" ("id") on delete restrict on update restrict;

-- step create:fk:orders.orders__fk__7fd40c8a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" c where c."buyer_contact" is not null and not exists (select 1 from "contacts" p where p."id" = c."buyer_contact")' into n;
	if n > 0 then raise exception 'orders__fk__7fd40c8a refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__fk__7fd40c8a" foreign key ("buyer_contact") references "contacts" ("id") on delete restrict on update restrict;

-- step create:fk:settlements.settlements__fk__5ddafbd8 (additive)
alter table "settlements" add constraint "settlements__fk__5ddafbd8" foreign key ("source") references "sys_integration" ("id") on delete restrict on update restrict;

-- step replace:trigger:orders.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"confirmed":{},"draft":{"to":["confirmed"]}}}}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_snapshots','document_templates','order_files','order_lines','orders','parties','pricing_floors','products','settlements','source_lot_costs','source_payments','source_purchase_lines','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','transactions','warehouses']::text[]));

-- step replace:engine:audit:orders (additive)
drop trigger if exists bolt_audit_mark on "orders";
drop trigger if exists bolt_audit on "orders";
create trigger bolt_audit after insert or update or delete on "orders" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["buyer_contact","contacts"],["ledger","sys_integration"],["logistics_handler","sys_user"],["owner","sys_user"],["party","parties"],["payment_terms","settlements"],["warehouse","warehouses"]]');

-- step create:trigger:settlements.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "settlements" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:settlements.settlements__gin__73732636 (additive)
create index "settlements__gin__73732636" on "settlements" using gin (bolt_search);

-- step create:index:orders.orders__ix__fd4abb4c (additive)
-- operational risk: writes-blocked, table-scan
create index "orders__ix__fd4abb4c" on "orders" ("payment_terms");

-- step create:index:orders.orders__ix__172b45b4 (additive)
-- operational risk: writes-blocked, table-scan
create index "orders__ix__172b45b4" on "orders" ("buyer_contact");

-- step create:index:settlements.settlements__ix__7703c55b (additive)
create index "settlements__ix__7703c55b" on "settlements" ("source");

-- step create:engine:audit:settlements (additive)
drop trigger if exists bolt_audit_mark on "settlements";
drop trigger if exists bolt_audit on "settlements";
create trigger bolt_audit after insert or update or delete on "settlements" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["source","sys_integration"]]');
