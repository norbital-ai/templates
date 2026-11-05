-- 0018_schema.sql: 76 step(s), from 1427075055387c8d22176bbd53259bad3ce33aada8e26c571685b13ba0a3e2f6 to 3e3c81174043e87582639e4d89827a1f7ffe0d8ddbdd312e4314a0cf1f7e0ec1.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:payroll_run.payroll_run__ix__f13bdd14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payroll_run__ix__f13bdd14";

-- step replace:trigger:payroll_run.store_row_rules (additive)
drop trigger if exists store_row_rules on "payroll_run";

-- step replace:trigger:payslip.store_row_rules (additive)
drop trigger if exists store_row_rules on "payslip";

-- step replace:index:payslip.payslip__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payslip__gin__73732636";

-- step drop:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" drop constraint if exists "adhoc_catalog_entry__fk__ece28443";

-- step drop:fk:claim_catalog_entry.claim_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" drop constraint if exists "claim_catalog_entry__fk__ece28443";

-- step drop:fk:leave_catalog_entry.leave_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" drop constraint if exists "leave_catalog_entry__fk__ece28443";

-- step drop:fk:loan_catalog_entry.loan_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_catalog_entry" drop constraint if exists "loan_catalog_entry__fk__ece28443";

-- step drop:fk:loan_repayment_entry.loan_repayment_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "loan_repayment_entry" drop constraint if exists "loan_repayment_entry__fk__ece28443";

