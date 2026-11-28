-- 0002_schema.sql: 36 step(s), from 9be9b51d6792d679f4b9a24beb316f9c8d8771c6078e977712ac884d9b4384cf to 8ef95dd9b57bb721681fde036ee5febd4469532794bed9185ffdb5a700c58a8f.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step replace:index:parties.parties__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "parties__gin__73732636";

-- step replace:column:parties.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "parties" drop column if exists bolt_search cascade;

-- step create:function:bolt_record_label_user_profiles_93340fdd (additive)
create or replace function "bolt_record_label_user_profiles_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:user_profiles (additive)
create table "user_profiles" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"name" text not null,
	"kingdee_employee_id" text,
	"kingdee_department_id" text,
	"kingdee_biller_id" text,
	"kingdee_customer_id" text,
	"phone" text,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_user_profiles_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_user_profiles_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("kingdee_employee_id"::text, '') || ' ' || coalesce("kingdee_customer_id"::text, ''))) stored,
	"user_id" text not null,
	constraint "user_profiles__ck__43907b08" check ("phone" ~ '^\+?[0-9][0-9 ()\-.]{2,}$'),
	constraint "user_profiles__uq__87831656" unique ("user_id") deferrable initially immediate
);

-- step create:column:parties.tax_id (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "tax_id" text;

-- step replace:column:parties.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "parties" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_parties_93340fdd"("name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("external_code"::text, '') || ' ' || coalesce("source_number"::text, '') || ' ' || coalesce("tax_id"::text, ''))) stored;

