-- 0002_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

create or replace function "bolt_record_label_requestor_ecf94290"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['user_id']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('user_id', to_jsonb("user_id")) AS j FROM (SELECT $1 AS "user_id") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_api_key_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_challenge_df4146f1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['address_mac']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('address_mac', to_jsonb("address_mac")) AS j FROM (SELECT $1 AS "address_mac") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_config_3b2327df"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['key']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('key', to_jsonb("key")) AS j FROM (SELECT $1 AS "key") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_conversation_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_envoy_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_file_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_inbox_36426dfc"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['delivery']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('delivery', to_jsonb("delivery")) AS j FROM (SELECT $1 AS "delivery") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_integration_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_invitation_34710ef4"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['email']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('email', to_jsonb("email")) AS j FROM (SELECT $1 AS "email") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_message_6667a00c"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['preview']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('preview', to_jsonb("preview")) AS j FROM (SELECT $1 AS "preview") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_notification_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_outbox_3b2327df"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['key']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('key', to_jsonb("key")) AS j FROM (SELECT $1 AS "key") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_run_09f15580"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['automation']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('automation', to_jsonb("automation")) AS j FROM (SELECT $1 AS "automation") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_session_6a2ce92f"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['via']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('via', to_jsonb("via")) AS j FROM (SELECT $1 AS "via") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_sync_35128a4d"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['sync']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('sync', to_jsonb("sync")) AS j FROM (SELECT $1 AS "sync") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_sync_row_605c7331"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['remote_id']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('remote_id', to_jsonb("remote_id")) AS j FROM (SELECT $1 AS "remote_id") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sys_user_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_commercial_settings_c31fc1bb"() returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb('Commercial settings'::text) #>> '{}') AS value FROM (SELECT jsonb_build_object() AS j FROM (SELECT 1 AS unused) label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_commission_rules_6bb98859"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb((coalesce((label_row.j #> ARRAY['currency']), 'null'::jsonb) #>> '{}')) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_on']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('currency', to_jsonb("currency"), 'effective_on', to_jsonb("effective_on"::text)) AS j FROM (SELECT $1 AS "currency", $2 AS "effective_on") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_document_templates_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_commission_statements_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_orders_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_activities_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_ext_purchase_orders_813c0aa8"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_order_files_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_source_payments_813c0aa8"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_source_sales_lines_813c0aa8"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_transactions_813c0aa8"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_parties_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_contacts_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_products_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_warehouses_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

select bolt_history_register('approval_request','{"fields":{"action":{"kind":"enum","values":["create","update","delete"]},"approver_teams":{"kind":"json","shape":{"kind":"text","many":true}},"approver_users":{"kind":"json","shape":{"kind":"text","many":true}},"closed_at":{"kind":"instant","optional":true},"closed_by":{"kind":"text","optional":true},"collection_name":{"kind":"text"},"created_at":{"kind":"instant"},"record_id":{"kind":"text"},"revision":{"default":1,"kind":"int"},"status":{"kind":"enum","values":["ONGOING","CHANGES_REQUESTED","APPROVED","REJECTED","SUPERSEDED","WITHDRAWN"]},"step":{"kind":"int"},"step_names":{"kind":"json","shape":{"kind":"text","many":true}},"steps":{"kind":"int"},"superseder_teams":{"kind":"json","shape":{"kind":"text","many":true}}},"key":"uuid","search":{"text":["collection_name"]},"unique":[{"fields":["collection_name","record_id"],"name":"one_ongoing_request","where":{"status":{"eq":"ONGOING"}}}]}'::jsonb);

select bolt_history_register('sys_api_key','{"fields":{"created_at":{"default":{"var":"now"},"kind":"instant"},"created_by":{"kind":"ref","optional":true,"to":"sys_user"},"hash":{"kind":"text"},"last_used_at":{"kind":"instant","optional":true},"name":{"kind":"text"},"prefix":{"kind":"text"},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"key":"text","record_label":"record.name","unique":[{"fields":["prefix"],"name":"prefix"}]}'::jsonb);

