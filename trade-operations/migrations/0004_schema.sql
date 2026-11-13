-- 0004_schema.sql: 62 step(s), from 350b988140aa8711589fbf0b31dd794eb13f99e3b3faabb96e9bc99f3dbc85df to 3733db6bb238223e0ad329b73f24595ec411e028264f865c434feeb0e5034f8e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:source_lot_costs.source_lot_costs__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "source_lot_costs__gin__73732636";

-- step drop:index:source_receivables.source_receivables__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "source_receivables__gin__73732636";

-- step drop:index:source_stock_commitments.source_stock_commitments__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "source_stock_commitments__gin__73732636";

-- step replace:index:commercial_settings.commercial_settings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "commercial_settings__gin__73732636";

-- step replace:index:commission_rules.commission_rules__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "commission_rules__gin__73732636";

-- step replace:index:order_lines.order_lines__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "order_lines__gin__73732636";

-- step replace:index:credit_snapshots.credit_snapshots__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "credit_snapshots__gin__73732636";

-- step replace:index:pricing_floors.pricing_floors__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "pricing_floors__gin__73732636";

-- step replace:index:stock_snapshots.stock_snapshots__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "stock_snapshots__gin__73732636";

-- step drop:column:credit_snapshots.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "credit_snapshots" drop column if exists "bolt_record_label" cascade;

-- step drop:column:order_lines.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "order_lines" drop column if exists "bolt_record_label" cascade;

-- step drop:column:pricing_floors.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "pricing_floors" drop column if exists "bolt_record_label" cascade;

-- step drop:column:source_lot_costs.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "source_lot_costs" drop column if exists "bolt_record_label" cascade;

-- step drop:column:source_lot_costs.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "source_lot_costs" drop column if exists bolt_search cascade;

-- step drop:column:source_receivables.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" drop column if exists "bolt_record_label" cascade;

-- step drop:column:source_receivables.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "source_receivables" drop column if exists bolt_search cascade;

-- step drop:column:source_stock_commitments.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "source_stock_commitments" drop column if exists "bolt_record_label" cascade;

-- step drop:column:source_stock_commitments.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "source_stock_commitments" drop column if exists bolt_search cascade;

-- step drop:column:stock_snapshots.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop column if exists "bolt_record_label" cascade;

-- step replace:column:commercial_settings.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists "bolt_record_label" cascade;

-- step replace:column:commercial_settings.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "commercial_settings" drop column if exists bolt_search cascade;

-- step replace:column:commission_rules.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "commission_rules" drop column if exists "bolt_record_label" cascade;

-- step replace:column:commission_rules.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "commission_rules" drop column if exists bolt_search cascade;

-- step replace:column:order_lines.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "order_lines" drop column if exists bolt_search cascade;

-- step replace:column:credit_snapshots.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "credit_snapshots" drop column if exists bolt_search cascade;

-- step replace:column:pricing_floors.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "pricing_floors" drop column if exists bolt_search cascade;

-- step replace:column:stock_snapshots.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "stock_snapshots" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_commercial_settings_1d6aa255 (additive)
drop function if exists "bolt_record_label_commercial_settings_1d6aa255"(text) cascade;

-- step drop:function:bolt_record_label_commission_rules_f592205b (additive)
drop function if exists "bolt_record_label_commission_rules_f592205b"(text, date) cascade;

-- step drop:function:bolt_record_label_credit_snapshots_3375c19f (additive)
drop function if exists "bolt_record_label_credit_snapshots_3375c19f"(text) cascade;

-- step drop:function:bolt_record_label_order_lines_37fae414 (additive)
drop function if exists "bolt_record_label_order_lines_37fae414"(text, numeric) cascade;

-- step drop:function:bolt_record_label_pricing_floors_8bc7f92e (additive)
drop function if exists "bolt_record_label_pricing_floors_8bc7f92e"(date, text) cascade;

-- step drop:function:bolt_record_label_source_lot_costs_b6b722c6 (additive)
drop function if exists "bolt_record_label_source_lot_costs_b6b722c6"(timestamptz) cascade;

-- step drop:function:bolt_record_label_source_receivables_b6b722c6 (additive)
drop function if exists "bolt_record_label_source_receivables_b6b722c6"(timestamptz) cascade;

-- step drop:function:bolt_record_label_source_stock_commitmen_b6b722c6 (additive)
drop function if exists "bolt_record_label_source_stock_commitmen_b6b722c6"(timestamptz) cascade;

-- step drop:function:bolt_record_label_stock_snapshots_3375c19f (additive)
drop function if exists "bolt_record_label_stock_snapshots_3375c19f"(text) cascade;

