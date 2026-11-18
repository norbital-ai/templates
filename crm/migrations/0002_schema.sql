-- 0002_schema.sql: 17 step(s), from 90f1f614087161e130d5eaa31c8373e65d63594e8da14af636c57ec62643dafd to fc9b59cac307bbfa87dfc6b0fbb844cebb79d308c704379745727ab2abb65c07.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:constraint:activities.activities__ck__eff1ac05 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__eff1ac05";

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

-- step replace:history:schema:companies (additive)
select bolt_history_register('companies','{"audit":true,"computed":{"company_key":{"expr":{"trim":{"regex_replace":[{"trim":{"regex_replace":[{"regex_replace":[{"lower":{"field":"name"}},"&"," and "]},"[^0-9a-zÀ-￿]+"," "]}},"( (private|pte|pvt|public|limited|ltd|sdn|bhd|berhad|inc|incorporated|llc|llp|lp|plc|pty|corp|corporation|co|company|gmbh|ag|sa|bv|nv|tbk|pt|jsc))+$",""]}},"kind":"text"},"uen_key":{"expr":{"upper":{"regex_replace":[{"field":"uen"},"[^A-Za-z0-9]",""]}},"kind":"text"}},"fields":{"address":{"kind":"text","optional":true},"description":{"kind":"text","optional":true},"documents":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"domain":{"kind":"text","optional":true},"follow_up_days":{"default":7,"kind":"int","max":90,"min":1},"industry":{"kind":"text","optional":true},"job_count":{"kind":"count","of":"projects"},"manual_fields":{"hidden":true,"kind":"enum","many":true,"optional":true,"values":["industry","description"]},"name":{"kind":"text"},"nda_required":{"kind":"bool","optional":true},"notes":{"format":"markdown","kind":"text","optional":true},"owner":{"default":{"var":"actor.id"},"kind":"ref","optional":true,"to":"sys_user"},"preferences":{"kind":"json","optional":true,"shape":{"fields":{"origin":{"hidden":true,"kind":"enum","optional":true,"values":["generated","manual"]},"preference":{"kind":"text"},"sources":{"hidden":true,"kind":"text","many":true,"optional":true},"topic":{"kind":"text"}},"kind":"object","many":true}},"profile_error":{"kind":"text","optional":true},"profiled_at":{"kind":"instant","optional":true},"progress":{"kind":"enum","optional":true,"values":["in_progress","maintenance"]},"region":{"kind":"text","optional":true},"research":{"format":"markdown","kind":"text","optional":true},"research_error":{"kind":"text","optional":true},"researched_at":{"kind":"instant","optional":true},"source":{"default":"manual","kind":"enum","values":["manual","csv","apollo"]},"stage":{"initial":"lead","kind":"state","states":{"client":{"to":["qualified"]},"lead":{"to":["qualified","client","lost"]},"lost":{"to":["lead","client"]},"qualified":{"to":["lead","client","lost"]}}},"uen":{"kind":"text","optional":true},"use_cases":{"kind":"text","many":true,"optional":true},"website":{"kind":"text","optional":true}},"indexes":[{"on":["stage"]}],"record_label":"record.name","search":{"text":["name","uen","domain"]},"unique":[{"fields":["company_key"],"name":"one_company"},{"fields":["domain"],"name":"one_company_per_domain"},{"fields":["uen_key"],"name":"one_company_per_uen"}]}'::jsonb);

