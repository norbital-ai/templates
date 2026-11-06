-- 0019_schema.sql: 5 step(s), from 3e3c81174043e87582639e4d89827a1f7ffe0d8ddbdd312e4314a0cf1f7e0ec1 to 7524b280a1fb3a56a22aa51323d1033ed5b8383e144f99f9d648ae0f2a966405.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "allowance_catalog";

-- step replace:history:schema:allowance_catalog (additive)
select bolt_history_register('allowance_catalog','{"audit":true,"fields":{"code":{"kind":"text"},"conversion":{"format":"cel","kind":"text","max":65536},"direction":{"kind":"enum","values":["ADD","DEDUCT"]},"eligibility":{"format":"cel","kind":"text","max":65536},"incurred_on":{"format":"cel","kind":"text","max":65536},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"off_cycle_eligible":{"kind":"bool"},"party":{"default":"EMPLOYEE","kind":"enum","values":["EMPLOYEE","EMPLOYER"]},"prorate":{"default":false,"kind":"bool"},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"allowance_catalog","kind":"ref","owned":true,"to":"jurisdiction_settings"},"subtotal_id":{"inverse":"allowance_catalog","kind":"ref","onDelete":"restrict","optional":true,"to":"subtotal"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step create:column:allowance_catalog.prorate (additive)
-- operational risk: access-exclusive-lock
alter table "allowance_catalog" add column "prorate" boolean default false;
update "allowance_catalog" set "prorate" = true where "lookup"->>'prorate' = 'true';

-- step create:notNull:allowance_catalog.prorate (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "allowance_catalog" where "prorate" is null' into n;
	if n > 0 then raise exception 'notNull:allowance_catalog.prorate refuses % existing row(s)', n; end if;
end $store$;
alter table "allowance_catalog" alter column "prorate" set not null;

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "allowance_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"prorate":["prorate"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"allowance_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');