select bolt_history_register('sys_conversation','{"fields":{"archived_at":{"kind":"instant","optional":true},"created_at":{"default":{"var":"now"},"kind":"instant"},"envoy":{"kind":"text","optional":true},"inputs":{"default":[],"kind":"json"},"integration":{"kind":"ref","on_delete":"cascade","optional":true,"to":"sys_integration"},"kind":{"kind":"text","optional":true},"lease_until":{"kind":"instant","optional":true},"model":{"default":"default","kind":"text"},"outputs":{"default":[],"kind":"json"},"owner":{"kind":"text","optional":true},"parent":{"kind":"text","optional":true},"participants":{"kind":"json","optional":true},"plan":{"kind":"json","optional":true},"read":{"default":{},"kind":"json"},"restart_at":{"kind":"text","optional":true},"restart_from":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"run":{"kind":"text","optional":true},"status":{"default":"idle","kind":"text"},"thread":{"kind":"text","optional":true},"title":{"kind":"text","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.title"}'::jsonb);

select bolt_history_register('sys_envoy','{"fields":{"active":{"default":true,"kind":"bool"},"audience":{"default":"private","kind":"enum","values":["private","public"]},"created_at":{"default":{"var":"now"},"kind":"instant"},"delegation":{"default":"disabled","kind":"enum","values":["enabled","disabled"]},"dm":{"default":"union","kind":"enum","values":["union","envoy"]},"group_messages":{"default":"mention_or_reply","kind":"enum","values":["disabled","mention_or_reply","all"]},"name":{"kind":"text"},"policies":{"default":[],"kind":"text","many":true},"revision":{"default":1,"kind":"int"},"task":{"default":"","format":"markdown","kind":"text"},"triage":{"default":false,"kind":"bool"},"triage_scope":{"default":"all","hidden":true,"kind":"enum","values":["dm","group","all"]}},"key":"uuid","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_file','{"fields":{"created_at":{"kind":"instant"},"created_by":{"kind":"text","optional":true},"field":{"kind":"text"},"key":{"kind":"text"},"mime":{"kind":"text"},"name":{"kind":"text"},"revision":{"default":1,"kind":"int"},"sha256":{"kind":"text"},"size":{"kind":"int"},"updated_at":{"kind":"instant","optional":true},"updated_by":{"kind":"text","optional":true}},"key":"text","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_integration','{"fields":{"active":{"default":true,"kind":"bool"},"configuration":{"default":{},"kind":"json"},"envoy":{"kind":"text","optional":true},"epoch":{"kind":"text","optional":true},"import_start":{"kind":"json","optional":true},"integration":{"kind":"text"},"name":{"kind":"text"},"owner":{"kind":"ref","optional":true,"to":"sys_user"},"revision":{"default":1,"kind":"int"},"status":{"kind":"json","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.name","unique":[{"fields":["owner","integration"],"name":"one_per_member","where":{"owner":{"is_null":false}}}]}'::jsonb);

select bolt_history_register('sys_invitation','{"check":{"addressed":{"or":[{"email":{"is_null":false}},{"phone":{"is_null":false}}]}},"fields":{"accepted_at":{"kind":"instant","optional":true},"email":{"kind":"text","optional":true},"expires_at":{"kind":"instant"},"external":{"default":false,"kind":"bool"},"invited_by":{"kind":"ref","optional":true,"to":"sys_user"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}]},{"on":["phone"]}],"key":"text","record_label":"record.email"}'::jsonb);

select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

