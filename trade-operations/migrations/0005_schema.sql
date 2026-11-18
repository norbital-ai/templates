-- 0005_schema.sql: 20 step(s), from c6eea6a336ee6467f9843a0b35c4d11e1859200738bdba87776787d9983f186f to 60daae6021887fb3cd1180c81d52b9240ff89df3fdd8eb96e16b23cf7e1c2da1.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:commercial_settings.commercial_settings__ix__4548c5bd (additive)
-- operational risk: access-exclusive-lock
drop index if exists "commercial_settings__ix__4548c5bd";

-- step drop:index:commercial_settings.commercial_settings__ix__0d0353f6 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "commercial_settings__ix__0d0353f6";

-- step replace:trigger:document_templates.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "document_templates";

-- step replace:trigger:document_templates.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "document_templates";

-- step drop:fk:commercial_settings.commercial_settings__fk__72d13abd (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop constraint if exists "commercial_settings__fk__72d13abd";

-- step drop:fk:commercial_settings.commercial_settings__fk__eafa4393 (additive)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop constraint if exists "commercial_settings__fk__eafa4393";

-- step drop:column:commercial_settings.default_document_layout (destructive)
-- accept: drop:column:commercial_settings.default_document_layout
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists "default_document_layout" cascade;

-- step drop:column:commercial_settings.default_purchase_document_layout (destructive)
-- accept: drop:column:commercial_settings.default_purchase_document_layout
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists "default_purchase_document_layout" cascade;

-- step replace:history:schema:commercial_settings (additive)
select bolt_history_register('commercial_settings','{"audit":true,"fields":{"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"credit_fresh_minutes":{"default":60,"kind":"int","min":1},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"require_floor":{"default":false,"kind":"bool"},"stock_fresh_minutes":{"default":30,"kind":"int","min":1}},"record_label":"''Commercial settings''","unique":[{"fields":["code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:document_templates (additive)
select bolt_history_register('document_templates','{"audit":true,"fields":{"body":{"default":"{agreement}","kind":"text"},"contract_stamp":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"kind":{"kind":"enum","values":["quotation","sales_contract","purchase_contract"]},"layout":{"kind":"enum","optional":true,"values":["text","table_v1"]},"letterhead":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"locale":{"kind":"enum","values":["en","zh"]},"print_fields":{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true},"print_layout":{"accept":["text/html"],"kind":"file","max":"3MiB","optional":true},"published_at":{"kind":"instant","optional":true},"status":{"initial":"draft","kind":"state","states":{"draft":{"to":["published"]},"published":{}}},"title":{"kind":"text"},"version":{"kind":"text"}},"locks":{"published":{"where":{"status":{"eq":"published"}}}},"record_label":"record.title","search":{"text":["title"]}}'::jsonb);

-- step replace:history:schema:orders (additive)
select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"text","optional":true},"buyer_mobile":{"format":"phone","kind":"text","optional":true},"check_hash":{"hidden":true,"kind":"text","optional":true},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"delivery_address":{"kind":"text","optional":true},"delivery_date":{"kind":"date","optional":true},"delivery_terms":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_locale":{"default":"en","kind":"enum","values":["en","zh"]},"document_template":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user"},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"other_terms":{"kind":"text","optional":true},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"text","optional":true},"payment_terms":{"kind":"text"},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","many":true,"max":"20MiB","optional":true},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"time_of_shipment":{"kind":"text","optional":true},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:column:document_templates.kind (additive)
-- operational risk: access-exclusive-lock
alter table "document_templates" add column "kind" text;

-- step create:column:orders.document_locale (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "document_locale" text default 'en'::text;

-- step data:document_templates.kind (data)
-- each layout's case: the seeded quotations and purchase contract by id, every other layout a sales contract
update "document_templates" set "kind" = case "id"::text
	when '00000000-0000-4000-8000-000000000503' then 'purchase_contract'
	when '00000000-0000-4000-8000-000000000504' then 'quotation'
	when '00000000-0000-4000-8000-000000000506' then 'quotation'
	else 'sales_contract'
end;

-- step data:orders.document_locale (data)
-- an order prints in its chosen layout's language; only a confirmed order keeps a sealed layout
update "orders" set "document_locale" = t."locale"
from "document_templates" t where t."id" = "orders"."document_template";
update "orders" set "document_template" = null
where "status" <> 'confirmed' and "document_template" is not null;

-- step create:notNull:document_templates.kind (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "document_templates" where "kind" is null' into n;
	if n > 0 then raise exception 'notNull:document_templates.kind refuses % existing row(s)', n; end if;
end $store$;
alter table "document_templates" alter column "kind" set not null;

-- step create:notNull:orders.document_locale (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where "document_locale" is null' into n;
	if n > 0 then raise exception 'notNull:orders.document_locale refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" alter column "document_locale" set not null;

-- step create:constraint:document_templates.document_templates__ck__b092a0a3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "document_templates" where ("kind" in (''quotation'', ''sales_contract'', ''purchase_contract'')) is false' into n;
	if n > 0 then raise exception 'document_templates__ck__b092a0a3 refuses % existing row(s)', n; end if;
end $store$;
alter table "document_templates" add constraint "document_templates__ck__b092a0a3" check ("kind" in ('quotation', 'sales_contract', 'purchase_contract'));

-- step create:constraint:orders.orders__ck__f2969d22 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where ("document_locale" in (''en'', ''zh'')) is false' into n;
	if n > 0 then raise exception 'orders__ck__f2969d22 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__f2969d22" check ("document_locale" in ('en', 'zh'));

-- step replace:trigger:document_templates.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "document_templates" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"body":["body"],"contract_stamp":["contract_stamp"],"kind":["kind"],"layout":["layout"],"letterhead":["letterhead"],"locale":["locale"],"print_fields":["print_fields"],"print_layout":["print_layout"],"published_at":["published_at"],"status":["status"],"title":["title"],"version":["version"]},"key":["id"],"locks":[{"constraint":"document_templates__lock__b04e5ea2","except":[],"name":"published","sql":"(coalesce(t.\"status\" = ''published''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"draft":{"to":["published"]},"published":{}}}}}');

-- step replace:trigger:document_templates.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "document_templates" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"body":["body"],"contract_stamp":["contract_stamp"],"kind":["kind"],"layout":["layout"],"letterhead":["letterhead"],"locale":["locale"],"print_fields":["print_fields"],"print_layout":["print_layout"],"published_at":["published_at"],"status":["status"],"title":["title"],"version":["version"]},"key":["id"],"locks":[{"constraint":"document_templates__lock__b04e5ea2","except":[],"name":"published","sql":"(coalesce(t.\"status\" = ''published''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"draft":{"to":["published"]},"published":{}}}}}');

-- step replace:engine:audit:commercial_settings (additive)
drop trigger if exists bolt_audit_mark on "commercial_settings";
drop trigger if exists bolt_audit on "commercial_settings";
create trigger bolt_audit after insert or update or delete on "commercial_settings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');
