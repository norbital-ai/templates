-- 0006_schema.sql: 3 step(s), from 60daae6021887fb3cd1180c81d52b9240ff89df3fdd8eb96e16b23cf7e1c2da1 to deae3ce0a1164af41e4fc1a5a83afaa21973f07adc1a32b69f7a29d826de4dc8.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:document_templates.document_templates__ck__8bd21406 (additive)
-- operational risk: access-exclusive-lock
alter table "document_templates" drop constraint if exists "document_templates__ck__8bd21406";

-- step replace:history:schema:document_templates (additive)
select bolt_history_register('document_templates','{"audit":true,"fields":{"body":{"default":"{agreement}","kind":"text"},"contract_stamp":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"kind":{"kind":"enum","values":["quotation","sales_contract","purchase_contract"]},"layout":{"kind":"enum","optional":true,"values":["text","table_v1"]},"letterhead":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"locale":{"kind":"enum","values":["en","zh"]},"print_fields":{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true},"print_layout":{"accept":["text/html"],"kind":"file","max":"3MiB","optional":true},"published_at":{"kind":"instant","optional":true},"status":{"initial":"draft","kind":"state","states":{"draft":{"to":["published"]},"published":{}}},"title":{"kind":"text"},"version":{"kind":"text"}},"locks":{"published":{"where":{"status":{"eq":"published"}}}},"record_label":"record.title","search":{"text":["title"]}}'::jsonb);

-- step data:document_templates.print_fields (data)
-- hazard: the shape of document_templates.print_fields changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over document_templates); the check below counts the rows the new shape still refuses.
-- step check:document_templates.print_fields (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "document_templates" where "print_fields" is not null and store_json_valid("print_fields", ''{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of document_templates.print_fields refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:document_templates.document_templates__ck__dd45050b (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "document_templates" where (("print_fields" is null or store_json_valid("print_fields", ''{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'document_templates__ck__dd45050b refuses % existing row(s)', n; end if;
end $store$;
alter table "document_templates" add constraint "document_templates__ck__dd45050b" check (("print_fields" is null or store_json_valid("print_fields", '{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"options":{"kind":"text","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true}'::jsonb) is true));
