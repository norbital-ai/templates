-- 0002_schema.sql: 28 step(s), from ab7379e4c7abbf4903483588aab1bf1e2497ac1a5e547984195aa46ac5bafe27 to 3bd7dcffebc36c6d6d6a4fe8870aabd8d92e34bb2b33d595108ab83edbc47bfc.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:trigger:contract_exit.store_row_rules (additive)
drop trigger if exists store_row_rules on "contract_exit";

-- step drop:index:contract_exit.contract_exit__ix__b0e10b14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_exit__ix__b0e10b14";

-- step drop:index:contract_exit.contract_exit__ix__c9f435cb (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_exit__ix__c9f435cb";

-- step drop:index:contract_exit.contract_exit__ix__26554388 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_exit__ix__26554388";

-- step drop:index:contract_exit.contract_exit__ix__81c3962d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contract_exit__ix__81c3962d";

-- step drop:fk:contract_exit.contract_exit__fk__fbd45363 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__fk__fbd45363";

-- step drop:fk:contract_exit.contract_exit__fk__b2689e2c (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__fk__b2689e2c";

-- step drop:fk:contract_exit.contract_exit__fk__b14b53a8 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__fk__b14b53a8";

-- step drop:fk:contract_exit.contract_exit__fk__904a13bb (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__fk__904a13bb";

-- step drop:constraint:contract_exit.contract_exit__ck__62cb136a (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__ck__62cb136a";

-- step drop:constraint:contract_exit.contract_exit__ck__ca8464ef (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__ck__ca8464ef";

-- step drop:constraint:contract_exit.contract_exit__uq__6b3fbd36 (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop constraint if exists "contract_exit__uq__6b3fbd36";

-- step drop:constraint:registered_effect.registered_effect__ck__0b01c0b9 (additive)
-- operational risk: access-exclusive-lock
alter table "registered_effect" drop constraint if exists "registered_effect__ck__0b01c0b9";

-- step drop:notNull:contract_exit.effective_to (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" alter column "effective_to" drop not null;

-- step drop:notNull:contract_exit.employee_id (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" alter column "employee_id" drop not null;

-- step drop:notNull:contract_exit.employment_id (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" alter column "employment_id" drop not null;

-- step drop:notNull:contract_exit.entity_id (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" alter column "entity_id" drop not null;

-- step drop:notNull:contract_exit.settings_id (additive)
-- operational risk: access-exclusive-lock
alter table "contract_exit" alter column "settings_id" drop not null;

-- step drop:column:contract_exit.effective_to (destructive)
-- accept: drop:column:contract_exit.effective_to
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "effective_to" cascade;

-- step drop:column:contract_exit.final_pay_due_on (destructive)
-- accept: drop:column:contract_exit.final_pay_due_on
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "final_pay_due_on" cascade;

-- step drop:column:contract_exit.employee_id (destructive)
-- accept: drop:column:contract_exit.employee_id
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "employee_id" cascade;

-- step drop:column:contract_exit.employment_id (destructive)
-- accept: drop:column:contract_exit.employment_id
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "employment_id" cascade;

-- step drop:column:contract_exit.entity_id (destructive)
-- accept: drop:column:contract_exit.entity_id
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "entity_id" cascade;

-- step drop:column:contract_exit.settings_id (destructive)
-- accept: drop:column:contract_exit.settings_id
-- operational risk: access-exclusive-lock
alter table "contract_exit" drop column if exists "settings_id" cascade;

-- step drop:table:contract_exit (destructive)
-- accept: drop:table:contract_exit
-- operational risk: access-exclusive-lock
drop table if exists "contract_exit" cascade;

-- step replace:history:schema:registered_effect (additive)
select bolt_history_register('registered_effect','{"audit":true,"fields":{"code":{"kind":"text"},"condition":{"kind":"text","max":65536},"description":{"kind":"text","optional":true},"effects":{"kind":"text","max":65536},"events":{"kind":"enum","many":true,"values":["create","update","delete","prepare_request","seal","void","approve","entries_changed","prepare_payroll","after_basic","after_gross","after_contributions","after_tax","after_net","finalise","mark_paid","daily","calendar","exit"]},"lookup":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"name":{"kind":"text"},"reads":{"kind":"custom","of":"reads","optional":true},"references":{"kind":"custom","of":"references","optional":true},"settings_id":{"inverse":"registered_effect","kind":"ref","owned":true,"to":"jurisdiction_settings"},"source_collection":{"kind":"text"},"target_action":{"kind":"enum","values":["create","update","delete"]},"target_collection":{"kind":"text"}},"nativeRules":2,"recordLabel":"record.code","unique":[{"fields":["settings_id","code"]}]}'::jsonb);

-- step create:constraint:registered_effect.registered_effect__ck__9ceb5efd (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "registered_effect" where (not jsonb_path_exists(to_jsonb("events"), ''strict $[*] ? (@.type() != "string")'') and "events" <@ array[''create'', ''update'', ''delete'', ''prepare_request'', ''seal'', ''void'', ''approve'', ''entries_changed'', ''prepare_payroll'', ''after_basic'', ''after_gross'', ''after_contributions'', ''after_tax'', ''after_net'', ''finalise'', ''mark_paid'', ''daily'', ''calendar'', ''exit'']::text[]) is false' into n;
	if n > 0 then raise exception 'registered_effect__ck__9ceb5efd refuses % existing row(s)', n; end if;
end $store$;
alter table "registered_effect" add constraint "registered_effect__ck__9ceb5efd" check (not jsonb_path_exists(to_jsonb("events"), 'strict $[*] ? (@.type() != "string")') and "events" <@ array['create', 'update', 'delete', 'prepare_request', 'seal', 'void', 'approve', 'entries_changed', 'prepare_payroll', 'after_basic', 'after_gross', 'after_contributions', 'after_tax', 'after_net', 'finalise', 'mark_paid', 'daily', 'calendar', 'exit']::text[]);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog','adhoc_catalog_entry','allowance_catalog','claim_catalog','claim_catalog_entry','contract_change','employee_balance','employee_contract','employee_profile','entity','entity_change','entity_profile_version','holiday','jurisdiction_settings','leave_catalog','leave_catalog_entry','leave_catalog_entry_day','ledger_entry','loan_catalog','loan_catalog_entry','loan_catalog_entry_repayment','obligation','overtime_catalog','payroll_run','payslip','registered_effect','registered_rule','roster_entry','shift_definition','shift_pattern','statutory_change','statutory_contribution_catalog','statutory_finding','statutory_source','subtotal','work_event','work_event_catalog','workplace_case_catalog','workplace_case_catalog_entry']::text[]));
