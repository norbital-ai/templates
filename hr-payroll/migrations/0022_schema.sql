-- 0022_schema.sql: 25 step(s), from 7f271677b65621d398a73893e466a5d6a227f5db5a8ff439f06c1c449b515c59 to f33f33c2c06a389c955fd6a6c7d3ba149ba51adbab035ec0d518f5186b4c33cf.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step replace:trigger:employee_profile.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_profile";

-- step drop:constraint:ledger_entry.ledger_entry__ck__8d78a19a (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__ck__8d78a19a";

-- step create:function:bolt_record_label_contract_change_b26ebd75 (additive)
create function "bolt_record_label_contract_change_b26ebd75"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['field_path']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('field_path', to_jsonb("field_path")) AS j FROM (SELECT $1 AS "field_path") label_inputs) label_row) label_value$record_label$;

-- step create:table:contract_change (additive)
create table "contract_change" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"field_path" text not null,
	"old_value" jsonb,
	"new_value" jsonb,
	"effective_from" date not null,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_contract_change_b26ebd75"("field_path")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contract_change_b26ebd75"("field_path"), ''))) stored,
	"employee_id" uuid not null,
	"applied_version_id" uuid,
	constraint "contract_change__ck__ae52c15d" check (("old_value" is null or store_json_valid("old_value", '{"kind":"json","optional":true}'::jsonb) is true)),
	constraint "contract_change__ck__73129686" check (("new_value" is null or store_json_valid("new_value", '{"kind":"json","optional":true}'::jsonb) is true)),
	constraint "contract_change__ck__30e69ba6" check (isfinite("effective_from"))
);

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"documents":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_last_match_at":{"kind":"instant","optional":true},"face_match_count":{"default":0,"kind":"int","min":0},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"first_hired_on":{"help":"The first day this person joined the employer group. Company service stays with the person across entity and jurisdiction transfers.","kind":"date","optional":true},"invitation_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","label":"Source reference","optional":true},"user_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"}},"nativeRules":2,"recordLabel":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"]},{"fields":["user_id"]}]}'::jsonb);