-- step create:function:bolt_record_label_commercial_settings_c31fc1bb (additive)
create function "bolt_record_label_commercial_settings_c31fc1bb"() returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb('Commercial settings'::text) #>> '{}') AS value FROM (SELECT jsonb_build_object() AS j FROM (SELECT 1 AS unused) label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_commission_rules_6bb98859 (additive)
create function "bolt_record_label_commission_rules_6bb98859"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb((coalesce((label_row.j #> ARRAY['currency']), 'null'::jsonb) #>> '{}')) AS left_value, to_jsonb(' · '::text) AS right_value) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_on']), 'null'::jsonb) #>> '{}')) AS right_value) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('currency', to_jsonb("currency"), 'effective_on', to_jsonb("effective_on"::text)) AS j FROM (SELECT $1 AS "currency", $2 AS "effective_on") label_inputs) label_row) label_value$record_label$;

-- step replace:column:commercial_settings.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "commercial_settings" add column "bolt_record_label" text generated always as ("bolt_record_label_commercial_settings_c31fc1bb"()) stored;

-- step replace:column:commercial_settings.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "commercial_settings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_commercial_settings_c31fc1bb"(), ''))) stored;

-- step replace:column:commission_rules.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "commission_rules" add column "bolt_record_label" text generated always as ("bolt_record_label_commission_rules_6bb98859"("currency", "effective_on")) stored;

-- step replace:column:commission_rules.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "commission_rules" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_commission_rules_6bb98859"("currency", "effective_on"), '') || ' ' || coalesce("basis_unit"::text, ''))) stored;

-- step replace:column:order_lines.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "order_lines" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("product_code"::text, ''))) stored;

-- step replace:column:credit_snapshots.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "credit_snapshots" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("external_code"::text, ''))) stored;

-- step replace:column:pricing_floors.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "pricing_floors" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("group_code"::text, '') || ' ' || coalesce("unit"::text, ''))) stored;

-- step replace:column:stock_snapshots.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "stock_snapshots" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("lot_number"::text, '') || ' ' || coalesce("external_code"::text, ''))) stored;