-- step replace:history:schema:credit_releases (additive)
select bolt_history_register('credit_releases','{"audit":true,"computed":{"status":{"expr":{"when":[{"and":[{"eq":[{"field":"source_status"},"blocked"]},{"eq":[{"field":"approval_status"},"approved"]}]},"approved",{"field":"source_status"}]},"kind":"text"}},"fields":{"approval_status":{"default":"none","kind":"enum","values":["none","approved"]},"approved_content_hash":{"hidden":true,"kind":"text","optional":true},"audit_seen_at":{"hidden":true,"kind":"instant","optional":true},"bill_amount":{"currency":"currency","kind":"money","optional":true},"bill_number":{"kind":"text"},"bill_on":{"kind":"date","optional":true},"block_reasons":{"kind":"enum","many":true,"optional":true,"values":["over_limit","overdue"]},"content_hash":{"hidden":true,"kind":"text","optional":true},"credit_days":{"kind":"int","optional":true},"credit_limit":{"currency":"currency","kind":"money","optional":true},"credit_used":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"delivery":{"kind":"ref","optional":true,"to":"transactions"},"delivery_fid":{"kind":"text"},"external_code":{"hidden":true,"kind":"text"},"observed_at":{"kind":"instant"},"oldest_overdue_bill":{"kind":"text","optional":true},"order":{"kind":"ref","optional":true,"to":"orders"},"over_limit":{"currency":"currency","kind":"money","optional":true},"overdue_days":{"kind":"int","optional":true},"party":{"kind":"ref","to":"parties"},"proposed_limit":{"currency":"currency","kind":"money","optional":true},"reason":{"kind":"text","optional":true},"release_log_key":{"hidden":true,"kind":"text","optional":true},"released_at":{"kind":"instant","optional":true},"released_by":{"kind":"text","optional":true},"route":{"kind":"enum","optional":true,"values":["one_time","permanent"]},"settlement_name":{"kind":"text","optional":true},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_oper_date":{"hidden":true,"kind":"text","optional":true},"source_status":{"default":"blocked","kind":"enum","values":["blocked","released","cleared","superseded","withdrawn","bypassed"]},"temp_bump_amount":{"currency":"currency","kind":"money","optional":true},"temp_bump_days":{"kind":"int","optional":true},"temp_bump_status":{"default":"none","kind":"enum","values":["none","active","restored"]}},"record_label":"record.bill_number","search":{"text":["bill_number","delivery_fid","oldest_overdue_bill","released_by"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:transactions (additive)
select bolt_history_register('transactions','{"audit":true,"fields":{"credit_check":{"kind":"enum","optional":true,"values":["passed","failed","released","bypassed","unchecked"]},"credit_check_detail":{"kind":"text","optional":true},"credit_checked_at":{"kind":"instant","optional":true},"currency":{"kind":"currency"},"documents":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"sha256":{"kind":"text"},"url":{"kind":"text"}},"kind":"object","many":true}},"due_on":{"kind":"date","optional":true},"erp_id":{"hidden":true,"kind":"text"},"issued_on":{"kind":"date","optional":true},"items":{"kind":"json","optional":true,"shape":{"fields":{"lot_number":{"kind":"text","optional":true},"net_amount":{"kind":"decimal","optional":true,"scale":8},"order_line_id":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"decimal","scale":3},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"unit_price":{"kind":"decimal","optional":true,"scale":4}},"kind":"object","many":true}},"kind":{"kind":"enum","values":["invoice","delivery"]},"order":{"inverse":"transactions","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"default":"issued","kind":"enum","values":["draft","issued","void"]},"total":{"currency":"currency","kind":"money","optional":true}},"record_label":"record.reference","search":{"text":["reference","kind"]},"unique":[{"fields":["source","erp_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:parties (additive)
select bolt_history_register('parties','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"address":{"kind":"text","optional":true},"bank_account":{"kind":"text","optional":true},"bank_name":{"kind":"text","optional":true},"credit_days_target":{"kind":"int","min":0,"optional":true},"credit_limit_target":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"kind":{"kind":"enum","values":["customer","supplier","both"]},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"profile_notes":{"kind":"text","optional":true},"region":{"kind":"text","optional":true},"related_party":{"default":false,"kind":"bool"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"},"tax_id":{"kind":"text","optional":true}},"record_label":"record.name","search":{"text":["name","external_code","source_number","tax_id"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:column:credit_releases.credit_days (additive)
-- operational risk: access-exclusive-lock
alter table "credit_releases" add column "credit_days" int;

-- step create:column:credit_releases.temp_bump_amount (additive)
-- operational risk: access-exclusive-lock
alter table "credit_releases" add column "temp_bump_amount" numeric;

-- step create:column:credit_releases.temp_bump_days (additive)
-- operational risk: access-exclusive-lock
alter table "credit_releases" add column "temp_bump_days" int;

-- step create:column:credit_releases.temp_bump_status (additive)
-- operational risk: access-exclusive-lock
alter table "credit_releases" add column "temp_bump_status" text default 'none'::text;

-- step create:column:transactions.credit_check (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" add column "credit_check" text;

-- step create:column:transactions.credit_check_detail (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" add column "credit_check_detail" text;

-- step create:column:transactions.credit_checked_at (additive)
-- operational risk: access-exclusive-lock
alter table "transactions" add column "credit_checked_at" timestamptz;

-- step create:column:parties.bank_name (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "bank_name" text;

-- step create:column:parties.bank_account (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "bank_account" text;

-- step create:column:parties.profile_notes (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "profile_notes" text;

-- step create:column:parties.credit_limit_target (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "credit_limit_target" numeric;

-- step create:column:parties.credit_days_target (additive)
-- operational risk: access-exclusive-lock
alter table "parties" add column "credit_days_target" int;

-- step create:history:schema:user_profiles (additive)
select bolt_history_register('user_profiles','{"audit":true,"fields":{"kingdee_biller_id":{"kind":"text","optional":true},"kingdee_customer_id":{"kind":"text","optional":true},"kingdee_department_id":{"kind":"text","optional":true},"kingdee_employee_id":{"kind":"text","optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"phone":{"format":"phone","kind":"text","optional":true},"user_id":{"kind":"ref","to":"sys_user"}},"record_label":"record.name","search":{"text":["name","kingdee_employee_id","kingdee_customer_id"]},"unique":[{"fields":["user_id"],"name":"user"}]}'::jsonb);

-- step create:notNull:credit_releases.temp_bump_status (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "credit_releases" where "temp_bump_status" is null' into n;
	if n > 0 then raise exception 'notNull:credit_releases.temp_bump_status refuses % existing row(s)', n; end if;
end $store$;
alter table "credit_releases" alter column "temp_bump_status" set not null;

-- step create:constraint:credit_releases.credit_releases__ck__928c44c4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "credit_releases" where ("temp_bump_amount" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("temp_bump_amount", bolt_minor_units("currency")) = "temp_bump_amount") is false' into n;
	if n > 0 then raise exception 'credit_releases__ck__928c44c4 refuses % existing row(s)', n; end if;
end $store$;
alter table "credit_releases" add constraint "credit_releases__ck__928c44c4" check ("temp_bump_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("temp_bump_amount", bolt_minor_units("currency")) = "temp_bump_amount");

-- step create:constraint:credit_releases.credit_releases__ck__bd82f6bc (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "credit_releases" where ("temp_bump_status" in (''none'', ''active'', ''restored'')) is false' into n;
	if n > 0 then raise exception 'credit_releases__ck__bd82f6bc refuses % existing row(s)', n; end if;
end $store$;
alter table "credit_releases" add constraint "credit_releases__ck__bd82f6bc" check ("temp_bump_status" in ('none', 'active', 'restored'));

-- step create:constraint:transactions.transactions__ck__08b51055 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "transactions" where ("credit_check" in (''passed'', ''failed'', ''released'', ''bypassed'', ''unchecked'')) is false' into n;
	if n > 0 then raise exception 'transactions__ck__08b51055 refuses % existing row(s)', n; end if;
end $store$;
alter table "transactions" add constraint "transactions__ck__08b51055" check ("credit_check" in ('passed', 'failed', 'released', 'bypassed', 'unchecked'));

-- step create:constraint:transactions.transactions__ck__97606d30 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "transactions" where (isfinite("credit_checked_at")) is false' into n;
	if n > 0 then raise exception 'transactions__ck__97606d30 refuses % existing row(s)', n; end if;
end $store$;
alter table "transactions" add constraint "transactions__ck__97606d30" check (isfinite("credit_checked_at"));

-- step create:constraint:parties.parties__ck__2a521138 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "parties" where ("credit_limit_target" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("credit_limit_target", bolt_minor_units("currency")) = "credit_limit_target") is false' into n;
	if n > 0 then raise exception 'parties__ck__2a521138 refuses % existing row(s)', n; end if;
end $store$;
alter table "parties" add constraint "parties__ck__2a521138" check ("credit_limit_target" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("credit_limit_target", bolt_minor_units("currency")) = "credit_limit_target");

-- step create:constraint:parties.parties__ck__3a63c384 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "parties" where ("credit_days_target" >= 0) is false' into n;
	if n > 0 then raise exception 'parties__ck__3a63c384 refuses % existing row(s)', n; end if;
end $store$;
alter table "parties" add constraint "parties__ck__3a63c384" check ("credit_days_target" >= 0);

-- step create:fk:user_profiles.user_profiles__fk__f0e56d54 (additive)
alter table "user_profiles" add constraint "user_profiles__fk__f0e56d54" foreign key ("user_id") references "sys_user" ("id") on delete restrict on update restrict;

-- step replace:index:parties.parties__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "parties__gin__73732636" on "parties" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_releases','credit_snapshots','document_templates','order_files','order_lines','orders','parties','pricing_floors','products','settlements','source_lot_costs','source_payables','source_payments','source_purchase_lines','source_purchase_orders','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_envoy_channel','sys_file','sys_integration','sys_invitation','sys_team','sys_user','sys_workspace','transactions','user_profiles','warehouses']::text[]));

-- step create:trigger:user_profiles.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "user_profiles" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:user_profiles.user_profiles__gin__73732636 (additive)
create index "user_profiles__gin__73732636" on "user_profiles" using gin (bolt_search);

-- step create:index:user_profiles.user_profiles__ix__07a01ee1 (additive)
create index "user_profiles__ix__07a01ee1" on "user_profiles" ("user_id");

-- step create:engine:audit:user_profiles (additive)
drop trigger if exists bolt_audit_mark on "user_profiles";
drop trigger if exists bolt_audit on "user_profiles";
create trigger bolt_audit after insert or update or delete on "user_profiles" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["user_id","sys_user"]]');
