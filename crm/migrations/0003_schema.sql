-- 0003_schema.sql: 30 step(s), from fc9b59cac307bbfa87dfc6b0fbb844cebb79d308c704379745727ab2abb65c07 to 1b37efcf8869a71ed3177872898476ede6fe67a8d0079a3dd67569b02e9b997c.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:constraint:meeting_speakers.meeting_speakers__uq__96f782d3 (additive)
-- operational risk: access-exclusive-lock
alter table "meeting_speakers" drop constraint if exists "meeting_speakers__uq__96f782d3";

-- step create:function:bolt_record_label_meeting_recordings_c9340192 (additive)
create or replace function "bolt_record_label_meeting_recordings_c9340192"(jsonb, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['audio']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['audio']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['audio', 'name']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['audio']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['audio']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Recording'::text) ELSE 'null'::jsonb END) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title"), 'audio', to_jsonb("audio")) AS j FROM (SELECT $1 AS "audio", $2 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_offering_settings_8124f4ee (additive)
create or replace function "bolt_record_label_offering_settings_8124f4ee"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['seller_name']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['seller_name']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['seller_name']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['seller_name']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['seller_name']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Seller profile'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('seller_name', to_jsonb("seller_name")) AS j FROM (SELECT $1 AS "seller_name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_products_d45b8fc7 (additive)
create or replace function "bolt_record_label_products_d45b8fc7"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['category']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['category']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['category']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['category']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['category']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('category', to_jsonb("category"), 'name', to_jsonb("name")) AS j FROM (SELECT $1 AS "category", $2 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:meeting_recordings (additive)
create table "meeting_recordings" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"title" text,
	"audio" jsonb not null,
	"transcription" text default 'pending'::text not null,
	"transcription_error" text,
	"language" text,
	"segments" jsonb,
	"bolt_record_label" text generated always as ("bolt_record_label_meeting_recordings_c9340192"("audio", "title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_meeting_recordings_c9340192"("audio", "title"), ''))) stored,
	"meeting" uuid not null,
	constraint "meeting_recordings__ck__ad2c4a96" check (("audio" is null or store_json_valid("audio", '{"accept":["audio/*","video/*"],"kind":"file","max":"20MiB"}'::jsonb) is true)),
	constraint "meeting_recordings__ck__8ff47784" check ("transcription" in ('pending', 'done', 'failed', 'unavailable')),
	constraint "meeting_recordings__ck__7e22b716" check (("segments" is null or store_json_valid("segments", '{"kind":"json","optional":true,"shape":{"fields":{"end":{"kind":"number"},"speaker":{"kind":"text"},"start":{"kind":"number"},"text":{"kind":"text"}},"kind":"object","many":true}}'::jsonb) is true))
);

-- step create:table:offering_settings (additive)
create table "offering_settings" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"scope" text default 'workspace'::text not null,
	"seller_name" text,
	"offering_summary" text,
	"research_focus" text,
	"bolt_record_label" text generated always as ("bolt_record_label_offering_settings_8124f4ee"("seller_name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_offering_settings_8124f4ee"("seller_name"), ''))) stored,
	constraint "offering_settings__ck__d6588134" check ("scope" in ('workspace')),
	constraint "offering_settings__uq__af546d87" unique ("scope") deferrable initially immediate
);

