-- 0007_schema.sql: 40 step(s), from d15d806febb6b2346a7ba6535b4f47ef1e4216f0959c4a17290c30eaaf68476c to b8cd8b9d55b2c6eb92952b1e4e098fdcb02090b529fddabe2f93a42684d48744.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:jurisdiction_settings.store_row_rules (additive)
drop trigger if exists store_row_rules on "jurisdiction_settings";

-- step replace:trigger:adhoc_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "adhoc_catalog";

-- step replace:trigger:claim_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog";

-- step replace:trigger:leave_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog";

-- step replace:trigger:loan_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "loan_catalog";

-- step replace:trigger:work_interruption_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "work_interruption_catalog";

-- step replace:trigger:workplace_case_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "workplace_case_catalog";

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "allowance_catalog";

-- step replace:trigger:overtime_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "overtime_catalog";

-- step replace:trigger:statutory_contribution_catalog.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_contribution_catalog";

-- step replace:trigger:registered_effect.store_row_rules (additive)
drop trigger if exists store_row_rules on "registered_effect";

-- step replace:trigger:registered_rule.store_row_rules (additive)
drop trigger if exists store_row_rules on "registered_rule";

-- step replace:trigger:subtotal.store_row_rules (additive)
drop trigger if exists store_row_rules on "subtotal";

-- step create:function:bolt_record_label_statutory_change_b26ebd75 (additive)
create function "bolt_record_label_statutory_change_b26ebd75"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['field_path']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('field_path', to_jsonb("field_path")) AS j FROM (SELECT $1 AS "field_path") label_inputs) label_row) label_value$record_label$;

-- step create:table:statutory_change (additive)
create table "statutory_change" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"jurisdiction_code" text not null,
	"family" text not null,
	"row_code" text,
	"field_path" text not null,
	"old_value" jsonb,
	"new_value" jsonb,
	"effective_from" date,
	"announced_on" date,
	"status" text default 'PROPOSED' not null,
	"source_urls" jsonb not null,
	"source_quote" text,
	"verified_on" date,
	"research_run_id" text,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_statutory_change_b26ebd75"("field_path")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_statutory_change_b26ebd75"("field_path"), ''))) stored,
	"verified_by" text,
	"baseline_version_id" uuid not null,
	"applied_version_id" uuid,
	constraint "statutory_change__ck__ae52c15d" check (("old_value" is null or store_json_valid("old_value", '{"kind":"json","optional":true}'::jsonb) is true)),
	constraint "statutory_change__ck__73129686" check (("new_value" is null or store_json_valid("new_value", '{"kind":"json","optional":true}'::jsonb) is true)),
	constraint "statutory_change__ck__30e69ba6" check (isfinite("effective_from")),
	constraint "statutory_change__ck__eeef1ebb" check (isfinite("announced_on")),
	constraint "statutory_change__ck__928cafd6" check ("status" in ('APPLIED', 'CONFIRMED', 'PROPOSED', 'REJECTED')),
	constraint "statutory_change__ck__2869228f" check (("source_urls" is null or store_json_valid("source_urls", '{"kind":"list","of":{"kind":"text"}}'::jsonb) is true)),
	constraint "statutory_change__ck__cc788915" check (isfinite("verified_on"))
);

-- step replace:history:schema:jurisdiction_settings (additive)
select bolt_history_register('jurisdiction_settings','{"audit":true,"fields":{"code":{"kind":"text"},"currency":{"kind":"currency"},"effective_range":{"kind":"period","of":"date"},"employee_extension_schema":{"kind":"json","optional":true},"entity_extension_schema":{"kind":"json","optional":true},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"reason":{"kind":"text","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"tax_year_start_month":{"kind":"int","max":12,"min":1},"timezone":{"format":"zone","kind":"text"}},"nativeRules":2,"noOverlap":[{"key":["code"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"record.name"}'::jsonb);

-- step create:history:schema:statutory_change (additive)
select bolt_history_register('statutory_change','{"audit":true,"fields":{"announced_on":{"kind":"date","optional":true},"applied_version_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"jurisdiction_settings"},"baseline_version_id":{"inverse":"statutory_changes","kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"effective_from":{"kind":"date","optional":true},"family":{"kind":"text"},"field_path":{"kind":"text"},"jurisdiction_code":{"kind":"text"},"new_value":{"kind":"json","optional":true},"notes":{"kind":"text","optional":true},"old_value":{"kind":"json","optional":true},"research_run_id":{"kind":"text","optional":true},"row_code":{"kind":"text","optional":true},"source_quote":{"kind":"text","optional":true},"source_urls":{"kind":"list","of":{"kind":"text"}},"status":{"initial":"PROPOSED","kind":"state","states":{"APPLIED":{"edit":"none","to":[]},"CONFIRMED":{"edit":["applied_version_id","status"],"to":["APPLIED","REJECTED"]},"PROPOSED":{"edit":["new_value","effective_from","announced_on","source_urls","source_quote","notes","verified_on","verified_by","status"],"to":["CONFIRMED","REJECTED"]},"REJECTED":{"edit":"none","to":[]}}},"verified_by":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"},"verified_on":{"kind":"date","optional":true}},"nativeRules":2,"recordLabel":"record.field_path"}'::jsonb);

-- step create:fk:statutory_change.statutory_change__fk__d42a73ec (additive)
alter table "statutory_change" add constraint "statutory_change__fk__d42a73ec" foreign key ("verified_by") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:statutory_change.statutory_change__fk__038739e1 (additive)
alter table "statutory_change" add constraint "statutory_change__fk__038739e1" foreign key ("baseline_version_id") references "jurisdiction_settings" ("id") on delete restrict on update restrict;

