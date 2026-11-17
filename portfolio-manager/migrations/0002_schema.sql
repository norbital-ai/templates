-- 0002_schema.sql: 10 step(s), from 29e39bcc6a3d76f33630ea75fa4cf163488f9b7b2fd5a5dcee4ab293b54758f4 to 925e99aae5a8d8001a2d02007754373de02def8ca44c16451502bc204e00d6f2.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step create:function:bolt_record_label_sys_workspace_93340fdd (additive)
create or replace function "bolt_record_label_sys_workspace_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:sys_workspace (additive)
create table "sys_workspace" ("id" text primary key,
	"name" text,
	"revision" int default '1'::int not null,
	"bolt_record_label" text generated always as ("bolt_record_label_sys_workspace_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_sys_workspace_93340fdd"("name"), ''))) stored,
	constraint "sys_workspace__ck__a12e11bb" check (char_length("name") <= 120),
	constraint "sys_workspace__ck__4e7b428e" check ((coalesce("id" = '00000000-0000-0000-0000-000000000001'::text, false)))
);

-- step replace:history:schema:sys_user (additive)
select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"preferences":{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"locale":{"kind":"enum","optional":true,"values":["en","zh"]},"sounds":{"kind":"bool","optional":true}},"kind":"object"}},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

-- step create:column:sys_user.preferences (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" add column "preferences" jsonb default '{}'::jsonb;

-- step create:history:schema:sys_workspace (additive)
select bolt_history_register('sys_workspace','{"check":{"singleton":{"id":{"eq":"00000000-0000-0000-0000-000000000001"}}},"fields":{"name":{"kind":"text","max":120,"optional":true},"revision":{"default":1,"kind":"int"}},"key":"text","record_label":"record.name"}'::jsonb);

-- step create:notNull:sys_user.preferences (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where "preferences" is null' into n;
	if n > 0 then raise exception 'notNull:sys_user.preferences refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" alter column "preferences" set not null;

-- step create:constraint:sys_user.sys_user__ck__3996db29 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where (("preferences" is null or store_json_valid("preferences", ''{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"locale":{"kind":"enum","optional":true,"values":["en","zh"]},"sounds":{"kind":"bool","optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__3996db29 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__3996db29" check (("preferences" is null or store_json_valid("preferences", '{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"locale":{"kind":"enum","optional":true,"values":["en","zh"]},"sounds":{"kind":"bool","optional":true}},"kind":"object"}}'::jsonb) is true));

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['approval_request','holding','portfolio_settings','report','report_subscription','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace']::text[]));

-- step create:trigger:sys_workspace.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "sys_workspace" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

-- step create:index:sys_workspace.sys_workspace__gin__73732636 (additive)
create index "sys_workspace__gin__73732636" on "sys_workspace" using gin (bolt_search);
