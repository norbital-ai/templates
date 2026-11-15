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

create or replace function "bolt_record_label_holding_5929d345"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['instrument']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('instrument', to_jsonb("instrument")) AS j FROM (SELECT $1 AS "instrument") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_portfolio_settings_4d34641e"() returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb('Portfolio settings'::text) #>> '{}') AS value FROM (SELECT jsonb_build_object() AS j FROM (SELECT 1 AS unused) label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_report_0685ed0d"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb('Portfolio report · '::text) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['for_date']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_0) #>> '{}') AS value FROM (SELECT jsonb_build_object('for_date', to_jsonb("for_date"::text)) AS j FROM (SELECT $1 AS "for_date") label_inputs) label_row OFFSET 0) label_value$record_label$;

select bolt_history_register('approval_request','{"fields":{"action":{"kind":"enum","values":["create","update","delete"]},"approver_teams":{"kind":"json","shape":{"kind":"text","many":true}},"approver_users":{"kind":"json","shape":{"kind":"text","many":true}},"closed_at":{"kind":"instant","optional":true},"closed_by":{"kind":"text","optional":true},"collection_name":{"kind":"text"},"created_at":{"kind":"instant"},"record_id":{"kind":"text"},"revision":{"default":1,"kind":"int"},"status":{"kind":"enum","values":["ONGOING","CHANGES_REQUESTED","APPROVED","REJECTED","SUPERSEDED","WITHDRAWN"]},"step":{"kind":"int"},"step_names":{"kind":"json","shape":{"kind":"text","many":true}},"steps":{"kind":"int"},"superseder_teams":{"kind":"json","shape":{"kind":"text","many":true}}},"key":"uuid","search":{"text":["collection_name"]},"unique":[{"fields":["collection_name","record_id"],"name":"one_ongoing_request","where":{"status":{"eq":"ONGOING"}}}]}'::jsonb);

select bolt_history_register('sys_api_key','{"fields":{"created_at":{"default":{"var":"now"},"kind":"instant"},"created_by":{"kind":"ref","optional":true,"to":"sys_user"},"hash":{"kind":"text"},"last_used_at":{"kind":"instant","optional":true},"name":{"kind":"text"},"prefix":{"kind":"text"},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"key":"text","record_label":"record.name","unique":[{"fields":["prefix"],"name":"prefix"}]}'::jsonb);

select bolt_history_register('sys_conversation','{"fields":{"archived_at":{"kind":"instant","optional":true},"created_at":{"default":{"var":"now"},"kind":"instant"},"envoy":{"kind":"text","optional":true},"inputs":{"default":[],"kind":"json"},"integration":{"kind":"ref","on_delete":"cascade","optional":true,"to":"sys_integration"},"kind":{"kind":"text","optional":true},"lease_until":{"kind":"instant","optional":true},"model":{"default":"default","kind":"text"},"outputs":{"default":[],"kind":"json"},"owner":{"kind":"text","optional":true},"parent":{"kind":"text","optional":true},"participants":{"kind":"json","optional":true},"plan":{"kind":"json","optional":true},"read":{"default":{},"kind":"json"},"restart_at":{"kind":"text","optional":true},"restart_from":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"run":{"kind":"text","optional":true},"status":{"default":"idle","kind":"text"},"thread":{"kind":"text","optional":true},"title":{"kind":"text","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.title"}'::jsonb);

select bolt_history_register('sys_envoy','{"fields":{"active":{"default":true,"kind":"bool"},"audience":{"default":"private","kind":"enum","values":["private","public"]},"created_at":{"default":{"var":"now"},"kind":"instant"},"delegation":{"default":"disabled","kind":"enum","values":["enabled","disabled"]},"dm":{"default":"union","kind":"enum","values":["union","envoy"]},"group_messages":{"default":"mention_or_reply","kind":"enum","values":["disabled","mention_or_reply","all"]},"name":{"kind":"text"},"policies":{"default":[],"kind":"text","many":true},"revision":{"default":1,"kind":"int"},"task":{"default":"","format":"markdown","kind":"text"},"triage":{"default":false,"kind":"bool"},"triage_scope":{"default":"all","hidden":true,"kind":"enum","values":["dm","group","all"]}},"key":"uuid","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_file','{"fields":{"created_at":{"kind":"instant"},"created_by":{"kind":"text","optional":true},"field":{"kind":"text"},"key":{"kind":"text"},"mime":{"kind":"text"},"name":{"kind":"text"},"revision":{"default":1,"kind":"int"},"sha256":{"kind":"text"},"size":{"kind":"int"},"updated_at":{"kind":"instant","optional":true},"updated_by":{"kind":"text","optional":true}},"key":"text","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_integration','{"fields":{"active":{"default":true,"kind":"bool"},"configuration":{"default":{},"kind":"json"},"envoy":{"kind":"text","optional":true},"epoch":{"kind":"text","optional":true},"import_start":{"kind":"json","optional":true},"integration":{"kind":"text"},"name":{"kind":"text"},"owner":{"kind":"ref","optional":true,"to":"sys_user"},"revision":{"default":1,"kind":"int"},"status":{"kind":"json","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.name","unique":[{"fields":["owner","integration"],"name":"one_per_member","where":{"owner":{"is_null":false}}}]}'::jsonb);

select bolt_history_register('sys_invitation','{"check":{"addressed":{"or":[{"email":{"is_null":false}},{"phone":{"is_null":false}}]}},"fields":{"accepted_at":{"kind":"instant","optional":true},"email":{"kind":"text","optional":true},"expires_at":{"kind":"instant"},"external":{"default":false,"kind":"bool"},"invited_by":{"kind":"ref","optional":true,"to":"sys_user"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}]},{"on":["phone"]}],"key":"text","record_label":"record.email"}'::jsonb);

