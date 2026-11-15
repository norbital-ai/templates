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

create or replace function "bolt_record_label_customers_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_bookings_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_visits_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_customer_notices_c9b3c79d"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['subject']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('subject', to_jsonb("subject")) AS j FROM (SELECT $1 AS "subject") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_dispatch_settings_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_drive_times_f87133b7"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['leg']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('leg', to_jsonb("leg")) AS j FROM (SELECT $1 AS "leg") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_helpers_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_services_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_availability_requests_4fcde555"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['address']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('address', to_jsonb("address")) AS j FROM (SELECT $1 AS "address") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_booking_requests_bde560e1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('number', to_jsonb("number")) AS j FROM (SELECT $1 AS "number") label_inputs) label_row OFFSET 0) label_value$record_label$;

select bolt_history_register('approval_request','{"fields":{"action":{"kind":"enum","values":["create","update","delete"]},"approver_teams":{"kind":"json","shape":{"kind":"text","many":true}},"approver_users":{"kind":"json","shape":{"kind":"text","many":true}},"closed_at":{"kind":"instant","optional":true},"closed_by":{"kind":"text","optional":true},"collection_name":{"kind":"text"},"created_at":{"kind":"instant"},"record_id":{"kind":"text"},"revision":{"default":1,"kind":"int"},"status":{"kind":"enum","values":["ONGOING","CHANGES_REQUESTED","APPROVED","REJECTED","SUPERSEDED","WITHDRAWN"]},"step":{"kind":"int"},"step_names":{"kind":"json","shape":{"kind":"text","many":true}},"steps":{"kind":"int"},"superseder_teams":{"kind":"json","shape":{"kind":"text","many":true}}},"key":"uuid","search":{"text":["collection_name"]},"unique":[{"fields":["collection_name","record_id"],"name":"one_ongoing_request","where":{"status":{"eq":"ONGOING"}}}]}'::jsonb);

select bolt_history_register('sys_api_key','{"fields":{"created_at":{"default":{"var":"now"},"kind":"instant"},"created_by":{"kind":"ref","optional":true,"to":"sys_user"},"hash":{"kind":"text"},"last_used_at":{"kind":"instant","optional":true},"name":{"kind":"text"},"prefix":{"kind":"text"},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"key":"text","record_label":"record.name","unique":[{"fields":["prefix"],"name":"prefix"}]}'::jsonb);

select bolt_history_register('sys_conversation','{"fields":{"archived_at":{"kind":"instant","optional":true},"created_at":{"default":{"var":"now"},"kind":"instant"},"envoy":{"kind":"text","optional":true},"inputs":{"default":[],"kind":"json"},"integration":{"kind":"ref","on_delete":"cascade","optional":true,"to":"sys_integration"},"kind":{"kind":"text","optional":true},"lease_until":{"kind":"instant","optional":true},"model":{"default":"default","kind":"text"},"outputs":{"default":[],"kind":"json"},"owner":{"kind":"text","optional":true},"parent":{"kind":"text","optional":true},"participants":{"kind":"json","optional":true},"plan":{"kind":"json","optional":true},"read":{"default":{},"kind":"json"},"restart_at":{"kind":"text","optional":true},"restart_from":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"run":{"kind":"text","optional":true},"status":{"default":"idle","kind":"text"},"thread":{"kind":"text","optional":true},"title":{"kind":"text","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.title"}'::jsonb);

