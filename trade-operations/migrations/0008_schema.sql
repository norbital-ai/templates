-- 0008_schema.sql: 5 step(s), from 6836ea6051ac40a840528cac859c4770986e073b6c145e3719a5ce6951927093 to 6b8e811842a0d302a0a18c8b8c76a681eb60f50047688830f3216cc5fb4d485e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:source_receivables.source_receivables__uq__9de6968c (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" drop constraint if exists "source_receivables__uq__9de6968c";

-- step replace:history:schema:source_receivables (additive)
select bolt_history_register('source_receivables','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"delivered_on":{"kind":"date","optional":true},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"kingdee_due_on":{"kind":"date","optional":true},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlement":{"kind":"text","optional":true},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}},"observed_at":{"kind":"instant"},"shard":{"default":0,"kind":"int"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source","shard"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step create:column:source_receivables.shard (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" add column "shard" int default '0'::int;

-- step create:notNull:source_receivables.shard (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "source_receivables" where "shard" is null' into n;
	if n > 0 then raise exception 'notNull:source_receivables.shard refuses % existing row(s)', n; end if;
end $store$;
alter table "source_receivables" alter column "shard" set not null;

-- step create:constraint:source_receivables.source_receivables__uq__12a169a0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "source_receivables" group by "source", "shard" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'source_receivables__uq__12a169a0 refuses % existing row(s)', n; end if;
end $store$;
alter table "source_receivables" add constraint "source_receivables__uq__12a169a0" unique nulls not distinct ("source", "shard");