-- step create:fk:statutory_change.statutory_change__fk__bc3a80d5 (additive)
alter table "statutory_change" add constraint "statutory_change__fk__bc3a80d5" foreign key ("applied_version_id") references "jurisdiction_settings" ("id") on delete restrict on update restrict;

-- step replace:trigger:jurisdiction_settings.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "jurisdiction_settings" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"currency":["currency"],"effective_range":["effective_range"],"employee_extension_schema":["employee_extension_schema"],"entity_extension_schema":["entity_extension_schema"],"lookup":["lookup"],"name":["name"],"reason":["reason"],"status":["status"],"tax_year_start_month":["tax_year_start_month"],"timezone":["timezone"]},"key":["id"],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}}}');

-- step replace:trigger:adhoc_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "adhoc_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"adhoc_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:claim_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "claim_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"claim_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:leave_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"pay_treatment":["pay_treatment"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"leave_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:loan_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "loan_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"description":["description"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"loan_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:work_interruption_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "work_interruption_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"work_interruption_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:workplace_case_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "workplace_case_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"description":["description"],"events":["events"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"workplace_case_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:allowance_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "allowance_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"allowance_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:overtime_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "overtime_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"conversion":["conversion"],"direction":["direction"],"eligibility":["eligibility"],"incurred_on":["incurred_on"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"party":["party"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"overtime_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:statutory_contribution_catalog.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_contribution_catalog" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"depends_on":["depends_on"],"eligibility":["eligibility"],"employee_amount":["employee_amount"],"employer_amount":["employer_amount"],"employer_cost_subtotal_id":["employer_cost_subtotal_id"],"kind":["kind"],"lookup":["lookup"],"name":["name"],"off_cycle_eligible":["off_cycle_eligible"],"references":["references"],"settings_id":["settings_id"],"subtotal_id":["subtotal_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"statutory_contribution_catalog","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:registered_effect.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "registered_effect" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"condition":["condition"],"effects":["effects"],"events":["events"],"lookup":["lookup"],"name":["name"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"source_collection":["source_collection"],"target_action":["target_action"],"target_collection":["target_collection"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"registered_effect","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:registered_rule.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "registered_rule" for each row execute function store_row_rules('{"audit":true,"fields":{"code":["code"],"condition":["condition"],"events":["events"],"lookup":["lookup"],"order":["order"],"reads":["reads"],"references":["references"],"settings_id":["settings_id"],"target_collection":["target_collection"],"validate":["validate"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"registered_rule","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:trigger:subtotal.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "subtotal" for each row execute function store_row_rules('{"audit":true,"fields":{"calculation":["calculation"],"code":["code"],"name":["name"],"previous_id":["previous_id"],"settings_id":["settings_id"]},"key":["id"],"parents":[{"column":"settings_id","key":"id","relation":"subtotals","states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED","VOID"]},"SEALED":{"edit":["effective_range","reason"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}},"table":"jurisdiction_settings","type":"uuid"}],"states":{}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog','adhoc_catalog_entry','allowance_catalog','claim_catalog','claim_catalog_entry','employee_balance','employee_contract','employee_profile','entity','entity_profile_version','holiday','jurisdiction_settings','leave_catalog','leave_catalog_entry','ledger_entry','loan_catalog','loan_catalog_entry','loan_repayment_entry','obligation','overtime_catalog','payroll_run','payslip','registered_effect','registered_rule','roster_entry','shift_definition','shift_pattern','statutory_change','statutory_contribution_catalog','subtotal','work_interruption_catalog','work_interruption_catalog_entry','workplace_case_catalog','workplace_case_catalog_entry']::text[]));

-- step create:trigger:statutory_change.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_change" for each row execute function store_row_rules('{"audit":true,"fields":{"announced_on":["announced_on"],"applied_version_id":["applied_version_id"],"baseline_version_id":["baseline_version_id"],"effective_from":["effective_from"],"family":["family"],"field_path":["field_path"],"jurisdiction_code":["jurisdiction_code"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"],"research_run_id":["research_run_id"],"row_code":["row_code"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"APPLIED":{"edit":"none","to":[]},"CONFIRMED":{"edit":["applied_version_id","status"],"to":["APPLIED","REJECTED"]},"PROPOSED":{"edit":["new_value","effective_from","announced_on","source_urls","source_quote","notes","verified_on","verified_by","status"],"to":["CONFIRMED","REJECTED"]},"REJECTED":{"edit":"none","to":[]}}}}}');

-- step create:index:statutory_change.statutory_change__gin__73732636 (additive)
create index "statutory_change__gin__73732636" on "statutory_change" using gin (bolt_search);

-- step create:index:statutory_change.statutory_change__ix__9442f833 (additive)
create index "statutory_change__ix__9442f833" on "statutory_change" ("verified_by");

-- step create:index:statutory_change.statutory_change__ix__4a32eade (additive)
create index "statutory_change__ix__4a32eade" on "statutory_change" ("baseline_version_id");

-- step create:index:statutory_change.statutory_change__ix__9803300f (additive)
create index "statutory_change__ix__9803300f" on "statutory_change" ("applied_version_id");

-- step create:engine:audit:statutory_change (additive)
drop trigger if exists bolt_audit_mark on "statutory_change";
create trigger bolt_audit_mark before insert or update or delete on "statutory_change" for each row execute function bolt_audit_mark('[]','[["applied_version_id","jurisdiction_settings"],["baseline_version_id","jurisdiction_settings"],["verified_by","sys_user"]]');
drop trigger if exists bolt_audit on "statutory_change";
create trigger bolt_audit after insert or update or delete on "statutory_change" for each row execute function bolt_audit('[]','[["applied_version_id","jurisdiction_settings"],["baseline_version_id","jurisdiction_settings"],["verified_by","sys_user"]]');