select bolt_history_register('commercial_settings','{"audit":true,"fields":{"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"credit_fresh_minutes":{"default":60,"kind":"int","min":1},"default_document_layout":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"default_purchase_document_layout":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"require_floor":{"default":false,"kind":"bool"},"stock_fresh_minutes":{"default":30,"kind":"int","min":1}},"record_label":"''Commercial settings''","unique":[{"fields":["code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('commission_rules','{"audit":true,"check":{"fixed_rate_nonnegative":{"fixed_rate":{"gte":"0"}}},"fields":{"active":{"default":true,"kind":"bool"},"amount_expression":{"default":"basis_quantity * (rule.fixed_rate + max(spread, 0) * rule.spread_pct / 100)","format":"cel","kind":"text"},"basis_unit":{"kind":"text","optional":true},"code":{"default":"default","hidden":true,"kind":"enum","values":["default"]},"currency":{"kind":"currency"},"effective_on":{"kind":"date"},"eligibility_expression":{"default":"true","format":"cel","kind":"text"},"fixed_rate":{"currency":"currency","default":"0","kind":"money","scale":4},"parameters":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true}},"spread_pct":{"default":"0","kind":"decimal","max":100,"min":0,"scale":2}},"record_label":"string(record.currency) + '' · '' + string(record.effective_on)","search":{"text":["basis_unit"]},"unique":[{"fields":["code","currency","effective_on"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('document_templates','{"audit":true,"fields":{"body":{"default":"{agreement}","kind":"text"},"contract_stamp":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"layout":{"kind":"enum","optional":true,"values":["text","table_v1"]},"letterhead":{"accept":["image/png"],"kind":"file","max":"512KiB","optional":true},"locale":{"kind":"enum","values":["en","zh"]},"print_fields":{"fields":{"default_value":{"kind":"text","optional":true},"key":{"kind":"text"},"label":{"kind":"text"},"multiline":{"kind":"bool","optional":true},"scope":{"kind":"enum","values":["order","line"]}},"kind":"object","many":true,"optional":true},"print_layout":{"accept":["text/html"],"kind":"file","max":"3MiB","optional":true},"published_at":{"kind":"instant","optional":true},"status":{"initial":"draft","kind":"state","states":{"draft":{"to":["published"]},"published":{}}},"title":{"kind":"text"},"version":{"kind":"text"}},"locks":{"published":{"where":{"status":{"eq":"published"}}}},"record_label":"record.title","search":{"text":["title"]}}'::jsonb);

select bolt_history_register('commission_statements','{"audit":true,"fields":{"acknowledged_at":{"kind":"instant"},"acknowledged_by":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"amount":{"currency":"currency","kind":"money"},"calculation_hash":{"hidden":true,"kind":"text"},"currency":{"kind":"currency"},"number":{"kind":"seq","pattern":"CS-{yyyy}-{0000}"},"order_count":{"kind":"int"},"owner":{"kind":"ref","to":"sys_user"},"period":{"kind":"date"},"snapshot":{"hidden":true,"kind":"json","shape":{"fields":{"amount":{"kind":"text","optional":true},"awaiting_approval":{"kind":"bool"},"calculation_hash":{"kind":"text"},"number":{"kind":"text"},"order":{"kind":"text"},"unresolved_lines":{"kind":"int"}},"kind":"object","many":true}}},"record_label":"record.number","unique":[{"fields":["owner","period","currency","calculation_hash"],"name":"one_monthly_commission_statement"}]}'::jsonb);

select bolt_history_register('orders','{"audit":true,"fields":{"archived":{"default":false,"kind":"bool"},"buyer_contact":{"kind":"text","optional":true},"buyer_mobile":{"format":"phone","kind":"text","optional":true},"check_hash":{"hidden":true,"kind":"text","optional":true},"commission":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"amount_expression":{"kind":"text","optional":true},"basis_unit":{"kind":"text"},"currency":{"kind":"text"},"effective_on":{"kind":"text"},"eligibility_expression":{"kind":"text","optional":true},"engine_version":{"kind":"text","optional":true},"fixed_rate":{"kind":"text"},"parameters":{"fields":{"name":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"rule_id":{"kind":"text"},"spread_pct":{"kind":"text"}},"kind":"object"},"was":"sealed_commission"},"currency":{"kind":"currency"},"delivery_address":{"kind":"text","optional":true},"delivery_date":{"kind":"date","optional":true},"delivery_terms":{"kind":"text","optional":true},"direction":{"kind":"enum","values":["sales","purchasing"]},"document_template":{"kind":"ref","optional":true,"to":"document_templates","where":{"status":{"eq":"published"}}},"freight_treatment":{"default":"deduct","kind":"enum","values":["deduct","include"]},"kingdee":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"closed":{"kind":"bool"},"exchange_rate":{"kind":"text"},"fid":{"kind":"text"},"reference":{"kind":"text"},"status":{"kind":"enum","values":["draft","issued","void"]},"version":{"kind":"text"}},"kind":"object"}},"ledger":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"line_count":{"kind":"count","of":"lines"},"logistics_handler":{"kind":"ref","optional":true,"to":"sys_user"},"net":{"kind":"sum","of":"lines.net"},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"TR-{yyyy}-{0000}"},"ordered_on":{"default":{"var":"today"},"kind":"date"},"other_terms":{"kind":"text","optional":true},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"packaging":{"kind":"text","optional":true},"party":{"inverse":"orders","kind":"ref","to":"parties"},"party_name":{"kind":"text","optional":true},"payment_method":{"kind":"text","optional":true},"payment_terms":{"kind":"text"},"place_of_delivery":{"kind":"text","optional":true},"place_of_loading":{"kind":"text","optional":true},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"shipping_mark":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"source_order_key":{"hidden":true,"kind":"text","optional":true},"status":{"initial":"draft","kind":"state","states":{"confirmed":{},"draft":{"to":["confirmed"]}}},"supporting_documents":{"accept":["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],"kind":"file","many":true,"max":"20MiB","optional":true},"tax":{"kind":"sum","of":"lines.tax"},"tax_inclusive":{"default":false,"kind":"bool"},"time_of_shipment":{"kind":"text","optional":true},"title":{"kind":"text"},"total":{"kind":"sum","of":"lines.total"},"valid_from":{"kind":"date","optional":true},"valid_until":{"kind":"date","optional":true},"warehouse":{"kind":"ref","optional":true,"to":"warehouses"},"write_target":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"account":{"kind":"text"},"branch":{"kind":"text"}},"kind":"object"}}},"record_label":"record.number","search":{"text":["number","title","party_name"]},"unique":[{"fields":["source_order_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('activities','{"audit":true,"fields":{"done":{"default":false,"kind":"bool"},"due_on":{"default":{"var":"today"},"kind":"date"},"kind":{"default":"task","kind":"enum","values":["task","call","meeting","note"]},"notes":{"kind":"text","optional":true},"order":{"inverse":"activities","kind":"ref","to":"orders"},"owner":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"},"title":{"kind":"text"}},"record_label":"record.title","search":{"text":["title","kind"]}}'::jsonb);

select bolt_history_register('ext_purchase_orders','{"audit":true,"fields":{"currency":{"kind":"currency"},"external_id":{"hidden":true,"kind":"text"},"order":{"inverse":"ext_purchase_orders","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"kind":"enum","values":["draft","issued","void"]}},"record_label":"record.reference","unique":[{"fields":["source","external_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('order_files','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"20MiB"},"order":{"inverse":"filed_documents","kind":"ref","to":"orders"},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

select bolt_history_register('order_lines','{"audit":true,"check":{"unit_price_nonnegative":{"unit_price":{"gte":"0"}}},"fields":{"commission_basis_unit":{"kind":"text","optional":true},"commission_factor":{"kind":"decimal","min":0,"optional":true,"scale":6},"currency":{"kind":"currency"},"discount_pct":{"default":0,"kind":"decimal","max":100,"min":0,"scale":2},"floor_net":{"currency":"currency","kind":"money","optional":true,"scale":8},"floor_on":{"kind":"date","optional":true},"line_key":{"hidden":true,"kind":"text","optional":true},"net":{"currency":"currency","kind":"money"},"order":{"inverse":"lines","kind":"ref","owned":true,"to":"orders"},"print_values":{"fields":{"key":{"kind":"text"},"value":{"kind":"text"}},"kind":"object","many":true,"optional":true},"product":{"kind":"ref","to":"products"},"product_code":{"kind":"text"},"product_name":{"kind":"text"},"product_spec":{"kind":"text","optional":true},"quantity":{"kind":"decimal","min":0,"scale":3},"source_entry_id":{"hidden":true,"kind":"text","optional":true},"tax":{"currency":"currency","kind":"money"},"tax_rate":{"kind":"decimal","max":100,"min":0,"scale":2},"total":{"currency":"currency","kind":"money"},"unit":{"kind":"text"},"unit_price":{"currency":"currency","kind":"money","scale":4}},"record_label":"record.order.number + '' · '' + record.product_name","search":{"text":["product","product_code"]},"unique":[{"fields":["order","line_key"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('source_payments','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"amount":{"currency":"currency","kind":"money"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"invoice":{"kind":"ref","optional":true,"to":"transactions"},"kind":{"kind":"enum","values":["receipt","refund"]},"order":{"inverse":"source_payments","kind":"ref","to":"orders"},"reference":{"kind":"text"},"settled_on":{"kind":"date"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant"}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"},{"fields":["order","reference"],"name":"one_source_receipt_per_order"}]}'::jsonb);

select bolt_history_register('source_sales_lines','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"booked_cost":{"kind":"decimal","optional":true,"scale":10},"booked_cost_currency":{"kind":"currency","optional":true},"business_on":{"kind":"date"},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"freight":{"currency":"currency","kind":"money","optional":true},"kind":{"kind":"enum","values":["shipment","return","invoice_only","invoice"]},"lot_number":{"kind":"text","optional":true},"net_amount":{"currency":"currency","kind":"money","optional":true},"order":{"inverse":"source_sales_lines","kind":"ref","optional":true,"to":"orders"},"order_line":{"hidden":true,"kind":"text","optional":true},"quantity":{"kind":"decimal","scale":3},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_dimensions":{"hidden":true,"kind":"json","optional":true,"shape":{"fields":{"customer":{"kind":"text","optional":true},"employee":{"kind":"text","optional":true},"employee_id":{"kind":"text","optional":true},"product":{"kind":"text","optional":true}},"kind":"object"}},"source_updated_at":{"kind":"instant"},"tax_amount":{"currency":"currency","kind":"money","optional":true},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8}},"record_label":"record.reference","unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('transactions','{"audit":true,"fields":{"currency":{"kind":"currency"},"documents":{"kind":"json","optional":true,"shape":{"fields":{"name":{"kind":"text"},"sha256":{"kind":"text"},"url":{"kind":"text"}},"kind":"object","many":true}},"due_on":{"kind":"date","optional":true},"erp_id":{"hidden":true,"kind":"text"},"ext_purchase_order":{"inverse":"transactions","kind":"ref","optional":true,"to":"ext_purchase_orders"},"issued_on":{"kind":"date","optional":true},"items":{"kind":"json","optional":true,"shape":{"fields":{"lot_number":{"kind":"text","optional":true},"net_amount":{"kind":"decimal","optional":true,"scale":8},"order_line_id":{"kind":"text"},"product_name":{"kind":"text"},"quantity":{"kind":"decimal","scale":3},"unit":{"kind":"text"},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"unit_price":{"kind":"decimal","optional":true,"scale":4}},"kind":"object","many":true}},"kind":{"kind":"enum","values":["invoice","delivery"]},"order":{"inverse":"transactions","kind":"ref","to":"orders"},"reference":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_updated_at":{"kind":"instant","optional":true},"status":{"default":"issued","kind":"enum","values":["issued","void"]},"total":{"currency":"currency","kind":"money","optional":true}},"record_label":"record.reference","search":{"text":["reference","kind"]},"unique":[{"fields":["source","erp_id"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('parties','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"address":{"kind":"text","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"kind":{"kind":"enum","values":["customer","supplier","both"]},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"}},"record_label":"record.name","search":{"text":["name","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('contacts','{"audit":true,"fields":{"email":{"format":"email","kind":"text","optional":true},"job_title":{"kind":"text","optional":true},"name":{"kind":"text"},"party":{"inverse":"contacts","kind":"ref","to":"parties"},"phone":{"format":"phone","kind":"text","optional":true}},"record_label":"record.name","search":{"text":["name","email","phone"]}}'::jsonb);

select bolt_history_register('credit_snapshots','{"audit":true,"fields":{"as_of":{"kind":"instant"},"credit_hold":{"default":false,"kind":"bool"},"credit_limit":{"currency":"currency","kind":"money","optional":true},"credit_used":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"party":{"kind":"ref","to":"parties"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.party.name","search":{"text":["party","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('products','{"audit":true,"check":{"unit_price_nonnegative":{"or":[{"unit_price":{"is_null":true}},{"unit_price":{"gte":"0"}}]}},"fields":{"active":{"default":true,"kind":"bool"},"brand":{"kind":"text","optional":true},"brand_en":{"kind":"text","optional":true},"commission_basis_unit":{"kind":"text","optional":true},"commission_factor":{"kind":"decimal","min":0,"optional":true,"scale":6},"currency":{"kind":"currency"},"external_code":{"kind":"text"},"name":{"kind":"text"},"producing_area":{"kind":"text","optional":true},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"},"spec":{"kind":"text","optional":true},"tax_rate":{"kind":"decimal","max":100,"min":0,"optional":true,"scale":2},"unit":{"kind":"text","optional":true},"unit_price":{"currency":"currency","kind":"money","optional":true,"scale":4}},"record_label":"record.name","search":{"text":["name","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('pricing_floors','{"audit":true,"check":{"floor_price_nonnegative":{"floor_price":{"gte":"0"}},"import_revision_ephemeral":{"import_revision":{"is_null":true}}},"computed":{"floor_net":{"expr":{"round":[{"when":[{"field":"tax_inclusive"},{"div":[{"field":"floor_price"},{"plus":[1,{"div":[{"field":"tax_rate"},100]}]}]},{"field":"floor_price"}]},8]},"kind":"decimal","scale":8}},"fields":{"currency":{"kind":"currency"},"effective_on":{"kind":"date"},"floor_price":{"currency":"currency","kind":"money","scale":4},"group_code":{"kind":"text"},"import_revision":{"hidden":true,"kind":"int","min":0,"optional":true},"minimum_quantity":{"default":0,"kind":"decimal","min":0,"scale":3},"product":{"kind":"ref","to":"products"},"tax_inclusive":{"kind":"bool"},"tax_rate":{"default":0,"kind":"decimal","max":100,"min":0,"scale":2},"unit":{"kind":"text"}},"record_label":"record.product.name + '' · '' + record.group_code + '' · '' + string(record.effective_on)","search":{"text":["product","group_code","unit"]},"unique":[{"fields":["product","group_code","currency","effective_on","minimum_quantity"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('stock_snapshots','{"audit":true,"fields":{"as_of":{"kind":"instant"},"currency":{"kind":"currency","optional":true},"erp_committed":{"kind":"decimal","optional":true,"scale":3},"external_code":{"kind":"text"},"lot_number":{"kind":"text","optional":true},"on_hand":{"kind":"decimal","scale":3},"orders_as_of":{"kind":"instant","optional":true},"product":{"kind":"ref","to":"products"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"unit":{"kind":"text","optional":true},"unit_cost":{"kind":"decimal","optional":true,"scale":8},"warehouse":{"kind":"ref","to":"warehouses"}},"record_label":"record.product.name + '' · '' + record.warehouse.name + (record.lot_number != null ? '' · '' + record.lot_number : '''')","search":{"text":["product","warehouse","lot_number","external_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"natural_key"}]}'::jsonb);

select bolt_history_register('source_lot_costs','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"fields":{"lot_number":{"kind":"text"},"product_code":{"kind":"text"},"received_on":{"kind":"date"},"received_qty":{"kind":"text"},"unit":{"kind":"text"},"unit_cost":{"kind":"text"}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

select bolt_history_register('source_receivables','{"audit":true,"fields":{"currency":{"kind":"currency"},"entries":{"kind":"json","shape":{"kind":"json","many":true,"shape":{"fields":{"business_on":{"kind":"date"},"contact_id":{"kind":"text"},"customer":{"kind":"text"},"customer_id":{"kind":"text"},"due_on":{"kind":"date","optional":true},"kind":{"kind":"enum","values":["invoice","receipt"]},"reference":{"kind":"text"},"remaining":{"kind":"text"},"settlements":{"fields":{"amount":{"kind":"text"},"on":{"kind":"date"}},"kind":"object","many":true}},"kind":"object"}}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

select bolt_history_register('source_stock_commitments','{"audit":true,"fields":{"entries":{"kind":"json","shape":{"fields":{"product_code":{"kind":"text"},"quantity":{"kind":"text"},"unit":{"kind":"text","optional":true},"warehouse":{"kind":"text","optional":true}},"kind":"object","many":true}},"observed_at":{"kind":"instant"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}}},"record_label":"record.source.name","unique":[{"fields":["source"],"import_key":true,"name":"one_per_source"}]}'::jsonb);

select bolt_history_register('warehouses','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"external_code":{"kind":"text"},"group_code":{"kind":"text","optional":true},"name":{"kind":"text"},"source":{"kind":"ref","to":"sys_integration","where":{"integration":{"eq":"kingdee"}}},"source_number":{"kind":"text","optional":true},"source_updated_at":{"kind":"instant"}},"record_label":"record.name","search":{"text":["name","external_code","group_code"]},"unique":[{"fields":["source","external_code"],"import_key":true,"name":"source_code"}]}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['activities','approval_request','commercial_settings','commission_rules','commission_statements','contacts','credit_snapshots','document_templates','ext_purchase_orders','order_files','order_lines','orders','parties','pricing_floors','products','source_lot_costs','source_payments','source_receivables','source_sales_lines','source_stock_commitments','stock_snapshots','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','transactions','warehouses']::text[]));