-- step create:table:products (additive)
create table "products" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"name" text not null,
	"category" text,
	"summary" text,
	"fit_criteria" text,
	"active" boolean default true not null,
	"bolt_record_label" text generated always as ("bolt_record_label_products_d45b8fc7"("category", "name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_products_d45b8fc7"("category", "name"), '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("category"::text, '') || ' ' || coalesce("summary"::text, '') || ' ' || coalesce("fit_criteria"::text, ''))) stored
);

-- step replace:history:schema:meeting_speakers (additive)
select bolt_history_register('meeting_speakers','{"audit":true,"fields":{"contact":{"inverse":"meeting_voices","kind":"ref","optional":true,"to":"contacts"},"label":{"kind":"text"},"meeting":{"inverse":"speakers","kind":"ref","owned":true,"to":"activities"},"name":{"kind":"text","optional":true},"recording":{"inverse":"speakers","kind":"ref","optional":true,"owned":true,"to":"meeting_recordings"},"voice_enrolled_at":{"kind":"instant","optional":true}},"record_label":"record.contact.full_name != null ? record.contact.full_name : record.name != null ? record.name : record.label","search":{"text":["label","name","contact"]},"unique":[{"fields":["recording","label"],"name":"one_speaker_label_per_recording","where":{"recording":{"is_null":false}}},{"fields":["meeting","label"],"name":"one_speaker_label_per_meeting","where":{"recording":{"is_null":true}}}]}'::jsonb);

-- step create:column:meeting_speakers.recording (additive)
-- operational risk: access-exclusive-lock
alter table "meeting_speakers" add column "recording" uuid;

-- step create:history:schema:meeting_recordings (additive)
select bolt_history_register('meeting_recordings','{"audit":true,"fields":{"audio":{"accept":["audio/*","video/*"],"kind":"file","max":"20MiB"},"language":{"kind":"text","optional":true},"meeting":{"inverse":"recordings","kind":"ref","owned":true,"to":"activities"},"segments":{"kind":"json","optional":true,"shape":{"fields":{"end":{"kind":"number"},"speaker":{"kind":"text"},"start":{"kind":"number"},"text":{"kind":"text"}},"kind":"object","many":true}},"title":{"kind":"text","optional":true},"transcription":{"default":"pending","kind":"enum","values":["pending","done","failed","unavailable"]},"transcription_error":{"kind":"text","optional":true}},"indexes":[{"on":["meeting"]}],"record_label":"record.title != null ? record.title : record.audio != null ? record.audio.name : \"Recording\""}'::jsonb);

-- step create:history:schema:offering_settings (additive)
select bolt_history_register('offering_settings','{"audit":true,"fields":{"offering_summary":{"format":"markdown","kind":"text","optional":true},"research_focus":{"format":"markdown","kind":"text","optional":true},"scope":{"default":"workspace","hidden":true,"kind":"enum","values":["workspace"]},"seller_name":{"kind":"text","optional":true}},"record_label":"record.seller_name != null ? record.seller_name : \"Seller profile\"","unique":[{"fields":["scope"],"name":"one_offering_settings"}]}'::jsonb);

-- step create:history:schema:products (additive)
select bolt_history_register('products','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"category":{"kind":"text","optional":true},"fit_criteria":{"format":"markdown","kind":"text","optional":true},"name":{"kind":"text"},"summary":{"format":"markdown","kind":"text","optional":true}},"indexes":[{"on":["category","name"]}],"record_label":"record.category != null ? record.category + \" · \" + record.name : record.name","search":{"text":["name","category","summary","fit_criteria"]}}'::jsonb);

-- step create:constraint:meeting_speakers.meeting_speakers__ex__72ed61d7 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "meeting_speakers" where ("recording" is not null) group by "recording", "label" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'meeting_speakers__ex__72ed61d7 refuses % existing row(s)', n; end if;
end $store$;
alter table "meeting_speakers" add constraint "meeting_speakers__ex__72ed61d7" exclude using btree ((coalesce("recording", '00000000-0000-0000-0000-000000000000'::uuid)) with =, ("recording" is null) with =, "label" with =) where ("recording" is not null) deferrable initially immediate;

-- step create:constraint:meeting_speakers.meeting_speakers__ex__072a1d55 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "meeting_speakers" where ("recording" is null) group by "meeting", "label" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'meeting_speakers__ex__072a1d55 refuses % existing row(s)', n; end if;
end $store$;
alter table "meeting_speakers" add constraint "meeting_speakers__ex__072a1d55" exclude using btree ("meeting" with =, "label" with =) where ("recording" is null) deferrable initially immediate;

-- step create:fk:meeting_recordings.meeting_recordings__fk__b684b326 (additive)
alter table "meeting_recordings" add constraint "meeting_recordings__fk__b684b326" foreign key ("meeting") references "activities" ("id") on delete cascade on update restrict;

-- step create:fk:meeting_speakers.meeting_speakers__fk__d6e18fb6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "meeting_speakers" c where c."recording" is not null and not exists (select 1 from "meeting_recordings" p where p."id" = c."recording")' into n;
	if n > 0 then raise exception 'meeting_speakers__fk__d6e18fb6 refuses % existing row(s)', n; end if;
end $store$;
alter table "meeting_speakers" add constraint "meeting_speakers__fk__d6e18fb6" foreign key ("recording") references "meeting_recordings" ("id") on delete cascade on update restrict;

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','agreement_settings','approval_request','calendar_entries','cohort_members','cohorts','communication_settings','companies','contacts','issues','meeting_recordings','meeting_speakers','notes','offering_settings','outreach_settings','potential_projects','products','project_documents','projects','sequences','signed_documents','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','tasks','template_documents']::text[]));

-- step replace:engine:audit:meeting_speakers (additive)
drop trigger if exists bolt_audit_mark on "meeting_speakers";
drop trigger if exists bolt_audit on "meeting_speakers";
create trigger bolt_audit after insert or update or delete on "meeting_speakers" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["meeting","activities"],["recording","meeting_recordings"]]','[["contact","contacts"],["meeting","activities"],["recording","meeting_recordings"]]');

-- step create:trigger:meeting_recordings.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "meeting_recordings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:meeting_recordings.meeting_recordings__gin__73732636 (additive)
create index "meeting_recordings__gin__73732636" on "meeting_recordings" using gin (bolt_search);

-- step create:index:meeting_recordings.meeting_recordings__ix__2a751893 (additive)
create index "meeting_recordings__ix__2a751893" on "meeting_recordings" ("meeting");

-- step create:trigger:offering_settings.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "offering_settings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:offering_settings.offering_settings__gin__73732636 (additive)
create index "offering_settings__gin__73732636" on "offering_settings" using gin (bolt_search);

-- step create:trigger:products.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "products" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:products.products__gin__73732636 (additive)
create index "products__gin__73732636" on "products" using gin (bolt_search);

-- step create:index:products.products__ix__b8e53549 (additive)
create index "products__ix__b8e53549" on "products" ("category", "name");

-- step create:index:meeting_speakers.meeting_speakers__ix__bfd4447e (additive)
-- operational risk: writes-blocked, table-scan
create index "meeting_speakers__ix__bfd4447e" on "meeting_speakers" ("recording");

-- step create:engine:audit:meeting_recordings (additive)
drop trigger if exists bolt_audit_mark on "meeting_recordings";
drop trigger if exists bolt_audit on "meeting_recordings";
create trigger bolt_audit after insert or update or delete on "meeting_recordings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["meeting","activities"]]','[["meeting","activities"]]');

-- step create:engine:audit:offering_settings (additive)
drop trigger if exists bolt_audit_mark on "offering_settings";
drop trigger if exists bolt_audit on "offering_settings";
create trigger bolt_audit after insert or update or delete on "offering_settings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step create:engine:audit:products (additive)
drop trigger if exists bolt_audit_mark on "products";
drop trigger if exists bolt_audit on "products";
create trigger bolt_audit after insert or update or delete on "products" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');
