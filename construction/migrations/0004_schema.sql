-- 0004_schema.sql: 58 step(s), from 963d11127b28c6215cc28827ae93d7b440b79fc548556645a32e415ae8c46464 to 2d284c149a659a01bc54f999b03c3aabd15ff251ba297e13eb2d720744f1d05e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:jobs_certification_types.jobs_certification_types__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "jobs_certification_types__gin__73732636";

-- step drop:index:jobs_site_locations.jobs_site_locations__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "jobs_site_locations__gin__73732636";

-- step drop:index:permits_to_work_certification_types.permits_to_work_certification_types__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "permits_to_work_certification_types__gin__73732636";

-- step drop:index:permits_to_work_workers.permits_to_work_workers__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "permits_to_work_workers__gin__73732636";

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "projects__gin__73732636";

-- step replace:index:job_assignments.job_assignments__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "job_assignments__gin__73732636";

-- step replace:index:site_locations.site_locations__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "site_locations__gin__73732636";

-- step replace:index:workers.workers__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "workers__gin__73732636";

-- step drop:column:job_assignments.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "job_assignments" drop column if exists "bolt_record_label" cascade;

-- step drop:column:jobs_certification_types.name (destructive)
-- accept: drop:column:jobs_certification_types.name
-- operational risk: access-exclusive-lock
alter table "jobs_certification_types" drop column if exists "name" cascade;

-- step drop:column:jobs_certification_types.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "jobs_certification_types" drop column if exists "bolt_record_label" cascade;

-- step drop:column:jobs_certification_types.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "jobs_certification_types" drop column if exists bolt_search cascade;

-- step drop:column:jobs_site_locations.name (destructive)
-- accept: drop:column:jobs_site_locations.name
-- operational risk: access-exclusive-lock
alter table "jobs_site_locations" drop column if exists "name" cascade;

-- step drop:column:jobs_site_locations.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "jobs_site_locations" drop column if exists "bolt_record_label" cascade;

-- step drop:column:jobs_site_locations.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "jobs_site_locations" drop column if exists bolt_search cascade;

-- step drop:column:permits_to_work_certification_types.name (destructive)
-- accept: drop:column:permits_to_work_certification_types.name
-- operational risk: access-exclusive-lock
alter table "permits_to_work_certification_types" drop column if exists "name" cascade;

-- step drop:column:permits_to_work_certification_types.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "permits_to_work_certification_types" drop column if exists "bolt_record_label" cascade;

-- step drop:column:permits_to_work_certification_types.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "permits_to_work_certification_types" drop column if exists bolt_search cascade;

-- step drop:column:permits_to_work_workers.name (destructive)
-- accept: drop:column:permits_to_work_workers.name
-- operational risk: access-exclusive-lock
alter table "permits_to_work_workers" drop column if exists "name" cascade;

-- step drop:column:permits_to_work_workers.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "permits_to_work_workers" drop column if exists "bolt_record_label" cascade;

-- step drop:column:permits_to_work_workers.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "permits_to_work_workers" drop column if exists bolt_search cascade;

-- step replace:column:projects.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "bolt_record_label" cascade;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists bolt_search cascade;

-- step replace:column:job_assignments.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "job_assignments" drop column if exists bolt_search cascade;

-- step replace:column:site_locations.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "site_locations" drop column if exists "bolt_record_label" cascade;

-- step replace:column:site_locations.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "site_locations" drop column if exists bolt_search cascade;

-- step replace:column:workers.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "workers" drop column if exists "bolt_record_label" cascade;

-- step replace:column:workers.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "workers" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_job_assignments_6dd9c366 (additive)
drop function if exists "bolt_record_label_job_assignments_6dd9c366"(text) cascade;

-- step drop:function:bolt_record_label_jobs_certification_typ_93340fdd (additive)
drop function if exists "bolt_record_label_jobs_certification_typ_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_jobs_site_locations_93340fdd (additive)
drop function if exists "bolt_record_label_jobs_site_locations_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_permits_to_work_certif_93340fdd (additive)
drop function if exists "bolt_record_label_permits_to_work_certif_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_permits_to_work_worker_93340fdd (additive)
drop function if exists "bolt_record_label_permits_to_work_worker_93340fdd"(text) cascade;

