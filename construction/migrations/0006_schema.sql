-- 0006_schema.sql: 56 step(s), from c18dbf4b4a774a2b223a0e794c6cca6ec1850bb8ea9166113f932dde6d34c4a2 to 5e08351f0953c5fd1e36f5837dea83eb34fcc4f6003db1e60066d8203d1ac4a6.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:cost_estimates.cost_estimates__ix__aec2d15d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "cost_estimates__ix__aec2d15d";

-- step drop:index:issues.issues__ix__aec2d15d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "issues__ix__aec2d15d";

-- step replace:trigger:cost_estimates.store_row_rules (additive)
drop trigger if exists store_row_rules on "cost_estimates";

-- step replace:trigger:cost_estimates.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "cost_estimates";

-- step replace:trigger:cost_estimates.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "cost_estimates";

-- step drop:fk:cost_estimates.cost_estimates__fk__2f26968c (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop constraint if exists "cost_estimates__fk__2f26968c";

-- step drop:fk:issues.issues__fk__2f26968c (additive)
-- operational risk: access-exclusive-lock
alter table "issues" drop constraint if exists "issues__fk__2f26968c";

-- step drop:constraint:cost_estimates.cost_estimates__ck__215a918a (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop constraint if exists "cost_estimates__ck__215a918a";

-- step drop:constraint:cost_estimates.cost_estimates__ck__c3b7e1af (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop constraint if exists "cost_estimates__ck__c3b7e1af";

-- step drop:constraint:cost_estimates.cost_estimates__ck__bdb7294e (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop constraint if exists "cost_estimates__ck__bdb7294e";

-- step drop:constraint:project_files.project_files__ck__43a3b15a (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__ck__43a3b15a";

-- step drop:constraint:project_files.project_files__ck__09eccf25 (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__ck__09eccf25";

-- step drop:notNull:cost_estimates.additional_subtotal (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" alter column "additional_subtotal" drop not null;

-- step drop:default:cost_estimates.additional_subtotal (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" alter column "additional_subtotal" drop default;

-- step drop:column:cost_estimates.additional_costs (destructive)
-- accept: drop:column:cost_estimates.additional_costs
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop column if exists "additional_costs" cascade;

-- step drop:column:cost_estimates.additional_subtotal (destructive)
-- accept: drop:column:cost_estimates.additional_subtotal
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop column if exists "additional_subtotal" cascade;

-- step drop:column:project_files.bim_summary (destructive)
-- accept: drop:column:project_files.bim_summary
-- operational risk: access-exclusive-lock
alter table "project_files" drop column if exists "bim_summary" cascade;

-- step drop:column:cost_estimates.bim_file_id (destructive)
-- accept: drop:column:cost_estimates.bim_file_id
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop column if exists "bim_file_id" cascade;

-- step drop:column:issues.bim_file_id (destructive)
-- accept: drop:column:issues.bim_file_id
-- operational risk: access-exclusive-lock
alter table "issues" drop column if exists "bim_file_id" cascade;

-- step create:function:bolt_record_label_adhoc_costs_0ce906d9 (additive)
create or replace function "bolt_record_label_adhoc_costs_0ce906d9"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['cost_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['cost_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['cost_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['cost_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['cost_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('cost_number', to_jsonb("cost_number"), 'title', to_jsonb("title")) AS j FROM (SELECT $1 AS "cost_number", $2 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:adhoc_costs (additive)
create table "adhoc_costs" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"cost_number" text not null,
	"title" text not null,
	"category" text default 'preliminaries'::text not null,
	"status" text default 'draft' not null,
	"currency" text default 'SGD'::text not null,
	"unit" text default 'ls'::text not null,
	"qty" numeric default '1'::numeric not null,
	"unit_rate" numeric default '0'::numeric not null,
	"amount" numeric default '0'::numeric not null,
	"incurred_date" date,
	"notes" text,
	"attachments" jsonb,
	"bolt_record_label" text generated always as ("bolt_record_label_adhoc_costs_0ce906d9"("cost_number", "title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_adhoc_costs_0ce906d9"("cost_number", "title"), '') || ' ' || coalesce("cost_number"::text, '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("notes"::text, ''))) stored,
	"catalog_item_id" uuid not null,
	"project_id" uuid not null,
	"contact_id" uuid,
	constraint "adhoc_costs__uq__fe804d4a" unique nulls not distinct ("project_id", "cost_number") deferrable initially immediate,
	constraint "adhoc_costs__ck__1a97ea64" check ("category" in ('preliminaries', 'hoisting_logistics', 'permits_fees', 'testing_commissioning', 'temporary_works', 'overhead', 'other')),
	constraint "adhoc_costs__ck__01614b5f" check ("status" in ('approved', 'cancelled', 'draft', 'incurred')),
	constraint "adhoc_costs__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "adhoc_costs__ck__a3bdb72d" check ("qty" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("qty", 3) = "qty"),
	constraint "adhoc_costs__ck__5b9983cb" check ("unit_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("unit_rate", bolt_minor_units("currency")) = "unit_rate"),
	constraint "adhoc_costs__ck__8e360202" check ("amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("amount", bolt_minor_units("currency")) = "amount"),
	constraint "adhoc_costs__ck__a0448e01" check (isfinite("incurred_date")),
	constraint "adhoc_costs__ck__50e98387" check (("attachments" is null or store_json_valid("attachments", '{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}'::jsonb) is true)),
	constraint "adhoc_costs__ck__780e0467" check ((coalesce("qty" >= '0'::numeric, false))),
	constraint "adhoc_costs__ck__21f06763" check ((coalesce("unit_rate" >= '0'::numeric, false)))
);

-- step replace:history:schema:projects (additive)
select bolt_history_register('projects','{"audit":true,"check":{"valid_retention_cap":{"retention_cap_rate":{"gte":0,"lte":100}},"valid_retention_rate":{"retention_rate":{"gte":0,"lte":100}},"valid_tax_rate":{"tax_rate":{"gte":0,"lte":100}}},"fields":{"active_contract_count":{"kind":"count","of":"contracts","where":{"status":{"in":["under_review","active"]}}},"address":{"kind":"custom","of":"project_address","optional":true},"autodesk_project_id":{"kind":"text","optional":true},"bim_costing_dirty":{"default":false,"kind":"bool"},"bim_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"bim_revisions":{"kind":"custom","of":"revision_trail","optional":true},"bim_summary":{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}},"bim_version":{"kind":"text","optional":true},"capture_rules":{"format":"markdown","kind":"text","optional":true},"client":{"kind":"text","optional":true},"contract_value":{"currency":"currency","kind":"money","optional":true},"currency":{"default":"SGD","kind":"currency"},"description":{"format":"markdown","kind":"text","optional":true},"main_contractor":{"kind":"text","optional":true},"open_document_count":{"kind":"count","of":"commercial_documents","where":{"status":{"in":["issued","verified","certified","disputed"]}}},"open_issue_count":{"kind":"count","of":"issues","where":{"status":{"in":["open","in_progress","ready_for_verification"]}}},"open_task_count":{"kind":"count","of":"tasks","where":{"status":{"in":["todo","in_progress","blocked"]}}},"payment_terms_days":{"default":30,"kind":"int","max":180,"min":0},"project_manager":{"kind":"text","optional":true},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_role":{"default":"main_contractor","kind":"enum","values":["main_contractor","subcontractor","specialist_contractor"]},"project_type":{"kind":"text","optional":true},"retention_cap_rate":{"default":5,"kind":"decimal","scale":2},"retention_rate":{"default":10,"kind":"decimal","scale":2},"schedule_range":{"kind":"period","of":"date","optional":true},"status":{"initial":"active","kind":"state","states":{"active":{"to":["tendering","on_hold","defects_liability","complete","cancelled"]},"cancelled":{"to":["tendering","active"]},"complete":{"to":["defects_liability"]},"defects_liability":{"to":["complete","active"]},"on_hold":{"to":["active","cancelled"]},"tendering":{"to":["active","cancelled"]}}},"tax_rate":{"default":9,"kind":"decimal","scale":2},"zones":{"kind":"custom","of":"project_zones","optional":true}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number","client","main_contractor"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

-- step replace:history:schema:cost_estimates (additive)
select bolt_history_register('cost_estimates','{"audit":true,"check":{"valid_contingency":{"contingency_pct":{"gte":0,"lte":100}}},"fields":{"analyzed_at":{"kind":"instant","optional":true},"bim_asset_count":{"default":0,"kind":"int","min":0},"bim_assets":{"kind":"custom","of":"bim_takeoff","optional":true},"bim_subtotal":{"currency":"currency","default":0,"kind":"money"},"classified_asset_count":{"default":0,"kind":"int","min":0},"contingency_amount":{"currency":"currency","default":0,"kind":"money"},"contingency_pct":{"default":5,"kind":"decimal","scale":2},"contract_id":{"inverse":"cost_estimates","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"currency":{"default":"SGD","kind":"currency"},"estimate_number":{"kind":"seq","pattern":"EST-{yyyy}-{000}","per":["project_id"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"cost_estimates","kind":"ref","owned":true,"to":"projects"},"status":{"initial":"draft","kind":"state","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}},"title":{"kind":"text"},"total_estimate":{"currency":"currency","default":0,"kind":"money"},"unmatched_asset_count":{"default":0,"kind":"int","min":0}},"indexes":[{"on":["project_id","status"]}],"locks":{"baselined_locked":{"except":["status","notes"],"where":{"status":{"eq":"baselined"}}}},"record_label":"record.estimate_number != null ? record.estimate_number + '' · '' + record.title : record.title","search":{"text":["estimate_number","title","notes"]},"unique":[{"fields":["project_id"],"name":"one_per_project"}]}'::jsonb);

-- step replace:history:schema:issues (additive)
select bolt_history_register('issues','{"audit":true,"fields":{"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"bim_pin":{"kind":"custom","of":"bim_pin","optional":true},"closed_date":{"kind":"date","optional":true},"contract_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","kind":"text","optional":true},"due_date":{"kind":"date","optional":true},"issue_number":{"kind":"seq","pattern":"ISS-{yyyy}-{000}","per":["project_id"]},"kind":{"default":"defect","kind":"enum","values":["defect","rfi","clash","safety","snag"]},"party":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"photos":{"accept":["image/jpeg","image/png","image/webp"],"kind":"file","many":true,"max":"20MiB","optional":true},"project_id":{"inverse":"issues","kind":"ref","owned":true,"to":"projects"},"reported_by":{"kind":"text","optional":true},"reported_date":{"default":{"var":"today"},"kind":"date","optional":true},"resolution_notes":{"format":"markdown","kind":"text","optional":true},"severity":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"source_message_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"open","kind":"state","states":{"closed":{"to":["open"]},"in_progress":{"to":["open","ready_for_verification","closed"]},"open":{"to":["in_progress","ready_for_verification","closed"]},"ready_for_verification":{"to":["in_progress","closed"]}}},"task_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"tasks"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.issue_number != null ? record.issue_number + '' · '' + record.title : record.title","search":{"text":["issue_number","title","zone","description"]}}'::jsonb);

-- step replace:history:schema:project_files (additive)
select bolt_history_register('project_files','{"audit":true,"fields":{"autodesk_urn":{"kind":"text","optional":true},"current_version":{"default":"P01","kind":"text"},"discipline":{"kind":"enum","optional":true,"values":["architecture","structural","mep","civil","federated","commercial"]},"document_number":{"kind":"text"},"file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"kind":{"default":"drawing","kind":"enum","values":["drawing","spec","schedule","contract_doc","handover","autodesk_model"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"project_files","kind":"ref","owned":true,"to":"projects"},"revisions":{"kind":"custom","of":"revision_trail","optional":true},"status":{"initial":"draft","kind":"state","states":{"archived":{"to":["draft"]},"draft":{"to":["in_review","issued","archived"]},"in_review":{"to":["issued","draft","archived"]},"issued":{"to":["superseded","in_review","archived"]},"superseded":{"to":["archived"]}}},"title":{"kind":"text"},"zone":{"kind":"text","optional":true}},"record_label":"record.document_number != null ? record.document_number + '' · '' + record.title : record.title","search":{"text":["document_number","title","zone"]},"unique":[{"fields":["project_id","document_number"],"import_key":true,"name":"document_number"}]}'::jsonb);

-- step create:column:projects.bim_file (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_file" jsonb;

-- step create:column:projects.bim_version (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_version" text;

-- step create:column:projects.bim_revisions (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_revisions" jsonb;

-- step create:column:projects.bim_costing_dirty (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_costing_dirty" boolean default false;

-- step create:column:projects.bim_summary (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_summary" jsonb;

-- step create:history:schema:adhoc_costs (additive)
select bolt_history_register('adhoc_costs','{"audit":true,"check":{"non_negative_qty":{"qty":{"gte":0}},"non_negative_rate":{"unit_rate":{"gte":0}}},"fields":{"amount":{"currency":"currency","default":0,"kind":"money"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"catalog_item_id":{"inverse":"adhoc_costs","kind":"ref","on_delete":"restrict","to":"cost_matrix"},"category":{"default":"preliminaries","kind":"enum","values":["preliminaries","hoisting_logistics","permits_fees","testing_commissioning","temporary_works","overhead","other"]},"contact_id":{"inverse":"adhoc_costs","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"cost_number":{"kind":"seq","pattern":"ADH-{yyyy}-{000}","per":["project_id"]},"currency":{"default":"SGD","kind":"currency"},"incurred_date":{"kind":"date","optional":true},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"adhoc_costs","kind":"ref","owned":true,"to":"projects"},"qty":{"default":1,"kind":"decimal","scale":3},"status":{"initial":"draft","kind":"state","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}},"title":{"kind":"text"},"unit":{"default":"ls","kind":"text"},"unit_rate":{"currency":"currency","default":0,"kind":"money"}},"indexes":[{"on":["project_id","status"]}],"locks":{"settled_locked":{"except":["status","attachments","notes"],"where":{"status":{"in":["incurred","cancelled"]}}}},"record_label":"record.cost_number != null ? record.cost_number + '' · '' + record.title : record.title","search":{"text":["cost_number","title","notes"]}}'::jsonb);

-- step create:notNull:projects.bim_costing_dirty (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where "bim_costing_dirty" is null' into n;
	if n > 0 then raise exception 'notNull:projects.bim_costing_dirty refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" alter column "bim_costing_dirty" set not null;

-- step create:constraint:projects.projects__ck__7f12ec2a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_file" is null or store_json_valid("bim_file", ''{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__7f12ec2a refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__7f12ec2a" check (("bim_file" is null or store_json_valid("bim_file", '{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true}'::jsonb) is true));

-- step create:constraint:projects.projects__ck__ec01a341 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_revisions" is null or store_json_valid("bim_revisions", ''{"kind":"custom","of":"revision_trail","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__ec01a341 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__ec01a341" check (("bim_revisions" is null or store_json_valid("bim_revisions", '{"kind":"custom","of":"revision_trail","optional":true}'::jsonb) is true));

-- step create:constraint:projects.projects__ck__43a3b15a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_summary" is null or store_json_valid("bim_summary", ''{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__43a3b15a refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__43a3b15a" check (("bim_summary" is null or store_json_valid("bim_summary", '{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:cost_estimates.cost_estimates__ck__98c8e546 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "cost_estimates" where ("status" in (''baselined'', ''draft'', ''reviewed'', ''void'')) is false' into n;
	if n > 0 then raise exception 'cost_estimates__ck__98c8e546 refuses % existing row(s)', n; end if;
end $store$;
alter table "cost_estimates" add constraint "cost_estimates__ck__98c8e546" check ("status" in ('baselined', 'draft', 'reviewed', 'void'));

-- step create:constraint:cost_estimates.cost_estimates__uq__d3ad5ef2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "cost_estimates" where "project_id" is not null group by "project_id" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'cost_estimates__uq__d3ad5ef2 refuses % existing row(s)', n; end if;
end $store$;
alter table "cost_estimates" add constraint "cost_estimates__uq__d3ad5ef2" unique ("project_id") deferrable initially immediate;

-- step create:constraint:project_files.project_files__ck__ccbc6ec2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_files" where ("kind" in (''drawing'', ''spec'', ''schedule'', ''contract_doc'', ''handover'', ''autodesk_model'')) is false' into n;
	if n > 0 then raise exception 'project_files__ck__ccbc6ec2 refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" add constraint "project_files__ck__ccbc6ec2" check ("kind" in ('drawing', 'spec', 'schedule', 'contract_doc', 'handover', 'autodesk_model'));

-- step create:fk:adhoc_costs.adhoc_costs__fk__1e1e3665 (additive)
alter table "adhoc_costs" add constraint "adhoc_costs__fk__1e1e3665" foreign key ("catalog_item_id") references "cost_matrix" ("id") on delete restrict on update restrict;

-- step create:fk:adhoc_costs.adhoc_costs__fk__9ee6b710 (additive)
alter table "adhoc_costs" add constraint "adhoc_costs__fk__9ee6b710" foreign key ("project_id") references "projects" ("id") on delete cascade on update restrict;

-- step create:fk:adhoc_costs.adhoc_costs__fk__aa61b208 (additive)
alter table "adhoc_costs" add constraint "adhoc_costs__fk__aa61b208" foreign key ("contact_id") references "contacts" ("id") on delete set null on update restrict;

-- step replace:trigger:cost_estimates.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "cost_estimates" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}}}}');

-- step replace:trigger:cost_estimates.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "cost_estimates" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"contract_id":["contract_id"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = ''baselined''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}}}}');

-- step replace:trigger:cost_estimates.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "cost_estimates" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"contract_id":["contract_id"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = ''baselined''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}}}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_costs','approval_request','commercial_documents','communication_settings','contacts','contracts','cost_estimates','cost_matrix','issues','project_files','project_messages','projects','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','tasks']::text[]));

-- step replace:engine:audit:cost_estimates (additive)
drop trigger if exists bolt_audit_mark on "cost_estimates";
drop trigger if exists bolt_audit on "cost_estimates";
create trigger bolt_audit after insert or update or delete on "cost_estimates" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["contract_id","contracts"],["project_id","projects"]]');

-- step replace:engine:audit:issues (additive)
drop trigger if exists bolt_audit_mark on "issues";
drop trigger if exists bolt_audit on "issues";
create trigger bolt_audit after insert or update or delete on "issues" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["assignee","sys_user"],["contract_id","contracts"],["party","contacts"],["project_id","projects"],["source_message_id","project_messages"],["task_id","tasks"]]');

-- step create:trigger:adhoc_costs.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "adhoc_costs" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}}}}');

-- step create:trigger:adhoc_costs.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "adhoc_costs" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"attachments":["attachments"],"catalog_item_id":["catalog_item_id"],"category":["category"],"contact_id":["contact_id"],"currency":["currency"],"incurred_date":["incurred_date"],"notes":["notes"],"project_id":["project_id"],"qty":["qty"],"status":["status"],"title":["title"],"unit":["unit"],"unit_rate":["unit_rate"]},"key":["id"],"locks":[{"constraint":"adhoc_costs__lock__76283211","except":["status","attachments","notes"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''incurred''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}}}}');

-- step create:trigger:adhoc_costs.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "adhoc_costs" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"attachments":["attachments"],"catalog_item_id":["catalog_item_id"],"category":["category"],"contact_id":["contact_id"],"currency":["currency"],"incurred_date":["incurred_date"],"notes":["notes"],"project_id":["project_id"],"qty":["qty"],"status":["status"],"title":["title"],"unit":["unit"],"unit_rate":["unit_rate"]},"key":["id"],"locks":[{"constraint":"adhoc_costs__lock__76283211","except":["status","attachments","notes"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''incurred''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}}}}');

-- step create:index:adhoc_costs.adhoc_costs__gin__73732636 (additive)
create index "adhoc_costs__gin__73732636" on "adhoc_costs" using gin (bolt_search);

-- step create:index:adhoc_costs.adhoc_costs__ix__6cabdb6b (additive)
create index "adhoc_costs__ix__6cabdb6b" on "adhoc_costs" ("project_id", "status");

-- step create:index:adhoc_costs.adhoc_costs__ix__b02a6929 (additive)
create index "adhoc_costs__ix__b02a6929" on "adhoc_costs" ("catalog_item_id");

-- step create:index:adhoc_costs.adhoc_costs__ix__17a654f9 (additive)
create index "adhoc_costs__ix__17a654f9" on "adhoc_costs" ("project_id");

-- step create:index:adhoc_costs.adhoc_costs__ix__48bb0927 (additive)
create index "adhoc_costs__ix__48bb0927" on "adhoc_costs" ("contact_id");

-- step create:engine:audit:adhoc_costs (additive)
drop trigger if exists bolt_audit_mark on "adhoc_costs";
drop trigger if exists bolt_audit on "adhoc_costs";
create trigger bolt_audit after insert or update or delete on "adhoc_costs" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["catalog_item_id","cost_matrix"],["contact_id","contacts"],["project_id","projects"]]');