select bolt_history_register('sys_envoy','{"fields":{"active":{"default":true,"kind":"bool"},"audience":{"default":"private","kind":"enum","values":["private","public"]},"created_at":{"default":{"var":"now"},"kind":"instant"},"delegation":{"default":"disabled","kind":"enum","values":["enabled","disabled"]},"dm":{"default":"union","kind":"enum","values":["union","envoy"]},"group_messages":{"default":"mention_or_reply","kind":"enum","values":["disabled","mention_or_reply","all"]},"name":{"kind":"text"},"policies":{"default":[],"kind":"text","many":true},"revision":{"default":1,"kind":"int"},"task":{"default":"","format":"markdown","kind":"text"},"triage":{"default":false,"kind":"bool"},"triage_scope":{"default":"all","hidden":true,"kind":"enum","values":["dm","group","all"]}},"key":"uuid","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_file','{"fields":{"created_at":{"kind":"instant"},"created_by":{"kind":"text","optional":true},"field":{"kind":"text"},"key":{"kind":"text"},"mime":{"kind":"text"},"name":{"kind":"text"},"revision":{"default":1,"kind":"int"},"sha256":{"kind":"text"},"size":{"kind":"int"},"updated_at":{"kind":"instant","optional":true},"updated_by":{"kind":"text","optional":true}},"key":"text","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_integration','{"fields":{"active":{"default":true,"kind":"bool"},"configuration":{"default":{},"kind":"json"},"envoy":{"kind":"text","optional":true},"epoch":{"kind":"text","optional":true},"import_start":{"kind":"json","optional":true},"integration":{"kind":"text"},"name":{"kind":"text"},"owner":{"kind":"ref","optional":true,"to":"sys_user"},"revision":{"default":1,"kind":"int"},"status":{"kind":"json","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.name","unique":[{"fields":["owner","integration"],"name":"one_per_member","where":{"owner":{"is_null":false}}}]}'::jsonb);

select bolt_history_register('sys_invitation','{"check":{"addressed":{"or":[{"email":{"is_null":false}},{"phone":{"is_null":false}}]}},"fields":{"accepted_at":{"kind":"instant","optional":true},"email":{"kind":"text","optional":true},"expires_at":{"kind":"instant"},"external":{"default":false,"kind":"bool"},"invited_by":{"kind":"ref","optional":true,"to":"sys_user"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}]},{"on":["phone"]}],"key":"text","record_label":"record.email"}'::jsonb);

select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

select bolt_history_register('customers','{"audit":true,"fields":{"address":{"kind":"text"},"area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"email":{"format":"email","kind":"text","optional":true},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"phone":{"format":"phone","kind":"text"}},"record_label":"record.name","search":{"text":["name","phone","email","address"]},"unique":[{"fields":["phone"],"name":"phone"}]}'::jsonb);

select bolt_history_register('bookings','{"audit":true,"fields":{"address":{"kind":"text"},"area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"customer":{"inverse":"bookings","kind":"ref","to":"customers"},"location":{"kind":"point","optional":true},"notes":{"kind":"text","optional":true},"number":{"kind":"seq","pattern":"BK-{yyyy}-{0000}"},"preference":{"kind":"enum","values":["any","preferred"]},"repeat":{"kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"inverse":"bookings","kind":"ref","to":"services"},"status":{"initial":"active","kind":"state","states":{"active":{"to":["cancelled"]},"cancelled":{}}},"visit_count":{"kind":"count","of":"visits"}},"indexes":[{"on":["status"]}],"locks":{"cancelled":{"where":{"status":{"eq":"cancelled"}}}},"record_label":"record.number","search":{"text":["number","customer","service"]}}'::jsonb);

select bolt_history_register('booking_helpers','{"audit":true,"fields":{"booking":{"inverse":"preferred_helpers","kind":"ref","owned":true,"to":"bookings"},"helper":{"inverse":"preferred_by","kind":"ref","to":"helpers"},"rank":{"kind":"int","max":5,"min":1}},"record_label":"record.booking.number + '' · '' + record.helper.name","unique":[{"fields":["booking","helper"],"name":"one_rank_per_helper"}]}'::jsonb);