-- step drop:fk:payroll_run.payroll_run__fk__3bdf8a6f (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__fk__3bdf8a6f";

-- step drop:fk:roster_entry.roster_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "roster_entry" drop constraint if exists "roster_entry__fk__ece28443";

-- step drop:fk:work_interruption_catalog_entry.work_interruption_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "work_interruption_catalog_entry" drop constraint if exists "work_interruption_catalog_entry__fk__ece28443";

-- step drop:fk:workplace_case_catalog_entry.workplace_case_catalog_entry__fk__ece28443 (additive)
-- operational risk: access-exclusive-lock
alter table "workplace_case_catalog_entry" drop constraint if exists "workplace_case_catalog_entry__fk__ece28443";

-- step drop:constraint:payroll_run.payroll_run__ck__9eb75b4f (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__9eb75b4f";

-- step drop:constraint:payroll_run.payroll_run__ck__82b2b5fb (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__82b2b5fb";

-- step drop:constraint:payroll_run.payroll_run__ck__a60ae687 (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__a60ae687";

-- step drop:constraint:payroll_run.payroll_run__ck__401ed505 (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__401ed505";

-- step drop:constraint:payroll_run.payroll_run__ck__c65ae59b (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__c65ae59b";

-- step drop:constraint:payroll_run.payroll_run__ck__a0db6e59 (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__a0db6e59";

-- step drop:constraint:payroll_run.payroll_run__ck__ac75ed33 (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__ck__ac75ed33";

-- step drop:constraint:payroll_run.payroll_run__uq__b1d77ab4 (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop constraint if exists "payroll_run__uq__b1d77ab4";

-- step drop:constraint:payslip.payslip__ck__7720a99e (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" drop constraint if exists "payslip__ck__7720a99e";

-- step drop:notNull:payroll_run.attendance_coverage (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "attendance_coverage" drop not null;

-- step drop:notNull:payroll_run.findings (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "findings" drop not null;

-- step drop:notNull:payroll_run.occurrence_key (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "occurrence_key" drop not null;

-- step drop:notNull:payroll_run.pay_due_date (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "pay_due_date" drop not null;

-- step drop:notNull:payroll_run.payment_timezone (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "payment_timezone" drop not null;

-- step drop:notNull:payroll_run.source_manifest (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "source_manifest" drop not null;

-- step drop:notNull:payslip.state (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "state" drop not null;

-- step drop:default:payroll_run.findings (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "findings" drop default;

-- step drop:default:payroll_run.source_manifest (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "source_manifest" drop default;

-- step drop:default:payslip.state (additive)
-- operational risk: access-exclusive-lock
alter table "payslip" alter column "state" drop default;

-- step replace:default:payroll_run.state (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "state" drop default;

-- step drop:column:payroll_run.attendance_coverage (destructive)
-- accept: drop:column:payroll_run.attendance_coverage
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "attendance_coverage" cascade;

-- step drop:column:payroll_run.findings (destructive)
-- accept: drop:column:payroll_run.findings
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "findings" cascade;

-- step drop:column:payroll_run.occurrence_key (destructive)
-- accept: drop:column:payroll_run.occurrence_key
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "occurrence_key" cascade;

-- step drop:column:payroll_run.pay_due_date (destructive)
-- accept: drop:column:payroll_run.pay_due_date
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "pay_due_date" cascade;

-- step drop:column:payroll_run.payment_timezone (destructive)
-- accept: drop:column:payroll_run.payment_timezone
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "payment_timezone" cascade;

-- step drop:column:payroll_run.replacement_reason (destructive)
-- accept: drop:column:payroll_run.replacement_reason
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "replacement_reason" cascade;

-- step drop:column:payroll_run.source_manifest (destructive)
-- accept: drop:column:payroll_run.source_manifest
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "source_manifest" cascade;

-- step drop:column:payroll_run.source_reference (destructive)
-- accept: drop:column:payroll_run.source_reference
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "source_reference" cascade;

-- step drop:column:payslip.state (destructive)
-- accept: drop:column:payslip.state
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "state" cascade;

-- step drop:column:payroll_run.replacement_of_id (destructive)
-- accept: drop:column:payroll_run.replacement_of_id
-- operational risk: access-exclusive-lock
alter table "payroll_run" drop column if exists "replacement_of_id" cascade;

-- step replace:column:payslip.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists "bolt_record_label" cascade;

-- step replace:column:payslip.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "payslip" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_payslip_9132e949 (additive)
drop function if exists "bolt_record_label_payslip_9132e949"(numeric, text) cascade;

-- step create:function:bolt_record_label_payslip_e54569f4 (additive)
create function "bolt_record_label_payslip_e54569f4"(numeric) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['net_pay']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('net_pay', to_jsonb(("net_pay")::text)) AS j FROM (SELECT $1 AS "net_pay") label_inputs) label_row) label_value$record_label$;

-- step replace:column:payslip.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "payslip" add column "bolt_record_label" text generated always as ("bolt_record_label_payslip_e54569f4"("net_pay")) stored;

-- step replace:column:payslip.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "payslip" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_payslip_e54569f4"("net_pay"), ''))) stored;

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.description"}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","label":"Amount","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"string(record.quantity) + '' '' + record.unit"}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"days":{"kind":"list","min":1,"of":{"fields":{"date":{"kind":"date"},"part":{"kind":"enum","values":["AM","PM"]}},"kind":"object"}},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"}},"nativeRules":2,"recordLabel":"string(size(record.days)) + '' half-days''"}'::jsonb);

-- step replace:history:schema:loan_catalog_entry (additive)
select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"loan_catalog"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"repayment_period":{"kind":"period","of":"date"}},"nativeRules":2,"recordLabel":"string(record.quantity)"}'::jsonb);

-- step replace:history:schema:loan_repayment_entry (additive)
select bolt_history_register('loan_repayment_entry','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_repayment_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"is_reversal":{"default":false,"kind":"bool"},"loan_id":{"inverse":"repayments","kind":"ref","onDelete":"restrict","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"}},"nativeRules":2,"recordLabel":"record.payment_reference"}'::jsonb);

-- step replace:history:schema:work_interruption_catalog_entry (additive)
select bolt_history_register('work_interruption_catalog_entry','{"audit":true,"fields":{"catalog_id":{"inverse":"entries","kind":"ref","onDelete":"restrict","to":"work_interruption_catalog"},"entity_id":{"inverse":"work_interruptions","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","label":"Document","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"period":{"kind":"period","of":"date"},"reason":{"kind":"text","optional":true},"worksite":{"kind":"text","optional":true}},"nativeRules":2,"recordLabel":"record.reason"}'::jsonb);

-- step replace:history:schema:workplace_case_catalog_entry (additive)
select bolt_history_register('workplace_case_catalog_entry','{"audit":true,"fields":{"catalog_id":{"inverse":"entries","kind":"ref","onDelete":"restrict","to":"workplace_case_catalog"},"closed_on":{"kind":"date","optional":true},"entity_id":{"inverse":"workplace_case_catalog_entries","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","label":"Document","max":"20MiB","optional":true},"inputs":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"kind":{"kind":"text"},"opened_on":{"kind":"date"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"scheduled_on":{"kind":"date","optional":true}},"nativeRules":2,"recordLabel":"record.kind"}'::jsonb);

-- step replace:history:schema:payroll_run (additive)
select bolt_history_register('payroll_run','{"audit":true,"fields":{"entity_id":{"inverse":"payroll_runs","kind":"ref","to":"entity"},"kind":{"default":"ON_CYCLE","kind":"enum","values":["ON_CYCLE","OFF_CYCLE"]},"pay_date":{"kind":"date"},"period":{"kind":"text"},"run_number":{"kind":"seq"},"salary_coverage":{"kind":"period","of":"date"},"settings_id":{"kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"state":{"initial":"UNPAID","kind":"state","states":{"PAID":{"edit":"none","to":[]},"UNPAID":{"edit":["state"],"to":["PAID"]}}}},"nativeRules":2,"recordLabel":"record.run_number","unique":[{"fields":["entity_id","period"],"where":{"kind":{"eq":"ON_CYCLE"}}}]}'::jsonb);

-- step replace:history:schema:payslip (additive)
select bolt_history_register('payslip','{"audit":true,"fields":{"additional_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","onDelete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"settings_id":{"kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"nativeRules":2,"recordLabel":"string(record.net_pay)","unique":[{"fields":["payroll_run_id","employee_id","entity_id"]}]}'::jsonb);

-- step replace:history:schema:roster_entry (additive)
select bolt_history_register('roster_entry','{"audit":true,"fields":{"actual_worked_intervals":{"kind":"list","of":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"kind":"list","of":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"end":{"kind":"instant","optional":true},"start":{"kind":"instant"}},"kind":"object"},"optional":true,"was":"worked_intervals"},"employment_id":{"inverse":"roster_entry","kind":"ref","to":"employee_contract"},"findings":{"default":[],"kind":"json"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"planned_overtime_intervals":{"kind":"list","of":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"kind":"list","of":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"shift_definition_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"shift_definition"},"work_date":{"kind":"date"}},"nativeRules":2,"recordLabel":"record.work_date","unique":[{"fields":["employment_id","work_date"]}]}'::jsonb);

-- step replace:default:payroll_run.state (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "state" set default 'UNPAID';

-- step create:default:payroll_run.kind (additive)
-- operational risk: access-exclusive-lock
alter table "payroll_run" alter column "kind" set default 'ON_CYCLE'::text;
update "payroll_run" set "kind" = case when "kind" = 'REGULAR' then 'ON_CYCLE' else 'OFF_CYCLE' end where "kind" not in ('ON_CYCLE', 'OFF_CYCLE');
update "payroll_run" set "state" = 'UNPAID' where "state" = 'FINALISED';

-- step create:constraint:payroll_run.payroll_run__ck__9567fad3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "payroll_run" where ("kind" in (''ON_CYCLE'', ''OFF_CYCLE'')) is false' into n;
	if n > 0 then raise exception 'payroll_run__ck__9567fad3 refuses % existing row(s)', n; end if;
end $store$;
alter table "payroll_run" add constraint "payroll_run__ck__9567fad3" check ("kind" in ('ON_CYCLE', 'OFF_CYCLE'));

-- step create:constraint:payroll_run.payroll_run__ck__840f16b4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "payroll_run" where ("state" in (''PAID'', ''UNPAID'')) is false' into n;
	if n > 0 then raise exception 'payroll_run__ck__840f16b4 refuses % existing row(s)', n; end if;
end $store$;
alter table "payroll_run" add constraint "payroll_run__ck__840f16b4" check ("state" in ('PAID', 'UNPAID'));

-- step create:constraint:payroll_run.payroll_run__ex__e9998e47 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "payroll_run" where (coalesce("kind" = ''ON_CYCLE''::text, false)) group by "entity_id", "period" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'payroll_run__ex__e9998e47 refuses % existing row(s)', n; end if;
end $store$;
alter table "payroll_run" add constraint "payroll_run__ex__e9998e47" exclude using btree ("entity_id" with =, "period" with =) where (coalesce("kind" = 'ON_CYCLE'::text, false)) deferrable initially immediate;

-- step create:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "adhoc_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'adhoc_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "adhoc_catalog_entry" add constraint "adhoc_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:claim_catalog_entry.claim_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "claim_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'claim_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "claim_catalog_entry" add constraint "claim_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:leave_catalog_entry.leave_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'leave_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" add constraint "leave_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:loan_catalog_entry.loan_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'loan_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_catalog_entry" add constraint "loan_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:loan_repayment_entry.loan_repayment_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "loan_repayment_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'loan_repayment_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "loan_repayment_entry" add constraint "loan_repayment_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:work_interruption_catalog_entry.work_interruption_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "work_interruption_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'work_interruption_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "work_interruption_catalog_entry" add constraint "work_interruption_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:workplace_case_catalog_entry.workplace_case_catalog_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "workplace_case_catalog_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'workplace_case_catalog_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "workplace_case_catalog_entry" add constraint "workplace_case_catalog_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step create:fk:roster_entry.roster_entry__fk__fe7e3555 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "roster_entry" c where c."payroll_run_id" is not null and not exists (select 1 from "payroll_run" p where p."id" = c."payroll_run_id")' into n;
	if n > 0 then raise exception 'roster_entry__fk__fe7e3555 refuses % existing row(s)', n; end if;
end $store$;
alter table "roster_entry" add constraint "roster_entry__fk__fe7e3555" foreign key ("payroll_run_id") references "payroll_run" ("id") on delete set null on update restrict;

-- step replace:trigger:payroll_run.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "payroll_run" for each row execute function store_row_rules('{"audit":true,"fields":{"entity_id":["entity_id"],"kind":["kind"],"pay_date":["pay_date"],"period":["period"],"salary_coverage":["salary_coverage"],"settings_id":["settings_id"],"state":["state"]},"key":["id"],"parents":[],"states":{"state":{"initial":"UNPAID","states":{"PAID":{"edit":"none","to":[]},"UNPAID":{"edit":["state"],"to":["PAID"]}}}}}');

-- step replace:trigger:payslip.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "payslip" for each row execute function store_row_rules('{"audit":true,"fields":{"additional_wages":["additional_wages"],"basic_earnings":["basic_earnings"],"breakdown":["breakdown"],"employee_id":["employee_id"],"employee_statutory":["employee_statutory"],"employer_cost":["employer_cost"],"employer_statutory":["employer_statutory"],"employment_id":["employment_id"],"entity_id":["entity_id"],"gross_earnings":["gross_earnings"],"net_pay":["net_pay"],"ordinary_wages":["ordinary_wages"],"payroll_run_id":["payroll_run_id"],"period":["period"],"settings_id":["settings_id"],"tax_withheld":["tax_withheld"],"total_deductions":["total_deductions"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:index:payslip.payslip__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "payslip__gin__73732636" on "payslip" using gin (bolt_search);

-- step replace:engine:audit:payroll_run (additive)
drop trigger if exists bolt_audit_mark on "payroll_run";
create trigger bolt_audit_mark before insert or update or delete on "payroll_run" for each row execute function bolt_audit_mark('[]','[["entity_id","entity"],["settings_id","jurisdiction_settings"]]');
drop trigger if exists bolt_audit on "payroll_run";
create trigger bolt_audit after insert or update or delete on "payroll_run" for each row execute function bolt_audit('[]','[["entity_id","entity"],["settings_id","jurisdiction_settings"]]');