-- step replace:history:schema:activities (additive)
select bolt_history_register('activities','{"audit":true,"fields":{"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"attendees":{"kind":"text","many":true,"optional":true},"calendar_account":{"kind":"ref","optional":true,"to":"sys_integration","where":{"integration":{"eq":"google_calendar"}}},"calendar_etag":{"hidden":true,"kind":"text","optional":true},"calendar_id":{"hidden":true,"kind":"text","optional":true},"calendar_manual":{"default":false,"kind":"bool"},"calendar_notify":{"default":false,"kind":"bool"},"calendar_revision":{"default":0,"hidden":true,"kind":"int"},"calendar_status":{"kind":"enum","optional":true,"values":["confirmed","tentative","cancelled"]},"classification":{"kind":"enum","optional":true,"values":["pending","useful","ignored","review"]},"classified_at":{"kind":"instant","optional":true},"classified_by":{"kind":"enum","optional":true,"values":["hard_filter","model","manual","calendar"]},"company":{"inverse":"activities","kind":"ref","optional":true,"to":"companies"},"contact_id":{"inverse":"activities","kind":"ref","optional":true,"to":"contacts"},"detail":{"format":"markdown","kind":"text","optional":true},"direction":{"kind":"enum","optional":true,"values":["inbound","outbound"]},"external_id":{"hidden":true,"kind":"text","optional":true},"handle":{"kind":"text","optional":true},"happened_on":{"kind":"date","optional":true},"kind":{"default":"note","kind":"enum","values":["note","recording","call","message","meeting","milestone"]},"language":{"kind":"text","optional":true},"location":{"kind":"text","optional":true},"notes":{"format":"markdown","kind":"text","optional":true},"notes_at":{"kind":"instant","optional":true},"occurred_at":{"default":{"var":"now"},"kind":"instant"},"owner":{"default":{"var":"actor.id"},"kind":"ref","optional":true,"to":"sys_user"},"project_id":{"inverse":"activities","kind":"ref","optional":true,"to":"projects"},"reason":{"kind":"text","optional":true},"recording":{"accept":["audio/*","video/*"],"kind":"file","max":"20MiB","optional":true},"scheduled_end_at":{"kind":"instant","optional":true},"scheduled_end_on":{"kind":"date","optional":true},"scheduled_start_at":{"kind":"instant","optional":true},"scheduled_start_on":{"kind":"date","optional":true},"segments":{"kind":"json","optional":true,"shape":{"fields":{"end":{"kind":"number"},"speaker":{"kind":"text"},"start":{"kind":"number"},"text":{"kind":"text"}},"kind":"object","many":true}},"source_calendar":{"inverse":"crm_activities","kind":"ref","on_delete":"set_null","optional":true,"to":"calendar_entries"},"source_key":{"hidden":true,"kind":"text","optional":true},"source_message":{"inverse":"crm_activities","kind":"ref","optional":true,"to":"sys_message"},"source_seq":{"hidden":true,"kind":"int","optional":true},"source_user":{"kind":"ref","optional":true,"to":"sys_user"},"status":{"initial":"open","kind":"state","states":{"cancelled":{"to":["open"]},"done":{"to":["open"]},"open":{"to":["done","cancelled"]}}},"subject":{"kind":"text"},"thread_key":{"hidden":true,"kind":"text","optional":true},"transcription":{"default":"none","kind":"enum","values":["none","pending","done","failed","unavailable"]},"transcription_error":{"kind":"text","optional":true},"transport":{"kind":"text","optional":true}},"indexes":[{"on":["occurred_at"]},{"on":["kind","status"]},{"on":["classification","source_seq"]},{"on":["source_user","occurred_at"]},{"on":["source_key","thread_key","occurred_at"]}],"record_label":"record.subject","search":{"text":["subject","detail","handle","company","project_id"]},"unique":[{"fields":["source_key","external_id"],"name":"one_activity_per_external_message","where":{"external_id":{"is_null":false},"source_calendar":{"is_null":true},"source_key":{"is_null":false}}},{"fields":["source_message"],"name":"one_activity_per_native_message"},{"fields":["source_calendar","external_id"],"name":"one_activity_per_calendar_event","where":{"external_id":{"is_null":false},"source_calendar":{"is_null":false}}}]}'::jsonb);

-- step replace:history:schema:project_documents (additive)
select bolt_history_register('project_documents','{"audit":true,"fields":{"attachment":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"company":{"inverse":"project_documents","kind":"ref","optional":true,"to":"companies"},"kind":{"kind":"enum","optional":true,"values":["brief","supporting"]},"markdown_body":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"documents","kind":"ref","optional":true,"to":"projects"},"received_on":{"kind":"date","optional":true},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

-- step create:column:sys_user.preferences (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" add column "preferences" jsonb default '{}'::jsonb;

-- step create:column:companies.documents (additive)
-- operational risk: access-exclusive-lock
alter table "companies" add column "documents" jsonb;

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

-- step create:constraint:companies.companies__ck__884ea79e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "companies" where (("documents" is null or store_json_valid("documents", ''{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'companies__ck__884ea79e refuses % existing row(s)', n; end if;
end $store$;
alter table "companies" add constraint "companies__ck__884ea79e" check (("documents" is null or store_json_valid("documents", '{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}'::jsonb) is true));

-- step create:constraint:activities.activities__ck__88438bdc (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" where ("kind" in (''note'', ''recording'', ''call'', ''message'', ''meeting'', ''milestone'')) is false' into n;
	if n > 0 then raise exception 'activities__ck__88438bdc refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__ck__88438bdc" check ("kind" in ('note', 'recording', 'call', 'message', 'meeting', 'milestone'));

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','agreement_settings','approval_request','calendar_entries','cohort_members','cohorts','communication_settings','companies','contacts','issues','meeting_speakers','notes','outreach_settings','potential_projects','project_documents','projects','sequences','signed_documents','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','tasks','template_documents']::text[]));

-- step create:trigger:sys_workspace.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "sys_workspace" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

-- step create:index:sys_workspace.sys_workspace__gin__73732636 (additive)
create index "sys_workspace__gin__73732636" on "sys_workspace" using gin (bolt_search);