-- step replace:history:schema:ledger_entry (additive)
select bolt_history_register('ledger_entry','{"audit":true,"fields":{"account":{"help":"Catalogue family key, for example leave or claim.","kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"help":"Account code inside the family, for example ANNUAL_LEAVE.","kind":"text"},"effective_on":{"kind":"date"},"measure":{"help":"What is held in that window, for example entitled or used.","kind":"text","optional":true},"operation":{"kind":"enum","values":["ADD","DEDUCT"]},"period":{"help":"The window the value belongs to, for example MY.S.2026-03-05.","kind":"text","optional":true},"source":{"help":"What caused this movement. Plain text, so a movement outlives what caused it.","kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.code"}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"adhoc_catalog_entry"},"unit":{"kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.description","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","label":"Amount","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"claim_catalog_entry"},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"string(record.quantity) + '' '' + record.unit","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"days":{"kind":"list","min":1,"of":{"fields":{"date":{"kind":"date"},"part":{"kind":"enum","values":["AM","PM"]}},"kind":"object"}},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"leave_catalog_entry"}},"nativeRules":2,"recordLabel":"string(size(record.days)) + '' half-days''","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step create:column:employee_profile.documents (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "documents" jsonb;

-- step create:history:schema:contract_change (additive)
select bolt_history_register('contract_change','{"audit":true,"fields":{"applied_version_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"employee_contract"},"effective_from":{"kind":"date"},"employee_id":{"inverse":"contract_changes","kind":"ref","onDelete":"cascade","to":"employee_profile"},"field_path":{"kind":"text"},"new_value":{"kind":"json","optional":true},"notes":{"kind":"text","optional":true},"old_value":{"kind":"json","optional":true}},"nativeRules":2,"recordLabel":"record.field_path"}'::jsonb);

-- step create:constraint:employee_profile.employee_profile__ck__468f7182 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where (("documents" is null or store_json_valid("documents", ''{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","multiple":true,"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'employee_profile__ck__468f7182 refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" add constraint "employee_profile__ck__468f7182" check (("documents" is null or store_json_valid("documents", '{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","multiple":true,"optional":true}'::jsonb) is true));

-- step create:constraint:ledger_entry.ledger_entry__ck__83d69349 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "ledger_entry" where ("operation" in (''ADD'', ''DEDUCT'')) is false' into n;
	if n > 0 then raise exception 'ledger_entry__ck__83d69349 refuses % existing row(s)', n; end if;
end $store$;
alter table "ledger_entry" add constraint "ledger_entry__ck__83d69349" check ("operation" in ('ADD', 'DEDUCT'));

-- step create:constraint:adhoc_catalog_entry.adhoc_catalog_entry__uq__f54a609c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "adhoc_catalog_entry" where "reverses" is not null group by "reverses" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'adhoc_catalog_entry__uq__f54a609c refuses % existing row(s)', n; end if;
end $store$;
alter table "adhoc_catalog_entry" add constraint "adhoc_catalog_entry__uq__f54a609c" unique ("reverses") deferrable initially immediate;

-- step create:constraint:claim_catalog_entry.claim_catalog_entry__uq__f54a609c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "claim_catalog_entry" where "reverses" is not null group by "reverses" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'claim_catalog_entry__uq__f54a609c refuses % existing row(s)', n; end if;
end $store$;
alter table "claim_catalog_entry" add constraint "claim_catalog_entry__uq__f54a609c" unique ("reverses") deferrable initially immediate;

-- step create:constraint:leave_catalog_entry.leave_catalog_entry__uq__f54a609c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "leave_catalog_entry" where "reverses" is not null group by "reverses" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'leave_catalog_entry__uq__f54a609c refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" add constraint "leave_catalog_entry__uq__f54a609c" unique ("reverses") deferrable initially immediate;

-- step create:fk:contract_change.contract_change__fk__fbd45363 (additive)
alter table "contract_change" add constraint "contract_change__fk__fbd45363" foreign key ("employee_id") references "employee_profile" ("id") on delete cascade on update restrict;

-- step create:fk:contract_change.contract_change__fk__116070c1 (additive)
alter table "contract_change" add constraint "contract_change__fk__116070c1" foreign key ("applied_version_id") references "employee_contract" ("id") on delete restrict on update restrict;

-- step replace:trigger:employee_profile.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_profile" for each row execute function store_row_rules('{"audit":true,"fields":{"address":["address"],"documents":["documents"],"email":["email"],"face_consent_at":["face_consent_at"],"face_embedding":["face_embedding"],"face_enrolled_at":["face_enrolled_at"],"face_enrollment_status":["face_enrollment_status"],"face_last_match_at":["face_last_match_at"],"face_match_count":["face_match_count"],"face_photo":["face_photo"],"first_hired_on":["first_hired_on"],"invitation_id":["invitation_id"],"location":["location"],"name":["name"],"phone":["phone"],"source_reference":["source_reference"],"user_id":["user_id"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog','adhoc_catalog_entry','allowance_catalog','claim_catalog','claim_catalog_entry','contract_change','employee_balance','employee_contract','employee_profile','entity','entity_profile_version','holiday','jurisdiction_settings','leave_catalog','leave_catalog_entry','ledger_entry','loan_catalog','loan_catalog_entry','loan_repayment_entry','obligation','overtime_catalog','payroll_run','payslip','registered_effect','registered_rule','roster_entry','shift_definition','shift_pattern','statutory_change','statutory_contribution_catalog','statutory_finding','statutory_source','subtotal','work_interruption_catalog','work_interruption_catalog_entry','workplace_case_catalog','workplace_case_catalog_entry']::text[]));

-- step create:trigger:contract_change.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "contract_change" for each row execute function store_row_rules('{"audit":true,"fields":{"applied_version_id":["applied_version_id"],"effective_from":["effective_from"],"employee_id":["employee_id"],"field_path":["field_path"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"]},"key":["id"],"parents":[],"states":{}}');

-- step create:index:contract_change.contract_change__gin__73732636 (additive)
create index "contract_change__gin__73732636" on "contract_change" using gin (bolt_search);

-- step create:index:contract_change.contract_change__ix__b0e10b14 (additive)
create index "contract_change__ix__b0e10b14" on "contract_change" ("employee_id");

-- step create:index:contract_change.contract_change__ix__9803300f (additive)
create index "contract_change__ix__9803300f" on "contract_change" ("applied_version_id");

-- step create:engine:audit:contract_change (additive)
drop trigger if exists bolt_audit_mark on "contract_change";
create trigger bolt_audit_mark before insert or update or delete on "contract_change" for each row execute function bolt_audit_mark('[]','[["applied_version_id","employee_contract"],["employee_id","employee_profile"]]');
drop trigger if exists bolt_audit on "contract_change";
create trigger bolt_audit after insert or update or delete on "contract_change" for each row execute function bolt_audit('[]','[["applied_version_id","employee_contract"],["employee_id","employee_profile"]]');
