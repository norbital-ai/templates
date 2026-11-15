-- 0002_schema.sql: 14 step(s), from d166ad46a0ebbcd361eede76525b2ccb28af1e230a25da15788e6261e75c9ff4 to be1a789a839e4fdf20aa83647988ebc23661eb3bce9c0256fedd8bfc61b1fe49.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step drop:constraint:entity.entity__ck__efdb8eda (additive)
-- operational risk: access-exclusive-lock
alter table "entity" drop constraint if exists "entity__ck__efdb8eda";

-- step drop:constraint:entity.entity__ck__f92e3a5a (additive)
-- operational risk: access-exclusive-lock
alter table "entity" drop constraint if exists "entity__ck__f92e3a5a";

-- step drop:constraint:statutory_parameters.statutory_parameters__ck__20833849 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop constraint if exists "statutory_parameters__ck__20833849";

-- step drop:constraint:statutory_parameters.statutory_parameters__ck__d038c03b (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop constraint if exists "statutory_parameters__ck__d038c03b";

-- step drop:column:entity.epf_registered_on (destructive)
-- accept: drop:column:entity.epf_registered_on
-- operational risk: access-exclusive-lock
alter table "entity" drop column if exists "epf_registered_on" cascade;

-- step drop:column:entity.socso_registered_on (destructive)
-- accept: drop:column:entity.socso_registered_on
-- operational risk: access-exclusive-lock
alter table "entity" drop column if exists "socso_registered_on" cascade;

-- step drop:column:statutory_parameters.marital_status (destructive)
-- accept: drop:column:statutory_parameters.marital_status
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "marital_status" cascade;

-- step drop:column:statutory_parameters.nationality (destructive)
-- accept: drop:column:statutory_parameters.nationality
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "nationality" cascade;

-- step drop:column:statutory_parameters.passport_number (destructive)
-- accept: drop:column:statutory_parameters.passport_number
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "passport_number" cascade;

-- step drop:column:statutory_parameters.residency_status (destructive)
-- accept: drop:column:statutory_parameters.residency_status
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "residency_status" cascade;

-- step drop:column:statutory_parameters.work_authorisation_category (destructive)
-- accept: drop:column:statutory_parameters.work_authorisation_category
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "work_authorisation_category" cascade;

-- step drop:column:statutory_parameters.work_authorisation_expires_on (destructive)
-- accept: drop:column:statutory_parameters.work_authorisation_expires_on
-- operational risk: access-exclusive-lock
alter table "statutory_parameters" drop column if exists "work_authorisation_expires_on" cascade;

-- step replace:history:schema:statutory_parameters (additive)
select bolt_history_register('statutory_parameters','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"employment_id":{"inverse":"parameters","kind":"ref","on_delete":"cascade","to":"employment"},"parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["employment_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step replace:history:schema:entity (additive)
select bolt_history_register('entity','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"code":{"kind":"text","optional":true},"name":{"kind":"text"},"registered_address":{"kind":"text","optional":true},"representative_name":{"kind":"text","optional":true},"settings_code":{"kind":"text"},"source_reference":{"kind":"text","optional":true},"time_zone":{"kind":"text","optional":true}},"record_label":"record.name","search":{"text":["code","name"]},"unique":[{"fields":["code"],"name":"code"}]}'::jsonb);
