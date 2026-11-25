-- 0002_schema.sql: 86 step(s), from 5e08351f0953c5fd1e36f5837dea83eb34fcc4f6003db1e60066d8203d1ac4a6 to 634c058760601f8446fd7472c8426b20f54cc5482d4b3151dbb486f036f57e70.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:contacts.contacts__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__ix__17a654f9";

-- step drop:index:cost_estimates.cost_estimates__ix__b9b34d15 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "cost_estimates__ix__b9b34d15";

-- step drop:index:tasks.tasks__ix__8dc62d8e (additive)
-- operational risk: access-exclusive-lock
drop index if exists "tasks__ix__8dc62d8e";

-- step replace:trigger:projects.store_row_rules (additive)
drop trigger if exists store_row_rules on "projects";

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "projects__gin__73732636";

-- step replace:trigger:adhoc_costs.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "adhoc_costs";

-- step replace:trigger:adhoc_costs.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "adhoc_costs";

-- step replace:trigger:contracts.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "contracts";

-- step replace:trigger:contracts.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "contracts";

-- step replace:trigger:cost_estimates.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "cost_estimates";

-- step replace:trigger:cost_estimates.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "cost_estimates";

-- step drop:fk:contacts.contacts__fk__3944ff1a (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" drop constraint if exists "contacts__fk__3944ff1a";

-- step drop:fk:cost_estimates.cost_estimates__fk__bb99cd5e (additive)
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop constraint if exists "cost_estimates__fk__bb99cd5e";

-- step drop:fk:tasks.tasks__fk__cca5c980 (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" drop constraint if exists "tasks__fk__cca5c980";

-- step drop:constraint:adhoc_costs.adhoc_costs__ck__1a97ea64 (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_costs" drop constraint if exists "adhoc_costs__ck__1a97ea64";

-- step drop:constraint:contracts.contracts__ck__dd141558 (additive)
-- operational risk: access-exclusive-lock
alter table "contracts" drop constraint if exists "contracts__ck__dd141558";

-- step drop:constraint:contracts.contracts__ck__21644fae (additive)
-- operational risk: access-exclusive-lock
alter table "contracts" drop constraint if exists "contracts__ck__21644fae";

-- step drop:constraint:project_files.project_files__ck__21644fae (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__ck__21644fae";

-- step drop:constraint:projects.projects__ck__ec01a341 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__ec01a341";

-- step drop:constraint:projects.projects__ck__f966f864 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__f966f864";

-- step drop:constraint:projects.projects__ck__8e77f51d (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__8e77f51d";

-- step drop:constraint:projects.projects__ck__4f3f49c0 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__4f3f49c0";

-- step drop:constraint:projects.projects__ck__838fe290 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__838fe290";

-- step drop:constraint:projects.projects__ck__f4947005 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__f4947005";

-- step drop:constraint:projects.projects__ck__0808b8d0 (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__0808b8d0";

-- step drop:constraint:projects.projects__ck__949e3eec (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__949e3eec";

-- step drop:constraint:projects.projects__ck__243a7e7b (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__243a7e7b";

-- step drop:notNull:adhoc_costs.category (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_costs" alter column "category" drop not null;

-- step drop:notNull:contracts.current_revision (additive)
-- operational risk: access-exclusive-lock
alter table "contracts" alter column "current_revision" drop not null;

-- step drop:notNull:projects.payment_terms_days (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "payment_terms_days" drop not null;

-- step drop:notNull:projects.retention_cap_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "retention_cap_rate" drop not null;

-- step drop:notNull:projects.retention_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "retention_rate" drop not null;

-- step drop:notNull:projects.tax_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "tax_rate" drop not null;

-- step drop:default:adhoc_costs.category (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_costs" alter column "category" drop default;

-- step drop:default:contracts.current_revision (additive)
-- operational risk: access-exclusive-lock
alter table "contracts" alter column "current_revision" drop default;

-- step drop:default:projects.payment_terms_days (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "payment_terms_days" drop default;

-- step drop:default:projects.retention_cap_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "retention_cap_rate" drop default;

-- step drop:default:projects.retention_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "retention_rate" drop default;

-- step drop:default:projects.tax_rate (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "tax_rate" drop default;

-- step drop:column:adhoc_costs.category (destructive)
-- accept: drop:column:adhoc_costs.category
-- operational risk: access-exclusive-lock
alter table "adhoc_costs" drop column if exists "category" cascade;

-- step drop:column:contracts.current_revision (destructive)
-- accept: drop:column:contracts.current_revision
-- operational risk: access-exclusive-lock
alter table "contracts" drop column if exists "current_revision" cascade;

-- step drop:column:contracts.revisions (destructive)
-- accept: drop:column:contracts.revisions
-- operational risk: access-exclusive-lock
alter table "contracts" drop column if exists "revisions" cascade;

-- step drop:column:issues.reported_by (destructive)
-- accept: drop:column:issues.reported_by
-- operational risk: access-exclusive-lock
alter table "issues" drop column if exists "reported_by" cascade;

-- step drop:column:project_files.revisions (destructive)
-- accept: drop:column:project_files.revisions
-- operational risk: access-exclusive-lock
alter table "project_files" drop column if exists "revisions" cascade;

-- step drop:column:projects.bim_revisions (destructive)
-- accept: drop:column:projects.bim_revisions
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "bim_revisions" cascade;

-- step drop:column:projects.capture_rules (destructive)
-- accept: drop:column:projects.capture_rules
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "capture_rules" cascade;

-- step drop:column:projects.client (destructive)
-- accept: drop:column:projects.client
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "client" cascade;

-- step drop:column:projects.contract_value (destructive)
-- accept: drop:column:projects.contract_value
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "contract_value" cascade;

-- step drop:column:projects.main_contractor (destructive)
-- accept: drop:column:projects.main_contractor
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "main_contractor" cascade;

-- step drop:column:projects.payment_terms_days (destructive)
-- accept: drop:column:projects.payment_terms_days
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "payment_terms_days" cascade;

-- step drop:column:projects.project_type (destructive)
-- accept: drop:column:projects.project_type
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "project_type" cascade;

-- step drop:column:projects.retention_cap_rate (destructive)
-- accept: drop:column:projects.retention_cap_rate
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "retention_cap_rate" cascade;

-- step drop:column:projects.retention_rate (destructive)
-- accept: drop:column:projects.retention_rate
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "retention_rate" cascade;

-- step drop:column:projects.tax_rate (destructive)
-- accept: drop:column:projects.tax_rate
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "tax_rate" cascade;

-- step drop:column:contacts.project_id (destructive)
-- accept: drop:column:contacts.project_id
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "project_id" cascade;

-- step drop:column:cost_estimates.contract_id (destructive)
-- accept: drop:column:cost_estimates.contract_id
-- operational risk: access-exclusive-lock
alter table "cost_estimates" drop column if exists "contract_id" cascade;

-- step drop:column:tasks.parent_task_id (destructive)
-- accept: drop:column:tasks.parent_task_id
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists "parent_task_id" cascade;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists bolt_search cascade;

-- step replace:column:projects.project_manager (destructive)
-- accept: replace:column:projects.project_manager
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "project_manager" cascade;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "projects" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_projects_20ce88de"("project_name", "project_number"), '') || ' ' || coalesce("project_name"::text, '') || ' ' || coalesce("project_number"::text, ''))) stored;

-- step replace:column:projects.project_manager (destructive)
-- accept: replace:column:projects.project_manager
-- operational risk: access-exclusive-lock
alter table "projects" add column "project_manager" text;

-- step replace:history:schema:contacts (additive)
select bolt_history_register('contacts','{"audit":true,"computed":{"email_key":{"expr":{"lower":{"field":"email"}},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"company_name":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"full_name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms_days":{"kind":"int","max":180,"min":0,"optional":true},"phone":{"format":"phone","kind":"text","optional":true},"registration_no":{"kind":"text","optional":true},"role":{"default":"subcontractor","kind":"enum","values":["subcontractor","supplier","main_contractor","client","consultant","architect","qs","site_engineer","project_manager"]},"status":{"default":"active","kind":"enum","values":["active","inactive"]},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]}},"indexes":[{"on":["email_key"]},{"on":["phone_key"]},{"on":["trade_specialty","role"]}],"record_label":"record.company_name != null ? record.company_name + '' · '' + record.full_name : record.full_name","search":{"text":["full_name","company_name","phone","email","registration_no"]}}'::jsonb);

-- step replace:history:schema:projects (additive)
select bolt_history_register('projects','{"audit":true,"fields":{"active_contract_count":{"kind":"count","of":"contracts","where":{"status":{"in":["under_review","active"]}}},"address":{"kind":"custom","of":"project_address","optional":true},"autodesk_project_id":{"kind":"text","optional":true},"bim_costing_dirty":{"default":false,"kind":"bool"},"bim_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"bim_summary":{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}},"bim_version":{"kind":"text","optional":true},"client_id":{"inverse":"client_projects","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"currency":{"default":"SGD","kind":"currency"},"description":{"format":"markdown","kind":"text","optional":true},"open_document_count":{"kind":"count","of":"commercial_documents","where":{"status":{"in":["issued","verified","certified","disputed"]}}},"open_issue_count":{"kind":"count","of":"issues","where":{"status":{"in":["open","in_progress","ready_for_verification"]}}},"open_task_count":{"kind":"count","of":"tasks","where":{"status":{"in":["todo","in_progress","blocked"]}}},"project_manager":{"kind":"ref","optional":true,"to":"sys_user"},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_role":{"default":"main_contractor","kind":"enum","values":["main_contractor","subcontractor","specialist_contractor"]},"schedule_range":{"kind":"period","of":"date","optional":true},"status":{"initial":"active","kind":"state","states":{"active":{"to":["tendering","on_hold","defects_liability","complete","cancelled"]},"cancelled":{"to":["tendering","active"]},"complete":{"to":["defects_liability"]},"defects_liability":{"to":["complete","active"]},"on_hold":{"to":["active","cancelled"]},"tendering":{"to":["active","cancelled"]}}},"zones":{"kind":"custom","of":"project_zones","optional":true}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

-- step replace:history:schema:adhoc_costs (additive)
select bolt_history_register('adhoc_costs','{"audit":true,"check":{"non_negative_qty":{"qty":{"gte":0}},"non_negative_rate":{"unit_rate":{"gte":0}}},"fields":{"amount":{"currency":"currency","default":0,"kind":"money"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"catalog_item_id":{"inverse":"adhoc_costs","kind":"ref","on_delete":"restrict","to":"cost_matrix"},"contact_id":{"inverse":"adhoc_costs","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"cost_number":{"kind":"seq","pattern":"ADH-{yyyy}-{000}","per":["project_id"]},"currency":{"default":"SGD","kind":"currency"},"incurred_date":{"kind":"date","optional":true},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"adhoc_costs","kind":"ref","owned":true,"to":"projects"},"qty":{"default":1,"kind":"decimal","scale":3},"status":{"initial":"draft","kind":"state","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}},"title":{"kind":"text"},"unit":{"default":"ls","kind":"text"},"unit_rate":{"currency":"currency","default":0,"kind":"money"}},"indexes":[{"on":["project_id","status"]}],"locks":{"settled_locked":{"except":["status","attachments","notes"],"where":{"status":{"in":["incurred","cancelled"]}}}},"record_label":"record.cost_number != null ? record.cost_number + '' · '' + record.title : record.title","search":{"text":["cost_number","title","notes"]}}'::jsonb);

-- step replace:history:schema:contracts (additive)
select bolt_history_register('contracts','{"audit":true,"check":{"valid_retention_cap":{"retention_cap_rate":{"gte":0,"lte":100}},"valid_retention_rate":{"retention_rate":{"gte":0,"lte":100}},"valid_tax_rate":{"tax_rate":{"gte":0,"lte":100}}},"fields":{"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"bim_pin":{"kind":"custom","of":"bim_pin","optional":true},"bond_amount":{"currency":"currency","kind":"money","optional":true},"contact_id":{"inverse":"contracts","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"contract_number":{"kind":"seq","pattern":"CTR-{yyyy}-{000}","per":["project_id"]},"contract_period":{"kind":"period","of":"date","optional":true},"contract_type":{"default":"subcontract","kind":"enum","values":["main_contract","subcontract","supply_agreement","consultancy","variation_order"]},"contract_value":{"currency":"currency","default":0,"kind":"money"},"currency":{"default":"SGD","kind":"currency"},"direction":{"default":"downstream","kind":"enum","values":["upstream","downstream"]},"dlp_months":{"default":12,"kind":"int","max":60,"min":0},"insurance_expiry":{"kind":"date","optional":true},"lines":{"kind":"custom","of":"priced_lines","optional":true},"parent_contract_id":{"inverse":"variations","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"payment_terms_days":{"default":30,"kind":"int","max":180,"min":0},"project_id":{"inverse":"contracts","kind":"ref","owned":true,"to":"projects"},"retention_cap_rate":{"default":5,"kind":"decimal","scale":2},"retention_rate":{"default":10,"kind":"decimal","scale":2},"schedule_impact_days":{"default":0,"kind":"int"},"scope_notes":{"format":"markdown","kind":"text","optional":true},"signed_date":{"kind":"date","optional":true},"source_message_id":{"inverse":"contracts","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"draft","kind":"state","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}},"tax_rate":{"default":9,"kind":"decimal","scale":2},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]}},"indexes":[{"on":["project_id","direction","status"]}],"locks":{"active_locked":{"except":["status","insurance_expiry","attachments","scope_notes"],"where":{"status":{"eq":"active"}}},"review_locked":{"except":["status","signed_date","attachments","scope_notes"],"where":{"status":{"eq":"under_review"}}},"settled_locked":{"except":["attachments"],"where":{"status":{"in":["completed","terminated"]}}}},"record_label":"record.contract_number != null ? record.contract_number + '' · '' + record.title : record.title","search":{"text":["contract_number","title","scope_notes"]}}'::jsonb);

-- step replace:history:schema:cost_estimates (additive)
select bolt_history_register('cost_estimates','{"audit":true,"check":{"valid_contingency":{"contingency_pct":{"gte":0,"lte":100}}},"fields":{"analyzed_at":{"kind":"instant","optional":true},"bim_asset_count":{"default":0,"kind":"int","min":0},"bim_assets":{"kind":"custom","of":"bim_takeoff","optional":true},"bim_subtotal":{"currency":"currency","default":0,"kind":"money"},"classified_asset_count":{"default":0,"kind":"int","min":0},"contingency_amount":{"currency":"currency","default":0,"kind":"money"},"contingency_pct":{"default":5,"kind":"decimal","scale":2},"currency":{"default":"SGD","kind":"currency"},"estimate_number":{"kind":"seq","pattern":"EST-{yyyy}-{000}","per":["project_id"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"cost_estimates","kind":"ref","owned":true,"to":"projects"},"status":{"initial":"draft","kind":"state","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}},"title":{"kind":"text"},"total_estimate":{"currency":"currency","default":0,"kind":"money"},"unmatched_asset_count":{"default":0,"kind":"int","min":0}},"indexes":[{"on":["project_id","status"]}],"locks":{"baselined_locked":{"except":["status","notes"],"where":{"status":{"eq":"baselined"}}}},"record_label":"record.estimate_number != null ? record.estimate_number + '' · '' + record.title : record.title","search":{"text":["estimate_number","title","notes"]},"unique":[{"fields":["project_id"],"name":"one_per_project"}]}'::jsonb);

-- step replace:history:schema:issues (additive)
select bolt_history_register('issues','{"audit":true,"fields":{"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"bim_pin":{"kind":"custom","of":"bim_pin","optional":true},"closed_date":{"kind":"date","optional":true},"contract_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","kind":"text","optional":true},"due_date":{"kind":"date","optional":true},"issue_number":{"kind":"seq","pattern":"ISS-{yyyy}-{000}","per":["project_id"]},"kind":{"default":"defect","kind":"enum","values":["defect","rfi","clash","safety","snag"]},"party":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"photos":{"accept":["image/jpeg","image/png","image/webp"],"kind":"file","many":true,"max":"20MiB","optional":true},"project_id":{"inverse":"issues","kind":"ref","owned":true,"to":"projects"},"reported_date":{"default":{"var":"today"},"kind":"date","optional":true},"resolution_notes":{"format":"markdown","kind":"text","optional":true},"severity":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"source_message_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"open","kind":"state","states":{"closed":{"to":["open"]},"in_progress":{"to":["open","ready_for_verification","closed"]},"open":{"to":["in_progress","ready_for_verification","closed"]},"ready_for_verification":{"to":["in_progress","closed"]}}},"task_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"tasks"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.issue_number != null ? record.issue_number + '' · '' + record.title : record.title","search":{"text":["issue_number","title","zone","description"]}}'::jsonb);

-- step replace:history:schema:project_files (additive)
select bolt_history_register('project_files','{"audit":true,"fields":{"autodesk_urn":{"kind":"text","optional":true},"current_version":{"default":"P01","kind":"text"},"discipline":{"kind":"enum","optional":true,"values":["architecture","structural","mep","civil","federated","commercial"]},"document_number":{"kind":"text"},"file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"kind":{"default":"drawing","kind":"enum","values":["drawing","spec","schedule","contract_doc","handover","autodesk_model"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"project_files","kind":"ref","owned":true,"to":"projects"},"status":{"initial":"draft","kind":"state","states":{"archived":{"to":["draft"]},"draft":{"to":["in_review","issued","archived"]},"in_review":{"to":["issued","draft","archived"]},"issued":{"to":["superseded","in_review","archived"]},"superseded":{"to":["archived"]}}},"title":{"kind":"text"},"zone":{"kind":"text","optional":true}},"record_label":"record.document_number != null ? record.document_number + '' · '' + record.title : record.title","search":{"text":["document_number","title","zone"]},"unique":[{"fields":["project_id","document_number"],"import_key":true,"name":"document_number"}]}'::jsonb);

-- step replace:history:schema:tasks (additive)
select bolt_history_register('tasks','{"audit":true,"check":{"valid_progress":{"progress_pct":{"gte":0,"lte":100}}},"fields":{"actual_range":{"kind":"period","of":"date","optional":true},"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"baseline_range":{"kind":"period","of":"date","optional":true},"bim_express_ids":{"kind":"int","many":true,"optional":true},"contract_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","kind":"text","optional":true},"external_id":{"kind":"text","optional":true},"is_milestone":{"default":false,"kind":"bool"},"last_updated_on":{"kind":"date","optional":true},"latest_update":{"kind":"text","optional":true},"priority":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"progress_pct":{"default":0,"kind":"decimal","scale":1},"project_id":{"inverse":"tasks","kind":"ref","owned":true,"to":"projects"},"schedule_range":{"kind":"period","of":"date","optional":true},"source_message_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"todo","kind":"state","states":{"blocked":{"to":["in_progress","todo","cancelled"]},"cancelled":{"to":["todo"]},"done":{"to":["in_progress"]},"in_progress":{"to":["blocked","done","todo","cancelled"]},"todo":{"to":["in_progress","blocked","done","cancelled"]}}},"subcontractor_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"task_code":{"kind":"text"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"wbs_path":{"kind":"text","optional":true},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.task_code != null ? record.task_code + '' · '' + record.title : record.title","search":{"text":["task_code","wbs_path","title","zone","latest_update"]},"unique":[{"fields":["project_id","task_code"],"import_key":true,"name":"task_code"}]}'::jsonb);

-- step create:column:projects.client_id (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "client_id" uuid;

-- step create:fk:projects.projects__fk__834f5177 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" c where c."client_id" is not null and not exists (select 1 from "contacts" p where p."id" = c."client_id")' into n;
	if n > 0 then raise exception 'projects__fk__834f5177 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__fk__834f5177" foreign key ("client_id") references "contacts" ("id") on delete set null on update restrict;

-- step create:fk:projects.projects__fk__1b1f0b5a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" c where c."project_manager" is not null and not exists (select 1 from "sys_user" p where p."id" = c."project_manager")' into n;
	if n > 0 then raise exception 'projects__fk__1b1f0b5a refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__fk__1b1f0b5a" foreign key ("project_manager") references "sys_user" ("id") on delete restrict on update restrict;

-- step replace:trigger:projects.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "projects" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"active","states":{"active":{"to":["tendering","on_hold","defects_liability","complete","cancelled"]},"cancelled":{"to":["tendering","active"]},"complete":{"to":["defects_liability"]},"defects_liability":{"to":["complete","active"]},"on_hold":{"to":["active","cancelled"]},"tendering":{"to":["active","cancelled"]}}}}}');

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "projects__gin__73732636" on "projects" using gin (bolt_search);

-- step replace:trigger:adhoc_costs.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "adhoc_costs" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"attachments":["attachments"],"catalog_item_id":["catalog_item_id"],"contact_id":["contact_id"],"currency":["currency"],"incurred_date":["incurred_date"],"notes":["notes"],"project_id":["project_id"],"qty":["qty"],"status":["status"],"title":["title"],"unit":["unit"],"unit_rate":["unit_rate"]},"key":["id"],"locks":[{"constraint":"adhoc_costs__lock__76283211","except":["status","attachments","notes"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''incurred''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}}}}');

-- step replace:trigger:adhoc_costs.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "adhoc_costs" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"amount":["amount"],"attachments":["attachments"],"catalog_item_id":["catalog_item_id"],"contact_id":["contact_id"],"currency":["currency"],"incurred_date":["incurred_date"],"notes":["notes"],"project_id":["project_id"],"qty":["qty"],"status":["status"],"title":["title"],"unit":["unit"],"unit_rate":["unit_rate"]},"key":["id"],"locks":[{"constraint":"adhoc_costs__lock__76283211","except":["status","attachments","notes"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''incurred''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"approved":{"to":["incurred","draft","cancelled"]},"cancelled":{"to":["draft"]},"draft":{"to":["approved","cancelled"]},"incurred":{"to":[]}}}}}');

-- step replace:trigger:contracts.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "contracts" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"bim_pin":["bim_pin"],"bond_amount":["bond_amount"],"contact_id":["contact_id"],"contract_period":["contract_period"],"contract_type":["contract_type"],"contract_value":["contract_value"],"currency":["currency"],"direction":["direction"],"dlp_months":["dlp_months"],"insurance_expiry":["insurance_expiry"],"lines":["lines"],"parent_contract_id":["parent_contract_id"],"payment_terms_days":["payment_terms_days"],"project_id":["project_id"],"retention_cap_rate":["retention_cap_rate"],"retention_rate":["retention_rate"],"schedule_impact_days":["schedule_impact_days"],"scope_notes":["scope_notes"],"signed_date":["signed_date"],"source_message_id":["source_message_id"],"status":["status"],"tax_rate":["tax_rate"],"title":["title"],"trade_specialty":["trade_specialty"]},"key":["id"],"locks":[{"constraint":"contracts__lock__74d50c59","except":["status","insurance_expiry","attachments","scope_notes"],"name":"active_locked","sql":"(coalesce(t.\"status\" = ''active''::text, false))"},{"constraint":"contracts__lock__18cd013f","except":["status","signed_date","attachments","scope_notes"],"name":"review_locked","sql":"(coalesce(t.\"status\" = ''under_review''::text, false))"},{"constraint":"contracts__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''terminated''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}}}}');

-- step replace:trigger:contracts.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "contracts" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"bim_pin":["bim_pin"],"bond_amount":["bond_amount"],"contact_id":["contact_id"],"contract_period":["contract_period"],"contract_type":["contract_type"],"contract_value":["contract_value"],"currency":["currency"],"direction":["direction"],"dlp_months":["dlp_months"],"insurance_expiry":["insurance_expiry"],"lines":["lines"],"parent_contract_id":["parent_contract_id"],"payment_terms_days":["payment_terms_days"],"project_id":["project_id"],"retention_cap_rate":["retention_cap_rate"],"retention_rate":["retention_rate"],"schedule_impact_days":["schedule_impact_days"],"scope_notes":["scope_notes"],"signed_date":["signed_date"],"source_message_id":["source_message_id"],"status":["status"],"tax_rate":["tax_rate"],"title":["title"],"trade_specialty":["trade_specialty"]},"key":["id"],"locks":[{"constraint":"contracts__lock__74d50c59","except":["status","insurance_expiry","attachments","scope_notes"],"name":"active_locked","sql":"(coalesce(t.\"status\" = ''active''::text, false))"},{"constraint":"contracts__lock__18cd013f","except":["status","signed_date","attachments","scope_notes"],"name":"review_locked","sql":"(coalesce(t.\"status\" = ''under_review''::text, false))"},{"constraint":"contracts__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''terminated''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}}}}');

-- step replace:trigger:cost_estimates.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "cost_estimates" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = ''baselined''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}}}}');

-- step replace:trigger:cost_estimates.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "cost_estimates" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = ''baselined''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["draft","void"]},"draft":{"to":["reviewed","baselined","void"]},"reviewed":{"to":["baselined","draft","void"]},"void":{"to":["draft"]}}}}}');

-- step replace:engine:audit:contacts (additive)
drop trigger if exists bolt_audit_mark on "contacts";
drop trigger if exists bolt_audit on "contacts";
create trigger bolt_audit after insert or update or delete on "contacts" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step replace:engine:audit:projects (additive)
drop trigger if exists bolt_audit_mark on "projects";
drop trigger if exists bolt_audit on "projects";
create trigger bolt_audit after insert or update or delete on "projects" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["client_id","contacts"],["project_manager","sys_user"]]');

-- step replace:engine:audit:cost_estimates (additive)
drop trigger if exists bolt_audit_mark on "cost_estimates";
drop trigger if exists bolt_audit on "cost_estimates";
create trigger bolt_audit after insert or update or delete on "cost_estimates" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["project_id","projects"]]');

-- step replace:engine:audit:tasks (additive)
drop trigger if exists bolt_audit_mark on "tasks";
drop trigger if exists bolt_audit on "tasks";
create trigger bolt_audit after insert or update or delete on "tasks" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["assignee","sys_user"],["contract_id","contracts"],["project_id","projects"],["source_message_id","project_messages"],["subcontractor_id","contacts"]]');

-- step create:index:projects.projects__ix__46eae505 (additive)
-- operational risk: writes-blocked, table-scan
create index "projects__ix__46eae505" on "projects" ("client_id");

-- step create:index:projects.projects__ix__7c605414 (additive)
-- operational risk: writes-blocked, table-scan
create index "projects__ix__7c605414" on "projects" ("project_manager");
