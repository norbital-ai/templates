-- 0004_schema.sql: 18 step(s), from e2791412b0692a249005bb7de157e09ac03ed13eacf6cb97d4e6d656bbdcd3b4 to 3e832b8471866b7ed7827d4ac2a304cd3e41d50dde497c9999e8a3f2d70f7ca4.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:index:portfolio_settings.portfolio_settings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "portfolio_settings__gin__73732636";

-- step replace:index:report.report__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "report__gin__73732636";

-- step replace:column:portfolio_settings.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop column if exists "bolt_record_label" cascade;

-- step replace:column:portfolio_settings.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "portfolio_settings" drop column if exists bolt_search cascade;

-- step replace:column:report.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "report" drop column if exists "bolt_record_label" cascade;

-- step replace:column:report.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "report" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_portfolio_settings_4abbb1dc (additive)
drop function if exists "bolt_record_label_portfolio_settings_4abbb1dc"(text) cascade;

-- step drop:function:bolt_record_label_report_fd2e04a3 (additive)
drop function if exists "bolt_record_label_report_fd2e04a3"(date) cascade;

-- step create:function:bolt_record_label_portfolio_settings_4d34641e (additive)
create function "bolt_record_label_portfolio_settings_4d34641e"() returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb('Portfolio settings'::text) #>> '{}') AS value FROM (SELECT jsonb_build_object() AS j FROM (SELECT 1 AS unused) label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_report_0685ed0d (additive)
create function "bolt_record_label_report_0685ed0d"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb('Portfolio report · '::text) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['for_date']), 'null'::jsonb) #>> '{}')) AS right_value) label_0) #>> '{}') AS value FROM (SELECT jsonb_build_object('for_date', to_jsonb("for_date"::text)) AS j FROM (SELECT $1 AS "for_date") label_inputs) label_row) label_value$record_label$;

-- step replace:column:portfolio_settings.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "portfolio_settings" add column "bolt_record_label" text generated always as ("bolt_record_label_portfolio_settings_4d34641e"()) stored;

-- step replace:column:portfolio_settings.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "portfolio_settings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_portfolio_settings_4d34641e"(), ''))) stored;

-- step replace:column:report.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "report" add column "bolt_record_label" text generated always as ("bolt_record_label_report_0685ed0d"("for_date")) stored;

-- step replace:column:report.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "report" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_report_0685ed0d"("for_date"), '') || ' ' || coalesce("headline"::text, '') || ' ' || coalesce("summary"::text, '') || ' ' || coalesce("market_view"::text, ''))) stored;

-- step replace:history:schema:portfolio_settings (additive)
select bolt_history_register('portfolio_settings','{"audit":true,"fields":{"base_currency":{"kind":"currency"},"benchmarks":{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true},"recipients":{"fields":{"handle":{"kind":"text"},"name":{"kind":"text","optional":true}},"key":"handle","kind":"object","many":true,"optional":true},"report_via":{"kind":"ref","optional":true,"to":"sys_integration"}},"record_label":"''Portfolio settings''"}'::jsonb);

-- step replace:history:schema:report (additive)
select bolt_history_register('report','{"audit":true,"fields":{"allocation":{"fields":{"label":{"kind":"text"},"value":{"kind":"decimal","scale":2},"weight":{"kind":"decimal","scale":2}},"key":"label","kind":"object","many":true,"optional":true},"base_currency":{"kind":"currency"},"cash":{"kind":"decimal","scale":2},"day_change":{"kind":"decimal","optional":true,"scale":2},"deliveries":{"kind":"ref","many":true,"optional":true,"to":"sys_message"},"for_date":{"kind":"date"},"fx_used":{"fields":{"pair":{"kind":"text"},"rate":{"kind":"decimal","scale":6}},"key":"pair","kind":"object","many":true,"optional":true},"headline":{"format":"markdown","kind":"text"},"invested":{"kind":"decimal","scale":2},"liabilities":{"kind":"decimal","scale":2},"market_view":{"format":"markdown","kind":"text","optional":true},"markets":{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"net_assets":{"kind":"decimal","scale":2},"positions":{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"research_log":{"kind":"text","optional":true},"sources":{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"summary":{"format":"markdown","kind":"text"},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2}},"record_label":"''Portfolio report · '' + string(record.for_date)","search":{"text":["headline","summary","market_view"]},"unique":[{"fields":["for_date"],"name":"one_per_day"}]}'::jsonb);

-- step replace:index:portfolio_settings.portfolio_settings__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "portfolio_settings__gin__73732636" on "portfolio_settings" using gin (bolt_search);

-- step replace:index:report.report__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "report__gin__73732636" on "report" using gin (bolt_search);