-- step replace:history:schema:commercial_settings (additive)
select bolt_history_register('commercial_settings','{"audit":true,"fields":{"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"credit_fresh_minutes":{"default":60,"kind":"int","min":1},"default_document_layout":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"default_purchase_document_layout":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"require_floor":{"default":false,"kind":"bool"},"stock_fresh_minutes":{"default":30,"kind":"int","min":1}},"record_label":"''Commercial settings''","unique":[{"fields":["code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:commission_rules (additive)
select bolt_history_register('commission_rules','{"audit":true,"check":{"fixed_rate_nonnegative":{"fixed_rate":{"gte":"0"}}},"fields":{"active":{"default":true,"kind":"bool"},"amount_expression":{"default":"basis_quantity * (rule.fixed_rate + max(spread, 0) * rule.spread_pct / 100)","format":"cel","kind":"text"},"basis_unit":{"kind":"text","optional":true},"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"currency":{"kind":"currency"},"effective_on":{"kind":"date"},"eligibility_expression":{"default":"true","format":"cel","kind":"text"},"fixed_rate":{"currency":"currency","default":"0","kind":"money","scale":4},"parameters":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true}},"spread_pct":{"default":"0","kind":"decimal","max":100,"min":0,"scale":2}},"record_label":"string(record.currency) + '' · '' + string(record.effective_on)","search":{"text":["basis_unit"]},"unique":[{"fields":["code","currency","effective_on"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:order_lines (additive)
select bolt_history_register('order_lines','{"audit":true,"check":{"unit_price_nonnegative":{"unit_price":{"gte":"0"}}},"fields":{"commission_basis_unit":{"kind":"text","optional":true},"commission_factor":{"kind":"decimal","min":0,"optional":true,"scale":6},"currency":{"kind":"currency"},"discount_pct":{"default":0,"kind":"decimal","max":100,"min":0,"scale":2},"floor_net":{"currency":"currency","kind":"money","optional":true,"scale":8},"floor_on":{"kind":"date","optional":true},"line_key":{"hidden":true,"kind":"text","optional":true},"net":{"currency":"currency","kind":"money"},"order":{"inverse":"lines","kind":"ref","owned":true,"to":"orders"},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"product":{"kind":"ref","to":"products"},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"product_spec":{"kind":"text","optional":true},"quantity":{"kind":"decimal","min":0,"scale":3},"source_entry_id":{"hidden":true,"kind":"text","optional":true},"tax":{"currency":"currency","kind":"money"},"tax_rate":{"kind":"decimal","max":100,"min":0,"scale":2},"total":{"currency":"currency","kind":"money"},"unit":{"kind":"text"},"unit_price":{"currency":"currency","kind":"money","scale":4}},"record_label":"record.order.number + '' · '' + record.product_name","search":{"text":["product","product_code"]},"unique":[{"fields":["order","line_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:credit_snapshots (additive)
select bolt_history_register('credit_snapshots','{"audit":true,"fields":{"as_of":{"kind":"instant"},"credit_hold":{"default":false,"kind":"bool"},"credit_limit":{"currency":"currency","kind":"money","optional":true},"credit_used":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"party":{"kind":"ref","to":"parties"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.party.name","search":{"text":["party","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:pricing_floors (additive)
select bolt_history_register('pricing_floors','{"audit":true,"check":{"floor_price_nonnegative":{"floor_price":{"gte":"0"}},"import_revision_ephemeral":{"import_revision":{"is_null":true}}},"fields":{"currency":{"kind":"currency"},"effective_on":{"kind":"date"},"floor_price":{"currency":"currency","kind":"money","scale":4},"group_code":{"kind":"text"},"import_revision":{"hidden":true,"kind":"int","min":0,"optional":true},"minimum_quantity":{"default":0,"kind":"decimal","min":0,"scale":3},"product":{"kind":"ref","to":"products"},"tax_inclusive":{"kind":"bool"},"tax_rate":{"default":0,"kind":"decimal","max":100,"min":0,"scale":2},"unit":{"kind":"text"}},"record_label":"record.product.name + '' · '' + record.group_code + '' · '' + string(record.effective_on)","search":{"text":["product","group_code","unit"]},"unique":[{"fields":["product","group_code","currency","effective_on","minimum_quantity"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:stock_snapshots (additive)
select bolt_history_register('stock_snapshots','{"audit":true,"fields":{"as_of":{"kind":"instant"},"currency":{"kind":"currency","optional":true},"erp_committed":{"kind":"decimal","optional":true,"scale":3},"external_code":{"kind":"text"},"lot_number":{"kind":"text","optional":true},"on_hand":{"kind":"decimal","scale":3},"orders_as_of":{"kind":"instant","optional":true},"product":{"kind":"ref","to":"products"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"unit":{"kind":"text","optional":true},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"warehouse":{"kind":"ref","to":"warehouses"}},"record_label":"record.product.name + '' · '' + record.warehouse.name + (record.lot_number != null ? '' · '' + record.lot_number : '''')","search":{"text":["product","warehouse","lot_number","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

-- step replace:history:schema:salesperson_signatures (additive)
select bolt_history_register('salesperson_signatures','{"audit":true,"fields":{"owner":{"default":{"var":"requestor.id"},"kind":"ref","to":"sys_user"},"signature":{"fields":{"png":{"kind":"text","max":174764}},"kind":"object","optional":true}},"indexes":[{"on":["owner"]}],"record_label":"record.owner.name"}'::jsonb);

-- step replace:history:schema:source_lot_costs (additive)
select bolt_history_register('source_lot_costs','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"fields":{"lot_number":{"kind":"text"},"product_code":{"kind":"text"},"received_on":{"kind":"date"},"received_qty":{"kind":"text"},"unit":{"kind":"text"},"unit_cost":{"kind":"text"}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step replace:history:schema:source_receivables (additive)
select bolt_history_register('source_receivables','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step replace:history:schema:source_stock_commitments (additive)
select bolt_history_register('source_stock_commitments','{"audit":true,"fields":{"entries":{"kind":"json","shape":{"fields":{"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

-- step replace:index:commercial_settings.commercial_settings__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "commercial_settings__gin__73732636" on "commercial_settings" using gin (bolt_search);

-- step replace:index:commission_rules.commission_rules__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "commission_rules__gin__73732636" on "commission_rules" using gin (bolt_search);

-- step replace:index:order_lines.order_lines__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "order_lines__gin__73732636" on "order_lines" using gin (bolt_search);

-- step replace:index:credit_snapshots.credit_snapshots__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "credit_snapshots__gin__73732636" on "credit_snapshots" using gin (bolt_search);

-- step replace:index:pricing_floors.pricing_floors__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "pricing_floors__gin__73732636" on "pricing_floors" using gin (bolt_search);

-- step replace:index:stock_snapshots.stock_snapshots__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "stock_snapshots__gin__73732636" on "stock_snapshots" using gin (bolt_search);
