-- 0021_schema.sql: 47 step(s), from 37ca962ab035f5a04c2f905565d9046d460b3d43d404ff5af7da0b1870ceef09 to 7f271677b65621d398a73893e466a5d6a227f5db5a8ff439f06c1c449b515c59.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:ledger_entry.ledger_entry__ix__b4030daf (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__b4030daf";

-- step drop:index:ledger_entry.ledger_entry__ix__45f93ee5 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__45f93ee5";

-- step drop:index:ledger_entry.ledger_entry__ix__6e2c0e70 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__6e2c0e70";

-- step drop:index:ledger_entry.ledger_entry__ix__1cc95168 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__1cc95168";

-- step drop:index:ledger_entry.ledger_entry__ix__805937ae (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__805937ae";

-- step drop:index:ledger_entry.ledger_entry__ix__6cf01b96 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "ledger_entry__ix__6cf01b96";

-- step replace:trigger:ledger_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "ledger_entry";

-- step replace:trigger:adhoc_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "adhoc_catalog_entry";

-- step replace:trigger:claim_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "claim_catalog_entry";

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "leave_catalog_entry";

-- step drop:fk:ledger_entry.ledger_entry__fk__6836c710 (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__6836c710";

-- step drop:fk:ledger_entry.ledger_entry__fk__7d7de253 (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__7d7de253";

-- step drop:fk:ledger_entry.ledger_entry__fk__13fed49b (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__13fed49b";

-- step drop:fk:ledger_entry.ledger_entry__fk__ed008f87 (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__ed008f87";

-- step drop:fk:ledger_entry.ledger_entry__fk__63228716 (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__63228716";

-- step drop:fk:ledger_entry.ledger_entry__fk__9ba71b59 (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__fk__9ba71b59";

-- step drop:constraint:ledger_entry.ledger_entry__ck__e1c3072d (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop constraint if exists "ledger_entry__ck__e1c3072d";

-- step drop:column:ledger_entry.source_id__leave_catalog_entry (destructive)
-- accept: drop:column:ledger_entry.source_id__leave_catalog_entry
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__leave_catalog_entry" cascade;

-- step drop:column:ledger_entry.source_id__claim_catalog_entry (destructive)
-- accept: drop:column:ledger_entry.source_id__claim_catalog_entry
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__claim_catalog_entry" cascade;

-- step drop:column:ledger_entry.source_id__adhoc_catalog_entry (destructive)
-- accept: drop:column:ledger_entry.source_id__adhoc_catalog_entry
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__adhoc_catalog_entry" cascade;

-- step drop:column:ledger_entry.source_id__loan_catalog_entry (destructive)
-- accept: drop:column:ledger_entry.source_id__loan_catalog_entry
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__loan_catalog_entry" cascade;

-- step drop:column:ledger_entry.source_id__loan_repayment_entry (destructive)
-- accept: drop:column:ledger_entry.source_id__loan_repayment_entry
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__loan_repayment_entry" cascade;

-- step drop:column:ledger_entry.source_id__payroll_run (destructive)
-- accept: drop:column:ledger_entry.source_id__payroll_run
-- operational risk: access-exclusive-lock
alter table "ledger_entry" drop column if exists "source_id__payroll_run" cascade;

-- step replace:history:schema:ledger_entry (additive)
select bolt_history_register('ledger_entry','{"audit":true,"fields":{"account":{"help":"Catalogue family key, for example leave or claim.","kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"help":"Account code inside the family, for example ANNUAL_LEAVE.","kind":"text"},"effective_on":{"kind":"date"},"measure":{"help":"What is held in that window, for example entitled or used.","kind":"text","optional":true},"operation":{"kind":"enum","values":["CREATE","REMOVE","ADD","DEDUCT"]},"period":{"help":"The window the value belongs to, for example MY.S.2026-03-05.","kind":"text","optional":true},"source":{"help":"What caused this movement. Plain text, so a movement outlives what caused it.","kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.code"}'::jsonb);

-- step replace:history:schema:adhoc_catalog_entry (additive)
select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"adhoc_catalog"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"adhoc_catalog_entry"},"unit":{"kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.description"}'::jsonb);

-- step replace:history:schema:claim_catalog_entry (additive)
select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"claim_catalog"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employee_contract"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","label":"Amount","min":0,"scale":12},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"claim_catalog_entry"},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"string(record.quantity) + '' '' + record.unit"}'::jsonb);

-- step replace:history:schema:leave_catalog_entry (additive)
select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_id":{"kind":"ref","onDelete":"restrict","to":"leave_catalog"},"days":{"kind":"list","min":1,"of":{"fields":{"date":{"kind":"date"},"part":{"kind":"enum","values":["AM","PM"]}},"kind":"object"}},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employee_contract"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"is_reversal":{"default":false,"kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"reverses":{"kind":"ref","onDelete":"restrict","optional":true,"to":"leave_catalog_entry"}},"nativeRules":2,"recordLabel":"string(size(record.days)) + '' half-days''"}'::jsonb);

-- step create:column:ledger_entry.period (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" add column "period" text;

-- step create:column:ledger_entry.measure (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" add column "measure" text;

-- step create:column:ledger_entry.source (additive)
-- operational risk: access-exclusive-lock
alter table "ledger_entry" add column "source" text;

-- step create:column:adhoc_catalog_entry.reverses (additive)
-- operational risk: access-exclusive-lock
alter table "adhoc_catalog_entry" add column "reverses" uuid;

-- step create:column:claim_catalog_entry.reverses (additive)
-- operational risk: access-exclusive-lock
alter table "claim_catalog_entry" add column "reverses" uuid;

-- step create:column:leave_catalog_entry.reverses (additive)
-- operational risk: access-exclusive-lock
alter table "leave_catalog_entry" add column "reverses" uuid;

-- step create:fk:adhoc_catalog_entry.adhoc_catalog_entry__fk__598d8ab9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "adhoc_catalog_entry" c where c."reverses" is not null and not exists (select 1 from "adhoc_catalog_entry" p where p."id" = c."reverses")' into n;
	if n > 0 then raise exception 'adhoc_catalog_entry__fk__598d8ab9 refuses % existing row(s)', n; end if;
end $store$;
alter table "adhoc_catalog_entry" add constraint "adhoc_catalog_entry__fk__598d8ab9" foreign key ("reverses") references "adhoc_catalog_entry" ("id") on delete restrict on update restrict;

-- step create:fk:claim_catalog_entry.claim_catalog_entry__fk__a3eb3aa3 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "claim_catalog_entry" c where c."reverses" is not null and not exists (select 1 from "claim_catalog_entry" p where p."id" = c."reverses")' into n;
	if n > 0 then raise exception 'claim_catalog_entry__fk__a3eb3aa3 refuses % existing row(s)', n; end if;
end $store$;
alter table "claim_catalog_entry" add constraint "claim_catalog_entry__fk__a3eb3aa3" foreign key ("reverses") references "claim_catalog_entry" ("id") on delete restrict on update restrict;

-- step create:fk:leave_catalog_entry.leave_catalog_entry__fk__e445d5c0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "leave_catalog_entry" c where c."reverses" is not null and not exists (select 1 from "leave_catalog_entry" p where p."id" = c."reverses")' into n;
	if n > 0 then raise exception 'leave_catalog_entry__fk__e445d5c0 refuses % existing row(s)', n; end if;
end $store$;
alter table "leave_catalog_entry" add constraint "leave_catalog_entry__fk__e445d5c0" foreign key ("reverses") references "leave_catalog_entry" ("id") on delete restrict on update restrict;

-- step replace:trigger:ledger_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "ledger_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"account":["account"],"amount":["amount"],"balance_id":["balance_id"],"code":["code"],"effective_on":["effective_on"],"measure":["measure"],"operation":["operation"],"period":["period"],"source":["source"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:adhoc_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "adhoc_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"description":["description"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"incurred_on":["incurred_on"],"is_reversal":["is_reversal"],"payroll_run_id":["payroll_run_id"],"quantity":["quantity"],"reverses":["reverses"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:claim_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "claim_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"employment_id":["employment_id"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"incurred_on":["incurred_on"],"is_reversal":["is_reversal"],"payroll_run_id":["payroll_run_id"],"quantity":["quantity"],"reverses":["reverses"],"unit":["unit"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:leave_catalog_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "leave_catalog_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"catalog_id":["catalog_id"],"days":["days"],"employment_id":["employment_id"],"encashment":["encashment"],"entity_id":["entity_id"],"evidence_file":["evidence_file"],"is_reversal":["is_reversal"],"payroll_run_id":["payroll_run_id"],"reverses":["reverses"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:engine:audit:ledger_entry (additive)
drop trigger if exists bolt_audit_mark on "ledger_entry";
create trigger bolt_audit_mark before insert or update or delete on "ledger_entry" for each row execute function bolt_audit_mark('[]','[["balance_id","employee_balance"]]');
drop trigger if exists bolt_audit on "ledger_entry";
create trigger bolt_audit after insert or update or delete on "ledger_entry" for each row execute function bolt_audit('[]','[["balance_id","employee_balance"]]');

-- step replace:engine:audit:adhoc_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "adhoc_catalog_entry";
create trigger bolt_audit_mark before insert or update or delete on "adhoc_catalog_entry" for each row execute function bolt_audit_mark('[]','[["catalog_id","adhoc_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","adhoc_catalog_entry"]]');
drop trigger if exists bolt_audit on "adhoc_catalog_entry";
create trigger bolt_audit after insert or update or delete on "adhoc_catalog_entry" for each row execute function bolt_audit('[]','[["catalog_id","adhoc_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","adhoc_catalog_entry"]]');

-- step replace:engine:audit:claim_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "claim_catalog_entry";
create trigger bolt_audit_mark before insert or update or delete on "claim_catalog_entry" for each row execute function bolt_audit_mark('[]','[["catalog_id","claim_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","claim_catalog_entry"]]');
drop trigger if exists bolt_audit on "claim_catalog_entry";
create trigger bolt_audit after insert or update or delete on "claim_catalog_entry" for each row execute function bolt_audit('[]','[["catalog_id","claim_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","claim_catalog_entry"]]');

-- step replace:engine:audit:leave_catalog_entry (additive)
drop trigger if exists bolt_audit_mark on "leave_catalog_entry";
create trigger bolt_audit_mark before insert or update or delete on "leave_catalog_entry" for each row execute function bolt_audit_mark('[]','[["catalog_id","leave_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","leave_catalog_entry"]]');
drop trigger if exists bolt_audit on "leave_catalog_entry";
create trigger bolt_audit after insert or update or delete on "leave_catalog_entry" for each row execute function bolt_audit('[]','[["catalog_id","leave_catalog"],["employment_id","employee_contract"],["entity_id","entity"],["payroll_run_id","payroll_run"],["reverses","leave_catalog_entry"]]');

-- step create:index:adhoc_catalog_entry.adhoc_catalog_entry__ix__7a4e31a2 (additive)
-- operational risk: writes-blocked, table-scan
create index "adhoc_catalog_entry__ix__7a4e31a2" on "adhoc_catalog_entry" ("reverses");

-- step create:index:claim_catalog_entry.claim_catalog_entry__ix__7a4e31a2 (additive)
-- operational risk: writes-blocked, table-scan
create index "claim_catalog_entry__ix__7a4e31a2" on "claim_catalog_entry" ("reverses");

-- step create:index:leave_catalog_entry.leave_catalog_entry__ix__7a4e31a2 (additive)
-- operational risk: writes-blocked, table-scan
create index "leave_catalog_entry__ix__7a4e31a2" on "leave_catalog_entry" ("reverses");
