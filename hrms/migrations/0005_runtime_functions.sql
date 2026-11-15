-- 0005_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

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

create or replace function "bolt_record_label_employee_profile_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_dependant_b5b83002"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['name']) IS NOT NULL)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['relation']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name"), 'relation', to_jsonb("relation")) AS j FROM (SELECT $1 AS "name", $2 AS "relation") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_ledger_entry_b5edd145"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['effective_on']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code"), 'effective_on', to_jsonb("effective_on"::text)) AS j FROM (SELECT $1 AS "code", $2 AS "effective_on") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_contract_terms_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_statutory_parameters_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_entity_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_entity_change_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_holiday_926befc4"(date, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['date']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name"), 'date', to_jsonb("date"::text)) AS j FROM (SELECT $1 AS "date", $2 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_pay_group_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_shift_pattern_1d6aa255"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code")) AS j FROM (SELECT $1 AS "code") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_shift_definition_1d6aa255"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code")) AS j FROM (SELECT $1 AS "code") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_leave_catalog_entry_da_09c3ceee"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['incurred_on']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('incurred_on', to_jsonb("incurred_on"::text)) AS j FROM (SELECT $1 AS "incurred_on") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_workplace_case_catalog_a812210f"(text, date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['kind']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['opened_on']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('kind', to_jsonb("kind"), 'opened_on', to_jsonb("opened_on"::text)) AS j FROM (SELECT $1 AS "kind", $2 AS "opened_on") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_jurisdiction_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_jurisdiction_change_58d6e27a"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['effective_from']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('effective_from', to_jsonb("effective_from"::text)) AS j FROM (SELECT $1 AS "effective_from") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_obligation_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_payroll_run_8635e840"(text, int) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_2.left_value) = 'string' AND jsonb_typeof(label_2.right_value) = 'string' THEN to_jsonb((label_2.left_value #>> '{}') || (label_2.right_value #>> '{}')) WHEN jsonb_typeof(label_2.left_value) = 'array' AND jsonb_typeof(label_2.right_value) = 'array' THEN label_2.left_value || label_2.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_2.left_value) = 'number' THEN (label_2.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_2.right_value) = 'number' THEN (label_2.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT to_jsonb('Run '::text) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['run_number']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_0) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_1) AS left_value, coalesce((label_row.j #> ARRAY['period']), 'null'::jsonb) AS right_value OFFSET 0) label_2) #>> '{}') AS value FROM (SELECT jsonb_build_object('run_number', to_jsonb("run_number"), 'period', to_jsonb("period")) AS j FROM (SELECT $1 AS "period", $2 AS "run_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_statutory_finding_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_statutory_source_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_work_event_b392372b"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['description']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('description', to_jsonb("description")) AS j FROM (SELECT $1 AS "description") label_inputs) label_row OFFSET 0) label_value$record_label$;

select bolt_history_register('approval_request','{"fields":{"action":{"kind":"enum","values":["create","update","delete"]},"approver_teams":{"kind":"json","shape":{"kind":"text","many":true}},"approver_users":{"kind":"json","shape":{"kind":"text","many":true}},"closed_at":{"kind":"instant","optional":true},"closed_by":{"kind":"text","optional":true},"collection_name":{"kind":"text"},"created_at":{"kind":"instant"},"record_id":{"kind":"text"},"revision":{"default":1,"kind":"int"},"status":{"kind":"enum","values":["ONGOING","CHANGES_REQUESTED","APPROVED","REJECTED","SUPERSEDED","WITHDRAWN"]},"step":{"kind":"int"},"step_names":{"kind":"json","shape":{"kind":"text","many":true}},"steps":{"kind":"int"},"superseder_teams":{"kind":"json","shape":{"kind":"text","many":true}}},"key":"uuid","search":{"text":["collection_name"]},"unique":[{"fields":["collection_name","record_id"],"name":"one_ongoing_request","where":{"status":{"eq":"ONGOING"}}}]}'::jsonb);

select bolt_history_register('sys_api_key','{"fields":{"created_at":{"default":{"var":"now"},"kind":"instant"},"created_by":{"kind":"ref","optional":true,"to":"sys_user"},"hash":{"kind":"text"},"last_used_at":{"kind":"instant","optional":true},"name":{"kind":"text"},"prefix":{"kind":"text"},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"key":"text","record_label":"record.name","unique":[{"fields":["prefix"],"name":"prefix"}]}'::jsonb);

select bolt_history_register('sys_conversation','{"fields":{"archived_at":{"kind":"instant","optional":true},"created_at":{"default":{"var":"now"},"kind":"instant"},"envoy":{"kind":"text","optional":true},"inputs":{"default":[],"kind":"json"},"integration":{"kind":"ref","on_delete":"cascade","optional":true,"to":"sys_integration"},"kind":{"kind":"text","optional":true},"lease_until":{"kind":"instant","optional":true},"model":{"default":"default","kind":"text"},"outputs":{"default":[],"kind":"json"},"owner":{"kind":"text","optional":true},"parent":{"kind":"text","optional":true},"participants":{"kind":"json","optional":true},"plan":{"kind":"json","optional":true},"read":{"default":{},"kind":"json"},"restart_at":{"kind":"text","optional":true},"restart_from":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"run":{"kind":"text","optional":true},"status":{"default":"idle","kind":"text"},"thread":{"kind":"text","optional":true},"title":{"kind":"text","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.title"}'::jsonb);

select bolt_history_register('sys_envoy','{"fields":{"active":{"default":true,"kind":"bool"},"audience":{"default":"private","kind":"enum","values":["private","public"]},"created_at":{"default":{"var":"now"},"kind":"instant"},"delegation":{"default":"disabled","kind":"enum","values":["enabled","disabled"]},"dm":{"default":"union","kind":"enum","values":["union","envoy"]},"group_messages":{"default":"mention_or_reply","kind":"enum","values":["disabled","mention_or_reply","all"]},"name":{"kind":"text"},"policies":{"default":[],"kind":"text","many":true},"revision":{"default":1,"kind":"int"},"task":{"default":"","format":"markdown","kind":"text"},"triage":{"default":false,"kind":"bool"},"triage_scope":{"default":"all","hidden":true,"kind":"enum","values":["dm","group","all"]}},"key":"uuid","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_file','{"fields":{"created_at":{"kind":"instant"},"created_by":{"kind":"text","optional":true},"field":{"kind":"text"},"key":{"kind":"text"},"mime":{"kind":"text"},"name":{"kind":"text"},"revision":{"default":1,"kind":"int"},"sha256":{"kind":"text"},"size":{"kind":"int"},"updated_at":{"kind":"instant","optional":true},"updated_by":{"kind":"text","optional":true}},"key":"text","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_integration','{"fields":{"active":{"default":true,"kind":"bool"},"configuration":{"default":{},"kind":"json"},"envoy":{"kind":"text","optional":true},"epoch":{"kind":"text","optional":true},"import_start":{"kind":"json","optional":true},"integration":{"kind":"text"},"name":{"kind":"text"},"owner":{"kind":"ref","optional":true,"to":"sys_user"},"revision":{"default":1,"kind":"int"},"status":{"kind":"json","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.name","unique":[{"fields":["owner","integration"],"name":"one_per_member","where":{"owner":{"is_null":false}}}]}'::jsonb);

select bolt_history_register('sys_invitation','{"check":{"addressed":{"or":[{"email":{"is_null":false}},{"phone":{"is_null":false}}]}},"fields":{"accepted_at":{"kind":"instant","optional":true},"email":{"kind":"text","optional":true},"expires_at":{"kind":"instant"},"external":{"default":false,"kind":"bool"},"invited_by":{"kind":"ref","optional":true,"to":"sys_user"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}]},{"on":["phone"]}],"key":"text","record_label":"record.email"}'::jsonb);

select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"bank":{"kind":"custom","of":"bank","optional":true},"birth_city":{"kind":"text","optional":true},"cumulative_service":{"default":false,"kind":"bool"},"date_of_birth":{"kind":"date","optional":true},"documents":{"accept":["application/pdf","image/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"invitation_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"number":{"kind":"seq","pattern":"HR-{0000}"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","optional":true},"user_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"sys_user"}},"record_label":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"],"name":"invitation_id"},{"fields":["user_id"],"name":"user_id"}]}'::jsonb);

select bolt_history_register('dependant','{"audit":true,"fields":{"allocations":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"number","min":0}}},"born_on":{"kind":"date","optional":true},"disabled":{"kind":"bool","optional":true},"employee_id":{"inverse":"dependants","kind":"ref","on_delete":"cascade","to":"employee_profile"},"expected_on":{"kind":"date","optional":true},"has_income":{"kind":"bool","optional":true},"name":{"kind":"text","optional":true},"relation":{"kind":"enum","values":["CHILD","SPOUSE","PARENT"]},"studying":{"kind":"bool","optional":true}},"record_label":"has(record.name) ? record.name : string(record.relation)"}'::jsonb);

select bolt_history_register('employee_balance','{"audit":true,"fields":{"account":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"record","of":{"kind":"json"}}}},"employee_id":{"kind":"ref","to":"employee_profile"}},"record_label":"has(record.employee_id.name) ? record.employee_id.name : ''Balance''","unique":[{"fields":["employee_id"],"name":"one_balance"}]}'::jsonb);

select bolt_history_register('ledger_entry','{"audit":true,"check":{"names_its_movement":{"amount":{"is_null":false},"measure":{"is_null":false},"period":{"is_null":false},"source":{"is_null":false}}},"fields":{"account":{"kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"kind":"text"},"effective_on":{"kind":"date"},"measure":{"kind":"enum","optional":true,"values":["total","used","entitled","carried","limit","paid"]},"note":{"kind":"text","optional":true},"operation":{"kind":"enum","values":["ADD","DEDUCT"]},"period":{"kind":"text","optional":true},"source":{"kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.code + '' · '' + string(record.effective_on)"}'::jsonb);

select bolt_history_register('employment','{"audit":true,"fields":{"effective_range":{"kind":"period","of":"date"},"employee_id":{"inverse":"employment","kind":"ref","to":"employee_profile"},"employee_number":{"kind":"text"},"encash_leave":{"default":true,"kind":"bool"},"entity_id":{"inverse":"employment","kind":"ref","to":"entity"},"events":{"fields":{"allocated_days":{"kind":"int","optional":true},"ended_on":{"kind":"date","optional":true},"kind":{"kind":"text"},"on":{"kind":"date"},"opened_on":{"kind":"date","optional":true}},"kind":"object","many":true,"optional":true},"exit_ground":{"kind":"enum","optional":true,"values":["RETRENCHMENT","RETIREMENT","RESIGNATION","DISMISSAL","MISCONDUCT_DISMISSAL","END_OF_CONTRACT","MUTUAL","DEATH","UNILATERAL","BREACH_BY_EMPLOYER"]},"final_pay_due_on":{"kind":"date","optional":true},"reason":{"kind":"text","optional":true},"service_started_on":{"kind":"date","optional":true}},"no_overlap":[{"key":["employee_id"],"name":"stints","period":"effective_range"}],"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + record.employee_number + '' · '' + string(record.effective_range.from)","search":{"text":["employee_number","employee_id"]}}'::jsonb);

select bolt_history_register('contract_terms','{"audit":true,"fields":{"allowances":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"fields":{"amount":{"kind":"number","min":0}},"kind":"object"}}},"annual_leave_carry_limit_days":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"clears":{"kind":"text","many":true,"optional":true},"department":{"kind":"text","optional":true},"effective_from":{"kind":"date"},"employee_borne_tax_items":{"kind":"text","many":true,"optional":true},"employer_bears_income_tax":{"kind":"bool","optional":true},"employment_id":{"inverse":"terms","kind":"ref","on_delete":"cascade","to":"employment"},"engagement":{"kind":"enum","optional":true,"values":["EMPLOYEE","PART_TIME","CONTRACTOR","INTERN","APPRENTICE","CONSULTANT","PAYEE"]},"job_title":{"kind":"text","optional":true},"normal_days_per_week":{"kind":"json","optional":true,"shape":{"kind":"number","max":7,"min":0}},"normal_hours_per_day":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"normal_hours_per_week":{"kind":"json","optional":true,"shape":{"kind":"number","min":0}},"notice_period":{"fields":{"unit":{"kind":"enum","values":["DAYS","WEEKS","MONTHS"]},"value":{"kind":"number","min":0}},"kind":"object","optional":true},"pay_group_id":{"inverse":"contract_terms","kind":"ref","on_delete":"restrict","optional":true,"to":"pay_group"},"probation_period":{"kind":"period","of":"date","optional":true},"rate":{"kind":"json","optional":true,"shape":{"arms":{"DAILY":{"amount":{"kind":"number","min":0}},"HOURLY":{"amount":{"kind":"number","min":0}},"MONTHLY":{"amount":{"kind":"number","min":0}}},"by":"unit","kind":"union"}},"shift_pattern_id":{"kind":"ref","optional":true,"to":"shift_pattern"},"signed_contract_period":{"kind":"period","of":"date","optional":true},"signed_on":{"kind":"date","optional":true},"statutory_work_category":{"kind":"text","optional":true},"wage_payment_method":{"kind":"enum","optional":true,"values":["BANK","CASH","CHEQUE","DIGITAL"]},"work_classification":{"kind":"text","optional":true},"work_region":{"kind":"text","optional":true},"worksite":{"kind":"text","optional":true}},"record_label":"record.effective_from","unique":[{"fields":["employment_id","effective_from"],"name":"one_change"}]}'::jsonb);

select bolt_history_register('statutory_parameters','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"employment_id":{"inverse":"parameters","kind":"ref","on_delete":"cascade","to":"employment"},"parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["employment_id","effective_from"],"name":"one_change"}]}'::jsonb);

select bolt_history_register('entity','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"code":{"kind":"text","optional":true},"name":{"kind":"text"},"registered_address":{"kind":"text","optional":true},"representative_name":{"kind":"text","optional":true},"settings_code":{"kind":"text"},"source_reference":{"kind":"text","optional":true},"time_zone":{"kind":"text","optional":true}},"record_label":"record.name","search":{"text":["code","name"]},"unique":[{"fields":["code"],"name":"code"}]}'::jsonb);

select bolt_history_register('entity_change','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"entity_id":{"inverse":"changes","kind":"ref","on_delete":"cascade","to":"entity"},"final_pay_loan_floor_percent":{"kind":"int","max":100,"min":0,"optional":true},"overtime_full_award_percent":{"kind":"int","max":100,"min":1,"optional":true},"pay_methods":{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true},"statutory_parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["entity_id","effective_from"],"name":"one_change"}]}'::jsonb);

select bolt_history_register('holiday','{"audit":true,"fields":{"date":{"kind":"date"},"employee_id":{"inverse":"holiday","kind":"ref","optional":true,"to":"employee_profile"},"entity_id":{"inverse":"holiday","kind":"ref","to":"entity"},"given_to":{"default":"EVERYONE","kind":"enum","values":["EVERYONE","ONLY_IF_OFF_ON_REPLACED_DATE"]},"kind":{"default":"PUBLIC_HOLIDAY","kind":"enum","values":["PUBLIC_HOLIDAY","SPECIAL_HOLIDAY","SUBSTITUTE","DOUBLE_HOLIDAY","DOUBLE_SPECIAL","MAKEUP_WORKDAY"]},"name":{"kind":"text"},"published_at":{"hidden":true,"kind":"instant","optional":true},"replaces":{"kind":"date","optional":true}},"record_label":"record.name + '' · '' + string(record.date)"}'::jsonb);

select bolt_history_register('pay_group','{"audit":true,"fields":{"entity_id":{"inverse":"pay_groups","kind":"ref","to":"entity"},"name":{"kind":"text"},"payment_schedule":{"default":{"business_day":"PREVIOUS","frequency":"MONTHLY","non_working_weekdays":[0,6],"pay_cutoff_day":1,"pay_days":[25],"short_month":"LAST_DAY"},"kind":"json","shape":{"arms":{"BIWEEKLY":{"anchor_date":{"kind":"date"},"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]},"weekday":{"kind":"int","max":6,"min":0}},"DAILY":{"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]}},"INTEGER_MONTHS":{"anchor_date":{"kind":"date"},"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"month_interval":{"kind":"int","max":12,"min":1},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"pay_cutoff_day":{"default":1,"kind":"int","max":28,"min":1},"pay_days":{"kind":"int","many":true,"max":31,"min":1,"min_items":1},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]}},"MONTHLY":{"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"pay_cutoff_day":{"default":1,"kind":"int","max":28,"min":1},"pay_days":{"kind":"int","many":true,"max":31,"min":1,"min_items":1},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]}},"SEMI_MONTHLY":{"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"pay_cutoff_day":{"default":1,"kind":"int","max":28,"min":1},"pay_days":{"kind":"int","many":true,"max":31,"min":1,"min_items":1},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]}},"TEN_DAY":{"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"pay_cutoff_day":{"default":1,"kind":"int","max":28,"min":1},"pay_days":{"kind":"int","many":true,"max":31,"min":1,"min_items":1},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]}},"WEEKLY":{"anchor_date":{"kind":"date"},"business_day":{"kind":"enum","values":["NONE","PREVIOUS","NEXT"]},"non_working_weekdays":{"kind":"int","many":true,"max":6,"min":0},"short_month":{"kind":"enum","values":["LAST_DAY","REFUSE"]},"weekday":{"kind":"int","max":6,"min":0}}},"by":"frequency","kind":"union"}}},"record_label":"record.name","search":{"text":["name"]},"unique":[{"fields":["entity_id","name"],"name":"entity_name"}]}'::jsonb);

select bolt_history_register('shift_pattern','{"audit":true,"fields":{"code":{"kind":"text"},"effective_range":{"kind":"period","of":"date","optional":true},"entity_id":{"inverse":"shift_pattern","kind":"ref","to":"entity"},"name":{"kind":"text","optional":true},"pattern":{"fields":{"cycle":{"fields":{"shift_definition_id":{"kind":"ref","to":"shift_definition"}},"kind":"object","many":true,"optional":true},"days":{"fields":{"FRIDAY":{"kind":"ref","to":"shift_definition"},"MONDAY":{"kind":"ref","to":"shift_definition"},"SATURDAY":{"kind":"ref","to":"shift_definition"},"SUNDAY":{"kind":"ref","to":"shift_definition"},"THURSDAY":{"kind":"ref","to":"shift_definition"},"TUESDAY":{"kind":"ref","to":"shift_definition"},"WEDNESDAY":{"kind":"ref","to":"shift_definition"}},"kind":"object","optional":true},"week_start":{"default":"MONDAY","kind":"enum","values":["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]}},"kind":"object"}},"record_label":"record.code","unique":[{"fields":["entity_id","code"],"name":"entity_code"}]}'::jsonb);

select bolt_history_register('shift_definition','{"audit":true,"fields":{"code":{"kind":"text"},"effective_range":{"kind":"period","of":"date","optional":true},"entity_id":{"inverse":"shift_definition","kind":"ref","to":"entity"},"name":{"kind":"text","optional":true},"variant":{"fields":{"breaks":{"fields":{"end_time":{"kind":"time"},"paid":{"kind":"bool"},"start_time":{"kind":"time"}},"kind":"object","many":true},"day_type":{"kind":"enum","values":["WORK","REST","OFF","ABS"]},"end_time":{"kind":"time","optional":true},"ends_next_day":{"kind":"bool"},"start_time":{"kind":"time","optional":true},"untimed_hours":{"kind":"number","min":0,"optional":true}},"kind":"object"}},"record_label":"record.code","unique":[{"fields":["entity_id","code"],"name":"entity_code"}]}'::jsonb);

select bolt_history_register('adhoc_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text"},"employment_id":{"inverse":"adhoc_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"adhoc","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity)"}'::jsonb);

select bolt_history_register('claim_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"claim_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"incurred_on":{"kind":"date"},"payroll_run_id":{"inverse":"claim","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"unit":{"default":"MONEY","kind":"enum","values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code + '' · '' + string(record.quantity) + (record.unit == ''MONEY'' ? '''' : '' '' + record.unit)"}'::jsonb);

select bolt_history_register('leave_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"leave_catalog_entry","kind":"ref","to":"employment"},"encashment":{"default":false,"hidden":true,"kind":"bool"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"inverse":"leave","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

select bolt_history_register('leave_catalog_entry_day','{"audit":true,"fields":{"incurred_on":{"kind":"date"},"leave_entry_id":{"inverse":"leave_catalog_entry_day","kind":"ref","on_delete":"cascade","owned":true,"to":"leave_catalog_entry"},"part":{"kind":"enum","values":["AM","PM"]},"payroll_run_id":{"inverse":"leave_day","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"string(record.incurred_on)","unique":[{"fields":["leave_entry_id","incurred_on","part"],"name":"slot"}]}'::jsonb);

select bolt_history_register('loan_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"employment_id":{"inverse":"loan_catalog_entry","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"payroll_run_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"quantity":{"kind":"decimal","min":0,"scale":12},"recovered":{"hidden":true,"kind":"sum","of":"repayments.amount"},"repayment_period":{"kind":"period","of":"date"}},"record_label":"record.employment_id.employee_number + '' · '' + record.catalog_code"}'::jsonb);

select bolt_history_register('loan_catalog_entry_repayment','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"loan_catalog_entry_repayment","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"loan_id":{"inverse":"repayments","kind":"ref","on_delete":"cascade","to":"loan_catalog_entry"},"paid_on":{"kind":"date","optional":true},"payment_reference":{"kind":"text","optional":true},"payroll_run_id":{"inverse":"repayment","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"}},"record_label":"record.employment_id.employee_number + '' · '' + string(record.amount) + (record.paid_on != null ? '' · '' + string(record.paid_on) : '''')"}'::jsonb);

select bolt_history_register('workplace_case_catalog_entry','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"closed_on":{"kind":"date","optional":true},"description":{"kind":"text","optional":true},"employment_id":{"inverse":"workplace_case_catalog_entry","kind":"ref","on_delete":"restrict","to":"employment"},"entity_id":{"inverse":"workplace_case_catalog_entries","kind":"ref","to":"entity"},"evidence_file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"inputs":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"kind":{"kind":"text"},"location":{"kind":"text","optional":true},"occurred_on":{"kind":"date","optional":true},"opened_on":{"kind":"date"},"payroll_run_id":{"inverse":"case","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"reference":{"kind":"text","optional":true},"scheduled_on":{"kind":"date","optional":true},"severity":{"default":"N/A","kind":"enum","values":["DEATH","PERMANENT_TOTAL_DISABILITY","SERIOUS_INJURY","MINOR_INJURY","NEAR_MISS","PROPERTY_DAMAGE","N/A"]}},"locks":{"captured":{"where":{"payroll_run_id":{"is_null":false}}}},"record_label":"record.kind + '' · '' + string(record.opened_on)"}'::jsonb);

select bolt_history_register('jurisdiction','{"audit":true,"fields":{"code":{"kind":"text"},"currency":{"kind":"currency"},"name":{"kind":"text"},"tax_year_start_month":{"kind":"int","max":12,"min":1},"timezone":{"format":"zone","kind":"text"}},"record_label":"record.name","unique":[{"fields":["code"],"name":"code"}]}'::jsonb);

select bolt_history_register('jurisdiction_change','{"audit":true,"fields":{"effective_from":{"kind":"date"},"finding_id":{"inverse":"law_changes","kind":"ref","on_delete":"cascade","optional":true,"to":"statutory_finding"},"jurisdiction_code":{"kind":"text"},"law":{"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from"}'::jsonb);

select bolt_history_register('obligation','{"audit":true,"fields":{"due_on":{"kind":"date","optional":true},"employee_id":{"kind":"ref","optional":true,"to":"employee_profile"},"employment_id":{"kind":"ref","optional":true,"to":"employment"},"entity_id":{"inverse":"obligations","kind":"ref","to":"entity"},"evidence":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"fulfilled_on":{"kind":"date","optional":true},"occurrence_key":{"kind":"text"},"state":{"initial":"OPEN","kind":"state","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}},"title":{"kind":"text"},"waiver_reason":{"kind":"text","optional":true}},"locks":{"fulfilled_task":{"where":{"state":{"eq":"FULFILLED"}}},"waived_task":{"except":["waiver_reason","state"],"where":{"state":{"eq":"WAIVED"}}}},"record_label":"record.title","unique":[{"fields":["occurrence_key"],"import_key":true,"name":"one_occurrence"}]}'::jsonb);

select bolt_history_register('payroll_run','{"audit":true,"fields":{"entity_id":{"inverse":"payroll_runs","kind":"ref","to":"entity"},"kind":{"default":"ON_CYCLE","kind":"enum","values":["ON_CYCLE","OFF_CYCLE"]},"pay_date":{"kind":"date"},"pay_group_id":{"inverse":"payroll_runs","kind":"ref","on_delete":"restrict","to":"pay_group"},"period":{"kind":"text"},"run_number":{"kind":"seq"},"salary_coverage":{"kind":"period","of":"date"},"state":{"initial":"UNPAID","kind":"state","states":{"PAID":{"to":[]},"UNPAID":{"to":["PAID"]}}}},"locks":{"paid_run":{"where":{"state":{"eq":"PAID"}}}},"record_label":"''Run '' + string(record.run_number) + '' · '' + record.period","unique":[{"fields":["pay_group_id","period"],"name":"one_cycle_run","where":{"kind":{"eq":"ON_CYCLE"}}}]}'::jsonb);

select bolt_history_register('pay_amendment','{"audit":true,"fields":{"employee_id":{"inverse":"pay_amendments","kind":"ref","to":"employee_profile"},"pay_group_id":{"kind":"ref","on_delete":"restrict","to":"pay_group"},"payroll_run_id":{"inverse":"amendments","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"period":{"kind":"text"}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + record.period","unique":[{"fields":["employee_id","pay_group_id","period"],"name":"open_period","where":{"payroll_run_id":{"is_null":true}}}]}'::jsonb);

select bolt_history_register('payslip','{"audit":true,"fields":{"basic_earnings":{"kind":"decimal","optional":true,"scale":12},"breakdown":{"default":{},"kind":"json","shape":{"kind":"record","of":{"kind":"json"}}},"employee_id":{"inverse":"payslips","kind":"ref","to":"employee_profile"},"employee_statutory":{"default":0,"kind":"decimal","min":0,"scale":12},"employer_cost":{"default":0,"kind":"decimal","min":0,"scale":12},"employment_id":{"inverse":"payslips","kind":"ref","to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"gross_earnings":{"kind":"decimal","optional":true,"scale":12},"net_pay":{"kind":"decimal","scale":12},"ordinary_wages":{"default":0,"kind":"decimal","min":0,"scale":12},"payroll_run_id":{"inverse":"payslips","kind":"ref","on_delete":"cascade","to":"payroll_run"},"period":{"kind":"text","optional":true},"tax_withheld":{"default":0,"kind":"decimal","min":0,"scale":12},"total_deductions":{"kind":"decimal","min":0,"scale":12}},"record_label":"(has(record.employee_id.name) ? record.employee_id.name + '' · '' : '''') + (record.period != null ? record.period : '''')","unique":[{"fields":["payroll_run_id","employee_id","entity_id"],"name":"run_person"}]}'::jsonb);

select bolt_history_register('roster_entry','{"audit":true,"fields":{"actual_worked_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant","optional":true},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true,"was":"worked_intervals"},"consent":{"kind":"json","optional":true,"shape":{"fields":{"night_work":{"kind":"bool"},"overtime":{"kind":"bool"},"reference":{"kind":"text"}},"kind":"object"}},"employment_id":{"inverse":"roster_entry","kind":"ref","to":"employment"},"findings":{"default":[],"kind":"json"},"overtime_as_time_off":{"default":false,"kind":"bool"},"payroll_run_id":{"inverse":"roster_entry","kind":"ref","on_delete":"set_null","optional":true,"to":"payroll_run"},"planned_overtime_intervals":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object","many":true,"optional":true},"shift_definition_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"shift_definition"},"work_date":{"kind":"date"}},"record_label":"(has(record.employment_id.employee_number) ? record.employment_id.employee_number + '' · '' : '''') + string(record.work_date)","unique":[{"fields":["employment_id","work_date"],"import_key":true,"name":"one_day"}]}'::jsonb);

select bolt_history_register('statutory_finding','{"audit":true,"fields":{"announced_on":{"kind":"date","optional":true},"families":{"kind":"text","many":true},"fit":{"kind":"enum","values":["VALUE","ROW","STRUCTURAL"]},"instrument_key":{"kind":"text"},"jurisdiction_code":{"kind":"text"},"notes":{"kind":"text","optional":true},"research_run_id":{"kind":"text","optional":true},"source_quote":{"kind":"text","optional":true},"source_urls":{"kind":"text","many":true},"status":{"initial":"PROPOSED","kind":"state","states":{"CONFIRMED":{"to":["REJECTED"]},"PROPOSED":{"to":["CONFIRMED","REJECTED"]},"REJECTED":{"to":[]}}},"summary":{"kind":"text","optional":true},"title":{"kind":"text"},"verified_by":{"kind":"ref","on_delete":"restrict","optional":true,"to":"sys_user"},"verified_on":{"kind":"date","optional":true}},"locks":{"confirmed_finding":{"except":["status","notes"],"where":{"status":{"eq":"CONFIRMED"}}},"decided_finding":{"where":{"status":{"eq":"REJECTED"}}}},"record_label":"record.title","unique":[{"fields":["jurisdiction_code","instrument_key"],"name":"one_instrument"}]}'::jsonb);

select bolt_history_register('statutory_source','{"audit":true,"fields":{"family":{"kind":"text","optional":true},"jurisdiction_code":{"kind":"text"},"last_checked_on":{"kind":"date","optional":true},"notes":{"kind":"text","optional":true},"origin":{"default":"PERSON","kind":"enum","values":["REFERENCE","AGENT","PERSON"]},"replaces_url":{"format":"url","kind":"text","optional":true},"research_run_id":{"kind":"text","optional":true},"status":{"initial":"PROPOSED","kind":"state","states":{"ACTIVE":{"to":["RETIRED"]},"PROPOSED":{"to":["ACTIVE","RETIRED"]},"RETIRED":{"to":["ACTIVE"]}}},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"locks":{"retired_source":{"except":["status","notes"],"where":{"status":{"eq":"RETIRED"}}}},"record_label":"record.title","unique":[{"fields":["jurisdiction_code","url"],"name":"source_url"}]}'::jsonb);

select bolt_history_register('work_event','{"audit":true,"fields":{"catalog_code":{"kind":"text"},"description":{"kind":"text","optional":true},"employment_id":{"kind":"ref","optional":true,"to":"employment"},"entity_id":{"kind":"ref","to":"entity"},"evidence_file":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"from":{"kind":"date"},"location":{"kind":"text","optional":true},"to":{"kind":"date","optional":true}},"record_label":"record.description"}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog_entry','approval_request','claim_catalog_entry','contract_terms','dependant','employee_balance','employee_profile','employment','entity','entity_change','holiday','jurisdiction','jurisdiction_change','leave_catalog_entry','leave_catalog_entry_day','ledger_entry','loan_catalog_entry','loan_catalog_entry_repayment','obligation','pay_amendment','pay_group','payroll_run','payslip','roster_entry','shift_definition','shift_pattern','statutory_finding','statutory_parameters','statutory_source','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','work_event','workplace_case_catalog_entry']::text[]));