select bolt_history_register('visits','{"audit":true,"fields":{"address":{"kind":"text"},"area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"attention":{"default":"none","kind":"enum","values":["none","unassigned","eta_risk","helper_left","awaiting_approval"]},"booking":{"inverse":"visits","kind":"ref","owned":true,"to":"bookings"},"completed_at":{"kind":"instant","optional":true},"completion_notes":{"kind":"text","max":2000,"optional":true},"eta_checked_at":{"kind":"instant","optional":true},"eta_minutes":{"kind":"int","optional":true},"helper":{"inverse":"visits","kind":"ref","on_delete":"set_null","optional":true,"to":"helpers"},"late_cancellation":{"default":false,"kind":"bool"},"location":{"kind":"point","optional":true},"mc":{"default":false,"kind":"bool"},"number":{"kind":"seq","pattern":"V-{yyyy}-{00000}"},"proposed_helper":{"kind":"ref","on_delete":"set_null","optional":true,"to":"helpers"},"proposed_slot":{"kind":"period","of":"instant","optional":true},"shift_asked_at":{"kind":"instant","optional":true},"shift_check":{"default":"not_due","kind":"enum","values":["not_due","asked","confirmed","no_response","declined"]},"skill":{"kind":"enum","values":["home_cleaning","deep_cleaning","move_in_out","post_renovation","office_cleaning","laundry_ironing","handyman"]},"slot":{"kind":"period","of":"instant"},"started_at":{"kind":"instant","optional":true},"status":{"initial":"scheduled","kind":"state","states":{"cancelled":{},"done":{},"in_progress":{"to":["done"]},"scheduled":{"to":["in_progress","cancelled"]}}},"unavailable_helper":{"kind":"ref","on_delete":"set_null","optional":true,"to":"helpers"}},"indexes":[{"on":["attention","shift_check"]}],"locks":{"finished":{"where":{"status":{"in":["done","cancelled"]}}},"under_way":{"except":["status","completion_notes","completed_at","attention"],"where":{"status":{"eq":"in_progress"}}}},"no_overlap":[{"key":["helper"],"name":"one_visit_at_a_time","period":"slot","where":{"helper":{"is_null":false},"status":{"ne":"cancelled"}}}],"record_label":"record.number","search":{"text":["number","address","helper","booking"]}}'::jsonb);

select bolt_history_register('customer_notices','{"audit":true,"fields":{"auto_replied_at":{"kind":"instant","optional":true},"body":{"kind":"text"},"customer":{"inverse":"notices","kind":"ref","to":"customers"},"delivered_at":{"kind":"instant","optional":true},"delivery":{"kind":"enum","optional":true,"values":["queued","sent","deferred","delivered","opened","replied","bounced","failed"]},"delivery_presumed":{"kind":"bool","optional":true},"delivery_reason":{"kind":"text","optional":true},"opened_at":{"kind":"instant","optional":true},"replied_at":{"kind":"instant","optional":true},"reply_excerpt":{"kind":"text","optional":true},"sent_at":{"kind":"instant","optional":true},"subject":{"kind":"text"},"to_address":{"kind":"text","optional":true},"visit":{"kind":"ref","on_delete":"set_null","optional":true,"to":"visits"},"whatsapp":{"kind":"text","optional":true}},"record_label":"record.subject","search":{"text":["subject","visit"]}}'::jsonb);

select bolt_history_register('helper_warnings','{"audit":true,"fields":{"helper":{"inverse":"warnings","kind":"ref","to":"helpers"},"issued_at":{"kind":"instant"},"letter":{"accept":["application/pdf"],"kind":"file","max":"2MiB","optional":true},"notes":{"kind":"text","optional":true},"reason":{"kind":"enum","values":["no_response","declined_without_mc"]},"visit":{"kind":"ref","on_delete":"set_null","optional":true,"to":"visits"}},"indexes":[{"on":["issued_at"]}],"record_label":"record.helper.name + '' · '' + string(record.issued_at)","search":{"text":["helper","visit","reason"]}}'::jsonb);

select bolt_history_register('dispatch_settings','{"audit":true,"check":{"reply_inside_lead":{"shift_reply_minutes":{"lt":{"field":"shift_check_lead_minutes"}}}},"fields":{"eta_check_lead_minutes":{"default":60,"kind":"int","max":240,"min":15},"eta_limit_minutes":{"default":30,"kind":"int","max":240,"min":5},"free_change_hours":{"default":24,"kind":"int","max":168,"min":0},"name":{"default":"Dispatch","kind":"text"},"shift_check_lead_minutes":{"default":120,"kind":"int","max":720,"min":30},"shift_reply_minutes":{"default":60,"kind":"int","max":240,"min":10}},"record_label":"record.name","unique":[{"fields":["name"],"name":"name"}]}'::jsonb);

select bolt_history_register('drive_times','{"audit":true,"fields":{"leg":{"hidden":true,"kind":"text"},"minutes":{"kind":"int","min":0}},"record_label":"record.leg","unique":[{"fields":["leg"],"name":"leg"}]}'::jsonb);

