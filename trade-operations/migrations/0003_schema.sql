-- 0003_schema.sql: 12 step(s), from 57b8bb78f804f18e5d9a66911cbc3960c8a9a2147b7bac5dfe837df70203e58a to cecd1162564fbfe0d063e352d8f51b9fd5f8ec8a784f443f3ad8a8768de714ce.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:document_templates.document_templates__ck__dd45050b (additive)
-- operational risk: access-exclusive-lock
alter table "document_templates" drop constraint if exists "document_templates__ck__dd45050b";

-- step drop:constraint:orders.orders__ck__f2969d22 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__f2969d22";

-- step drop:constraint:orders.orders__ck__dcdbd148 (additive)
-- operational risk: access-exclusive-lock
alter table "orders" drop constraint if exists "orders__ck__dcdbd148";

-- step drop:notNull:orders.document_locale (additive)
-- operational risk: access-exclusive-lock
alter table "orders" alter column "document_locale" drop not null;

-- step drop:default:orders.document_locale (additive)
-- operational risk: access-exclusive-lock
alter table "orders" alter column "document_locale" drop default;

-- step drop:column:orders.document_locale (destructive)
-- accept: drop:column:orders.document_locale
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "document_locale" cascade;

-- step drop:column:orders.supporting_documents (destructive)
-- accept: drop:column:orders.supporting_documents
-- operational risk: access-exclusive-lock
alter table "orders" drop column if exists "supporting_documents" cascade;

-- step replace:history:schema:document_templates (additive)
select bolt_history_register('document_templates','{"audit":true,"fields":{"body":{"default":"{agreement}","kind":"text"},"contract_stamp":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"kind":{"kind":"enum","values":["quotation","sales_contract","purchase_contract"]},"layout":{"kind":"enum","optional":true,"values":["text","table_v1"]},"letterhead":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"locale":{"kind":"enum","values":["en","zh"]},"print_fields":{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]},"translation":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"print_layout":{"accept":["text/html"],"kind":"file","max":"3MiB","optional":true},"published_at":{"kind":"instant","optional":true},"status":{"initial":"draft","kind":"state","states":{"draft":{"to":["published"]},"published":{}}},"title":{"kind":"text"},"version":{"kind":"text"}},"locks":{"published":{"where":{"status":{"eq":"published"}}}},"record_label":"record.title","search":{"text":["title"]}}'::jsonb);

-- step replace:history:schema:orders (additive)
select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"ref","optional":true,"to":"contacts"},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"customer_po_no":{"kind":"text","optional":true},"delivery_address":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user"},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"other_terms":{"kind":"text","optional":true},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"enum","optional":true,"values":["wire_transfer","acceptance_bill"]},"payment_terms":{"kind":"ref","optional":true,"to":"settlements","where":{"active":{"eq":true}}},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"shipment":{"kind":"period","of":"date","optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"enum","optional":true,"values":["exw","fca","fas","fob","cfr","cif","cpt","cip","dap","dpu","ddp"]},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:column:orders.customer_po_no (additive)
-- operational risk: access-exclusive-lock
alter table "orders" add column "customer_po_no" text;

-- step data:document_templates.print_fields (data)
-- hazard: the shape of document_templates.print_fields changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over document_templates); the check below counts the rows the new shape still refuses.
-- step check:document_templates.print_fields (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "document_templates" where "print_fields" is not null and store_json_valid("print_fields", ''{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]},"translation":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of document_templates.print_fields refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:document_templates.document_templates__ck__4f054d53 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "document_templates" where (("print_fields" is null or store_json_valid("print_fields", ''{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]},"translation":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'document_templates__ck__4f054d53 refuses % existing row(s)', n; end if;
end $store$;
alter table "document_templates" add constraint "document_templates__ck__4f054d53" check (("print_fields" is null or store_json_valid("print_fields", '{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]},"translation":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true}'::jsonb) is true));

-- step data:orders.shipping_terms (data)
-- Free-text shipping terms become the Incoterm they name (自提 is EXW, 送到 DDP), else none; the text moves into other terms.
update "orders" set
	"other_terms" = concat_ws(E'\n', nullif("other_terms", ''), "shipping_terms"),
	"shipping_terms" = case
		when upper(ltrim("shipping_terms")) ~ '^(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\M'
			then lower(left(ltrim("shipping_terms"), 3))
		when "shipping_terms" like '%自提%' then 'exw'
		when "shipping_terms" like '%送到%' then 'ddp'
	end
where "shipping_terms" not in ('exw', 'fca', 'fas', 'fob', 'cfr', 'cif', 'cpt', 'cip', 'dap', 'dpu', 'ddp');

-- step create:constraint:orders.orders__ck__42a82693 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "orders" where ("shipping_terms" in (''exw'', ''fca'', ''fas'', ''fob'', ''cfr'', ''cif'', ''cpt'', ''cip'', ''dap'', ''dpu'', ''ddp'')) is false' into n;
	if n > 0 then raise exception 'orders__ck__42a82693 refuses % existing row(s)', n; end if;
end $store$;
alter table "orders" add constraint "orders__ck__42a82693" check ("shipping_terms" in ('exw', 'fca', 'fas', 'fob', 'cfr', 'cif', 'cpt', 'cip', 'dap', 'dpu', 'ddp'));
