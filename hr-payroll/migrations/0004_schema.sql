-- 0004_schema.sql: 8 step(s), from 4deb813659c40aad39b665083ca74aeb57139ae0fdcf71783aa4b9e2abe05c7f to f03e90ecd1c253e16630cf61354f3401142df6f28a9ad8f6807f203cc53dfd43.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step drop:index:employee_balance.employee_balance__ix__26554388 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "employee_balance__ix__26554388";

-- step replace:trigger:employee_balance.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_balance";

-- step drop:fk:employee_balance.employee_balance__fk__70277288 (additive)
-- operational risk: access-exclusive-lock
alter table "employee_balance" drop constraint if exists "employee_balance__fk__70277288";

-- step drop:notNull:employee_balance.entity_id (additive)
-- operational risk: access-exclusive-lock
alter table "employee_balance" alter column "entity_id" drop not null;

-- step drop:column:employee_balance.entity_id (destructive)
-- accept: drop:column:employee_balance.entity_id
-- operational risk: access-exclusive-lock
alter table "employee_balance" drop column if exists "entity_id" cascade;

-- step replace:history:schema:employee_balance (additive)
select bolt_history_register('employee_balance','{"audit":true,"fields":{"account":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"record","of":{"kind":"json"}}}},"employee_id":{"kind":"ref","to":"employee_profile"}},"nativeRules":2,"recordLabel":"''Balance''","unique":[{"fields":["employee_id"]}]}'::jsonb);

-- step replace:trigger:employee_balance.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_balance" for each row execute function store_row_rules('{"audit":true,"fields":{"account":["account"],"employee_id":["employee_id"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:engine:audit:employee_balance (additive)
drop trigger if exists bolt_audit_mark on "employee_balance";
create trigger bolt_audit_mark before insert or update or delete on "employee_balance" for each row execute function bolt_audit_mark('[]','[["employee_id","employee_profile"]]');
drop trigger if exists bolt_audit on "employee_balance";
create trigger bolt_audit after insert or update or delete on "employee_balance" for each row execute function bolt_audit('[]','[["employee_id","employee_profile"]]');
