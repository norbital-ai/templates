-- 0008_schema.sql: 173 step(s), from 7617c107477b4640e68f5b38b77f73139a9b806604dbd524a03e18440cf8842c to fac22c5ab5c55a519d3c1bc49572ec640e409a17e255c850b1c5237c19cf6efa.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:trigger:contract_change.store_row_rules (additive)
drop trigger if exists store_row_rules on "contract_change";

-- step drop:trigger:contract_change.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "contract_change";

-- step drop:trigger:contract_change.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "contract_change";

-- step drop:index:contract_change.contract_change__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_change__gin__73732636";

-- step drop:trigger:employee_contract.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_contract";

-- step drop:trigger:employee_contract.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "employee_contract";

-- step drop:trigger:employee_contract.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "employee_contract";

-- step drop:index:employee_contract.employee_contract__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__gin__73732636";

-- step drop:index:contract_change.contract_change__ix__9803300f (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_change__ix__9803300f";

-- step drop:index:contract_change.contract_change__ix__b0e10b14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_change__ix__b0e10b14";

-- step drop:index:employee_contract.employee_contract__ix__b0e10b14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__ix__b0e10b14";

-- step drop:index:employee_contract.employee_contract__ix__26554388 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__ix__26554388";

-- step drop:index:employee_contract.employee_contract__ix__2f5c3491 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_contract__ix__2f5c3491";

-- step drop:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" drop constraint if exists "adhoc_catalog_entry__fk__8fffab27";

-- step drop:fk:claim_catalog_entry.claim_catalog_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" drop constraint if exists "claim_catalog_entry__fk__8fffab27";

-- step drop:fk:contract_change.contract_change__fk__116070c1 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop constraint if exists "contract_change__fk__116070c1";

-- step drop:fk:contract_change.contract_change__fk__fbd45363 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop constraint if exists "contract_change__fk__fbd45363";

-- step drop:fk:employee_contract.employee_contract__fk__dfe472ed (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__fk__dfe472ed";

-- step drop:fk:employee_contract.employee_contract__fk__70277288 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__fk__70277288";

-- step drop:fk:employee_contract.employee_contract__fk__8d17fe20 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__fk__8d17fe20";

-- step drop:fk:leave_catalog_entry.leave_catalog_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" drop constraint if exists "leave_catalog_entry__fk__8fffab27";

-- step drop:fk:loan_catalog_entry.loan_catalog_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" drop constraint if exists "loan_catalog_entry__fk__8fffab27";

-- step drop:fk:loan_catalog_entry_repayment.loan_catalog_entry_repayment__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry_repayment" drop constraint if exists "loan_catalog_entry_repayment__fk__8fffab27";

-- step drop:fk:obligation.obligation__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "obligation" drop constraint if exists "obligation__fk__8fffab27";

-- step drop:fk:payslip.payslip__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop constraint if exists "payslip__fk__8fffab27";

-- step drop:fk:roster_entry.roster_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "roster_entry" drop constraint if exists "roster_entry__fk__8fffab27";

-- step drop:fk:work_event.work_event__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "work_event" drop constraint if exists "work_event__fk__8fffab27";

-- step drop:fk:workplace_case_catalog_entry.workplace_case_catalog_entry__fk__8fffab27 (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop constraint if exists "workplace_case_catalog_entry__fk__8fffab27";

-- step drop:constraint:contract_change.contract_change__ck__30e69ba6 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop constraint if exists "contract_change__ck__30e69ba6";

-- step drop:constraint:contract_change.contract_change__ck__73129686 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop constraint if exists "contract_change__ck__73129686";

-- step drop:constraint:contract_change.contract_change__ck__ae52c15d (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop constraint if exists "contract_change__ck__ae52c15d";

-- step drop:constraint:employee_contract.employee_contract__ck__0633b9c6 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__0633b9c6";

-- step drop:constraint:employee_contract.employee_contract__ck__b16c6b5e (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__b16c6b5e";

-- step drop:constraint:employee_contract.employee_contract__ck__6b0642ac (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__6b0642ac";

-- step drop:constraint:employee_contract.employee_contract__ck__db94f252 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__db94f252";

-- step drop:constraint:employee_contract.employee_contract__ck__c2e464db (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__c2e464db";

-- step drop:constraint:employee_contract.employee_contract__ck__4130a6e7 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__4130a6e7";

-- step drop:constraint:employee_contract.employee_contract__ck__f11d8a9c (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__f11d8a9c";

-- step drop:constraint:employee_contract.employee_contract__ck__ca8464ef (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__ca8464ef";

-- step drop:constraint:employee_contract.employee_contract__ck__3e552bf0 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__3e552bf0";

-- step drop:constraint:employee_contract.employee_contract__ck__7f5deee9 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__7f5deee9";

-- step drop:constraint:employee_contract.employee_contract__ck__ce769449 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__ce769449";

-- step drop:constraint:employee_contract.employee_contract__ck__a3a63477 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__a3a63477";

-- step drop:constraint:employee_contract.employee_contract__ck__b91d745e (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ck__b91d745e";

-- step drop:constraint:employee_contract.employee_contract__ex__89af20f6 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop constraint if exists "employee_contract__ex__89af20f6";

-- step drop:notNull:contract_change.effective_from (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" alter column "effective_from" drop not null;

-- step drop:notNull:contract_change.field_path (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" alter column "field_path" drop not null;

-- step create:function:bolt_record_label_dependant_b5b83002 (additive)
create function "bolt_record_label_dependant_b5b83002"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['relation']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name"), 'relation', to_jsonb("relation")) AS j FROM (SELECT $1 AS "name", $2 AS "relation") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_contract_terms_58d6e27a (additive)
create function "bolt_record_label_contract_terms_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_statutory_parameters_58d6e27a (additive)
create function "bolt_record_label_statutory_parameters_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row) label_value$record_label$;

-- step create:table:dependant (additive)
create table "dependant" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"relation" text not null,
	"name" text,
	"born_on" date,
	"expected_on" date,
	"has_income" boolean,
	"disabled" boolean,
	"studying" boolean,
	"allocations" jsonb,
	"bolt_record_label" text generated always as ("bolt_record_label_dependant_b5b83002"("name", "relation")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_dependant_b5b83002"("name", "relation"), ''))) stored,
	"employee_id" uuid not null,
	constraint "dependant__ck__5736cbcf" check ("relation" in ('CHILD', 'SPOUSE', 'PARENT')),
	constraint "dependant__ck__09625b3b" check (isfinite("born_on")),
	constraint "dependant__ck__647ff1ea" check (isfinite("expected_on")),
	constraint "dependant__ck__6cddf405" check (("allocations" is null or store_json_valid("allocations", '{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"number","min":0}}}'::jsonb) is true))
);

-- step create:table:employment (additive)
create table "employment" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"employee_number" text not null,
	"effective_range" daterange not null,
	"service_started_on" date,
	"events" jsonb,
	"final_pay_due_on" date,
	"reason" text,
	"encash_leave" boolean default true not null,
	"exit_ground" text,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("employee_number"::text, ''))) stored,
	"employee_id" uuid not null,
	"entity_id" uuid not null,
	constraint "employment__ck__b16c6b5e" check (not isempty("effective_range") and not lower_inf("effective_range")),
	constraint "employment__ck__7f5deee9" check (isfinite("service_started_on")),
	constraint "employment__ck__c2e464db" check (("events" is null or store_json_valid("events", '{"fields":{"allocated_days":{"kind":"int","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object","many":true,"optional":true}'::jsonb) is true)),
	constraint "employment__ck__ca8464ef" check (isfinite("final_pay_due_on")),
	constraint "employment__ck__4130a6e7" check ("exit_ground" in ('RETRENCHMENT', 'RETIREMENT', 'RESIGNATION', 'DISMISSAL', 'MISCONDUCT_DISMISSAL', 'END_OF_CONTRACT', 'MUTUAL', 'DEATH', 'UNILATERAL', 'BREACH_BY_EMPLOYER')),
	constraint "employment__ex__c18a4b19" exclude using gist ("employee_id" with =, "effective_range" with &&) deferrable initially immediate
);

-- step create:table:contract_terms (additive)
create table "contract_terms" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"effective_from" date not null,
	"signed_on" date,
	"engagement" text,
	"signed_contract_period" daterange,
	"probation_period" daterange,
	"rate" jsonb,
	"normal_hours_per_day" jsonb,
	"normal_hours_per_week" jsonb,
	"normal_days_per_week" jsonb,
	"employer_bears_income_tax" boolean,
	"employee_borne_tax_items" text[],
	"job_title" text,
	"department" text,
	"statutory_work_category" text,
	"work_classification" text,
	"work_region" text,
	"worksite" text,
	"notice_period" jsonb,
	"annual_leave_carry_limit_days" jsonb,
	"wage_payment_method" text,
	"allowances" jsonb,
	"clears" text[],
	"bolt_record_label" text generated always as ("bolt_record_label_contract_terms_58d6e27a"("effective_from")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contract_terms_58d6e27a"("effective_from"), ''))) stored,
	"employment_id" uuid not null,
	"pay_group_id" uuid,
	"shift_pattern_id" uuid,
	constraint "contract_terms__ck__30e69ba6" check (isfinite("effective_from")),
	constraint "contract_terms__ck__459cf665" check (isfinite("signed_on")),
	constraint "contract_terms__ck__db94f252" check ("engagement" in ('EMPLOYEE', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'APPRENTICE', 'CONSULTANT', 'PAYEE')),
	constraint "contract_terms__ck__ce769449" check (not isempty("signed_contract_period") and not lower_inf("signed_contract_period")),
	constraint "contract_terms__ck__b0d79508" check (not isempty("probation_period") and not lower_inf("probation_period")),
	constraint "contract_terms__ck__fb35f1a6" check (("rate" is null or store_json_valid("rate", '{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}}'::jsonb) is true)),
	constraint "contract_terms__ck__ec63e201" check (("normal_hours_per_day" is null or store_json_valid("normal_hours_per_day", '{"kind":"json","optional":true,"shape":{"kind":"number","min":0}}'::jsonb) is true)),
	constraint "contract_terms__ck__4ea5ac6f" check (("normal_hours_per_week" is null or store_json_valid("normal_hours_per_week", '{"kind":"json","optional":true,"shape":{"kind":"number","min":0}}'::jsonb) is true)),
	constraint "contract_terms__ck__57fda04f" check (("normal_days_per_week" is null or store_json_valid("normal_days_per_week", '{"kind":"json","optional":true,"shape":{"kind":"number","max":7,"min":0}}'::jsonb) is true)),
	constraint "contract_terms__ck__3923585e" check (not jsonb_path_exists(to_jsonb("employee_borne_tax_items"), 'strict $[*] ? (@.type() != "string")')),
	constraint "contract_terms__ck__56b1add7" check (("notice_period" is null or store_json_valid("notice_period", '{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true}'::jsonb) is true)),
	constraint "contract_terms__ck__ddc6685e" check (("annual_leave_carry_limit_days" is null or store_json_valid("annual_leave_carry_limit_days", '{"kind":"json","optional":true,"shape":{"kind":"number","min":0}}'::jsonb) is true)),
	constraint "contract_terms__ck__b32c483d" check ("wage_payment_method" in ('BANK', 'CASH', 'CHEQUE', 'DIGITAL')),
	constraint "contract_terms__ck__88ec5c85" check (("allowances" is null or store_json_valid("allowances", '{"kind":"json","optional":true,"shape":{"kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"}}}'::jsonb) is true)),
	constraint "contract_terms__ck__64a2ceb8" check (not jsonb_path_exists(to_jsonb("clears"), 'strict $[*] ? (@.type() != "string")')),
	constraint "contract_terms__uq__f1149db6" unique nulls not distinct ("employment_id", "effective_from") deferrable initially immediate
);

-- step create:table:statutory_parameters (additive)
create table "statutory_parameters" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"effective_from" date not null,
	"residency_status" text,
	"work_authorisation_category" text,
	"work_authorisation_expires_on" date,
	"marital_status" text,
	"nationality" text,
	"passport_number" text,
	"parameters" jsonb,
	"clears" text[],
	"bolt_record_label" text generated always as ("bolt_record_label_statutory_parameters_58d6e27a"("effective_from")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_statutory_parameters_58d6e27a"("effective_from"), ''))) stored,
	"employment_id" uuid not null,
	constraint "statutory_parameters__ck__30e69ba6" check (isfinite("effective_from")),
	constraint "statutory_parameters__ck__d038c03b" check (isfinite("work_authorisation_expires_on")),
	constraint "statutory_parameters__ck__20833849" check ("marital_status" in ('SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED')),
	constraint "statutory_parameters__ck__919e2fd1" check (("parameters" is null or store_json_valid("parameters", '{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}'::jsonb) is true)),
	constraint "statutory_parameters__ck__64a2ceb8" check (not jsonb_path_exists(to_jsonb("clears"), 'strict $[*] ? (@.type() != "string")')),
	constraint "statutory_parameters__uq__f1149db6" unique nulls not distinct ("employment_id", "effective_from") deferrable initially immediate
);

-- step create:column:employee_profile.date_of_birth (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "date_of_birth" date;

-- step create:column:employee_profile.identity_number (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "identity_number" text;

-- step create:column:employee_profile.gender (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "gender" text;

-- step create:column:employee_profile.birth_city (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "birth_city" text;

-- step create:column:employee_profile.bank (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "bank" jsonb;

-- A chain of sealed versions with one company, each starting the day after the last ended, is one stint: it takes
-- the id of its first version, and every row that named a version names its stint.
create temporary table "bolt_stint" on commit drop as
with v as (
	select c.*, lower("effective_range") as "f", upper("effective_range") as "u"
	from "employee_contract" c where "status" = 'SEALED'
), w as (
	select v.*, lag("entity_id") over p as "pe", lag("u") over p as "pu" from v window p as (partition by "employee_id" order by "f")
), n as (
	select w.*, sum(case when "pe" = "entity_id" and "pu" = "f" then 0 else 1 end) over (partition by "employee_id" order by "f") as "k" from w
)
select n.*, first_value("id") over s as "stint_id", ("id" = first_value("id") over s) as "first"
from n window s as (partition by "employee_id", "k" order by "f");

insert into "employment" ("id", "employee_number", "effective_range", "service_started_on", "events", "final_pay_due_on", "reason", "encash_leave", "exit_ground", "employee_id", "entity_id")
select "stint_id", (array_agg("employee_number" order by "f"))[1], daterange(min("f"), (array_agg("u" order by "f" desc))[1], '[)'),
	min("service_started_on"), (array_agg("events" order by "f" desc))[1], (array_agg("final_pay_due_on" order by "f" desc))[1],
	(array_agg("reason" order by "f" desc))[1], (array_agg("encash_leave" order by "f" desc))[1], (array_agg("exit_ground" order by "f" desc))[1],
	"employee_id", (array_agg("entity_id" order by "f"))[1]
from "bolt_stint" group by "stint_id", "employee_id";

-- each version is the terms and the parameters from its first day: stated whole, with what it no longer held taken away
insert into "contract_terms" ("id", "employment_id", "effective_from", "signed_on", "engagement", "signed_contract_period", "probation_period", "rate", "normal_hours_per_day", "normal_hours_per_week", "normal_days_per_week", "notice_period", "annual_leave_carry_limit_days", "allowances", "employer_bears_income_tax", "employee_borne_tax_items", "job_title", "department", "statutory_work_category", "work_classification", "work_region", "worksite", "wage_payment_method", "pay_group_id", "shift_pattern_id", "clears")
select md5("id"::text || 'terms')::uuid, "stint_id", "f", ("terms"->>'signed_on')::date, "engagement", "signed_contract_period", case when ("terms"->'probation_period') is null or ("terms"->'probation_period')->>'from' is null then null else daterange((("terms"->'probation_period')->>'from')::date, ((("terms"->'probation_period')->>'to')::date + 1), '[)') end, nullif("terms"->'rate', 'null'::jsonb), nullif("terms"->'normal_hours_per_day', 'null'::jsonb), nullif("terms"->'normal_hours_per_week', 'null'::jsonb), nullif("terms"->'normal_days_per_week', 'null'::jsonb), nullif("terms"->'notice_period', 'null'::jsonb), nullif("terms"->'annual_leave_carry_limit_days', 'null'::jsonb), nullif("terms"->'allowances', 'null'::jsonb), ("terms"->>'employer_bears_income_tax')::boolean, case when jsonb_typeof("terms"->'employee_borne_tax_items') = 'array' then array(select jsonb_array_elements_text("terms"->'employee_borne_tax_items')) end, "terms"->>'job_title', "terms"->>'department', "terms"->>'statutory_work_category', "terms"->>'work_classification', "terms"->>'work_region', "terms"->>'worksite', "terms"->>'wage_payment_method', "pay_group_id", ("terms"->>'shift_pattern_id')::uuid,
	case when "first" then null else array_remove(array[case when ("engagement") is null then 'engagement' end, case when ("signed_contract_period") is null then 'signed_contract_period' end, case when (case when ("terms"->'probation_period') is null or ("terms"->'probation_period')->>'from' is null then null else daterange((("terms"->'probation_period')->>'from')::date, ((("terms"->'probation_period')->>'to')::date + 1), '[)') end) is null then 'probation_period' end, case when (nullif("terms"->'rate', 'null'::jsonb)) is null then 'rate' end, case when (nullif("terms"->'normal_hours_per_day', 'null'::jsonb)) is null then 'normal_hours_per_day' end, case when (nullif("terms"->'normal_hours_per_week', 'null'::jsonb)) is null then 'normal_hours_per_week' end, case when (nullif("terms"->'normal_days_per_week', 'null'::jsonb)) is null then 'normal_days_per_week' end, case when (nullif("terms"->'notice_period', 'null'::jsonb)) is null then 'notice_period' end, case when (nullif("terms"->'annual_leave_carry_limit_days', 'null'::jsonb)) is null then 'annual_leave_carry_limit_days' end, case when (nullif("terms"->'allowances', 'null'::jsonb)) is null then 'allowances' end, case when (("terms"->>'employer_bears_income_tax')::boolean) is null then 'employer_bears_income_tax' end, case when (case when jsonb_typeof("terms"->'employee_borne_tax_items') = 'array' then array(select jsonb_array_elements_text("terms"->'employee_borne_tax_items')) end) is null then 'employee_borne_tax_items' end, case when ("terms"->>'job_title') is null then 'job_title' end, case when ("terms"->>'department') is null then 'department' end, case when ("terms"->>'statutory_work_category') is null then 'statutory_work_category' end, case when ("terms"->>'work_classification') is null then 'work_classification' end, case when ("terms"->>'work_region') is null then 'work_region' end, case when ("terms"->>'worksite') is null then 'worksite' end, case when ("terms"->>'wage_payment_method') is null then 'wage_payment_method' end, case when ("pay_group_id") is null then 'pay_group_id' end, case when (("terms"->>'shift_pattern_id')::uuid) is null then 'shift_pattern_id' end], null) end
from "bolt_stint";

insert into "statutory_parameters" ("id", "employment_id", "effective_from", "residency_status", "work_authorisation_category", "work_authorisation_expires_on", "marital_status", "nationality", "passport_number", "parameters", "clears")
select md5("id"::text || 'parameters')::uuid, "stint_id", "f", "terms"->>'residency_status', "terms"->>'work_authorisation_category', ("terms"->>'work_authorisation_expires_on')::date, "payroll"->>'marital_status', "payroll"->>'nationality', "payroll"->>'passport_number', "employee_extension_data",
	case when "first" then null else array_remove(array[case when ("terms"->>'residency_status') is null then 'residency_status' end, case when ("terms"->>'work_authorisation_category') is null then 'work_authorisation_category' end, case when (("terms"->>'work_authorisation_expires_on')::date) is null then 'work_authorisation_expires_on' end, case when ("payroll"->>'marital_status') is null then 'marital_status' end, case when ("payroll"->>'nationality') is null then 'nationality' end, case when ("payroll"->>'passport_number') is null then 'passport_number' end, case when ("employee_extension_data") is null then 'parameters' end], null) end
from "bolt_stint";

-- the person's fixed particulars and bank come from their newest version, and so do their dependants
update "employee_profile" e set "date_of_birth" = (v."payroll"->>'date_of_birth')::date, "identity_number" = v."payroll"->>'identity_number',
	"gender" = v."payroll"->>'gender', "birth_city" = v."payroll"->>'birth_city', "bank" = v."bank"
from (select distinct on ("employee_id") * from "bolt_stint" order by "employee_id", "f" desc) v where v."employee_id" = e."id";

insert into "dependant" ("id", "employee_id", "relation", "born_on", "expected_on", "has_income", "disabled", "studying", "allocations")
select md5(v."employee_id"::text || 'dependant' || m.n)::uuid, v."employee_id", m.item->>'relation', (m.item->>'born_on')::date, (m.item->>'expected_on')::date,
	(m.item->>'has_income')::boolean, (m.item->>'disabled')::boolean, (m.item->>'studying')::boolean, nullif(m.item->'allocations', 'null'::jsonb)
from (select distinct on ("employee_id") * from "bolt_stint" order by "employee_id", "f" desc) v,
	jsonb_array_elements(case when jsonb_typeof(v."family") = 'array' then v."family" else '[]'::jsonb end) with ordinality as m(item, n);

update "payslip" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "adhoc_catalog_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "claim_catalog_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "leave_catalog_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "loan_catalog_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "loan_catalog_entry_repayment" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "workplace_case_catalog_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "roster_entry" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "work_event" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";
update "obligation" r set "employment_id" = b."stint_id" from "bolt_stint" b where b."id" = r."employment_id" and b."stint_id" <> b."id";

-- step drop:notNull:employee_contract.effective_range (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "effective_range" drop not null;

-- step drop:notNull:employee_contract.employee_extension_data (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "employee_extension_data" drop not null;

-- step drop:notNull:employee_contract.employee_number (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "employee_number" drop not null;

-- step drop:notNull:employee_contract.encash_leave (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "encash_leave" drop not null;

-- step drop:notNull:employee_contract.engagement (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "engagement" drop not null;

-- step drop:notNull:employee_contract.status (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "status" drop not null;

-- step drop:notNull:employee_contract.terms (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "terms" drop not null;

-- step drop:notNull:contract_change.employee_id (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" alter column "employee_id" drop not null;

-- step drop:notNull:employee_contract.employee_id (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "employee_id" drop not null;

-- step drop:notNull:employee_contract.entity_id (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "entity_id" drop not null;

-- step drop:default:employee_contract.employee_extension_data (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "employee_extension_data" drop default;

-- step drop:default:employee_contract.encash_leave (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "encash_leave" drop default;

-- step drop:default:employee_contract.engagement (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "engagement" drop default;

-- step drop:default:employee_contract.status (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" alter column "status" drop default;

-- step drop:column:contract_change.effective_from (destructive)
-- accept: drop:column:contract_change.effective_from
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "effective_from" cascade;

-- step drop:column:contract_change.field_path (destructive)
-- accept: drop:column:contract_change.field_path
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "field_path" cascade;

-- step drop:column:contract_change.new_value (destructive)
-- accept: drop:column:contract_change.new_value
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "new_value" cascade;

-- step drop:column:contract_change.notes (destructive)
-- accept: drop:column:contract_change.notes
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "notes" cascade;

-- step drop:column:contract_change.old_value (destructive)
-- accept: drop:column:contract_change.old_value
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "old_value" cascade;

-- step drop:column:contract_change.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "bolt_record_label" cascade;

-- step drop:column:contract_change.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists bolt_search cascade;

-- step drop:column:employee_contract.bank (destructive)
-- accept: drop:column:employee_contract.bank
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "bank" cascade;

-- step drop:column:employee_contract.effective_range (destructive)
-- accept: drop:column:employee_contract.effective_range
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "effective_range" cascade;

-- step drop:column:employee_contract.employee_extension_data (destructive)
-- accept: drop:column:employee_contract.employee_extension_data
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "employee_extension_data" cascade;

-- step drop:column:employee_contract.employee_number (destructive)
-- accept: drop:column:employee_contract.employee_number
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "employee_number" cascade;

-- step drop:column:employee_contract.encash_leave (destructive)
-- accept: drop:column:employee_contract.encash_leave
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "encash_leave" cascade;

-- step drop:column:employee_contract.engagement (destructive)
-- accept: drop:column:employee_contract.engagement
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "engagement" cascade;

-- step drop:column:employee_contract.events (destructive)
-- accept: drop:column:employee_contract.events
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "events" cascade;

-- step drop:column:employee_contract.exit_ground (destructive)
-- accept: drop:column:employee_contract.exit_ground
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "exit_ground" cascade;

-- step drop:column:employee_contract.family (destructive)
-- accept: drop:column:employee_contract.family
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "family" cascade;

-- step drop:column:employee_contract.final_pay_due_on (destructive)
-- accept: drop:column:employee_contract.final_pay_due_on
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "final_pay_due_on" cascade;

-- step drop:column:employee_contract.payroll (destructive)
-- accept: drop:column:employee_contract.payroll
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "payroll" cascade;

-- step drop:column:employee_contract.reason (destructive)
-- accept: drop:column:employee_contract.reason
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "reason" cascade;

-- step drop:column:employee_contract.service_started_on (destructive)
-- accept: drop:column:employee_contract.service_started_on
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "service_started_on" cascade;

-- step drop:column:employee_contract.signed_contract_period (destructive)
-- accept: drop:column:employee_contract.signed_contract_period
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "signed_contract_period" cascade;

-- step drop:column:employee_contract.status (destructive)
-- accept: drop:column:employee_contract.status
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "status" cascade;

-- step drop:column:employee_contract.terms (destructive)
-- accept: drop:column:employee_contract.terms
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "terms" cascade;

-- step drop:column:employee_contract.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists bolt_search cascade;

-- step drop:column:contract_change.applied_version_id (destructive)
-- accept: drop:column:contract_change.applied_version_id
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "applied_version_id" cascade;

-- step drop:column:contract_change.employee_id (destructive)
-- accept: drop:column:contract_change.employee_id
-- operational risk: access-exclusive-lock
alter table "contract_change" drop column if exists "employee_id" cascade;

-- step drop:column:employee_contract.employee_id (destructive)
-- accept: drop:column:employee_contract.employee_id
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "employee_id" cascade;

-- step drop:column:employee_contract.entity_id (destructive)
-- accept: drop:column:employee_contract.entity_id
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "entity_id" cascade;

-- step drop:column:employee_contract.pay_group_id (destructive)
-- accept: drop:column:employee_contract.pay_group_id
-- operational risk: access-exclusive-lock
alter table "employee_contract" drop column if exists "pay_group_id" cascade;

-- step drop:table:contract_change (destructive)
-- accept: drop:table:contract_change
-- operational risk: access-exclusive-lock
drop table if exists "contract_change" cascade;

-- step drop:table:employee_contract (destructive)
-- accept: drop:table:employee_contract
-- operational risk: access-exclusive-lock
drop table if exists "employee_contract" cascade;

-- step drop:function:bolt_record_label_contract_change_82edb7c6 (additive)
drop function if exists "bolt_record_label_contract_change_82edb7c6"(date, text) cascade;

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"bank":{"kind":"custom","of":"bank","optional":true},"birth_city":{"kind":"text","optional":true},"cumulative_service":{"default":false,"kind":"bool"},"date_of_birth":{"kind":"date","optional":true},"documents":{"accept":["application/pdf","image/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"invitation_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","optional":true},"user_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"sys_user"}},"record_label":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"],"name":"invitation_id"},{"fields":["user_id"],"name":"user_id"}]}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"adhoc","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity)"}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"claim","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity) + (record.unit == ''MONEY'' ? '''' : '' '' + record.unit)"}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employment"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"inverse":"leave","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry (additive)
select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"recovered":{"hidden":true,"kind":"sum","of":"repayments.amount"},"repayment_period":{"kind":"period","of":"date"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry_repayment (additive)
select bolt_history_register('loan_catalog_entry_repayment','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_catalog_entry_repayment","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"loan_id":{"inverse":"repayments","kind":"ref","on_delete":"restrict","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"inverse":"repayment","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + string(record.amount) + (record.paid_on != null ? '' · '' + string(record.paid_on) : '''')"}'::jsonb);

-- step replace:history:schema:workplace_case_catalog_entry (additive)
select bolt_history_register('workplace_case_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"closed_on":{"kind":"date","optional":true},"description":{"kind":"text","optional":true},"employment_id":{"inverse":"workplace_case_catalog_entry","kind":"ref","on_delete":"restrict","to":"employment"},"entity_id":{"inverse":"workplace_case_catalog_entries","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"inputs":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"kind":{"kind":"text"},"location":{"kind":"text","optional":true},"occurred_on":{"kind":"date","optional":true},"opened_on":{"kind":"date"},"payroll_run_id":{"inverse":"case","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"reference":{"kind":"text","optional":true},"scheduled_on":{"kind":"date","optional":true},"severity":{"default":"N/A","kind":"enum","values":["DEATH","PERMANENT_TOTAL_DISABILITY","SERIOUS_INJURY","MINOR_INJURY","NEAR_MISS","PROPERTY_DAMAGE","N/A"]}},"locks":{"captured":{"where":{"payroll_run_id":{"is_null":false}}}},"record_label":"record.kind + '' · '' + string(record.opened_on)"}'::jsonb);

-- step replace:history:schema:obligation (additive)
select bolt_history_register('obligation','{"audit":true,"fields":{"due_on":{"kind":"date","optional":true},"employee_id":{"kind":"ref","optional":true,"to":"employee_profile"},"employment_id":{"kind":"ref","optional":true,"to":"employment"},"entity_id":{"inverse":"obligations","kind":"ref","to":"entity"},"evidence":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"fulfilled_on":{"kind":"date","optional":true},"occurrence_key":{"kind":"text"},"state":{"initial":"OPEN","kind":"state","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}},"title":{"kind":"text"},"waiver_reason":{"kind":"text","optional":true}},"locks":{"fulfilled_task":{"where":{"state":{"eq":"FULFILLED"}}},"waived_task":{"except":["waiver_reason","state"],"where":{"state":{"eq":"WAIVED"}}}},"record_label":"record.title","unique":[{"fields":["occurrence_key"],"name":"one_occurrence"}]}'::jsonb);

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","on_delete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + (record.period != null ? record.period : '''')","unique":[{"fields":["payroll_run_id","employee_id","entity_id"],"name":"run_person"}]}'::jsonb);

-- step replace:history:schema:roster_entry (additive)
select bolt_history_register('roster_entry','{"audit":true,"fields":{"actual_worked_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant","optional":true},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true,"was":"worked_intervals"},"consent":{"kind":"json","optional":true,"shape":{"fields":{"night_work":{"kind":"bool"},"overtime":{"kind":"bool"},"reference":{"kind":"text"}},"kind":"object"}},"employment_id":{"inverse":"roster_entry","kind":"ref","to":"employment"},"findings":{"default":[],"kind":"json"},"overtime_as_time_off":{"default":false,"kind":"bool"},"payroll_run_id":{"inverse":"roster_entry","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"planned_overtime_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"shift_definition_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"shift_definition"},"work_date":{"kind":"date"}},"record_label":"(has(record.employment_id.employee_number) ? record.employment_id.employee_number + '' · '' : '''') + string(record.work_date)","unique":[{"fields":["employment_id","work_date"],"import_key":true,"name":"one_day"}]}'::jsonb);

-- step replace:history:schema:work_event (additive)
select bolt_history_register('work_event','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text","optional":true},"employment_id":{"kind":"ref","optional":true,"to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"from":{"kind":"date"},"location":{"kind":"text","optional":true},"to":{"kind":"date","optional":true}},"record_label":"record.description"}'::jsonb);

-- step create:history:schema:dependant (additive)
select bolt_history_register('dependant','{"audit":true,"fields":{"allocations":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"number","min":0}}},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"employee_id":{"inverse":"dependants","kind":"ref","on_delete":"cascade","to":"employee_profile"},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"name":{"kind":"text","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"record_label":"has(record.name) ? record.name : string(record.relation)"}'::jsonb);

-- step create:history:schema:employment (additive)
select bolt_history_register('employment','{"audit":true,"fields":{"effective_range":{"kind":"period","of":"date"},"employee_id":{"inverse":"employment","kind":"ref","to":"employee_profile"},"employee_number":{"kind":"text"},"encash_leave":{"default":true,"kind":"bool"},"entity_id":{"inverse":"employment","kind":"ref","to":"entity"},"events":{"fields":{"allocated_days":{"kind":"int","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object","many":true,"optional":true},"exit_ground":{"kind":"enum","optional":true,"values":["RETRENCHMENT","RETIREMENT","RESIGNATION","DISMISSAL","MISCONDUCT_DISMISSAL","END_OF_CONTRACT","MUTUAL","DEATH","UNILATERAL","BREACH_BY_EMPLOYER"]},"final_pay_due_on":{"kind":"date","optional":true},"reason":{"kind":"text","optional":true},"service_started_on":{"kind":"date","optional":true}},"no_overlap":[{"key":["employee_id"],"name":"stints","period":"effective_range"}],"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + record.employee_number + '' · '' + string(record.effective_range.from)","search":{"text":["employee_number","employee_id"]}}'::jsonb);

-- step create:history:schema:contract_terms (additive)
select bolt_history_register('contract_terms','{"audit":true,"fields":{"allowances":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"}}},"annual_leave_carry_limit_days":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"clears":{"kind":"text","many":true,"optional":true},"department":{"kind":"text","optional":true},"effective_from":{"kind":"date"},"employee_borne_tax_items":{"kind":"text","many":true,"optional":true},"employer_bears_income_tax":{"kind":"bool","optional":true},"employment_id":{"inverse":"terms","kind":"ref","on_delete":"cascade","to":"employment"},"engagement":{"kind":"enum","optional":true,"values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"kind":"json","optional":true,"shape":{"kind":"number","max":7,"min":0}},"normal_hours_per_day":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"normal_hours_per_week":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"pay_group_id":{"inverse":"contract_terms","kind":"ref","on_delete":"restrict","optional":true,"to":"pay_group"},"probation_period":{"kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"shift_pattern_id":{"kind":"ref","optional":true,"to":"shift_pattern"},"signed_contract_period":{"kind":"period","of":"date","optional":true},"signed_on":{"kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_classification":{"kind":"text","optional":true},"work_region":{"kind":"text","optional":true},"worksite":{"kind":"text","optional":true}},"record_label":"record.effective_from","unique":[{"fields":["employment_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step create:history:schema:statutory_parameters (additive)
select bolt_history_register('statutory_parameters','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"employment_id":{"inverse":"parameters","kind":"ref","on_delete":"cascade","to":"employment"},"marital_status":{"kind":"enum","optional":true,"values":["SINGLE","MARRIED","SEPARATED","DIVORCED","WIDOWED"]},"nationality":{"kind":"text","optional":true},"parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}},"passport_number":{"kind":"text","optional":true},"residency_status":{"kind":"text","optional":true},"work_authorisation_category":{"kind":"text","optional":true},"work_authorisation_expires_on":{"kind":"date","optional":true}},"record_label":"record.effective_from","unique":[{"fields":["employment_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step create:constraint:employee_profile.employee_profile__ck__01e02f9e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where (isfinite("date_of_birth")) is false' into n;
	if n > 0 then raise exception 'employee_profile__ck__01e02f9e refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" add constraint "employee_profile__ck__01e02f9e" check (isfinite("date_of_birth"));

-- step create:constraint:employee_profile.employee_profile__ck__c4f6038f (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where ("gender" in (''MALE'', ''FEMALE'')) is false' into n;
	if n > 0 then raise exception 'employee_profile__ck__c4f6038f refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" add constraint "employee_profile__ck__c4f6038f" check ("gender" in ('MALE', 'FEMALE'));

-- step create:constraint:employee_profile.employee_profile__ck__0633b9c6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where (("bank" is null or store_json_valid("bank", ''{"kind":"custom","of":"bank","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'employee_profile__ck__0633b9c6 refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" add constraint "employee_profile__ck__0633b9c6" check (("bank" is null or store_json_valid("bank", '{"kind":"custom","of":"bank","optional":true}'::jsonb) is true));

-- step create:fk:dependant.dependant__fk__fbd45363 (additive)
alter table "dependant" add constraint "dependant__fk__fbd45363" foreign key ("employee_id") references "employee_profile" ("id") on delete cascade on update restrict;

-- step create:fk:employment.employment__fk__dfe472ed (additive)
alter table "employment" add constraint "employment__fk__dfe472ed" foreign key ("employee_id") references "employee_profile" ("id") on delete restrict on update restrict;

-- step create:fk:employment.employment__fk__70277288 (additive)
alter table "employment" add constraint "employment__fk__70277288" foreign key ("entity_id") references "entity" ("id") on delete restrict on update restrict;

-- step create:fk:contract_terms.contract_terms__fk__7f5f2adc (additive)
alter table "contract_terms" add constraint "contract_terms__fk__7f5f2adc" foreign key ("employment_id") references "employment" ("id") on delete cascade on update restrict;

-- step create:fk:contract_terms.contract_terms__fk__8d17fe20 (additive)
alter table "contract_terms" add constraint "contract_terms__fk__8d17fe20" foreign key ("pay_group_id") references "pay_group" ("id") on delete restrict on update restrict;

-- step create:fk:contract_terms.contract_terms__fk__4d56a030 (additive)
alter table "contract_terms" add constraint "contract_terms__fk__4d56a030" foreign key ("shift_pattern_id") references "shift_pattern" ("id") on delete restrict on update restrict;

-- step create:fk:statutory_parameters.statutory_parameters__fk__7f5f2adc (additive)
alter table "statutory_parameters" add constraint "statutory_parameters__fk__7f5f2adc" foreign key ("employment_id") references "employment" ("id") on delete cascade on update restrict;

-- step create:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "adhoc_catalog_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'adhoc_catalog_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "adhoc_catalog_entry" add constraint "adhoc_catalog_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:claim_catalog_entry.claim_catalog_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "claim_catalog_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'claim_catalog_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "claim_catalog_entry" add constraint "claim_catalog_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:leave_catalog_entry.leave_catalog_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'leave_catalog_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" add constraint "leave_catalog_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:loan_catalog_entry.loan_catalog_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_catalog_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'loan_catalog_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_catalog_entry" add constraint "loan_catalog_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:loan_catalog_entry_repayment.loan_catalog_entry_repayment__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_catalog_entry_repayment" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'loan_catalog_entry_repayment__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_catalog_entry_repayment" add constraint "loan_catalog_entry_repayment__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:workplace_case_catalog_entry.workplace_case_catalog_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "workplace_case_catalog_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'workplace_case_catalog_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "workplace_case_catalog_entry" add constraint "workplace_case_catalog_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:obligation.obligation__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "obligation" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'obligation__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "obligation" add constraint "obligation__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:payslip.payslip__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "payslip" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'payslip__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "payslip" add constraint "payslip__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:roster_entry.roster_entry__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "roster_entry" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'roster_entry__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "roster_entry" add constraint "roster_entry__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step create:fk:work_event.work_event__fk__ef7d12fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "work_event" c where c."employment_id" is not null and not exists (select 1 from "employment" p where p."id" = c."employment_id")' into n;
	if n > 0 then raise exception 'work_event__fk__ef7d12fe refuses % existing row(s)', n; end if;
end $store$;
alter table "work_event" add constraint "work_event__fk__ef7d12fe" foreign key ("employment_id") references "employment" ("id") on delete restrict on update restrict;

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog_entry','approval_request','claim_catalog_entry','contract_terms','dependant','employee_balance','employee_profile','employment','entity','entity_change','holiday','jurisdiction','jurisdiction_change','leave_catalog_entry','leave_catalog_entry_day','ledger_entry','loan_catalog_entry','loan_catalog_entry_repayment','obligation','pay_amendment','pay_group','payroll_run','payslip','roster_entry','shift_definition','shift_pattern','statutory_finding','statutory_parameters','statutory_source','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','work_event','workplace_case_catalog_entry']::text[]));

-- step replace:engine:audit:adhoc_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "adhoc_catalog_entry";
drop trigger if exists bolt_audit on "adhoc_catalog_entry";
create trigger bolt_audit after insert or update or delete on "adhoc_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:claim_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "claim_catalog_entry";
drop trigger if exists bolt_audit on "claim_catalog_entry";
create trigger bolt_audit after insert or update or delete on "claim_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:leave_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "leave_catalog_entry";
drop trigger if exists bolt_audit on "leave_catalog_entry";
create trigger bolt_audit after insert or update or delete on "leave_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:loan_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "loan_catalog_entry";
drop trigger if exists bolt_audit on "loan_catalog_entry";
create trigger bolt_audit after insert or update or delete on "loan_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:loan_catalog_entry_repayment (additive)
drop trigger if exists bolt_audit_mark on "loan_catalog_entry_repayment";
drop trigger if exists bolt_audit on "loan_catalog_entry_repayment";
create trigger bolt_audit after insert or update or delete on "loan_catalog_entry_repayment" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["loan_id","loan_catalog_entry"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:workplace_case_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "workplace_case_catalog_entry";
drop trigger if exists bolt_audit on "workplace_case_catalog_entry";
create trigger bolt_audit after insert or update or delete on "workplace_case_catalog_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:obligation (additive)
drop trigger if exists bolt_audit_mark on "obligation";
drop trigger if exists bolt_audit on "obligation";
create trigger bolt_audit after insert or update or delete on "obligation" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employee_id","employee_profile"],["employment_id","employment"],["entity_id","entity"]]');

-- step replace:engine:audit:payslip (additive)
drop trigger if exists bolt_audit_mark on "payslip";
drop trigger if exists bolt_audit on "payslip";
create trigger bolt_audit after insert or update or delete on "payslip" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employee_id","employee_profile"],["employment_id","employment"],["entity_id","entity"],["payroll_run_id","payroll_run"]]');

-- step replace:engine:audit:roster_entry (additive)
drop trigger if exists bolt_audit_mark on "roster_entry";
drop trigger if exists bolt_audit on "roster_entry";
create trigger bolt_audit after insert or update or delete on "roster_entry" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["payroll_run_id","payroll_run"],["shift_definition_id","shift_definition"]]');

-- step replace:engine:audit:work_event (additive)
drop trigger if exists bolt_audit_mark on "work_event";
drop trigger if exists bolt_audit on "work_event";
create trigger bolt_audit after insert or update or delete on "work_event" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["entity_id","entity"]]');

-- step create:trigger:dependant.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "dependant" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:dependant.dependant__gin__73732636 (additive)
create index "dependant__gin__73732636" on "dependant" using gin (bolt_search);

-- step create:trigger:employment.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employment" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:employment.employment__gin__73732636 (additive)
create index "employment__gin__73732636" on "employment" using gin (bolt_search);

-- step create:trigger:contract_terms.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "contract_terms" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:contract_terms.contract_terms__gin__eb429614 (additive)
create index "contract_terms__gin__eb429614" on "contract_terms" using gin ("employee_borne_tax_items");

-- step create:index:contract_terms.contract_terms__gin__b9550c34 (additive)
create index "contract_terms__gin__b9550c34" on "contract_terms" using gin ("clears");

-- step create:index:contract_terms.contract_terms__gin__73732636 (additive)
create index "contract_terms__gin__73732636" on "contract_terms" using gin (bolt_search);

-- step create:trigger:statutory_parameters.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_parameters" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:statutory_parameters.statutory_parameters__gin__b9550c34 (additive)
create index "statutory_parameters__gin__b9550c34" on "statutory_parameters" using gin ("clears");

-- step create:index:statutory_parameters.statutory_parameters__gin__73732636 (additive)
create index "statutory_parameters__gin__73732636" on "statutory_parameters" using gin (bolt_search);

-- step create:index:dependant.dependant__ix__b0e10b14 (additive)
create index "dependant__ix__b0e10b14" on "dependant" ("employee_id");

-- step create:index:employment.employment__ix__b0e10b14 (additive)
create index "employment__ix__b0e10b14" on "employment" ("employee_id");

-- step create:index:employment.employment__ix__26554388 (additive)
create index "employment__ix__26554388" on "employment" ("entity_id");

-- step create:index:contract_terms.contract_terms__ix__c9f435cb (additive)
create index "contract_terms__ix__c9f435cb" on "contract_terms" ("employment_id");

-- step create:index:contract_terms.contract_terms__ix__2f5c3491 (additive)
create index "contract_terms__ix__2f5c3491" on "contract_terms" ("pay_group_id");

-- step create:index:contract_terms.contract_terms__ix__401a14cf (additive)
create index "contract_terms__ix__401a14cf" on "contract_terms" ("shift_pattern_id");

-- step create:index:statutory_parameters.statutory_parameters__ix__c9f435cb (additive)
create index "statutory_parameters__ix__c9f435cb" on "statutory_parameters" ("employment_id");

-- step create:engine:audit:dependant (additive)
drop trigger if exists bolt_audit_mark on "dependant";
drop trigger if exists bolt_audit on "dependant";
create trigger bolt_audit after insert or update or delete on "dependant" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employee_id","employee_profile"]]');

-- step create:engine:audit:employment (additive)
drop trigger if exists bolt_audit_mark on "employment";
drop trigger if exists bolt_audit on "employment";
create trigger bolt_audit after insert or update or delete on "employment" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employee_id","employee_profile"],["entity_id","entity"]]');

-- step create:engine:audit:contract_terms (additive)
drop trigger if exists bolt_audit_mark on "contract_terms";
drop trigger if exists bolt_audit on "contract_terms";
create trigger bolt_audit after insert or update or delete on "contract_terms" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"],["pay_group_id","pay_group"],["shift_pattern_id","shift_pattern"]]');

-- step create:engine:audit:statutory_parameters (additive)
drop trigger if exists bolt_audit_mark on "statutory_parameters";
drop trigger if exists bolt_audit on "statutory_parameters";
create trigger bolt_audit after insert or update or delete on "statutory_parameters" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["employment_id","employment"]]');
