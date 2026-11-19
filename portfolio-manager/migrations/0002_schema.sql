-- 0002_schema.sql: 11 step(s), from 925e99aae5a8d8001a2d02007754373de02def8ca44c16451502bc204e00d6f2 to 0c0129c38da5dff31d115c7aaa9fa59b3dcca66dfa476339df087c5f9e273e79.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step drop:index:portfolio_settings.portfolio_settings__ix__4dd9fddd (additive)
-- operational risk: access-exclusive-lock
drop index if exists "portfolio_settings__ix__4dd9fddd";

-- step drop:fk:portfolio_settings.portfolio_settings__fk__bf92d9ec (additive)
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop constraint if exists "portfolio_settings__fk__bf92d9ec";

-- step drop:constraint:portfolio_settings.portfolio_settings__ck__c1c5d933 (additive)
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop constraint if exists "portfolio_settings__ck__c1c5d933";

-- step drop:constraint:report.report__ck__5586dd6b (additive)
-- operational risk: access-exclusive-lock
alter table "report" drop constraint if exists "report__ck__5586dd6b";

-- step drop:column:portfolio_settings.recipients (destructive)
-- accept: drop:column:portfolio_settings.recipients
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop column if exists "recipients" cascade;

-- step drop:column:report.deliveries (destructive)
-- accept: drop:column:report.deliveries
-- operational risk: access-exclusive-lock
alter table "report" drop column if exists "deliveries" cascade;

-- step drop:column:portfolio_settings.report_via (destructive)
-- accept: drop:column:portfolio_settings.report_via
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop column if exists "report_via" cascade;

-- step replace:history:schema:portfolio_settings (additive)
select bolt_history_register('portfolio_settings','{"audit":true,"fields":{"base_currency":{"kind":"currency"},"benchmarks":{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true}},"record_label":"''Portfolio settings''"}'::jsonb);

-- step replace:history:schema:report (additive)
select bolt_history_register('report','{"audit":true,"fields":{"allocation":{"fields":{"label":{"kind":"text"},"value":{"kind":"decimal","scale":2},"weight":{"kind":"decimal","scale":2}},"key":"label","kind":"object","many":true,"optional":true},"base_currency":{"kind":"currency"},"cash":{"kind":"decimal","scale":2},"day_change":{"kind":"decimal","optional":true,"scale":2},"for_date":{"kind":"date"},"fx_used":{"fields":{"pair":{"kind":"text"},"rate":{"kind":"decimal","scale":6}},"key":"pair","kind":"object","many":true,"optional":true},"headline":{"format":"markdown","kind":"text"},"invested":{"kind":"decimal","scale":2},"liabilities":{"kind":"decimal","scale":2},"market_view":{"format":"markdown","kind":"text","optional":true},"markets":{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"net_assets":{"kind":"decimal","scale":2},"positions":{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"research_log":{"kind":"text","optional":true},"sources":{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"summary":{"format":"markdown","kind":"text"},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2}},"record_label":"''Portfolio report · '' + string(record.for_date)","search":{"text":["headline","summary","market_view"]},"unique":[{"fields":["for_date"],"name":"one_per_day"}]}'::jsonb);

-- step replace:engine:audit:portfolio_settings (additive)
drop trigger if exists bolt_audit_mark on "portfolio_settings";
drop trigger if exists bolt_audit on "portfolio_settings";
create trigger bolt_audit after insert or update or delete on "portfolio_settings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step replace:engine:audit:report (additive)
drop trigger if exists bolt_audit_mark on "report";
drop trigger if exists bolt_audit on "report";
create trigger bolt_audit after insert or update or delete on "report" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');
