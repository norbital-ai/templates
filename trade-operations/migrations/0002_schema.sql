-- 0002_schema.sql: 2 step(s), from 3e678b7be5e03d82beb8b987a1ab440381ef60ea04b3392ecf8edf1bfcfedfbe to 98bbd4a730824c36a08b6cfd7bed34a73325d16d56f803b048108657867384f1.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step replace:history:schema:credit_snapshots (additive)
select bolt_history_register('credit_snapshots','{"audit":true,"computed":{"credit_available":{"expr":{"minus":[{"field":"credit_limit"},{"field":"credit_used"}]},"kind":"decimal","scale":2}},"fields":{"as_of":{"kind":"instant"},"credit_hold":{"default":false,"kind":"bool"},"credit_limit":{"currency":"currency","kind":"money","optional":true},"credit_used":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"party":{"kind":"ref","to":"parties"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.party.name","search":{"text":["party","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step create:column:credit_snapshots.credit_available (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "credit_snapshots" add column "credit_available" numeric generated always as (((("credit_limit")::numeric - ("credit_used")::numeric))::numeric) stored;
