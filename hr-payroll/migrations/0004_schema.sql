-- 0004_schema.sql: 5 step(s), from 9a8acf6653cbe7f624ebffc228d893f0f50a8b2b23530982c0fc10a4e169d174 to 7d5790197809af745e91c4d5229b99f8618f944561804d391eee27b237bc364e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog_entry";

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"occurrence_key":{"hidden":true,"kind":"text","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"leave_catalog_entry"}},"nativeRules":2,"recordLabel":"record.employment_id.employee_number + '' · '' + record.catalog_id.code","unique":[{"fields":["reverses"]},{"fields":["occurrence_key","catalog_id"],"where":{"occurrence_key":{"isNull":false},"reverses":{"isNull":true}}}]}'::jsonb);

-- step create:column:leave_catalog_entry.occurrence_key (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" add column "occurrence_key" text;

-- step create:constraint:leave_catalog_entry.leave_catalog_entry__ex__35721b11 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "leave_catalog_entry" where ("occurrence_key" is not null and "reverses" is null) group by "occurrence_key", "catalog_id" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'leave_catalog_entry__ex__35721b11 refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" add constraint "leave_catalog_entry__ex__35721b11" exclude using btree ((coalesce("occurrence_key", ''::text)) with =, ("occurrence_key" is null) with =, "catalog_id" with =) where ("occurrence_key" is not null and "reverses" is null) deferrable initially immediate;

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"employment_id":["employment_id"],"encashment":["encashment"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"occurrence_key":["occurrence_key"],"payroll_run_id":["payroll_run_id"],"reverses":["reverses"]},"key":["id"],"parents":[],"states":{}}');
