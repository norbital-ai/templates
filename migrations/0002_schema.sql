-- 0002_schema.sql: 41 step(s), from 177e6ad327b897365f676780279a9ecca339efc182289619fb685fa66c25750f to 547893ef32fdd312616084dfd24f625c80669248b7e1aefcbe72075bc7d46275.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step create:table:sys_envoy (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create table "sys_envoy" ("id" uuid primary key);

-- step create:column:sys_envoy.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "name" text;

-- step create:column:sys_envoy.audience (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "audience" text default 'private'::text;

-- step create:column:sys_envoy.task (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "task" text default ''::text;

-- step create:column:sys_envoy.policies (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "policies" text[] default '{}'::text[];

-- step create:column:sys_envoy.group_messages (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "group_messages" text default 'mention_or_reply'::text;

-- step create:column:sys_envoy.delegation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "delegation" text default 'disabled'::text;

-- step create:column:sys_envoy.triage (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "triage" boolean default false;

-- step create:column:sys_envoy.dm (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "dm" text default 'union'::text;

-- step create:column:sys_envoy.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "active" boolean default true;

-- step create:column:sys_envoy.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "created_at" timestamptz default (now());

-- step create:column:sys_envoy.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" add column "revision" int default '1'::int;

-- step create:default:sys_envoy.audience (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "audience" set default 'private'::text;

-- step create:default:sys_envoy.task (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "task" set default ''::text;

-- step create:default:sys_envoy.policies (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "policies" set default '{}'::text[];

-- step create:default:sys_envoy.group_messages (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "group_messages" set default 'mention_or_reply'::text;

-- step create:default:sys_envoy.delegation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "delegation" set default 'disabled'::text;

-- step create:default:sys_envoy.triage (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "triage" set default false;

-- step create:default:sys_envoy.dm (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "dm" set default 'union'::text;

-- step create:default:sys_envoy.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "active" set default true;

-- step create:default:sys_envoy.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "created_at" set default (now());

-- step create:default:sys_envoy.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "revision" set default '1'::int;

-- step create:notNull:sys_envoy.name (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "name" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.name refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "name" set not null;

-- step create:notNull:sys_envoy.audience (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "audience" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.audience refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "audience" set not null;

-- step create:notNull:sys_envoy.task (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "task" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.task refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "task" set not null;

-- step create:notNull:sys_envoy.policies (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "policies" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.policies refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "policies" set not null;

-- step create:notNull:sys_envoy.group_messages (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "group_messages" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.group_messages refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "group_messages" set not null;

-- step create:notNull:sys_envoy.delegation (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "delegation" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.delegation refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "delegation" set not null;

-- step create:notNull:sys_envoy.triage (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "triage" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.triage refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "triage" set not null;

-- step create:notNull:sys_envoy.dm (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "dm" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.dm refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "dm" set not null;

-- step create:notNull:sys_envoy.active (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "active" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.active refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "active" set not null;

-- step create:notNull:sys_envoy.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "created_at" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.created_at refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "created_at" set not null;

-- step create:notNull:sys_envoy.revision (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where "revision" is null' into n;
	if n > 0 then raise exception 'notNull:sys_envoy.revision refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" alter column "revision" set not null;

-- step create:constraint:sys_envoy.sys_envoy__ck__491bd369 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where ("audience" in (''private'', ''public'')) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__491bd369 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__491bd369" check ("audience" in ('private', 'public'));

-- step create:constraint:sys_envoy.sys_envoy__ck__61930eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where (not jsonb_path_exists(to_jsonb("policies"), ''strict $[*] ? (@.type() != "string")'')) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__61930eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__61930eb4" check (not jsonb_path_exists(to_jsonb("policies"), 'strict $[*] ? (@.type() != "string")'));

-- step create:constraint:sys_envoy.sys_envoy__ck__b5b45d76 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where ("group_messages" in (''disabled'', ''mention_or_reply'', ''all'')) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__b5b45d76 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__b5b45d76" check ("group_messages" in ('disabled', 'mention_or_reply', 'all'));

-- step create:constraint:sys_envoy.sys_envoy__ck__de16f910 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where ("delegation" in (''enabled'', ''disabled'')) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__de16f910 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__de16f910" check ("delegation" in ('enabled', 'disabled'));

-- step create:constraint:sys_envoy.sys_envoy__ck__62c03b05 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where ("dm" in (''union'', ''envoy'')) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__62c03b05 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__62c03b05" check ("dm" in ('union', 'envoy'));

-- step create:constraint:sys_envoy.sys_envoy__ck__367d8eb4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_envoy" where (isfinite("created_at")) is false' into n;
	if n > 0 then raise exception 'sys_envoy__ck__367d8eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_envoy" add constraint "sys_envoy__ck__367d8eb4" check (isfinite("created_at"));

-- step create:trigger:sys_envoy.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "sys_envoy" for each row execute function store_row_rules('{"audit":false,"fields":{"active":["active"],"audience":["audience"],"created_at":["created_at"],"delegation":["delegation"],"dm":["dm"],"group_messages":["group_messages"],"name":["name"],"policies":["policies"],"revision":["revision"],"task":["task"],"triage":["triage"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:sys_envoy.sys_envoy__gin__0061abf6 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "sys_envoy__gin__0061abf6" on "sys_envoy" using gin ("policies");
