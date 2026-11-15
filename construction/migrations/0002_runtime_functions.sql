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

create or replace function "bolt_record_label_certification_types_55a9d530"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['certification_name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('certification_name', to_jsonb("certification_name")) AS j FROM (SELECT $1 AS "certification_name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_projects_20ce88de"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['project_name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['project_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['project_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('project_number', to_jsonb("project_number"), 'project_name', to_jsonb("project_name")) AS j FROM (SELECT $1 AS "project_name", $2 AS "project_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_asset_documents_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_bim_reference_matrix_c647799b"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['reference_name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('reference_name', to_jsonb("reference_name")) AS j FROM (SELECT $1 AS "reference_name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_jobs_2158c05c"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['job_title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('job_title', to_jsonb("job_title")) AS j FROM (SELECT $1 AS "job_title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_defects_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_payment_claims_3ecd7377"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['claim_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('claim_number', to_jsonb("claim_number")) AS j FROM (SELECT $1 AS "claim_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_permits_to_work_e2445a92"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['permit_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('permit_number', to_jsonb("permit_number")) AS j FROM (SELECT $1 AS "permit_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_rfis_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_site_locations_b8c81273"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['location_name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['location_code']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['location_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('location_code', to_jsonb("location_code"), 'location_name', to_jsonb("location_name")) AS j FROM (SELECT $1 AS "location_code", $2 AS "location_name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_workers_e447ce69"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['worker_name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['worker_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['worker_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('worker_number', to_jsonb("worker_number"), 'worker_name', to_jsonb("worker_name")) AS j FROM (SELECT $1 AS "worker_name", $2 AS "worker_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

select bolt_history_register('approval_request','{"fields":{"action":{"kind":"enum","values":["create","update","delete"]},"approver_teams":{"kind":"json","shape":{"kind":"text","many":true}},"approver_users":{"kind":"json","shape":{"kind":"text","many":true}},"closed_at":{"kind":"instant","optional":true},"closed_by":{"kind":"text","optional":true},"collection_name":{"kind":"text"},"created_at":{"kind":"instant"},"record_id":{"kind":"text"},"revision":{"default":1,"kind":"int"},"status":{"kind":"enum","values":["ONGOING","CHANGES_REQUESTED","APPROVED","REJECTED","SUPERSEDED","WITHDRAWN"]},"step":{"kind":"int"},"step_names":{"kind":"json","shape":{"kind":"text","many":true}},"steps":{"kind":"int"},"superseder_teams":{"kind":"json","shape":{"kind":"text","many":true}}},"key":"uuid","search":{"text":["collection_name"]},"unique":[{"fields":["collection_name","record_id"],"name":"one_ongoing_request","where":{"status":{"eq":"ONGOING"}}}]}'::jsonb);

select bolt_history_register('sys_api_key','{"fields":{"created_at":{"default":{"var":"now"},"kind":"instant"},"created_by":{"kind":"ref","optional":true,"to":"sys_user"},"hash":{"kind":"text"},"last_used_at":{"kind":"instant","optional":true},"name":{"kind":"text"},"prefix":{"kind":"text"},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"key":"text","record_label":"record.name","unique":[{"fields":["prefix"],"name":"prefix"}]}'::jsonb);

select bolt_history_register('sys_conversation','{"fields":{"archived_at":{"kind":"instant","optional":true},"created_at":{"default":{"var":"now"},"kind":"instant"},"envoy":{"kind":"text","optional":true},"inputs":{"default":[],"kind":"json"},"integration":{"kind":"ref","on_delete":"cascade","optional":true,"to":"sys_integration"},"kind":{"kind":"text","optional":true},"lease_until":{"kind":"instant","optional":true},"model":{"default":"default","kind":"text"},"outputs":{"default":[],"kind":"json"},"owner":{"kind":"text","optional":true},"parent":{"kind":"text","optional":true},"participants":{"kind":"json","optional":true},"plan":{"kind":"json","optional":true},"read":{"default":{},"kind":"json"},"restart_at":{"kind":"text","optional":true},"restart_from":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"run":{"kind":"text","optional":true},"status":{"default":"idle","kind":"text"},"thread":{"kind":"text","optional":true},"title":{"kind":"text","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.title"}'::jsonb);

select bolt_history_register('sys_envoy','{"fields":{"active":{"default":true,"kind":"bool"},"audience":{"default":"private","kind":"enum","values":["private","public"]},"created_at":{"default":{"var":"now"},"kind":"instant"},"delegation":{"default":"disabled","kind":"enum","values":["enabled","disabled"]},"dm":{"default":"union","kind":"enum","values":["union","envoy"]},"group_messages":{"default":"mention_or_reply","kind":"enum","values":["disabled","mention_or_reply","all"]},"name":{"kind":"text"},"policies":{"default":[],"kind":"text","many":true},"revision":{"default":1,"kind":"int"},"task":{"default":"","format":"markdown","kind":"text"},"triage":{"default":false,"kind":"bool"},"triage_scope":{"default":"all","hidden":true,"kind":"enum","values":["dm","group","all"]}},"key":"uuid","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_file','{"fields":{"created_at":{"kind":"instant"},"created_by":{"kind":"text","optional":true},"field":{"kind":"text"},"key":{"kind":"text"},"mime":{"kind":"text"},"name":{"kind":"text"},"revision":{"default":1,"kind":"int"},"sha256":{"kind":"text"},"size":{"kind":"int"},"updated_at":{"kind":"instant","optional":true},"updated_by":{"kind":"text","optional":true}},"key":"text","record_label":"record.name"}'::jsonb);

select bolt_history_register('sys_integration','{"fields":{"active":{"default":true,"kind":"bool"},"configuration":{"default":{},"kind":"json"},"envoy":{"kind":"text","optional":true},"epoch":{"kind":"text","optional":true},"import_start":{"kind":"json","optional":true},"integration":{"kind":"text"},"name":{"kind":"text"},"owner":{"kind":"ref","optional":true,"to":"sys_user"},"revision":{"default":1,"kind":"int"},"status":{"kind":"json","optional":true},"updated_at":{"default":{"var":"now"},"kind":"instant"}},"key":"text","record_label":"record.name","unique":[{"fields":["owner","integration"],"name":"one_per_member","where":{"owner":{"is_null":false}}}]}'::jsonb);

select bolt_history_register('sys_invitation','{"check":{"addressed":{"or":[{"email":{"is_null":false}},{"phone":{"is_null":false}}]}},"fields":{"accepted_at":{"kind":"instant","optional":true},"email":{"kind":"text","optional":true},"expires_at":{"kind":"instant"},"external":{"default":false,"kind":"bool"},"invited_by":{"kind":"ref","optional":true,"to":"sys_user"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"revoked_at":{"kind":"instant","optional":true},"team":{"format":"team","kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}]},{"on":["phone"]}],"key":"text","record_label":"record.email"}'::jsonb);

select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

select bolt_history_register('certification_types','{"audit":true,"fields":{"category":{"kind":"text","optional":true},"certification_code":{"kind":"text","optional":true},"certification_name":{"kind":"text"},"description":{"kind":"text","optional":true},"issuing_body":{"kind":"text","optional":true},"requirements":{"kind":"text","many":true,"optional":true},"requires_refresher":{"kind":"bool","optional":true},"validity_period_months":{"kind":"decimal","optional":true,"scale":2}},"record_label":"record.certification_name","search":{"text":["certification_name"]},"unique":[{"fields":["certification_code"],"name":"certification_code"}]}'::jsonb);

select bolt_history_register('projects','{"audit":true,"fields":{"address":{"kind":"custom","of":"project_address","optional":true},"client":{"kind":"text","optional":true},"contract_value":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency","optional":true},"description":{"kind":"text","optional":true},"document_count":{"kind":"count","of":"asset_documents","where":{"status":{"in":["draft","in_review","issued"]}}},"main_contractor":{"kind":"text","optional":true},"project_manager":{"kind":"text","optional":true},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_type":{"kind":"text","optional":true},"schedule_range":{"kind":"period","of":"date","optional":true},"site_location_count":{"kind":"count","of":"site_locations"},"status":{"kind":"enum","optional":true,"values":["planned","active","on_hold","complete","cancelled"]}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

select bolt_history_register('asset_documents','{"audit":true,"fields":{"asset_category":{"kind":"enum","optional":true,"values":["bim_model","handover","operations"]},"asset_tag":{"kind":"text","optional":true},"document_file":{"accept":["*/*"],"kind":"file","max":"50MiB","optional":true},"document_number":{"kind":"text","optional":true},"document_type":{"kind":"enum","optional":true,"values":["ifc_model","handover_pack","o_and_m","drawing","specification","certificate"]},"document_url":{"kind":"text","optional":true},"project_id":{"inverse":"asset_documents","kind":"ref","optional":true,"to":"projects"},"site_location_id":{"inverse":"asset_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["draft","in_review","issued","superseded","archived"]},"tags":{"kind":"text","many":true,"optional":true},"title":{"kind":"text"},"validity_range":{"kind":"period","of":"date","optional":true},"version":{"kind":"text","optional":true}},"record_label":"record.title","search":{"text":["title"]},"unique":[{"fields":["document_number"],"name":"document_number"}]}'::jsonb);

select bolt_history_register('bim_reference_matrix','{"audit":true,"fields":{"bim_guid":{"kind":"text","optional":true},"carbon_unit":{"kind":"text","optional":true},"category":{"kind":"text","optional":true},"currency":{"kind":"currency","optional":true},"data_source":{"kind":"text","optional":true},"embodied_carbon_per_unit":{"kind":"decimal","optional":true,"scale":4},"project_id":{"inverse":"bim_references","kind":"ref","on_delete":"set_null","optional":true,"to":"projects"},"rate":{"currency":"currency","kind":"money","optional":true},"reference_code":{"kind":"text","optional":true},"reference_name":{"kind":"text"},"specification":{"kind":"text","optional":true},"subcategory":{"kind":"text","optional":true},"unit_of_measure":{"kind":"text","optional":true}},"record_label":"record.reference_name","search":{"text":["reference_name"]},"unique":[{"fields":["reference_code"],"name":"reference_code"}]}'::jsonb);

select bolt_history_register('jobs','{"audit":true,"fields":{"bim_reference_id":{"inverse":"jobs","kind":"ref","on_delete":"set_null","optional":true,"to":"bim_reference_matrix"},"budget":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency","optional":true},"description":{"kind":"text","optional":true},"job_number":{"kind":"text","optional":true},"job_title":{"kind":"text"},"job_type":{"kind":"text","optional":true},"priority":{"kind":"enum","optional":true,"values":["low","medium","high","critical"]},"project_id":{"inverse":"jobs","kind":"ref","optional":true,"to":"projects"},"schedule_range":{"kind":"period","of":"date","optional":true},"site_location_id":{"inverse":"jobs","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["planned","ready","in_progress","completed","blocked","cancelled"]}},"record_label":"record.job_title","search":{"text":["job_title","job_number","project_id"]},"unique":[{"fields":["job_number"],"name":"job_number"}]}'::jsonb);

select bolt_history_register('defects','{"audit":true,"fields":{"assigned_to":{"kind":"text","optional":true},"category":{"kind":"text","optional":true},"closed_date":{"kind":"date","optional":true},"defect_number":{"kind":"text","optional":true},"description":{"kind":"text","optional":true},"due_date":{"kind":"date","optional":true},"job_id":{"inverse":"defects","kind":"ref","on_delete":"set_null","optional":true,"to":"jobs"},"photos":{"accept":["image/jpeg","image/png"],"kind":"file","many":true,"max":"20MiB","optional":true},"project_id":{"inverse":"defects","kind":"ref","optional":true,"to":"projects"},"reported_by":{"kind":"text","optional":true},"reported_date":{"kind":"date","optional":true},"resolution_notes":{"kind":"text","optional":true},"severity":{"kind":"enum","optional":true,"values":["low","medium","high","critical"]},"site_location_id":{"inverse":"defects","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["open","in_review","ready_for_closeout","closed"]},"title":{"kind":"text"}},"record_label":"record.title","search":{"text":["title"]},"unique":[{"fields":["defect_number"],"name":"defect_number"}]}'::jsonb);

select bolt_history_register('job_assignments','{"audit":true,"fields":{"assignment_code":{"kind":"text","optional":true},"assignment_range":{"kind":"period","of":"date","optional":true},"hours_per_day":{"kind":"decimal","optional":true,"scale":2},"job_id":{"inverse":"job_assignments","kind":"ref","optional":true,"to":"jobs"},"required_certifications":{"kind":"text","many":true,"optional":true},"role":{"kind":"text","optional":true},"site_location_id":{"inverse":"job_assignments","kind":"ref","to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["assigned","in_progress","completed","cancelled"]},"worker_id":{"inverse":"job_assignments","kind":"ref","to":"workers"}},"record_label":"record.worker_id.worker_name + '' · '' + record.site_location_id.location_name","search":{"text":["assignment_code"]}}'::jsonb);

select bolt_history_register('jobs_certification_types','{"audit":true,"fields":{"certification_type_id":{"inverse":"jobs_certification_types","kind":"ref","to":"certification_types"},"job_id":{"inverse":"jobs_certification_types","kind":"ref","to":"jobs"}},"record_label":"record.job_id.job_title + '' · '' + record.certification_type_id.certification_name"}'::jsonb);

select bolt_history_register('jobs_site_locations','{"audit":true,"fields":{"job_id":{"inverse":"jobs_site_locations","kind":"ref","to":"jobs"},"site_location_id":{"inverse":"jobs_site_locations","kind":"ref","to":"site_locations"}},"record_label":"record.job_id.job_title + '' · '' + record.site_location_id.location_name"}'::jsonb);

select bolt_history_register('payment_claims','{"audit":true,"fields":{"certified_amount":{"currency":"currency","kind":"money","optional":true},"claim_number":{"kind":"text"},"claim_period":{"kind":"period","of":"date","optional":true},"claim_type":{"kind":"enum","optional":true,"values":["progress","variation","final"]},"claimed_amount":{"currency":"currency","kind":"money","optional":true},"currency":{"kind":"currency","optional":true},"description":{"kind":"text","optional":true},"job_id":{"inverse":"payment_claims","kind":"ref","on_delete":"set_null","optional":true,"to":"jobs"},"paid_date":{"kind":"date","optional":true},"project_id":{"inverse":"payment_claims","kind":"ref","optional":true,"to":"projects"},"status":{"kind":"enum","optional":true,"values":["draft","submitted","certified","paid","rejected"]},"submitted_date":{"kind":"date","optional":true},"supporting_documents":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}},"record_label":"record.claim_number","search":{"text":["claim_number"]},"unique":[{"fields":["claim_number"],"name":"claim_number"}]}'::jsonb);

select bolt_history_register('permits_to_work','{"audit":true,"fields":{"approved_by":{"kind":"text","optional":true},"control_measures":{"kind":"text","many":true,"optional":true},"hazards_identified":{"kind":"text","many":true,"optional":true},"job_id":{"inverse":"permits_to_work","kind":"ref","on_delete":"set_null","optional":true,"to":"jobs"},"permit_number":{"kind":"text"},"permit_type":{"kind":"enum","optional":true,"values":["work_at_height","site_supervision","electrical","confined_space","hot_work","lifting","excavation"]},"project_id":{"inverse":"permits_to_work","kind":"ref","optional":true,"to":"projects"},"requested_date":{"kind":"date","optional":true},"signatures":{"kind":"custom","of":"permit_signatures","optional":true},"site_location_id":{"inverse":"permits_to_work","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"status":{"kind":"enum","optional":true,"values":["draft","pending","active","expiring_soon","expired","suspended","closed"]},"validity_range":{"kind":"period","of":"date","optional":true},"worker_id":{"inverse":"permits_to_work","kind":"ref","on_delete":"set_null","optional":true,"to":"workers"}},"record_label":"record.permit_number","search":{"text":["permit_number"]},"unique":[{"fields":["permit_number"],"name":"permit_number"}]}'::jsonb);

select bolt_history_register('permits_to_work_certification_types','{"audit":true,"fields":{"certification_type_id":{"inverse":"permits_to_work_certification_types","kind":"ref","to":"certification_types"},"permits_to_work_id":{"inverse":"permits_to_work_certification_types","kind":"ref","to":"permits_to_work"}},"record_label":"record.permits_to_work_id.permit_number + '' · '' + record.certification_type_id.certification_name"}'::jsonb);

select bolt_history_register('permits_to_work_workers','{"audit":true,"fields":{"permits_to_work_id":{"inverse":"permits_to_work_workers","kind":"ref","to":"permits_to_work"},"worker_id":{"inverse":"permits_to_work_workers","kind":"ref","to":"workers"}},"record_label":"record.permits_to_work_id.permit_number + '' · '' + record.worker_id.worker_name"}'::jsonb);

select bolt_history_register('rfis','{"audit":true,"fields":{"answer":{"kind":"text","optional":true},"asked_by":{"kind":"text","optional":true},"assigned_to":{"kind":"text","optional":true},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"due_date":{"kind":"date","optional":true},"priority":{"kind":"enum","optional":true,"values":["low","medium","high","critical"]},"project_id":{"inverse":"rfis","kind":"ref","optional":true,"to":"projects"},"question":{"kind":"text","optional":true},"related_defect_id":{"inverse":"related_rfis","kind":"ref","on_delete":"set_null","optional":true,"to":"defects"},"resolved_date":{"kind":"date","optional":true},"rfi_number":{"kind":"text","optional":true},"status":{"kind":"enum","optional":true,"values":["open","answered","closed"]},"subject":{"kind":"text","optional":true},"submitted_date":{"kind":"date","optional":true},"title":{"kind":"text"}},"record_label":"record.title","search":{"text":["title"]},"unique":[{"fields":["rfi_number"],"name":"rfi_number"}]}'::jsonb);

select bolt_history_register('site_locations','{"audit":true,"fields":{"bim_model_element_id":{"kind":"text","optional":true},"coordinates":{"kind":"custom","of":"site_coordinates","optional":true},"description":{"kind":"text","optional":true},"grid_reference":{"kind":"text","optional":true},"location_code":{"kind":"text","optional":true},"location_name":{"kind":"text"},"location_type":{"kind":"text","optional":true},"parent_location_id":{"inverse":"child_locations","kind":"ref","on_delete":"set_null","optional":true,"to":"site_locations"},"project_id":{"inverse":"site_locations","kind":"ref","optional":true,"to":"projects"}},"record_label":"record.location_code != null ? record.location_code + '' · '' + record.location_name : record.location_name","search":{"text":["location_code","location_name"]},"unique":[{"fields":["location_code"],"name":"location_code"}]}'::jsonb);

select bolt_history_register('workers','{"audit":true,"fields":{"date_of_birth":{"kind":"date","optional":true},"email":{"kind":"text","optional":true},"emergency_contact":{"kind":"custom","of":"emergency_contact","optional":true},"medical_check_date":{"kind":"date","optional":true},"nationality":{"kind":"text","optional":true},"phone":{"kind":"text","optional":true},"safety_induction_date":{"kind":"date","optional":true},"status":{"kind":"enum","optional":true,"values":["active","inactive","suspended"]},"trade":{"kind":"text","optional":true},"work_permit_expiry":{"kind":"date","optional":true},"worker_name":{"kind":"text"},"worker_number":{"kind":"text","optional":true}},"record_label":"record.worker_number != null ? record.worker_number + '' · '' + record.worker_name : record.worker_name","search":{"text":["worker_name","worker_number"]},"unique":[{"fields":["worker_number"],"name":"worker_number"}]}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['approval_request','asset_documents','bim_reference_matrix','certification_types','defects','job_assignments','jobs','jobs_certification_types','jobs_site_locations','payment_claims','permits_to_work','permits_to_work_certification_types','permits_to_work_workers','projects','rfis','site_locations','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','workers']::text[]));