-- step drop:function:bolt_record_label_projects_ad9256b5 (additive)
drop function if exists "bolt_record_label_projects_ad9256b5"(text, text) cascade;

-- step drop:function:bolt_record_label_site_locations_604354fe (additive)
drop function if exists "bolt_record_label_site_locations_604354fe"(text, text) cascade;

-- step drop:function:bolt_record_label_workers_9880e3e2 (additive)
drop function if exists "bolt_record_label_workers_9880e3e2"(text, text) cascade;

-- step create:function:bolt_record_label_projects_20ce88de (additive)
create function "bolt_record_label_projects_20ce88de"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, coalesce((label_row.j #> ARRAY['project_name']), 'null'::jsonb) AS right_value) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['project_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('project_number', to_jsonb("project_number"), 'project_name', to_jsonb("project_name")) AS j FROM (SELECT $1 AS "project_name", $2 AS "project_number") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_site_locations_b8c81273 (additive)
create function "bolt_record_label_site_locations_b8c81273"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, coalesce((label_row.j #> ARRAY['location_name']), 'null'::jsonb) AS right_value) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['location_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('location_code', to_jsonb("location_code"), 'location_name', to_jsonb("location_name")) AS j FROM (SELECT $1 AS "location_code", $2 AS "location_name") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_workers_e447ce69 (additive)
create function "bolt_record_label_workers_e447ce69"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, coalesce((label_row.j #> ARRAY['worker_name']), 'null'::jsonb) AS right_value) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['worker_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('worker_number', to_jsonb("worker_number"), 'worker_name', to_jsonb("worker_name")) AS j FROM (SELECT $1 AS "worker_name", $2 AS "worker_number") label_inputs) label_row) label_value$record_label$;

-- step replace:column:projects.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "projects" add column "bolt_record_label" text generated always as ("bolt_record_label_projects_20ce88de"("project_name", "project_number")) stored;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "projects" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_projects_20ce88de"("project_name", "project_number"), '') || ' ' || coalesce("project_name"::text, '') || ' ' || coalesce("project_number"::text, ''))) stored;

-- step replace:column:job_assignments.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "job_assignments" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("assignment_code"::text, ''))) stored;

-- step replace:column:site_locations.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "site_locations" add column "bolt_record_label" text generated always as ("bolt_record_label_site_locations_b8c81273"("location_code", "location_name")) stored;

-- step replace:column:site_locations.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "site_locations" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_site_locations_b8c81273"("location_code", "location_name"), '') || ' ' || coalesce("location_code"::text, '') || ' ' || coalesce("location_name"::text, ''))) stored;

-- step replace:column:workers.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "workers" add column "bolt_record_label" text generated always as ("bolt_record_label_workers_e447ce69"("worker_name", "worker_number")) stored;

-- step replace:column:workers.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "workers" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_workers_e447ce69"("worker_name", "worker_number"), '') || ' ' || coalesce("worker_name"::text, '') || ' ' || coalesce("worker_number"::text, ''))) stored;

-- step replace:history:schema:projects (additive)
select bolt_history_register('projects','{"audit":true,"fields":{"address":{"kind":"custom","of":"project_address","optional":true},"client":{"kind":"text","optional":true},"contract_value":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency","optional":true},"description":{"kind":"text","optional":true},"main_contractor":{"kind":"text","optional":true},"project_manager":{"kind":"text","optional":true},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_type":{"kind":"text","optional":true},"schedule_range":{"kind":"period","of":"date","optional":true},"status":{"kind":"enum","optional":true,"values":["planned","active","on_hold","complete","cancelled"]}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

-- step replace:history:schema:job_assignments (additive)
select bolt_history_register('job_assignments','{"audit":true,"fields":{"assignment_code":{"kind":"text","optional":true},"assignment_range":{"kind":"period","of":"date","optional":true},"hours_per_day":{"kind":"decimal","optional":true,"scale":2},"job_id":{"inverse":"job_assignments","kind":"ref","optional":true,"to":"jobs"},"required_certifications":{"kind":"text","many":true,"optional":true},"role":{"kind":"text","optional":true},"site_location_id":{"inverse":"job_assignments","kind":"ref","to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["assigned","in_progress","completed","cancelled"]},"worker_id":{"inverse":"job_assignments","kind":"ref","to":"workers"}},"record_label":"record.worker_id.worker_name + '' · '' + record.site_location_id.location_name","search":{"text":["assignment_code"]}}'::jsonb);

-- step replace:history:schema:jobs_certification_types (additive)
select bolt_history_register('jobs_certification_types','{"audit":true,"fields":{"certification_type_id":{"inverse":"jobs_certification_types","kind":"ref","to":"certification_types"},"job_id":{"inverse":"jobs_certification_types","kind":"ref","to":"jobs"}},"record_label":"record.job_id.job_title + '' · '' + record.certification_type_id.certification_name"}'::jsonb);

-- step replace:history:schema:jobs_site_locations (additive)
select bolt_history_register('jobs_site_locations','{"audit":true,"fields":{"job_id":{"inverse":"jobs_site_locations","kind":"ref","to":"jobs"},"site_location_id":{"inverse":"jobs_site_locations","kind":"ref","to":"site_locations"}},"record_label":"record.job_id.job_title + '' · '' + record.site_location_id.location_name"}'::jsonb);

-- step replace:history:schema:permits_to_work_certification_types (additive)
select bolt_history_register('permits_to_work_certification_types','{"audit":true,"fields":{"certification_type_id":{"inverse":"permits_to_work_certification_types","kind":"ref","to":"certification_types"},"permits_to_work_id":{"inverse":"permits_to_work_certification_types","kind":"ref","to":"permits_to_work"}},"record_label":"record.permits_to_work_id.permit_number + '' · '' + record.certification_type_id.certification_name"}'::jsonb);

-- step replace:history:schema:permits_to_work_workers (additive)
select bolt_history_register('permits_to_work_workers','{"audit":true,"fields":{"permits_to_work_id":{"inverse":"permits_to_work_workers","kind":"ref","to":"permits_to_work"},"worker_id":{"inverse":"permits_to_work_workers","kind":"ref","to":"workers"}},"record_label":"record.permits_to_work_id.permit_number + '' · '' + record.worker_id.worker_name"}'::jsonb);

-- step replace:history:schema:site_locations (additive)
select bolt_history_register('site_locations','{"audit":true,"fields":{"bim_model_element_id":{"kind":"text","optional":true},"coordinates":{"kind":"custom","of":"site_coordinates","optional":true},"description":{"kind":"text","optional":true},"grid_reference":{"kind":"text","optional":true},"location_code":{"kind":"text","optional":true},"location_name":{"kind":"text"},"location_type":{"kind":"text","optional":true},"parent_location_id":{"inverse":"child_locations","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"project_id":{"inverse":"site_locations","kind":"ref","optional":true,"to":"projects"}},"record_label":"record.location_code != null ? record.location_code + '' · '' + record.location_name : record.location_name","search":{"text":["location_code","location_name"]},"unique":[{"fields":["location_code"],"name":"location_code"}]}'::jsonb);

-- step replace:history:schema:workers (additive)
select bolt_history_register('workers','{"audit":true,"fields":{"date_of_birth":{"kind":"date","optional":true},"email":{"kind":"text","optional":true},"emergency_contact":{"kind":"custom","of":"emergency_contact","optional":true},"medical_check_date":{"kind":"date","optional":true},"nationality":{"kind":"text","optional":true},"phone":{"kind":"text","optional":true},"safety_induction_date":{"kind":"date","optional":true},"status":{"kind":"enum","optional":true,"values":["active","inactive","suspended"]},"trade":{"kind":"text","optional":true},"work_permit_expiry":{"kind":"date","optional":true},"worker_name":{"kind":"text"},"worker_number":{"kind":"text","optional":true}},"record_label":"record.worker_number != null ? record.worker_number + '' · '' + record.worker_name : record.worker_name","search":{"text":["worker_name","worker_number"]},"unique":[{"fields":["worker_number"],"name":"worker_number"}]}'::jsonb);

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "projects__gin__73732636" on "projects" using gin (bolt_search);

-- step replace:index:job_assignments.job_assignments__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "job_assignments__gin__73732636" on "job_assignments" using gin (bolt_search);

-- step replace:index:site_locations.site_locations__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "site_locations__gin__73732636" on "site_locations" using gin (bolt_search);

-- step replace:index:workers.workers__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "workers__gin__73732636" on "workers" using gin (bolt_search);
