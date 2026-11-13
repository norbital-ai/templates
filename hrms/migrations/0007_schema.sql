-- 0007_schema.sql: 86 step(s), from fbe45e4fbd3294d024b1a5ed2292f211328f8e44c609f5f36f3f973acaf095a5 to 7617c107477b4640e68f5b38b77f73139a9b806604dbd524a03e18440cf8842c.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:trigger:entity_change.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "entity_change";

-- step drop:trigger:entity_change.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "entity_change";

-- step drop:trigger:entity_profile_version.store_row_rules (additive)
drop trigger if exists store_row_rules on "entity_profile_version";

-- step drop:trigger:entity_profile_version.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "entity_profile_version";

-- step drop:trigger:entity_profile_version.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "entity_profile_version";

-- step drop:index:entity_profile_version.entity_profile_version__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_profile_version__gin__73732636";

-- step drop:index:entity_change.entity_change__ix__9803300f (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_change__ix__9803300f";

-- step drop:index:entity_profile_version.entity_profile_version__ix__26554388 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_profile_version__ix__26554388";

-- step replace:index:entity_change.entity_change__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "entity_change__gin__73732636";

-- step drop:fk:entity_change.entity_change__fk__cabe92d4 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__fk__cabe92d4";

-- step drop:fk:entity_profile_version.entity_profile_version__fk__70277288 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__fk__70277288";

-- step drop:constraint:entity_change.entity_change__ck__73129686 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__ck__73129686";

-- step drop:constraint:entity_change.entity_change__ck__85dd0d0d (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__ck__85dd0d0d";

-- step drop:constraint:entity_change.entity_change__uq__9c85363f (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__uq__9c85363f";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__0633b9c6 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__0633b9c6";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__b16c6b5e (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__b16c6b5e";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__ad3b68d8 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__ad3b68d8";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__cea79742 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__cea79742";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__dda23d17 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__dda23d17";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__88a9ce0a (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__88a9ce0a";

-- step drop:constraint:entity_profile_version.entity_profile_version__ck__a3a63477 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ck__a3a63477";

-- step drop:constraint:entity_profile_version.entity_profile_version__ex__229b5c56 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop constraint if exists "entity_profile_version__ex__229b5c56";

-- step drop:notNull:entity_change.field_path (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" alter column "field_path" drop not null;

-- step drop:notNull:entity_profile_version.effective_range (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "effective_range" drop not null;

-- step drop:notNull:entity_profile_version.entity_extension_data (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "entity_extension_data" drop not null;

-- step drop:notNull:entity_profile_version.final_pay_loan_floor_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "final_pay_loan_floor_percent" drop not null;

-- step drop:notNull:entity_profile_version.name (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "name" drop not null;

-- step drop:notNull:entity_profile_version.overtime_full_award_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "overtime_full_award_percent" drop not null;

-- step drop:notNull:entity_profile_version.settings_code (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "settings_code" drop not null;

-- step drop:notNull:entity_profile_version.status (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "status" drop not null;

-- step drop:notNull:entity_profile_version.entity_id (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "entity_id" drop not null;

-- step drop:default:entity_profile_version.entity_extension_data (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "entity_extension_data" drop default;

-- step drop:default:entity_profile_version.final_pay_loan_floor_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "final_pay_loan_floor_percent" drop default;

-- step drop:default:entity_profile_version.overtime_full_award_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "overtime_full_award_percent" drop default;

-- step drop:default:entity_profile_version.status (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" alter column "status" drop default;

-- step create:column:entity.representative_name (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "representative_name" text;

-- step create:column:entity.registered_address (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "registered_address" text;

-- step create:column:entity.time_zone (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "time_zone" text;

-- step create:column:entity.bank (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "bank" jsonb;

-- step create:column:entity_change.pay_methods (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" add column "pay_methods" jsonb;

-- step create:column:entity_change.final_pay_loan_floor_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" add column "final_pay_loan_floor_percent" int;

-- step create:column:entity_change.overtime_full_award_percent (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" add column "overtime_full_award_percent" int;

-- step create:column:entity_change.statutory_parameters (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" add column "statutory_parameters" jsonb;

-- step create:column:entity_change.clears (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" add column "clears" text[];

-- a company's particulars are its own: carried over from its newest sealed version
update "entity" e set "representative_name" = v."representative_name", "registered_address" = v."registered_address", "time_zone" = v."time_zone", "bank" = v."bank"
from (select distinct on ("entity_id") * from "entity_profile_version" where "status" = 'SEALED' order by "entity_id", lower("effective_range") desc) v
where v."entity_id" = e."id";

-- a change filed ahead was never in force; each sealed version is a change from its first day
delete from "entity_change";
insert into "entity_change" ("id", "entity_id", "effective_from", "pay_methods", "final_pay_loan_floor_percent", "overtime_full_award_percent", "statutory_parameters")
select "id", "entity_id", lower("effective_range"), "pay_methods", "final_pay_loan_floor_percent", "overtime_full_award_percent", "entity_extension_data"
from "entity_profile_version" where "status" = 'SEALED';

-- step drop:column:entity_change.field_path (destructive)
-- accept: drop:column:entity_change.field_path
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "field_path" cascade;

-- step drop:column:entity_change.new_value (destructive)
-- accept: drop:column:entity_change.new_value
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "new_value" cascade;

-- step drop:column:entity_change.notes (destructive)
-- accept: drop:column:entity_change.notes
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "notes" cascade;

-- step drop:column:entity_change.old_value (destructive)
-- accept: drop:column:entity_change.old_value
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "old_value" cascade;

-- step drop:column:entity_profile_version.bank (destructive)
-- accept: drop:column:entity_profile_version.bank
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "bank" cascade;

-- step drop:column:entity_profile_version.effective_range (destructive)
-- accept: drop:column:entity_profile_version.effective_range
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "effective_range" cascade;

-- step drop:column:entity_profile_version.entity_extension_data (destructive)
-- accept: drop:column:entity_profile_version.entity_extension_data
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "entity_extension_data" cascade;

-- step drop:column:entity_profile_version.final_pay_loan_floor_percent (destructive)
-- accept: drop:column:entity_profile_version.final_pay_loan_floor_percent
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "final_pay_loan_floor_percent" cascade;

-- step drop:column:entity_profile_version.name (destructive)
-- accept: drop:column:entity_profile_version.name
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "name" cascade;

-- step drop:column:entity_profile_version.overtime_full_award_percent (destructive)
-- accept: drop:column:entity_profile_version.overtime_full_award_percent
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "overtime_full_award_percent" cascade;

-- step drop:column:entity_profile_version.pay_methods (destructive)
-- accept: drop:column:entity_profile_version.pay_methods
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "pay_methods" cascade;

-- step drop:column:entity_profile_version.reason (destructive)
-- accept: drop:column:entity_profile_version.reason
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "reason" cascade;

-- step drop:column:entity_profile_version.registered_address (destructive)
-- accept: drop:column:entity_profile_version.registered_address
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "registered_address" cascade;

-- step drop:column:entity_profile_version.representative_name (destructive)
-- accept: drop:column:entity_profile_version.representative_name
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "representative_name" cascade;

-- step drop:column:entity_profile_version.settings_code (destructive)
-- accept: drop:column:entity_profile_version.settings_code
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "settings_code" cascade;

-- step drop:column:entity_profile_version.status (destructive)
-- accept: drop:column:entity_profile_version.status
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "status" cascade;

-- step drop:column:entity_profile_version.time_zone (destructive)
-- accept: drop:column:entity_profile_version.time_zone
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "time_zone" cascade;

-- step drop:column:entity_profile_version.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "bolt_record_label" cascade;

-- step drop:column:entity_profile_version.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists bolt_search cascade;

-- step drop:column:entity_change.applied_version_id (destructive)
-- accept: drop:column:entity_change.applied_version_id
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "applied_version_id" cascade;

-- step drop:column:entity_profile_version.entity_id (destructive)
-- accept: drop:column:entity_profile_version.entity_id
-- operational risk: access-exclusive-lock
alter table "entity_profile_version" drop column if exists "entity_id" cascade;

-- step replace:column:entity_change.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "bolt_record_label" cascade;

-- step replace:column:entity_change.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists bolt_search cascade;

-- step drop:table:entity_profile_version (destructive)
-- accept: drop:table:entity_profile_version
-- operational risk: access-exclusive-lock
drop table if exists "entity_profile_version" cascade;

-- step drop:function:bolt_record_label_entity_change_82edb7c6 (additive)
drop function if exists "bolt_record_label_entity_change_82edb7c6"(date, text) cascade;

-- step drop:function:bolt_record_label_entity_profile_version_93340fdd (additive)
drop function if exists "bolt_record_label_entity_profile_version_93340fdd"(text) cascade;

-- step create:function:bolt_record_label_entity_change_58d6e27a (additive)
create function "bolt_record_label_entity_change_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row) label_value$record_label$;

-- step replace:column:entity_change.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "entity_change" add column "bolt_record_label" text generated always as ("bolt_record_label_entity_change_58d6e27a"("effective_from")) stored;

-- step replace:column:entity_change.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "entity_change" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_entity_change_58d6e27a"("effective_from"), ''))) stored;

-- step replace:history:schema:entity (additive)
select bolt_history_register('entity','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"code":{"kind":"text","optional":true},"epf_registered_on":{"kind":"date","optional":true},"name":{"kind":"text"},"registered_address":{"kind":"text","optional":true},"representative_name":{"kind":"text","optional":true},"settings_code":{"kind":"text"},"socso_registered_on":{"kind":"date","optional":true},"source_reference":{"kind":"text","optional":true},"time_zone":{"kind":"text","optional":true}},"record_label":"record.name","search":{"text":["code","name"]},"unique":[{"fields":["code"],"name":"code"}]}'::jsonb);

-- step replace:history:schema:entity_change (additive)
select bolt_history_register('entity_change','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"entity_id":{"inverse":"changes","kind":"ref","on_delete":"cascade","to":"entity"},"final_pay_loan_floor_percent":{"kind":"int","max":100,"min":0,"optional":true},"overtime_full_award_percent":{"kind":"int","max":100,"min":1,"optional":true},"pay_methods":{"fields":{"benefit_exclusion":{"default":"POOLED","kind":"enum","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","kind":"enum","values":["EVEN","FIRST_RUN"]},"health_billing":{"default":"CURRENT","kind":"enum","values":["CURRENT","ARREARS"]},"night_differential_basis":{"default":"WORKED","kind":"enum","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","kind":"enum","values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true},"statutory_parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["entity_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step create:constraint:entity.entity__ck__0633b9c6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity" where (("bank" is null or store_json_valid("bank", ''{"kind":"custom","of":"bank","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'entity__ck__0633b9c6 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity" add constraint "entity__ck__0633b9c6" check (("bank" is null or store_json_valid("bank", '{"kind":"custom","of":"bank","optional":true}'::jsonb) is true));

-- step create:constraint:entity_change.entity_change__ck__88a9ce0a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where (("pay_methods" is null or store_json_valid("pay_methods", ''{"fields":{"benefit_exclusion":{"default":"POOLED","kind":"enum","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","kind":"enum","values":["EVEN","FIRST_RUN"]},"health_billing":{"default":"CURRENT","kind":"enum","values":["CURRENT","ARREARS"]},"night_differential_basis":{"default":"WORKED","kind":"enum","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","kind":"enum","values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__88a9ce0a refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__88a9ce0a" check (("pay_methods" is null or store_json_valid("pay_methods", '{"fields":{"benefit_exclusion":{"default":"POOLED","kind":"enum","values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"default":"EVEN","kind":"enum","values":["EVEN","FIRST_RUN"]},"health_billing":{"default":"CURRENT","kind":"enum","values":["CURRENT","ARREARS"]},"night_differential_basis":{"default":"WORKED","kind":"enum","values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"default":"STATUTORY","kind":"enum","values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true}'::jsonb) is true));

-- step create:constraint:entity_change.entity_change__ck__cea79742 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where ("final_pay_loan_floor_percent" >= 0 and "final_pay_loan_floor_percent" <= 100) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__cea79742 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__cea79742" check ("final_pay_loan_floor_percent" >= 0 and "final_pay_loan_floor_percent" <= 100);

-- step create:constraint:entity_change.entity_change__ck__dda23d17 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where ("overtime_full_award_percent" >= 1 and "overtime_full_award_percent" <= 100) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__dda23d17 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__dda23d17" check ("overtime_full_award_percent" >= 1 and "overtime_full_award_percent" <= 100);

-- step create:constraint:entity_change.entity_change__ck__ac87d3fe (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where (("statutory_parameters" is null or store_json_valid("statutory_parameters", ''{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__ac87d3fe refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__ac87d3fe" check (("statutory_parameters" is null or store_json_valid("statutory_parameters", '{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}'::jsonb) is true));

-- step create:constraint:entity_change.entity_change__ck__64a2ceb8 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where (not jsonb_path_exists(to_jsonb("clears"), ''strict $[*] ? (@.type() != "string")'')) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__64a2ceb8 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__64a2ceb8" check (not jsonb_path_exists(to_jsonb("clears"), 'strict $[*] ? (@.type() != "string")'));

-- step create:constraint:entity_change.entity_change__uq__27cd9d33 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "entity_change" group by "entity_id", "effective_from" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'entity_change__uq__27cd9d33 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__uq__27cd9d33" unique nulls not distinct ("entity_id", "effective_from") deferrable initially immediate;

-- step replace:index:entity_change.entity_change__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "entity_change__gin__73732636" on "entity_change" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog_entry','approval_request','claim_catalog_entry','contract_change','employee_balance','employee_contract','employee_profile','entity','entity_change','holiday','jurisdiction','jurisdiction_change','leave_catalog_entry','leave_catalog_entry_day','ledger_entry','loan_catalog_entry','loan_catalog_entry_repayment','obligation','pay_amendment','pay_group','payroll_run','payslip','roster_entry','shift_definition','shift_pattern','statutory_finding','statutory_source','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','work_event','workplace_case_catalog_entry']::text[]));

-- step replace:engine:audit:entity_change (additive)
drop trigger if exists bolt_audit_mark on "entity_change";
drop trigger if exists bolt_audit on "entity_change";
create trigger bolt_audit after insert or update or delete on "entity_change" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["entity_id","entity"]]');

-- step create:index:entity_change.entity_change__gin__b9550c34 (additive)
-- operational risk: writes-blocked, table-scan
create index "entity_change__gin__b9550c34" on "entity_change" using gin ("clears");
