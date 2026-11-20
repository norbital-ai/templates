-- 0005_schema.sql: 6 step(s), from d3bf5bc3d878cbd8d5f7c3825a0ee2ed63754a0375408abdc8f787d245f7fe96 to a7e7089fab1289a8dde5690c7f2a63ac623243a7c9ca9404a03aa7763367ad87.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:source_receivables.source_receivables__ck__98e1a67d (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" drop constraint if exists "source_receivables__ck__98e1a67d";

-- step drop:constraint:source_stock_commitments.source_stock_commitments__ck__bcdf8a6f (additive)
-- operational risk: access-exclusive-lock
alter table "source_stock_commitments" drop constraint if exists "source_stock_commitments__ck__bcdf8a6f";

-- step replace:history:schema:source_receivables (additive)
select bolt_history_register('source_receivables','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"kingdee_due_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step replace:history:schema:source_stock_commitments (additive)
select bolt_history_register('source_stock_commitments','{"audit":true,"fields":{"entries":{"kind":"json","shape":{"fields":{"direction":{"kind":"enum","values":["out","in"]},"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step data:source_receivables.entries (data)
-- hazard: the shape of source_receivables.entries changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over source_receivables); the check below counts the rows the new shape still refuses.
-- step check:source_receivables.entries (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "source_receivables" where "entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"kingdee_due_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of source_receivables.entries refuses % existing row(s)', n; end if;
end $store$;

-- step data:source_stock_commitments.entries (data)
-- hazard: the shape of source_stock_commitments.entries changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over source_stock_commitments); the check below counts the rows the new shape still refuses.
-- every entry read so far was an open sales line: it is promised out; the next read adds the purchase lines
update "source_stock_commitments" set "entries" = (
	select coalesce(jsonb_agg(entry || '{"direction":"out"}'::jsonb), '[]'::jsonb)
	from jsonb_array_elements("entries") entry
);
-- step check:source_stock_commitments.entries (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "source_stock_commitments" where "entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"fields":{"direction":{"kind":"enum","values":["out","in"]},"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of source_stock_commitments.entries refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:source_receivables.source_receivables__ck__6b6a31bf (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_receivables" where (("entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"kingdee_due_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'source_receivables__ck__6b6a31bf refuses % existing row(s)', n; end if;
end $store$;
alter table "source_receivables" add constraint "source_receivables__ck__6b6a31bf" check (("entries" is null or store_json_valid("entries", '{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"kingdee_due_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}}'::jsonb) is true));

-- step create:constraint:source_stock_commitments.source_stock_commitments__ck__95859080 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_stock_commitments" where (("entries" is null or store_json_valid("entries", ''{"kind":"json","shape":{"fields":{"direction":{"kind":"enum","values":["out","in"]},"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'source_stock_commitments__ck__95859080 refuses % existing row(s)', n; end if;
end $store$;
alter table "source_stock_commitments" add constraint "source_stock_commitments__ck__95859080" check (("entries" is null or store_json_valid("entries", '{"kind":"json","shape":{"fields":{"direction":{"kind":"enum","values":["out","in"]},"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}}'::jsonb) is true));
