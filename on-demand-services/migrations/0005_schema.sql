-- 0005_schema.sql: 7 step(s), from e50377bc65ff8deb7d05fc9df321d5ff705a19d73f85f45c4991e21fc85e5f1e to 1eb52ef0cc859006416bdd9e4d72980b37434e9b62197926d1ef75198041e520.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:trigger:sys_run.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "sys_run";

-- step drop:constraint:sys_session.sys_session__ck__753fc483 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_session" drop constraint if exists "sys_session__ck__753fc483";

-- step drop:constraint:sys_user.sys_user__ck__973b1124 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" drop constraint if exists "sys_user__ck__973b1124";

-- step create:column:sys_run.trigger (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_run" add column "trigger" jsonb;

-- step create:constraint:sys_run.sys_run__ck__6dade4e5 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_run" where (("trigger" is null or store_json_valid("trigger", ''{"kind":"json","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_run__ck__6dade4e5 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_run" add constraint "sys_run__ck__6dade4e5" check (("trigger" is null or store_json_valid("trigger", '{"kind":"json","optional":true}'::jsonb) is true));

-- step create:constraint:sys_session.sys_session__ck__30a5a136 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_session" where ("via" in (''code'', ''invitation'', ''signup'', ''host'', ''anonymous'')) is false' into n;
	if n > 0 then raise exception 'sys_session__ck__30a5a136 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_session" add constraint "sys_session__ck__30a5a136" check ("via" in ('code', 'invitation', 'signup', 'host', 'anonymous'));

-- step create:constraint:sys_user.sys_user__ck__73877b7a (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where ("kind" in (''staff'', ''external'', ''anonymous'')) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__73877b7a refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__73877b7a" check ("kind" in ('staff', 'external', 'anonymous'));

-- step replace:trigger:sys_run.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_run" for each row execute function store_row_rules('{"audit":false,"fields":{"actor":["actor"],"attempts":["attempts"],"automation":["automation"],"cause":["cause"],"depth":["depth"],"due_at":["due_at"],"error":["error"],"finished_at":["finished_at"],"input":["input"],"key":["key"],"leases":["leases"],"output":["output"],"progress":["progress"],"results":["results"],"run_key":["run_key"],"started_at":["started_at"],"starter":["starter"],"state":["state"],"trigger":["trigger"]},"key":["id"],"parents":[],"states":{}}');
