-- 0007_schema.sql: 34 step(s), from 60ca74739d935d6c7c5227fb32ffae1a3098cd0dc63fb13f4831efbfca6ba6c8 to 3fe0cda30b419fd7d701a31325e814b77be59ed6a5a9dbdee377ff002c2b08ee.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:employee_contract.employee_contract__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__gin__73732636";

-- step drop:index:employee_contract.employee_contract__ix__3d2fc93d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__ix__3d2fc93d";

-- step replace:trigger:employee_contract.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_contract";

-- step drop:fk:employee_contract.employee_contract__fk__b616d7f6 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__fk__b616d7f6";

-- step drop:constraint:employee_contract.employee_contract__ck__61bba7f7 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__61bba7f7";

-- step drop:constraint:employee_contract.employee_contract__ck__83e675cc (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__83e675cc";

-- step drop:constraint:employee_contract.employee_contract__ck__23c73368 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__23c73368";

-- step drop:constraint:employee_contract.employee_contract__ck__4e512fb0 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__4e512fb0";

-- step drop:notNull:employee_contract.input_schema_version_id (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "input_schema_version_id" drop not null;

-- step drop:column:employee_contract.child_leave_allocations (destructive)
-- accept: drop:column:employee_contract.child_leave_allocations
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "child_leave_allocations" cascade;

-- step drop:column:employee_contract.children (destructive)
-- accept: drop:column:employee_contract.children
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "children" cascade;

-- step drop:column:employee_contract.dependents_count (destructive)
-- accept: drop:column:employee_contract.dependents_count
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "dependents_count" cascade;

-- step drop:column:employee_contract.employee_name (destructive)
-- accept: drop:column:employee_contract.employee_name
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "employee_name" cascade;

-- step drop:column:employee_contract.only_child (destructive)
-- accept: drop:column:employee_contract.only_child
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "only_child" cascade;

-- step drop:column:employee_contract.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "bolt_record_label" cascade;

-- step drop:column:employee_contract.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists bolt_search cascade;

-- step drop:column:employee_contract.input_schema_version_id (destructive)
-- accept: drop:column:employee_contract.input_schema_version_id
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "input_schema_version_id" cascade;

-- step drop:function:bolt_record_label_employee_contract_e8d96608 (additive)
drop function if exists "bolt_record_label_employee_contract_e8d96608"(text, text) cascade;

-- step create:column:employee_contract.family (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" add column "family" jsonb;

-- step data:employee_contract.events (data)
-- hazard: the shape of employee_contract.events changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over employee_contract); the check below counts the rows the new shape still refuses.

-- step check:employee_contract.events (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "employee_contract" where "events" is not null and store_json_valid("events", ''{"help":"Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason. A LEAVE_ADJUSTMENT adds its signed days to the leave row `code` names, in the window holding `on`, and states its cause.","kind":"list","of":{"fields":{"allocated_days":{"kind":"int","optional":true},"cause":{"kind":"text","optional":true},"code":{"kind":"text","optional":true},"days":{"kind":"number","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object"},"optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of employee_contract.events refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:employee_contract.employee_contract__ck__6429dd3c (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_contract" where (("events" is null or store_json_valid("events", ''{"help":"Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason. A LEAVE_ADJUSTMENT adds its signed days to the leave row `code` names, in the window holding `on`, and states its cause.","kind":"list","of":{"fields":{"allocated_days":{"kind":"int","optional":true},"cause":{"kind":"text","optional":true},"code":{"kind":"text","optional":true},"days":{"kind":"number","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object"},"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'employee_contract__ck__6429dd3c refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_contract" add constraint "employee_contract__ck__6429dd3c" check (("events" is null or store_json_valid("events", '{"help":"Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason. A LEAVE_ADJUSTMENT adds its signed days to the leave row `code` names, in the window holding `on`, and states its cause.","kind":"list","of":{"fields":{"allocated_days":{"kind":"int","optional":true},"cause":{"kind":"text","optional":true},"code":{"kind":"text","optional":true},"days":{"kind":"number","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object"},"optional":true}'::jsonb) is true));

-- step replace:trigger:employee_contract.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_contract" for each row execute function store_row_rules('{"audit":true,"fields":{"bank":["bank"],"effective_range":["effective_range"],"employee_extension_data":["employee_extension_data"],"employee_id":["employee_id"],"employee_number":["employee_number"],"engagement":["engagement"],"entity_id":["entity_id"],"events":["events"],"exit_ground":["exit_ground"],"family":["family"],"final_pay_due_on":["final_pay_due_on"],"payroll":["payroll"],"reason":["reason"],"service_started_on":["service_started_on"],"signed_contract_period":["signed_contract_period"],"status":["status"],"terms":["terms"],"work_pass_valid_until":["work_pass_valid_until"]},"key":["id"],"parents":[],"states":{"status":{"initial":"DRAFT","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","final_pay_due_on","reason","exit_ground","work_pass_valid_until"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}}}}');

-- step replace:engine:audit:employee_contract (additive)
drop trigger if exists bolt_audit_mark on "employee_contract";
create trigger bolt_audit_mark before insert or update or delete on "employee_contract" for each row execute function bolt_audit_mark('[]','[["employee_id","employee_profile"],["entity_id","entity"]]');
drop trigger if exists bolt_audit on "employee_contract";
create trigger bolt_audit after insert or update or delete on "employee_contract" for each row execute function bolt_audit('[]','[["employee_id","employee_profile"],["entity_id","entity"]]');

-- step data:employee_contract.family (data)
-- hazard: the shape of employee_contract.family changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over employee_contract); the check below counts the rows the new shape still refuses.

-- step check:employee_contract.family (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "employee_contract" where "family" is not null and store_json_valid("family", ''{"help":"The person''''s family. Every count or flag a scheme reads (dependants, a spouse''''s income, births) is worked out from this list. A child''''s `allocations` are HR''''s approved leave days for that child, keyed by leave code.","kind":"list","of":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object"},"optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of employee_contract.family refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:employee_contract.employee_contract__ck__4f7d3038 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_contract" where (("family" is null or store_json_valid("family", ''{"help":"The person''''s family. Every count or flag a scheme reads (dependants, a spouse''''s income, births) is worked out from this list. A child''''s `allocations` are HR''''s approved leave days for that child, keyed by leave code.","kind":"list","of":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object"},"optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'employee_contract__ck__4f7d3038 refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_contract" add constraint "employee_contract__ck__4f7d3038" check (("family" is null or store_json_valid("family", '{"help":"The person''s family. Every count or flag a scheme reads (dependants, a spouse''s income, births) is worked out from this list. A child''s `allocations` are HR''s approved leave days for that child, keyed by leave code.","kind":"list","of":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object"},"optional":true}'::jsonb) is true));

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"adhoc_catalog_entry"},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.employment_id.employee_number + '' · '' + string(record.quantity)","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","label":"Amount","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"claim_catalog_entry"},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.employment_id.employee_number + '' · '' + string(record.quantity) + (record.unit == ''MONEY'' ? '''' : '' '' + record.unit)","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"leave_catalog_entry"}},"nativeRules":2,"recordLabel":"record.employment_id.employee_number + '' · '' + record.catalog_id.code","unique":[{"fields":["reverses"]}]}'::jsonb);

-- step replace:history:schema:loan_catalog_entry (additive)
select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"loan_catalog"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"recovered":{"hidden":true,"kind":"sum","of":"repayments.amount","where":{"reverses":{"isNull":true}}},"repayment_period":{"kind":"period","of":"date"}},"nativeRules":2,"recordLabel":"record.employment_id.employee_number + '' · '' + string(record.recovered) + '' recovered''"}'::jsonb);

-- step replace:history:schema:employee_contract (additive)
select bolt_history_register('employee_contract','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"effective_range":{"help":"The dates this agreement applies. A replacement contract continues employment; ending it records a reason.","kind":"period","of":"date"},"employee_extension_data":{"default":{},"help":"The employee data the jurisdiction''s employee extension schema declares.","kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"employee_contract","kind":"ref","to":"employee_profile"},"employee_number":{"kind":"text"},"engagement":{"default":"EMPLOYEE","help":"The contracted role. PAYEE is paid without employment (a commission agent), outside the headcount and separations.","kind":"enum","values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"entity_id":{"inverse":"employee_contract","kind":"ref","to":"entity"},"events":{"help":"Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason. A LEAVE_ADJUSTMENT adds its signed days to the leave row `code` names, in the window holding `on`, and states its cause.","kind":"list","of":{"fields":{"allocated_days":{"kind":"int","optional":true},"cause":{"kind":"text","optional":true},"code":{"kind":"text","optional":true},"days":{"kind":"number","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object"},"optional":true},"exit_ground":{"help":"The statutory ground for ending the employment. It decides severance eligibility and exit duties; reason carries the narrative.","kind":"enum","optional":true,"values":["RETRENCHMENT","RETIREMENT","RESIGNATION","DISMISSAL","MISCONDUCT_DISMISSAL","END_OF_CONTRACT","MUTUAL","DEATH","UNILATERAL","BREACH_BY_EMPLOYER"]},"family":{"help":"The person''s family. Every count or flag a scheme reads (dependants, a spouse''s income, births) is worked out from this list. A child''s `allocations` are HR''s approved leave days for that child, keyed by leave code.","kind":"list","of":{"fields":{"allocations":{"kind":"record","of":{"kind":"number","min":0},"optional":true},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"kind":"object"},"optional":true},"final_pay_due_on":{"help":"The actual contractual date the final settlement becomes payable. This differs from the maximum statutory deadline and the run’s actual payment date.","kind":"date","optional":true},"payroll":{"fields":{"birth_city":{"kind":"text","optional":true},"date_of_birth":{"kind":"date","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"marital_status":{"kind":"enum","optional":true,"values":["SINGLE","MARRIED","SEPARATED","DIVORCED","WIDOWED"]},"nationality":{"help":"ISO 3166-1 alpha-2 country code.","kind":"text","optional":true},"passport_number":{"kind":"text","optional":true}},"kind":"object","label":"Person details","optional":true},"reason":{"help":"Why this record was voided or the employment ended.","kind":"text","optional":true},"service_started_on":{"help":"Only for service credited from elsewhere. Service is otherwise worked out from every stint under this jurisdiction, rehires included.","kind":"date","optional":true},"signed_contract_period":{"kind":"period","of":"date","optional":true},"status":{"initial":"DRAFT","kind":"state","states":{"DRAFT":{"edit":"all","to":["SEALED"]},"SEALED":{"edit":["effective_range","final_pay_due_on","reason","exit_ground","work_pass_valid_until"],"to":["VOID"]},"VOID":{"edit":"none","to":[]}}},"terms":{"fields":{"allowances":{"help":"The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.","kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"},"optional":true},"annual_leave_carry_limit_days":{"help":"An agreed contractual limit for carrying annual leave into the next leave year.","kind":"number","min":0,"optional":true},"department":{"kind":"text","optional":true},"employee_borne_tax_items":{"help":"Where the employer bears the income tax: the agreed allowances whose tax the employee still pays, at their own rate.","kind":"list","of":{"kind":"text"},"optional":true},"employer_bears_income_tax":{"help":"The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.","kind":"bool","optional":true},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"help":"The ordinary working days of one week.","kind":"number","max":7,"min":0},"normal_hours_per_day":{"help":"The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.","kind":"number","min":0},"normal_hours_per_week":{"help":"The ordinary hours of one working week.","kind":"number","min":0},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"probation_period":{"help":"The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.","kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"residency_status":{"kind":"text","optional":true},"shift_pattern_id":{"kind":"id","of":"shift_pattern","optional":true},"signed_on":{"help":"The actual date this employment agreement was signed.","kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_authorisation_category":{"kind":"text","optional":true},"work_classification":{"kind":"text","optional":true},"work_region":{"help":"The worksite region key the jurisdiction minimum-wage tables use, where it differs from the employer region.","kind":"text","optional":true},"worksite":{"help":"The establishment or site the person works at, where the law applies thresholds by site.","kind":"text","optional":true}},"kind":"object"},"work_pass_valid_until":{"help":"The actual expiry date of the current work pass. Renewal changes it while the contract is sealed; the reminder key follows the date.","kind":"date","optional":true}},"nativeRules":2,"noOverlap":[{"key":["employee_id"],"period":"effective_range","where":{"status":{"eq":"SEALED"}}}],"recordLabel":"has(record.employee_id.name) ? record.employee_id.name + '' · '' + record.employee_number : record.employee_number","search":{"text":["employee_number","employee_id"]}}'::jsonb);

-- step create:column:employee_contract.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "employee_contract" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("employee_number"::text, ''))) stored;

-- step create:index:employee_contract.employee_contract__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "employee_contract__gin__73732636" on "employee_contract" using gin (bolt_search);
