-- 0002_schema.sql: 119 step(s), from f126ce55206d52d6552ac0b99be31863597d1b0ac8a7103ba17d023b2c66d2f2 to 8ad7191bd3130a5558d29d0dd34b0d477b49d0794eceb04e1bcd35f9e109adbf.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:activities.activities__gin__13cc25b0 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "activities__gin__13cc25b0";

-- step drop:index:activities.activities__ix__f4423093 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "activities__ix__f4423093";

-- step drop:index:activities.activities__ix__a7142ad2 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "activities__ix__a7142ad2";

-- step replace:index:activities.activities__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "activities__gin__73732636";

-- step replace:index:asset_mappings.asset_mappings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "asset_mappings__gin__73732636";

-- step replace:index:tasks.tasks__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "tasks__gin__73732636";

-- step drop:fk:activities.activities__fk__28766e9e (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__fk__28766e9e";

-- step drop:constraint:activities.activities__ck__22a0071e (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__22a0071e";

-- step drop:constraint:activities.activities__ck__639b4c57 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__639b4c57";

-- step drop:constraint:activities.activities__ck__efd400b1 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__efd400b1";

-- step drop:constraint:activities.activities__ck__827dafc6 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__827dafc6";

-- step drop:constraint:activities.activities__ck__9248e144 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__9248e144";

-- step drop:constraint:activities.activities__ck__e5c8d1b8 (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__e5c8d1b8";

-- step drop:constraint:activities.activities__ck__1810cdfc (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__1810cdfc";

-- step drop:constraint:activities.activities__ck__9a6e61aa (additive)
-- operational risk: access-exclusive-lock
alter table "activities" drop constraint if exists "activities__ck__9a6e61aa";

-- step drop:constraint:projects.projects__ck__7f12ec2a (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__7f12ec2a";

-- step drop:constraint:projects.projects__ck__43a3b15a (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__43a3b15a";

-- step drop:constraint:projects.projects__ck__0e27f10e (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop constraint if exists "projects__ck__0e27f10e";

-- step drop:notNull:activities.kind (additive)
-- operational risk: access-exclusive-lock
alter table "activities" alter column "kind" drop not null;

-- step drop:notNull:projects.open_issue_count (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "open_issue_count" drop not null;

-- step drop:notNull:tasks.open_issue_count (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" alter column "open_issue_count" drop not null;

-- step drop:notNull:activities.task_id (additive)
-- operational risk: access-exclusive-lock
alter table "activities" alter column "task_id" drop not null;

-- step drop:default:activities.kind (additive)
-- operational risk: access-exclusive-lock
alter table "activities" alter column "kind" drop default;

-- step drop:column:activities.attendees (destructive)
-- accept: drop:column:activities.attendees
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "attendees" cascade;

-- step drop:column:activities.body (destructive)
-- accept: drop:column:activities.body
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "body" cascade;

-- step drop:column:activities.issue_type (destructive)
-- accept: drop:column:activities.issue_type
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "issue_type" cascade;

-- step drop:column:activities.kind (destructive)
-- accept: drop:column:activities.kind
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "kind" cascade;

-- step drop:column:activities.severity (destructive)
-- accept: drop:column:activities.severity
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "severity" cascade;

-- step drop:column:activities.status (destructive)
-- accept: drop:column:activities.status
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "status" cascade;

-- step drop:column:projects.open_issue_count (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "open_issue_count" cascade;

-- step drop:column:tasks.latest_update (destructive)
-- accept: drop:column:tasks.latest_update
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists "latest_update" cascade;

-- step drop:column:tasks.open_issue_count (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists "open_issue_count" cascade;

-- step drop:column:activities.task_id (destructive)
-- accept: drop:column:activities.task_id
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "task_id" cascade;

-- step replace:column:activities.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists "bolt_record_label" cascade;

-- step replace:column:activities.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "activities" drop column if exists bolt_search cascade;

-- step replace:column:asset_mappings.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" drop column if exists bolt_search cascade;

-- step replace:column:tasks.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_activities_2453b0d7 (additive)
drop function if exists "bolt_record_label_activities_2453b0d7"(text, text) cascade;

-- step create:function:bolt_record_label_activities_06f5fc13 (additive)
create or replace function "bolt_record_label_activities_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_bim_settings_93340fdd (additive)
create or replace function "bolt_record_label_bim_settings_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_sop_rules_0d7dd15b (additive)
create or replace function "bolt_record_label_sop_rules_0d7dd15b"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code"), 'name', to_jsonb("name")) AS j FROM (SELECT $1 AS "code", $2 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:bim_settings (additive)
create table "bim_settings" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"code" text default 'default'::text not null,
	"name" text default 'Default BIM Takeoff & Cleanup Policy'::text not null,
	"min_confidence" numeric default '0.7'::numeric not null,
	"duplicate_center_tol_m" numeric default '0.05'::numeric not null,
	"shape_tolerance_pct" numeric default '3'::numeric not null,
	"size_band_step_mm" numeric default '25'::numeric not null,
	"connection_gap_tol_m" numeric default '0.05'::numeric not null,
	"variance_flag_pct" numeric default '15'::numeric not null,
	"auto_reclassify_generic" boolean default true not null,
	"auto_split_multi_storey" boolean default true not null,
	"auto_deduplicate" boolean default true not null,
	"exclude_ifc_classes" text[] default '{"IFCSPACE","IFCOPENINGELEMENT"}'::text[] not null,
	"size_bands_mm" jsonb default '[20,32,50,80,100,150,200,300,500]'::jsonb not null,
	"material_densities" jsonb default '{"aluminium":2700,"concrete":2400,"copper":8960,"galvanised steel":7850,"stainless steel":7930,"steel":7850}'::jsonb,
	"service_aliases" jsonb default '{"chilled_water":["chilled water","chw","chws","chwr","condenser water","cws","cwr","chiller","cooling tower"],"domestic_cold_water":["domestic cold","cold water","potable","dcw","cw supply","water supply"],"domestic_hot_water":["domestic hot","hot water","dhw","hw supply","water heater"],"electrical_power":["electrical","electric","power","conduit","emt","cablesegment","cablecarrier","cable","trunking","panelboard","switchboard","receptacle","outlet","switchingdevice","socket","lighting","lightfixture","luminaire","downlight"],"elv_comms":["elv","data","telecom","cctv","security","audio","av","bms","nurse call"],"fire_protection":["fire","sprinkler","hose reel","wet riser","dry riser","hydrant","smoke","alarm"],"hydronic_hvac":["hydronic","heating","boiler","radiator","space heater","fcu","ahu","refrigerant","vrf","vrv","acmv","hvac"],"natural_gas":["natural gas","town gas","lpg","gas supply","fuel gas"],"sanitary_dwv":["sanitary","waste","soil","sewer","vent","dwv","toilet","urinal","sink","lavatory","tub","shower","floor trap"],"storm_drain":["storm drain","storm water","stormwater","rainwater","rwdp","roof drain","surface drain","storm"],"ventilation_duct":["supply air","return air","exhaust air","fresh air","airterminal","duct","diffuser","grille","fan","ventilation"]}'::jsonb,
	"extra_property_keys" text[],
	"max_visual_archetypes" int default '200'::int not null,
	"max_proposals" int default '30'::int not null,
	"max_candidates" int default '80'::int not null,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_bim_settings_93340fdd"("name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_bim_settings_93340fdd"("name"), ''))) stored,
	constraint "bim_settings__ck__17cc6c9f" check ("min_confidence" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("min_confidence", 2) = "min_confidence"),
	constraint "bim_settings__ck__01e15b6e" check ("duplicate_center_tol_m" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("duplicate_center_tol_m", 3) = "duplicate_center_tol_m"),
	constraint "bim_settings__ck__5659e41f" check ("shape_tolerance_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("shape_tolerance_pct", 1) = "shape_tolerance_pct"),
	constraint "bim_settings__ck__67e6c7ab" check ("size_band_step_mm" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("size_band_step_mm", 1) = "size_band_step_mm"),
	constraint "bim_settings__ck__b5366719" check ("connection_gap_tol_m" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("connection_gap_tol_m", 3) = "connection_gap_tol_m"),
	constraint "bim_settings__ck__155ad2c6" check ("variance_flag_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("variance_flag_pct", 1) = "variance_flag_pct"),
	constraint "bim_settings__ck__dfe339b4" check (not jsonb_path_exists(to_jsonb("exclude_ifc_classes"), 'strict $[*] ? (@.type() != "string")')),
	constraint "bim_settings__ck__de5cff69" check (("size_bands_mm" is null or store_json_valid("size_bands_mm", '{"default":[20,32,50,80,100,150,200,300,500],"kind":"int","many":true}'::jsonb) is true)),
	constraint "bim_settings__ck__35537d37" check (("material_densities" is null or store_json_valid("material_densities", '{"default":{"aluminium":2700,"concrete":2400,"copper":8960,"galvanised steel":7850,"stainless steel":7930,"steel":7850},"kind":"json","optional":true}'::jsonb) is true)),
	constraint "bim_settings__ck__4644fed8" check (("service_aliases" is null or store_json_valid("service_aliases", '{"default":{"chilled_water":["chilled water","chw","chws","chwr","condenser water","cws","cwr","chiller","cooling tower"],"domestic_cold_water":["domestic cold","cold water","potable","dcw","cw supply","water supply"],"domestic_hot_water":["domestic hot","hot water","dhw","hw supply","water heater"],"electrical_power":["electrical","electric","power","conduit","emt","cablesegment","cablecarrier","cable","trunking","panelboard","switchboard","receptacle","outlet","switchingdevice","socket","lighting","lightfixture","luminaire","downlight"],"elv_comms":["elv","data","telecom","cctv","security","audio","av","bms","nurse call"],"fire_protection":["fire","sprinkler","hose reel","wet riser","dry riser","hydrant","smoke","alarm"],"hydronic_hvac":["hydronic","heating","boiler","radiator","space heater","fcu","ahu","refrigerant","vrf","vrv","acmv","hvac"],"natural_gas":["natural gas","town gas","lpg","gas supply","fuel gas"],"sanitary_dwv":["sanitary","waste","soil","sewer","vent","dwv","toilet","urinal","sink","lavatory","tub","shower","floor trap"],"storm_drain":["storm drain","storm water","stormwater","rainwater","rwdp","roof drain","surface drain","storm"],"ventilation_duct":["supply air","return air","exhaust air","fresh air","airterminal","duct","diffuser","grille","fan","ventilation"]},"kind":"json","optional":true}'::jsonb) is true)),
	constraint "bim_settings__ck__f383b038" check (not jsonb_path_exists(to_jsonb("extra_property_keys"), 'strict $[*] ? (@.type() != "string")')),
	constraint "bim_settings__ck__33e55d02" check ("max_visual_archetypes" >= 1 and "max_visual_archetypes" <= 2000),
	constraint "bim_settings__ck__e1a1d4b5" check ("max_proposals" >= 0 and "max_proposals" <= 200),
	constraint "bim_settings__ck__5338ecb9" check ("max_candidates" >= 10 and "max_candidates" <= 250),
	constraint "bim_settings__uq__8afde2d7" unique ("code"),
	constraint "bim_settings__ck__d8a601cc" check ((coalesce("min_confidence" >= '0.1'::numeric, false) and coalesce("min_confidence" <= '0.99'::numeric, false))),
	constraint "bim_settings__ck__9a600a63" check ((coalesce("variance_flag_pct" >= '1'::numeric, false) and coalesce("variance_flag_pct" <= '100'::numeric, false)))
);

-- step create:table:sop_rules (additive)
create table "sop_rules" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"code" text not null,
	"name" text not null,
	"authority" text default 'bca'::text not null,
	"severity" text default 'error'::text not null,
	"scope" text default 'element'::text not null,
	"metric" text default 'min_width_mm'::text not null,
	"operator" text default 'gte'::text not null,
	"threshold_num" numeric,
	"threshold_text" text,
	"ifc_classes" text[],
	"name_contains" text[],
	"service_filter" text[],
	"clause_ref" text,
	"remediation" text,
	"active" boolean default true not null,
	"bolt_record_label" text generated always as ("bolt_record_label_sop_rules_0d7dd15b"("code", "name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_sop_rules_0d7dd15b"("code", "name"), '') || ' ' || coalesce("code"::text, '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("clause_ref"::text, '') || ' ' || coalesce("remediation"::text, ''))) stored,
	constraint "sop_rules__ck__4778a05a" check ("authority" in ('corenet_x', 'bca', 'scdf', 'pub', 'ura', 'company_sop')),
	constraint "sop_rules__ck__1725b98c" check ("severity" in ('error', 'warning', 'info')),
	constraint "sop_rules__ck__b6cf179f" check ("scope" in ('model', 'element', 'estimate')),
	constraint "sop_rules__ck__a266f1bd" check ("metric" in ('schema_version', 'georef_crs', 'sgpset_coverage_pct', 'unassigned_storey_pct', 'proxy_ratio_pct', 'duplicate_count', 'mep_untagged_pct', 'min_width_mm', 'min_height_mm', 'min_thickness_mm', 'max_thickness_mm', 'max_riser_mm', 'min_tread_mm', 'max_slope_pct', 'required_property', 'required_material', 'required_service', 'min_classified_pct', 'max_unmatched_count', 'max_variance_warnings', 'semantic_check')),
	constraint "sop_rules__ck__8f88462e" check ("operator" in ('gte', 'lte', 'eq', 'contains', 'present')),
	constraint "sop_rules__ck__18a01713" check ("threshold_num" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("threshold_num", 2) = "threshold_num"),
	constraint "sop_rules__ck__4c0a4130" check (not jsonb_path_exists(to_jsonb("ifc_classes"), 'strict $[*] ? (@.type() != "string")')),
	constraint "sop_rules__ck__33c66f9d" check (not jsonb_path_exists(to_jsonb("name_contains"), 'strict $[*] ? (@.type() != "string")')),
	constraint "sop_rules__ck__778d239a" check (not jsonb_path_exists(to_jsonb("service_filter"), 'strict $[*] ? (@.type() != "string")')),
	constraint "sop_rules__uq__8afde2d7" unique ("code")
);

-- step replace:column:activities.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "activities" add column "bolt_record_label" text generated always as ("bolt_record_label_activities_06f5fc13"("title")) stored;

-- step create:column:activities.description (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "description" text;

-- step replace:column:activities.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "activities" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_activities_06f5fc13"("title"), '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("description"::text, ''))) stored;

-- step create:column:asset_mappings.service (additive)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" add column "service" text;

-- step create:column:asset_mappings.size_mm (additive)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" add column "size_mm" text;

-- step replace:column:asset_mappings.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "asset_mappings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_asset_mappings_6895cf89"("label"), '') || ' ' || coalesce("label"::text, '') || ' ' || coalesce("ifc_class"::text, '') || ' ' || coalesce("service"::text, '') || ' ' || coalesce("size_mm"::text, ''))) stored;

-- step replace:column:tasks.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "tasks" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_tasks_26010760"("task_code", "title"), '') || ' ' || coalesce("task_code"::text, '') || ' ' || coalesce("wbs_path"::text, '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("zone"::text, ''))) stored;

-- step replace:history:schema:activities (additive)
select bolt_history_register('activities','{"audit":true,"fields":{"about":{"inverse":"activities","kind":"ref","on_delete":"cascade","to":["projects","tasks","contracts","contacts"]},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"author":{"kind":"ref","optional":true,"to":"sys_user"},"description":{"kind":"text","optional":true},"occurred_at":{"default":{"var":"now"},"kind":"instant"},"project_id":{"inverse":"project_activities","kind":"ref","on_delete":"cascade","optional":true,"to":"projects"},"source_message_id":{"inverse":"activities","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"title":{"kind":"text"}},"indexes":[{"on":["occurred_at"]},{"on":["project_id","occurred_at"]}],"record_label":"record.title","search":{"text":["title","description"]}}'::jsonb);

-- step replace:history:schema:asset_mappings (additive)
select bolt_history_register('asset_mappings','{"audit":true,"fields":{"cleanup_note":{"kind":"text","optional":true},"confidence":{"kind":"decimal","optional":true,"scale":2},"continuity":{"default":"discontiguous","kind":"enum","values":["discontiguous","contiguous_linear","contiguous_planar"]},"ifc_class":{"kind":"text"},"item_id":{"inverse":"asset_mappings","kind":"ref","on_delete":"set_null","optional":true,"to":"item_matrix"},"label":{"kind":"text"},"note":{"kind":"text","optional":true},"picture":{"accept":["image/jpeg"],"kind":"file","max":"1MiB","optional":true},"review_status":{"default":"pending","kind":"enum","values":["pending","verified","flagged"]},"service":{"kind":"text","optional":true},"signature":{"kind":"text"},"size_mm":{"kind":"text","optional":true},"source":{"default":"system_1","kind":"enum","values":["system_1","qs","proposal"]}},"indexes":[{"on":["review_status"]}],"record_label":"record.label","search":{"text":["label","ifc_class","service","size_mm"]},"unique":[{"fields":["signature"],"import_key":true,"name":"one_per_signature"}]}'::jsonb);

-- step replace:history:schema:item_matrix (additive)
select bolt_history_register('item_matrix','{"audit":true,"check":{"derived_needs_source":{"or":[{"quantity_basis":{"ne":"derived"}},{"derived_from":{"is_null":false},"ratio":{"gt":0}}]},"valid_carbon":{"carbon_factor":{"gte":0}},"valid_rate":{"unit_rate":{"gte":0}},"valid_waste":{"waste_factor_pct":{"gte":0,"lte":100}}},"fields":{"active":{"default":true,"kind":"bool"},"carbon_factor":{"default":0,"kind":"decimal","scale":3},"category":{"default":"bim_asset","kind":"enum","values":["bim_asset","additional_cost"]},"code":{"kind":"text"},"currency":{"default":"SGD","kind":"currency"},"derived_from":{"kind":"text","optional":true},"discipline":{"default":"mep","kind":"enum","values":["architecture","structural","mep","civil","preliminaries","general"]},"ifc_classes":{"kind":"text","many":true,"optional":true},"insulated":{"default":"any","kind":"enum","values":["any","insulated","uninsulated"]},"match_keywords":{"kind":"text","many":true,"optional":true},"max_size_mm":{"kind":"decimal","optional":true,"scale":1},"min_size_mm":{"kind":"decimal","optional":true,"scale":1},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"quantity_basis":{"default":"count","kind":"enum","values":["count","length","area","volume","weight","lump_sum","pct_of_bim","derived"]},"rate_basis":{"default":"benchmark","kind":"enum","values":["tender","benchmark","subcon_quote","assumption"]},"ratio":{"kind":"decimal","optional":true,"scale":4},"stands_in_for":{"kind":"text","optional":true},"system_services":{"kind":"text","many":true,"optional":true},"topology_mode":{"default":"auto","kind":"enum","values":["auto","discontiguous","contiguous_linear","contiguous_planar"]},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"unit":{"default":"ea","kind":"enum","values":["ea","m","m2","m3","kg","ls","month","pct"]},"unit_rate":{"currency":"currency","default":0,"kind":"money"},"validity":{"kind":"period","of":"date","optional":true},"waste_factor_pct":{"default":0,"kind":"decimal","scale":1}},"indexes":[{"on":["category","active"]}],"record_label":"record.code + '' · '' + record.name","search":{"text":["code","name","notes"]},"unique":[{"fields":["code"],"import_key":true,"name":"code"}]}'::jsonb);

-- step replace:history:schema:projects (additive)
select bolt_history_register('projects','{"audit":true,"fields":{"active_contract_count":{"kind":"count","of":"contracts","where":{"status":{"in":["under_review","active"]}}},"address":{"kind":"text","optional":true},"autodesk_project_id":{"kind":"text","optional":true},"bim_compliance":{"kind":"json","optional":true,"shape":{"fields":{"checked_at":{"kind":"text"},"fail_count":{"kind":"int"},"findings":{"fields":{"actual":{"kind":"text"},"affected_count":{"kind":"int"},"authority":{"kind":"text"},"clause_ref":{"kind":"text","optional":true},"expected":{"kind":"text"},"remediation":{"kind":"text","optional":true},"rule_code":{"kind":"text"},"rule_name":{"kind":"text"},"sample_express_ids":{"kind":"int","many":true,"optional":true},"severity":{"kind":"text"},"status":{"kind":"text"}},"kind":"object","many":true},"pass_count":{"kind":"int"},"score_pct":{"kind":"int"},"total_rules":{"kind":"int"},"warn_count":{"kind":"int"}},"kind":"object"}},"bim_costing_dirty":{"default":false,"kind":"bool"},"bim_costing_error":{"hidden":true,"kind":"text","optional":true},"bim_file":{"accept":["*/*"],"kind":"file","max":"250MiB","optional":true},"bim_summary":{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"dropped_duplicates":{"kind":"int","optional":true},"multi_storey_splits":{"kind":"int","optional":true},"propagated_services":{"kind":"int","optional":true},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true},"upgraded_classes":{"kind":"int","optional":true}},"kind":"object"}},"bim_takeoff":{"accept":["application/json"],"hidden":true,"kind":"file","max":"16MiB","optional":true},"bim_takeoff_views":{"accept":["image/jpeg"],"hidden":true,"kind":"file","many":true,"max":"1MiB","optional":true},"bim_version":{"kind":"text","optional":true},"client_id":{"inverse":"client_projects","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"currency":{"default":"SGD","kind":"currency"},"description":{"format":"markdown","kind":"text","optional":true},"location":{"kind":"point","optional":true},"open_document_count":{"kind":"count","of":"commercial_documents","where":{"status":{"in":["issued","verified","certified","disputed"]}}},"open_task_count":{"kind":"count","of":"tasks","where":{"status":{"in":["todo","in_progress","blocked"]}}},"project_manager":{"kind":"ref","optional":true,"to":"sys_user"},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_role":{"default":"main_contractor","kind":"enum","values":["main_contractor","subcontractor","specialist_contractor"]},"schedule_range":{"kind":"period","of":"date","optional":true},"status":{"initial":"active","kind":"state","states":{"active":{"to":["tendering","on_hold","defects_liability","complete","cancelled"]},"cancelled":{"to":["tendering","active"]},"complete":{"to":["defects_liability"]},"defects_liability":{"to":["complete","active"]},"on_hold":{"to":["active","cancelled"]},"tendering":{"to":["active","cancelled"]}}},"zones":{"kind":"custom","of":"project_zones","optional":true}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

-- step replace:history:schema:tasks (additive)
select bolt_history_register('tasks','{"audit":true,"check":{"valid_progress":{"progress_pct":{"gte":0,"lte":100}}},"fields":{"actual_range":{"kind":"period","of":"date","optional":true},"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"baseline_range":{"kind":"period","of":"date","optional":true},"bim_express_ids":{"kind":"int","many":true,"optional":true},"contract_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","images":"attachments","kind":"text","optional":true},"external_id":{"kind":"text","optional":true},"is_milestone":{"default":false,"kind":"bool"},"kind":{"default":"adhoc","kind":"enum","values":["bim","adhoc"]},"last_updated_on":{"kind":"date","optional":true},"priority":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"progress_pct":{"default":0,"kind":"decimal","scale":1},"project_id":{"inverse":"tasks","kind":"ref","owned":true,"to":"projects"},"schedule_range":{"kind":"period","of":"date","optional":true},"source_message_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"todo","kind":"state","states":{"blocked":{"to":["in_progress","todo","cancelled"]},"cancelled":{"to":["todo"]},"done":{"to":["in_progress"]},"in_progress":{"to":["blocked","done","todo","cancelled"]},"todo":{"to":["in_progress","blocked","done","cancelled"]}}},"subcontractor_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"task_code":{"kind":"text"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"wbs_path":{"kind":"text","optional":true},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.task_code != null ? record.task_code + '' · '' + record.title : record.title","search":{"text":["task_code","wbs_path","title","zone"]},"unique":[{"fields":["project_id","task_code"],"import_key":true,"name":"task_code"}]}'::jsonb);

-- step create:column:asset_mappings.continuity (additive)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" add column "continuity" text default 'discontiguous'::text;

-- step create:column:asset_mappings.review_status (additive)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" add column "review_status" text default 'pending'::text;

-- step create:column:asset_mappings.cleanup_note (additive)
-- operational risk: access-exclusive-lock
alter table "asset_mappings" add column "cleanup_note" text;

-- step create:column:item_matrix.system_services (additive)
-- operational risk: access-exclusive-lock
alter table "item_matrix" add column "system_services" text[];

-- step create:column:item_matrix.min_size_mm (additive)
-- operational risk: access-exclusive-lock
alter table "item_matrix" add column "min_size_mm" numeric;

-- step create:column:item_matrix.max_size_mm (additive)
-- operational risk: access-exclusive-lock
alter table "item_matrix" add column "max_size_mm" numeric;

-- step create:column:item_matrix.insulated (additive)
-- operational risk: access-exclusive-lock
alter table "item_matrix" add column "insulated" text default 'any'::text;

-- step create:column:item_matrix.topology_mode (additive)
-- operational risk: access-exclusive-lock
alter table "item_matrix" add column "topology_mode" text default 'auto'::text;

-- step create:column:projects.bim_compliance (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "bim_compliance" jsonb;

-- step create:column:activities.about__projects (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "about__projects" uuid;

-- step create:column:activities.about__tasks (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "about__tasks" uuid;

-- step create:column:activities.about__contracts (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "about__contracts" uuid;

-- step create:column:activities.about__contacts (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "about__contacts" uuid;

-- step create:column:activities.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "activities" add column "project_id" uuid;

-- step create:history:schema:bim_settings (additive)
select bolt_history_register('bim_settings','{"audit":true,"check":{"valid_confidence":{"min_confidence":{"gte":0.1,"lte":0.99}},"valid_variance":{"variance_flag_pct":{"gte":1,"lte":100}}},"fields":{"auto_deduplicate":{"default":true,"kind":"bool"},"auto_reclassify_generic":{"default":true,"kind":"bool"},"auto_split_multi_storey":{"default":true,"kind":"bool"},"code":{"default":"default","kind":"text"},"connection_gap_tol_m":{"default":0.05,"kind":"decimal","scale":3},"duplicate_center_tol_m":{"default":0.05,"kind":"decimal","scale":3},"exclude_ifc_classes":{"default":["IFCSPACE","IFCOPENINGELEMENT"],"kind":"text","many":true},"extra_property_keys":{"kind":"text","many":true,"optional":true},"material_densities":{"default":{"aluminium":2700,"concrete":2400,"copper":8960,"galvanised steel":7850,"stainless steel":7930,"steel":7850},"kind":"json","optional":true},"max_candidates":{"default":80,"kind":"int","max":250,"min":10},"max_proposals":{"default":30,"kind":"int","max":200,"min":0},"max_visual_archetypes":{"default":200,"kind":"int","max":2000,"min":1},"min_confidence":{"default":0.7,"kind":"decimal","scale":2},"name":{"default":"Default BIM Takeoff & Cleanup Policy","kind":"text"},"notes":{"format":"markdown","kind":"text","optional":true},"service_aliases":{"default":{"chilled_water":["chilled water","chw","chws","chwr","condenser water","cws","cwr","chiller","cooling tower"],"domestic_cold_water":["domestic cold","cold water","potable","dcw","cw supply","water supply"],"domestic_hot_water":["domestic hot","hot water","dhw","hw supply","water heater"],"electrical_power":["electrical","electric","power","conduit","emt","cablesegment","cablecarrier","cable","trunking","panelboard","switchboard","receptacle","outlet","switchingdevice","socket","lighting","lightfixture","luminaire","downlight"],"elv_comms":["elv","data","telecom","cctv","security","audio","av","bms","nurse call"],"fire_protection":["fire","sprinkler","hose reel","wet riser","dry riser","hydrant","smoke","alarm"],"hydronic_hvac":["hydronic","heating","boiler","radiator","space heater","fcu","ahu","refrigerant","vrf","vrv","acmv","hvac"],"natural_gas":["natural gas","town gas","lpg","gas supply","fuel gas"],"sanitary_dwv":["sanitary","waste","soil","sewer","vent","dwv","toilet","urinal","sink","lavatory","tub","shower","floor trap"],"storm_drain":["storm drain","storm water","stormwater","rainwater","rwdp","roof drain","surface drain","storm"],"ventilation_duct":["supply air","return air","exhaust air","fresh air","airterminal","duct","diffuser","grille","fan","ventilation"]},"kind":"json","optional":true},"shape_tolerance_pct":{"default":3,"kind":"decimal","scale":1},"size_band_step_mm":{"default":25,"kind":"decimal","scale":1},"size_bands_mm":{"default":[20,32,50,80,100,150,200,300,500],"kind":"int","many":true},"variance_flag_pct":{"default":15,"kind":"decimal","scale":1}},"record_label":"record.name","unique":[{"fields":["code"],"import_key":true,"name":"unique_code"}]}'::jsonb);

-- step create:history:schema:sop_rules (additive)
select bolt_history_register('sop_rules','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"authority":{"default":"bca","kind":"enum","values":["corenet_x","bca","scdf","pub","ura","company_sop"]},"clause_ref":{"kind":"text","optional":true},"code":{"kind":"text"},"ifc_classes":{"kind":"text","many":true,"optional":true},"metric":{"default":"min_width_mm","kind":"enum","values":["schema_version","georef_crs","sgpset_coverage_pct","unassigned_storey_pct","proxy_ratio_pct","duplicate_count","mep_untagged_pct","min_width_mm","min_height_mm","min_thickness_mm","max_thickness_mm","max_riser_mm","min_tread_mm","max_slope_pct","required_property","required_material","required_service","min_classified_pct","max_unmatched_count","max_variance_warnings","semantic_check"]},"name":{"kind":"text"},"name_contains":{"kind":"text","many":true,"optional":true},"operator":{"default":"gte","kind":"enum","values":["gte","lte","eq","contains","present"]},"remediation":{"kind":"text","optional":true},"scope":{"default":"element","kind":"enum","values":["model","element","estimate"]},"service_filter":{"kind":"text","many":true,"optional":true},"severity":{"default":"error","kind":"enum","values":["error","warning","info"]},"threshold_num":{"kind":"decimal","optional":true,"scale":2},"threshold_text":{"kind":"text","optional":true}},"indexes":[{"on":["authority","active"]}],"record_label":"record.code + '' · '' + record.name","search":{"text":["code","name","clause_ref","remediation"]},"unique":[{"fields":["code"],"import_key":true,"name":"unique_code"}]}'::jsonb);

-- step data:projects.bim_summary (data)
-- hazard: the shape of projects.bim_summary changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over projects); the check below counts the rows the new shape still refuses.
-- step check:projects.bim_summary (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "projects" where "bim_summary" is not null and store_json_valid("bim_summary", ''{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"dropped_duplicates":{"kind":"int","optional":true},"multi_storey_splits":{"kind":"int","optional":true},"propagated_services":{"kind":"int","optional":true},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true},"upgraded_classes":{"kind":"int","optional":true}},"kind":"object"}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of projects.bim_summary refuses % existing row(s)', n; end if;
end $store$;

-- step create:notNull:activities.title (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" where "title" is null' into n;
	if n > 0 then raise exception 'notNull:activities.title refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" alter column "title" set not null;

-- step create:notNull:asset_mappings.continuity (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "asset_mappings" where "continuity" is null' into n;
	if n > 0 then raise exception 'notNull:asset_mappings.continuity refuses % existing row(s)', n; end if;
end $store$;
alter table "asset_mappings" alter column "continuity" set not null;

-- step create:notNull:asset_mappings.review_status (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "asset_mappings" where "review_status" is null' into n;
	if n > 0 then raise exception 'notNull:asset_mappings.review_status refuses % existing row(s)', n; end if;
end $store$;
alter table "asset_mappings" alter column "review_status" set not null;

-- step create:notNull:item_matrix.insulated (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where "insulated" is null' into n;
	if n > 0 then raise exception 'notNull:item_matrix.insulated refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" alter column "insulated" set not null;

-- step create:notNull:item_matrix.topology_mode (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where "topology_mode" is null' into n;
	if n > 0 then raise exception 'notNull:item_matrix.topology_mode refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" alter column "topology_mode" set not null;

-- step create:constraint:asset_mappings.asset_mappings__ck__2d1a692d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "asset_mappings" where ("continuity" in (''discontiguous'', ''contiguous_linear'', ''contiguous_planar'')) is false' into n;
	if n > 0 then raise exception 'asset_mappings__ck__2d1a692d refuses % existing row(s)', n; end if;
end $store$;
alter table "asset_mappings" add constraint "asset_mappings__ck__2d1a692d" check ("continuity" in ('discontiguous', 'contiguous_linear', 'contiguous_planar'));

-- step create:constraint:asset_mappings.asset_mappings__ck__33814b8f (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "asset_mappings" where ("review_status" in (''pending'', ''verified'', ''flagged'')) is false' into n;
	if n > 0 then raise exception 'asset_mappings__ck__33814b8f refuses % existing row(s)', n; end if;
end $store$;
alter table "asset_mappings" add constraint "asset_mappings__ck__33814b8f" check ("review_status" in ('pending', 'verified', 'flagged'));

-- step create:constraint:item_matrix.item_matrix__ck__8ad1f103 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where (not jsonb_path_exists(to_jsonb("system_services"), ''strict $[*] ? (@.type() != "string")'')) is false' into n;
	if n > 0 then raise exception 'item_matrix__ck__8ad1f103 refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" add constraint "item_matrix__ck__8ad1f103" check (not jsonb_path_exists(to_jsonb("system_services"), 'strict $[*] ? (@.type() != "string")'));

-- step create:constraint:item_matrix.item_matrix__ck__c91b4ecc (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where ("min_size_mm" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("min_size_mm", 1) = "min_size_mm") is false' into n;
	if n > 0 then raise exception 'item_matrix__ck__c91b4ecc refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" add constraint "item_matrix__ck__c91b4ecc" check ("min_size_mm" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("min_size_mm", 1) = "min_size_mm");

-- step create:constraint:item_matrix.item_matrix__ck__e8ae13ae (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where ("max_size_mm" not in (''NaN''::numeric, ''Infinity''::numeric, ''-Infinity''::numeric) and round("max_size_mm", 1) = "max_size_mm") is false' into n;
	if n > 0 then raise exception 'item_matrix__ck__e8ae13ae refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" add constraint "item_matrix__ck__e8ae13ae" check ("max_size_mm" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("max_size_mm", 1) = "max_size_mm");

-- step create:constraint:item_matrix.item_matrix__ck__c13509b6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where ("insulated" in (''any'', ''insulated'', ''uninsulated'')) is false' into n;
	if n > 0 then raise exception 'item_matrix__ck__c13509b6 refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" add constraint "item_matrix__ck__c13509b6" check ("insulated" in ('any', 'insulated', 'uninsulated'));

-- step create:constraint:item_matrix.item_matrix__ck__c9105e84 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "item_matrix" where ("topology_mode" in (''auto'', ''discontiguous'', ''contiguous_linear'', ''contiguous_planar'')) is false' into n;
	if n > 0 then raise exception 'item_matrix__ck__c9105e84 refuses % existing row(s)', n; end if;
end $store$;
alter table "item_matrix" add constraint "item_matrix__ck__c9105e84" check ("topology_mode" in ('auto', 'discontiguous', 'contiguous_linear', 'contiguous_planar'));

-- step create:constraint:projects.projects__ck__e6be433a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_file" is null or store_json_valid("bim_file", ''{"accept":["*/*"],"kind":"file","max":"250MiB","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__e6be433a refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__e6be433a" check (("bim_file" is null or store_json_valid("bim_file", '{"accept":["*/*"],"kind":"file","max":"250MiB","optional":true}'::jsonb) is true));

-- step create:constraint:projects.projects__ck__7a5a9097 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_takeoff" is null or store_json_valid("bim_takeoff", ''{"accept":["application/json"],"hidden":true,"kind":"file","max":"16MiB","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__7a5a9097 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__7a5a9097" check (("bim_takeoff" is null or store_json_valid("bim_takeoff", '{"accept":["application/json"],"hidden":true,"kind":"file","max":"16MiB","optional":true}'::jsonb) is true));

-- step create:constraint:projects.projects__ck__99f89cc1 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_summary" is null or store_json_valid("bim_summary", ''{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"dropped_duplicates":{"kind":"int","optional":true},"multi_storey_splits":{"kind":"int","optional":true},"propagated_services":{"kind":"int","optional":true},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true},"upgraded_classes":{"kind":"int","optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__99f89cc1 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__99f89cc1" check (("bim_summary" is null or store_json_valid("bim_summary", '{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"dropped_duplicates":{"kind":"int","optional":true},"multi_storey_splits":{"kind":"int","optional":true},"propagated_services":{"kind":"int","optional":true},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true},"upgraded_classes":{"kind":"int","optional":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:projects.projects__ck__37c34870 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where (("bim_compliance" is null or store_json_valid("bim_compliance", ''{"kind":"json","optional":true,"shape":{"fields":{"checked_at":{"kind":"text"},"fail_count":{"kind":"int"},"findings":{"fields":{"actual":{"kind":"text"},"affected_count":{"kind":"int"},"authority":{"kind":"text"},"clause_ref":{"kind":"text","optional":true},"expected":{"kind":"text"},"remediation":{"kind":"text","optional":true},"rule_code":{"kind":"text"},"rule_name":{"kind":"text"},"sample_express_ids":{"kind":"int","many":true,"optional":true},"severity":{"kind":"text"},"status":{"kind":"text"}},"kind":"object","many":true},"pass_count":{"kind":"int"},"score_pct":{"kind":"int"},"total_rules":{"kind":"int"},"warn_count":{"kind":"int"}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'projects__ck__37c34870 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__37c34870" check (("bim_compliance" is null or store_json_valid("bim_compliance", '{"kind":"json","optional":true,"shape":{"fields":{"checked_at":{"kind":"text"},"fail_count":{"kind":"int"},"findings":{"fields":{"actual":{"kind":"text"},"affected_count":{"kind":"int"},"authority":{"kind":"text"},"clause_ref":{"kind":"text","optional":true},"expected":{"kind":"text"},"remediation":{"kind":"text","optional":true},"rule_code":{"kind":"text"},"rule_name":{"kind":"text"},"sample_express_ids":{"kind":"int","many":true,"optional":true},"severity":{"kind":"text"},"status":{"kind":"text"}},"kind":"object","many":true},"pass_count":{"kind":"int"},"score_pct":{"kind":"int"},"total_rules":{"kind":"int"},"warn_count":{"kind":"int"}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:activities.activities__ck__b942b83b (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" where (num_nonnulls("about__projects", "about__tasks", "about__contracts", "about__contacts") = 1) is false' into n;
	if n > 0 then raise exception 'activities__ck__b942b83b refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__ck__b942b83b" check (num_nonnulls("about__projects", "about__tasks", "about__contracts", "about__contacts") = 1);

-- step create:fk:activities.activities__fk__e22f999b (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" c where c."about__projects" is not null and not exists (select 1 from "projects" p where p."id" = c."about__projects")' into n;
	if n > 0 then raise exception 'activities__fk__e22f999b refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__fk__e22f999b" foreign key ("about__projects") references "projects" ("id") on delete cascade on update restrict;

-- step create:fk:activities.activities__fk__0e1b9eef (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" c where c."about__tasks" is not null and not exists (select 1 from "tasks" p where p."id" = c."about__tasks")' into n;
	if n > 0 then raise exception 'activities__fk__0e1b9eef refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__fk__0e1b9eef" foreign key ("about__tasks") references "tasks" ("id") on delete cascade on update restrict;

-- step create:fk:activities.activities__fk__25e5e8d6 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" c where c."about__contracts" is not null and not exists (select 1 from "contracts" p where p."id" = c."about__contracts")' into n;
	if n > 0 then raise exception 'activities__fk__25e5e8d6 refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__fk__25e5e8d6" foreign key ("about__contracts") references "contracts" ("id") on delete cascade on update restrict;

-- step create:fk:activities.activities__fk__fd00373e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" c where c."about__contacts" is not null and not exists (select 1 from "contacts" p where p."id" = c."about__contacts")' into n;
	if n > 0 then raise exception 'activities__fk__fd00373e refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__fk__fd00373e" foreign key ("about__contacts") references "contacts" ("id") on delete cascade on update restrict;

-- step create:fk:activities.activities__fk__9ee6b710 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "activities" c where c."project_id" is not null and not exists (select 1 from "projects" p where p."id" = c."project_id")' into n;
	if n > 0 then raise exception 'activities__fk__9ee6b710 refuses % existing row(s)', n; end if;
end $store$;
alter table "activities" add constraint "activities__fk__9ee6b710" foreign key ("project_id") references "projects" ("id") on delete cascade on update restrict;

-- step replace:index:activities.activities__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__gin__73732636" on "activities" using gin (bolt_search);

-- step replace:index:asset_mappings.asset_mappings__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "asset_mappings__gin__73732636" on "asset_mappings" using gin (bolt_search);

-- step replace:index:tasks.tasks__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "tasks__gin__73732636" on "tasks" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['activities','adhoc_costs','approval_request','asset_mappings','bim_settings','commercial_documents','communication_settings','contacts','contracts','cost_estimates','item_matrix','project_files','project_messages','projects','sop_rules','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_team','sys_user','sys_workspace','tasks']::text[]));

-- step replace:engine:audit:activities (additive)
drop trigger if exists bolt_audit_mark on "activities";
drop trigger if exists bolt_audit on "activities";
create trigger bolt_audit after insert or update or delete on "activities" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[["about__projects","projects"],["about__tasks","tasks"],["about__contracts","contracts"],["about__contacts","contacts"],["author","sys_user"],["project_id","projects"],["source_message_id","project_messages"]]');

-- step create:index:activities.activities__ix__c42566f3 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__c42566f3" on "activities" ("occurred_at");

-- step create:index:activities.activities__ix__ce718e7b (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__ce718e7b" on "activities" ("project_id", "occurred_at");

-- step create:index:asset_mappings.asset_mappings__ix__53539c69 (additive)
-- operational risk: writes-blocked, table-scan
create index "asset_mappings__ix__53539c69" on "asset_mappings" ("review_status");

-- step create:trigger:bim_settings.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "bim_settings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:bim_settings.bim_settings__gin__83dcd773 (additive)
create index "bim_settings__gin__83dcd773" on "bim_settings" using gin ("exclude_ifc_classes");

-- step create:index:bim_settings.bim_settings__gin__064cbe59 (additive)
create index "bim_settings__gin__064cbe59" on "bim_settings" using gin ("extra_property_keys");

-- step create:index:bim_settings.bim_settings__gin__73732636 (additive)
create index "bim_settings__gin__73732636" on "bim_settings" using gin (bolt_search);

-- step create:index:item_matrix.item_matrix__gin__faa314be (additive)
-- operational risk: writes-blocked, table-scan
create index "item_matrix__gin__faa314be" on "item_matrix" using gin ("system_services");

-- step create:trigger:sop_rules.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "sop_rules" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:sop_rules.sop_rules__gin__e3ed8963 (additive)
create index "sop_rules__gin__e3ed8963" on "sop_rules" using gin ("ifc_classes");

-- step create:index:sop_rules.sop_rules__gin__f96756bd (additive)
create index "sop_rules__gin__f96756bd" on "sop_rules" using gin ("name_contains");

-- step create:index:sop_rules.sop_rules__gin__d6fe386d (additive)
create index "sop_rules__gin__d6fe386d" on "sop_rules" using gin ("service_filter");

-- step create:index:sop_rules.sop_rules__gin__73732636 (additive)
create index "sop_rules__gin__73732636" on "sop_rules" using gin (bolt_search);

-- step create:index:sop_rules.sop_rules__ix__fc92b22e (additive)
create index "sop_rules__ix__fc92b22e" on "sop_rules" ("authority", "active");

-- step create:index:activities.activities__ix__d1f306ad (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__d1f306ad" on "activities" ("about__projects");

-- step create:index:activities.activities__ix__56d8a3d5 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__56d8a3d5" on "activities" ("about__tasks");

-- step create:index:activities.activities__ix__aa09df75 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__aa09df75" on "activities" ("about__contracts");

-- step create:index:activities.activities__ix__7abd66e7 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__7abd66e7" on "activities" ("about__contacts");

-- step create:index:activities.activities__ix__17a654f9 (additive)
-- operational risk: writes-blocked, table-scan
create index "activities__ix__17a654f9" on "activities" ("project_id");

-- step create:engine:audit:bim_settings (additive)
drop trigger if exists bolt_audit_mark on "bim_settings";
drop trigger if exists bolt_audit on "bim_settings";
create trigger bolt_audit after insert or update or delete on "bim_settings" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step create:engine:audit:sop_rules (additive)
drop trigger if exists bolt_audit_mark on "sop_rules";
drop trigger if exists bolt_audit on "sop_rules";
create trigger bolt_audit after insert or update or delete on "sop_rules" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');