select bolt_history_register('helpers','{"audit":true,"check":{"hours":{"day_end":{"gt":{"field":"day_start"}}}},"fields":{"day_end":{"kind":"time"},"day_start":{"kind":"time"},"home_area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"home_location":{"kind":"point","optional":true},"last_location":{"kind":"point","optional":true},"last_location_at":{"kind":"instant","optional":true},"left_on":{"kind":"date","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text"},"skills":{"kind":"enum","many":true,"values":["home_cleaning","deep_cleaning","move_in_out","post_renovation","office_cleaning","laundry_ironing","handyman"]},"status":{"initial":"active","kind":"state","states":{"active":{"to":["left"]},"left":{"to":["active"]}}},"user":{"kind":"ref","on_delete":"set_null","optional":true,"to":"sys_user"},"warning_count":{"kind":"count","of":"warnings"},"work_days":{"kind":"enum","many":true,"values":["sun","mon","tue","wed","thu","fri","sat"]}},"record_label":"record.name","search":{"text":["name"]},"unique":[{"fields":["user"],"name":"one_user"}]}'::jsonb);

select bolt_history_register('helper_time_off','{"audit":true,"fields":{"helper":{"inverse":"time_off","kind":"ref","owned":true,"to":"helpers"},"period":{"kind":"period","of":"date"},"reason":{"kind":"enum","values":["leave","medical","other"]}},"no_overlap":[{"key":["helper"],"name":"one_absence","period":"period"}],"record_label":"record.helper.name + '' · '' + string(record.period.from)"}'::jsonb);

select bolt_history_register('services','{"audit":true,"fields":{"active":{"default":true,"kind":"bool"},"description":{"kind":"text","optional":true},"duration_minutes":{"kind":"int","max":720,"min":30},"name":{"kind":"text"},"price":{"currency":"SGD","kind":"money"},"skill":{"kind":"enum","values":["home_cleaning","deep_cleaning","move_in_out","post_renovation","office_cleaning","laundry_ironing","handyman"]}},"record_label":"record.name","search":{"text":["name"]},"unique":[{"fields":["name"],"name":"name"}]}'::jsonb);

select bolt_history_register('availability_requests','{"audit":true,"fields":{"address":{"kind":"text","max":500},"area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"checked_at":{"kind":"instant","optional":true},"estimated":{"default":true,"kind":"bool"},"helper":{"kind":"ref","optional":true,"to":"helpers"},"location":{"kind":"point","optional":true},"phone":{"format":"phone","kind":"text"},"preference":{"default":"any","kind":"enum","values":["any","preferred"]},"problem":{"kind":"text","optional":true},"repeat":{"default":"once","kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"kind":"ref","to":"services"},"starts":{"default":[],"hidden":true,"kind":"text","many":true},"status":{"initial":"pending","kind":"state","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}},"locks":{"settled":{"where":{"status":{"in":["ready","failed"]}}}},"record_label":"record.address"}'::jsonb);

select bolt_history_register('booking_requests','{"audit":true,"fields":{"address":{"kind":"text","max":500},"area":{"kind":"enum","optional":true,"values":["central","north","north_east","east","west"]},"availability":{"kind":"ref","optional":true,"to":"availability_requests"},"booking":{"kind":"ref","on_delete":"set_null","optional":true,"to":"bookings"},"email":{"format":"email","kind":"text","optional":true},"name":{"kind":"text","max":200},"notes":{"kind":"text","max":2000,"optional":true},"number":{"kind":"seq","pattern":"RQ-{yyyy}-{0000}"},"outcome":{"kind":"text","optional":true},"phone":{"format":"phone","kind":"text"},"repeat":{"default":"once","kind":"enum","values":["once","weekly","fortnightly","monthly"]},"service":{"kind":"ref","to":"services","where":{"active":{"eq":true}}},"start":{"kind":"instant"},"status":{"initial":"received","kind":"state","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}},"indexes":[{"on":["status"]}],"locks":{"settled":{"where":{"status":{"in":["booked","closed"]}}}},"record_label":"record.number","search":{"text":["phone","address"]}}'::jsonb);

select bolt_history_register('openings','{"audit":true,"fields":{"day":{"kind":"date"},"service":{"inverse":"openings","kind":"ref","owned":true,"to":"services"},"starts":{"hidden":true,"kind":"text","many":true}},"record_label":"record.service.name + '' · '' + string(record.day)","unique":[{"fields":["service","day"],"name":"one_per_day"}]}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['approval_request','availability_requests','booking_helpers','booking_requests','bookings','customer_notices','customers','dispatch_settings','drive_times','helper_time_off','helper_warnings','helpers','openings','services','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','visits']::text[]));