select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

select bolt_history_register('holding','{"audit":true,"check":{"loan_is_owed":{"or":[{"asset_class":{"ne":"loan"}},{"value_base":{"lte":"0"}}]}},"fields":{"asset_class":{"default":"equity","kind":"enum","values":["equity","structured","fund","bond","metal","cash","loan","other"]},"cost_value":{"kind":"decimal","optional":true,"scale":2},"currency":{"kind":"currency"},"detail":{"kind":"text","optional":true},"documents":{"accept":["application/pdf","image/png","image/jpeg","text/csv"],"kind":"file","many":true,"max":"32MiB","optional":true},"insights":{"fields":{"headline":{"kind":"text"},"source_name":{"kind":"text","optional":true},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"instrument":{"kind":"text"},"isin":{"kind":"text","optional":true},"live_change_pct":{"kind":"decimal","optional":true,"scale":2},"live_price":{"kind":"decimal","optional":true,"scale":4},"live_value_base":{"kind":"decimal","optional":true,"scale":2},"market_value":{"default":0,"kind":"decimal","scale":2},"movement":{"kind":"enum","optional":true,"values":["surge","active","normal","quiet"]},"pnl_history":{"fields":{"date":{"kind":"date"},"pnl":{"kind":"decimal","scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2}},"key":"date","kind":"object","many":true,"optional":true},"price_date":{"kind":"date","optional":true},"price_updated_at":{"kind":"instant","optional":true},"quantity":{"default":1,"kind":"decimal","scale":4},"research_at":{"kind":"instant","optional":true},"research_direction":{"kind":"text","optional":true},"research_summary":{"format":"markdown","kind":"text","optional":true},"risk_rating":{"kind":"int","max":5,"min":1,"optional":true},"sources":{"fields":{"label":{"kind":"text"},"url":{"kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"symbol":{"kind":"text","optional":true},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2},"value_base":{"kind":"decimal","scale":2},"volume_ratio":{"kind":"decimal","optional":true,"scale":2}},"record_label":"record.instrument","search":{"text":["instrument","symbol","detail","research_direction","research_summary"]}}'::jsonb);

select bolt_history_register('portfolio_settings','{"audit":true,"fields":{"base_currency":{"kind":"currency"},"benchmarks":{"fields":{"name":{"kind":"text","optional":true},"symbol":{"kind":"text"}},"key":"symbol","kind":"object","many":true,"optional":true},"recipients":{"fields":{"handle":{"kind":"text"},"name":{"kind":"text","optional":true}},"key":"handle","kind":"object","many":true,"optional":true},"report_via":{"kind":"ref","optional":true,"to":"sys_integration"}},"record_label":"''Portfolio settings''"}'::jsonb);

select bolt_history_register('report','{"audit":true,"fields":{"allocation":{"fields":{"label":{"kind":"text"},"value":{"kind":"decimal","scale":2},"weight":{"kind":"decimal","scale":2}},"key":"label","kind":"object","many":true,"optional":true},"base_currency":{"kind":"currency"},"cash":{"kind":"decimal","scale":2},"day_change":{"kind":"decimal","optional":true,"scale":2},"deliveries":{"kind":"ref","many":true,"optional":true,"to":"sys_message"},"for_date":{"kind":"date"},"fx_used":{"fields":{"pair":{"kind":"text"},"rate":{"kind":"decimal","scale":6}},"key":"pair","kind":"object","many":true,"optional":true},"headline":{"format":"markdown","kind":"text"},"invested":{"kind":"decimal","scale":2},"liabilities":{"kind":"decimal","scale":2},"market_view":{"format":"markdown","kind":"text","optional":true},"markets":{"fields":{"change_pct":{"kind":"decimal","optional":true,"scale":2},"instrument":{"kind":"text"},"level":{"kind":"decimal","scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"net_assets":{"kind":"decimal","scale":2},"positions":{"fields":{"analysis":{"format":"markdown","kind":"text"},"call":{"kind":"enum","values":["buy","sell","hold","watch"]},"change_pct":{"kind":"decimal","optional":true,"scale":2},"confidence":{"kind":"decimal","optional":true,"scale":2},"headline":{"kind":"text"},"instrument":{"kind":"text"},"pnl":{"kind":"decimal","optional":true,"scale":2},"pnl_pct":{"kind":"decimal","optional":true,"scale":2},"symbol":{"kind":"text","optional":true},"weight":{"kind":"decimal","optional":true,"scale":2}},"key":"instrument","kind":"object","many":true,"optional":true},"research_log":{"kind":"text","optional":true},"sources":{"fields":{"at":{"kind":"instant"},"publisher":{"kind":"text"},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"key":"url","kind":"object","many":true,"optional":true},"summary":{"format":"markdown","kind":"text"},"unrealised_pl":{"kind":"decimal","optional":true,"scale":2}},"record_label":"''Portfolio report · '' + string(record.for_date)","search":{"text":["headline","summary","market_view"]},"unique":[{"fields":["for_date"],"name":"one_per_day"}]}'::jsonb);

select bolt_history_register('report_subscription','{"audit":true,"fields":{"user":{"default":{"var":"actor.id"},"kind":"ref","to":"sys_user"}},"record_label":"record.user.name","unique":[{"fields":["user"],"name":"one_per_user"}]}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['approval_request','holding','portfolio_settings','report','report_subscription','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user']::text[]));
