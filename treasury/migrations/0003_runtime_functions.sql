-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

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

create or replace function "bolt_record_label_bank_1d6aa255"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code")) AS j FROM (SELECT $1 AS "code") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_bank_contact_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_letter_of_offer_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_watch_point_b2bf9cd3"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['text']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('text', to_jsonb("text")) AS j FROM (SELECT $1 AS "text") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_drawdown_c9bc55ae"(numeric, text, text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_3.left_value) = 'string' AND jsonb_typeof(label_3.right_value) = 'string' THEN to_jsonb((label_3.left_value #>> '{}') || (label_3.right_value #>> '{}')) WHEN jsonb_typeof(label_3.left_value) = 'array' AND jsonb_typeof(label_3.right_value) = 'array' THEN label_3.left_value || label_3.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_3.left_value) = 'number' THEN (label_3.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_3.right_value) = 'number' THEN (label_3.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_2.left_value) = 'string' AND jsonb_typeof(label_2.right_value) = 'string' THEN to_jsonb((label_2.left_value #>> '{}') || (label_2.right_value #>> '{}')) WHEN jsonb_typeof(label_2.left_value) = 'array' AND jsonb_typeof(label_2.right_value) = 'array' THEN label_2.left_value || label_2.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_2.left_value) = 'number' THEN (label_2.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_2.right_value) = 'number' THEN (label_2.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['bank_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb((coalesce((label_row.j #> ARRAY['product']), 'null'::jsonb) #>> '{}')) ELSE 'null'::jsonb END) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['currency']), 'null'::jsonb) AS right_value OFFSET 0) label_1) AS left_value, to_jsonb(' '::text) AS right_value OFFSET 0) label_2) AS left_value, to_jsonb((coalesce((label_row.j #> ARRAY['amount']), 'null'::jsonb) #>> '{}')) AS right_value OFFSET 0) label_3) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_reference', to_jsonb("bank_reference"), 'product', to_jsonb("product"), 'currency', to_jsonb("currency"), 'amount', to_jsonb(("amount")::text)) AS j FROM (SELECT $1 AS "amount", $2 AS "bank_reference", $3 AS "currency", $4 AS "product") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_bank_document_3dc52602"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['advice_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Advice'::text) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('advice_reference', to_jsonb("advice_reference")) AS j FROM (SELECT $1 AS "advice_reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_drawdown_charge_60712bd1"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['charge_type']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('charge_type', to_jsonb("charge_type")) AS j FROM (SELECT $1 AS "charge_type") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_facility_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_facility_fee_e13c4f1a"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['fee_type']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('fee_type', to_jsonb("fee_type")) AS j FROM (SELECT $1 AS "fee_type") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_sub_limit_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('name', to_jsonb("name")) AS j FROM (SELECT $1 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_fx_rate_4982f156"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['currency']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('currency', to_jsonb("currency")) AS j FROM (SELECT $1 AS "currency") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_month_end_907c8683"(date) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (to_jsonb((coalesce((label_row.j #> ARRAY['month']), 'null'::jsonb) #>> '{}')) #>> '{}') AS value FROM (SELECT jsonb_build_object('month', to_jsonb("month"::text)) AS j FROM (SELECT $1 AS "month") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_month_end_line_7135a1d1"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['bank_code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('—'::text) ELSE 'null'::jsonb END) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('bank_code', to_jsonb("bank_code"), 'reference', to_jsonb("reference")) AS j FROM (SELECT $1 AS "bank_code", $2 AS "reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_purchase_order_27022eb9"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('po_number', to_jsonb("po_number")) AS j FROM (SELECT $1 AS "po_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_facility_form_27022eb9"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['po_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('po_number', to_jsonb("po_number")) AS j FROM (SELECT $1 AS "po_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_facility_attachment_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_invoice_d54577a9"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['invoice_number']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('invoice_number', to_jsonb("invoice_number")) AS j FROM (SELECT $1 AS "invoice_number") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_po_document_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_po_line_d1d21638"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['item']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('item', to_jsonb("item")) AS j FROM (SELECT $1 AS "item") label_inputs) label_row OFFSET 0) label_value$record_label$;

create or replace function "bolt_record_label_supplier_93340fdd"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
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

select bolt_history_register('bank','{"audit":true,"fields":{"code":{"kind":"text","max":20},"cut_off_time":{"kind":"text","optional":true},"is_active":{"default":true,"kind":"bool"},"name":{"kind":"text"},"offered_products":{"kind":"enum","many":true,"optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"settlement_instructions":{"kind":"text","optional":true},"terms_notes":{"kind":"text","optional":true}},"record_label":"record.code","unique":[{"fields":["code"],"import_key":true,"name":"bank_code"}]}'::jsonb);

select bolt_history_register('bank_contact','{"audit":true,"fields":{"bank":{"inverse":"contacts","kind":"ref","on_delete":"cascade","to":"bank"},"email":{"format":"email","kind":"text","optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"phone":{"kind":"text","optional":true},"role":{"default":"other","kind":"enum","values":["relationship_manager","client_service","trade_operations","other"]}},"record_label":"record.name"}'::jsonb);

select bolt_history_register('letter_of_offer','{"audit":true,"fields":{"bank":{"inverse":"letters_of_offer","kind":"ref","to":"bank"},"document":{"accept":["application/pdf"],"kind":"file","max":"10MiB","optional":true},"facility":{"inverse":"letters_of_offer","kind":"ref","on_delete":"set_null","optional":true,"to":"facility"},"next_review_date":{"kind":"date","optional":true},"notes":{"kind":"text","optional":true},"offer_date":{"kind":"date","optional":true},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

select bolt_history_register('watch_point','{"audit":true,"fields":{"bank":{"inverse":"watch_points","kind":"ref","on_delete":"cascade","to":"bank"},"category":{"default":"other","kind":"enum","values":["suppliers","restriction","documents","settlement","pricing","other"]},"facility":{"inverse":"watch_points","kind":"ref","on_delete":"set_null","optional":true,"to":"facility"},"is_active":{"default":true,"kind":"bool"},"text":{"kind":"text"}},"record_label":"record.text"}'::jsonb);

select bolt_history_register('drawdown','{"audit":true,"computed":{"amount_usd":{"expr":{"round":[{"times":[{"field":"amount"},{"field":"fx_rate_to_usd"}]},2]},"kind":"decimal","scale":2}},"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"application_date":{"kind":"date","optional":true},"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charge_rate_pct":{"kind":"decimal","optional":true,"scale":6},"converted_from":{"inverse":"converted_into","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"due_date":{"kind":"date","optional":true},"earliest_invoice_date":{"kind":"date","optional":true},"expected_draw_date":{"kind":"date","optional":true},"facility":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"facility"},"fx_rate_to_usd":{"default":1,"kind":"decimal","scale":12},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"interest_to_maturity":{"kind":"decimal","optional":true,"scale":2},"is_archived":{"default":false,"kind":"bool"},"latest_due_date":{"kind":"date","optional":true},"lc_expiry_date":{"kind":"date","optional":true},"lc_number":{"kind":"text","optional":true},"needs_review":{"default":false,"kind":"bool"},"notes":{"kind":"text","optional":true},"product":{"default":"if","kind":"enum","values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"purpose":{"kind":"text","optional":true},"rate_source":{"kind":"enum","optional":true,"values":["manual","bank_advice"]},"released_date":{"kind":"date","optional":true},"requested_by":{"kind":"text","optional":true},"review_note":{"kind":"text","optional":true},"settled_by":{"kind":"enum","optional":true,"values":["repaid","cash","converted"]},"settled_interest":{"kind":"decimal","optional":true,"scale":2},"settled_principal":{"kind":"decimal","optional":true,"scale":2},"settlement_date":{"kind":"date","optional":true},"start_date":{"kind":"date","optional":true},"status":{"default":"active","kind":"enum","values":["earmarked","applied","active","settled","cancelled","unclear"]},"supplier":{"inverse":"drawdowns","kind":"ref","on_delete":"restrict","optional":true,"to":"supplier"},"tenor_days":{"kind":"int","optional":true},"terms_days":{"kind":"int","min":0,"optional":true}},"indexes":[{"on":["status","due_date"]}],"locks":{"sealed_line":{"except":["is_archived","needs_review","review_note","notes"],"where":{"status":{"in":["settled","cancelled"]}}}},"record_label":"(record.bank_reference != null ? record.bank_reference : string(record.product)) + '' · '' + record.currency + '' '' + string(record.amount)","search":{"text":["bank_reference","lc_number","bill_number"]}}'::jsonb);

select bolt_history_register('bank_document','{"audit":true,"fields":{"advice_date":{"kind":"date","optional":true},"advice_reference":{"kind":"text","optional":true},"bank":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"bank"},"doc_type":{"default":"other","kind":"enum","values":["drawdown_advice","settlement_advice","other"]},"drawdown":{"inverse":"documents","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"extracted":{"kind":"json","optional":true,"shape":{"fields":{"bank_reference":{"kind":"text","optional":true},"bill_number":{"kind":"text","optional":true},"charges":{"fields":{"amount_usd":{"kind":"decimal","scale":2},"charge_type":{"kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"description":{"kind":"text","optional":true}},"kind":"object","many":true,"optional":true},"currency":{"kind":"currency","optional":true},"due_date":{"kind":"date","optional":true},"interest_amount":{"kind":"decimal","optional":true,"scale":2},"interest_days":{"kind":"int","optional":true},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"lc_number":{"kind":"text","optional":true},"principal":{"kind":"decimal","optional":true,"scale":2},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"start_date":{"kind":"date","optional":true},"supplier_name":{"kind":"text","optional":true},"total_debited":{"kind":"decimal","optional":true,"scale":2},"uncertain":{"kind":"text","many":true,"optional":true}},"kind":"object"}},"file":{"accept":["application/pdf"],"kind":"file","max":"10MiB"},"notes":{"kind":"text","optional":true},"read_note":{"kind":"text","optional":true},"read_status":{"default":"uploaded","kind":"enum","values":["uploaded","checked","applied","failed"]}},"record_label":"record.advice_reference != null ? record.advice_reference : ''Advice''"}'::jsonb);

select bolt_history_register('drawdown_charge','{"audit":true,"fields":{"amount":{"kind":"decimal","scale":2},"charge_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"currency":{"default":"USD","kind":"currency"},"description":{"kind":"text","optional":true},"drawdown":{"inverse":"charges","kind":"ref","on_delete":"cascade","to":"drawdown"},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.charge_type"}'::jsonb);

select bolt_history_register('facility','{"audit":true,"fields":{"bank":{"inverse":"facilities","kind":"ref","to":"bank"},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"early_settlement_penalty":{"kind":"text","optional":true},"entity":{"kind":"text","optional":true},"expiry_date":{"kind":"date","optional":true},"interest_rounding":{"default":"nearest_cent","kind":"enum","values":["nearest_cent","down_to_cent"]},"limit":{"default":0,"kind":"decimal","scale":2},"margin_pct":{"kind":"decimal","optional":true,"scale":6},"max_tenor_days":{"kind":"int","min":0,"optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"pledged_deposit":{"kind":"decimal","optional":true,"scale":2},"pricing_basis":{"kind":"text","optional":true},"pricing_notes":{"kind":"text","optional":true},"review_date":{"kind":"date","optional":true},"security":{"kind":"text","optional":true},"status":{"default":"active","kind":"enum","values":["active","expired"]},"tenor_start_rule":{"kind":"enum","optional":true,"values":["invoice_date","disbursement_date","bill_of_lading_date"]}},"record_label":"record.name","unique":[{"fields":["bank","name"],"name":"facility_name_per_bank"}]}'::jsonb);

select bolt_history_register('facility_fee','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"currency":{"default":"USD","kind":"currency"},"facility":{"inverse":"fees","kind":"ref","on_delete":"cascade","to":"facility"},"fee_type":{"default":"commission","kind":"enum","values":["commission","cable","swift","cost_of_funds_transfer","processing","tr_extension","penalty","other"]},"include_in_estimates":{"default":true,"kind":"bool"},"method":{"default":"percent","kind":"enum","values":["percent","flat"]},"minimum_amount":{"kind":"decimal","optional":true,"scale":2},"notes":{"kind":"text","optional":true},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"rate_pct":{"kind":"decimal","optional":true,"scale":6},"stage":{"default":"drawdown","kind":"enum","values":["drawdown","settlement"]}},"record_label":"record.fee_type"}'::jsonb);

select bolt_history_register('sub_limit','{"audit":true,"fields":{"facility":{"inverse":"sub_limits","kind":"ref","on_delete":"cascade","to":"facility"},"limit":{"kind":"decimal","scale":2},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"supplier":{"inverse":"sub_limits","kind":"ref","on_delete":"set_null","optional":true,"to":"supplier"}},"record_label":"record.name"}'::jsonb);

select bolt_history_register('fx_rate','{"audit":true,"fields":{"currency":{"kind":"currency"},"is_month_end":{"default":false,"kind":"bool"},"rate_date":{"kind":"date"},"source":{"kind":"text","optional":true},"usd_per_unit":{"kind":"decimal","scale":12}},"record_label":"record.currency","unique":[{"fields":["currency","rate_date"],"name":"fx_per_day"}]}'::jsonb);

select bolt_history_register('month_end','{"audit":true,"fields":{"accrued_interest":{"kind":"decimal","optional":true,"scale":2},"available":{"kind":"decimal","optional":true,"scale":2},"average_tenor_days":{"kind":"decimal","optional":true,"scale":2},"bank_borrowings":{"kind":"decimal","optional":true,"scale":2},"banker_guarantee":{"kind":"decimal","optional":true,"scale":2},"credit_line":{"kind":"decimal","optional":true,"scale":2},"highest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"is_locked":{"default":false,"kind":"bool"},"letters_of_credit":{"kind":"decimal","optional":true,"scale":2},"locked_at":{"kind":"instant","optional":true},"lowest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"month":{"kind":"date"},"notes":{"kind":"text","optional":true},"simple_average_rate_pct":{"kind":"decimal","optional":true,"scale":6},"source":{"default":"portal","kind":"enum","values":["portal","excel"]},"term_bills":{"kind":"decimal","optional":true,"scale":2},"total_utilised":{"kind":"decimal","optional":true,"scale":2},"weighted_average_rate_pct":{"kind":"decimal","optional":true,"scale":6}},"locks":{"locked_month":{"except":["is_locked","notes"],"where":{"is_locked":{"eq":true}}}},"record_label":"string(record.month)","unique":[{"fields":["month"],"name":"one_report_per_month"}]}'::jsonb);

select bolt_history_register('month_end_line','{"audit":true,"fields":{"accrued_days":{"kind":"int","optional":true},"accrued_interest":{"kind":"decimal","optional":true,"scale":2},"amount":{"kind":"decimal","scale":2},"amount_usd":{"kind":"decimal","optional":true,"scale":2},"bank_code":{"kind":"text"},"charges":{"kind":"decimal","optional":true,"scale":2},"currency":{"default":"USD","kind":"currency"},"day_count_basis":{"default":"actual_360","kind":"enum","values":["actual_360","actual_365"]},"drawdown":{"inverse":"month_end_lines","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"due_date":{"kind":"date","optional":true},"fx_rate_to_usd":{"default":1,"kind":"decimal","scale":12},"interest_rate_pct":{"kind":"decimal","optional":true,"scale":6},"interest_to_maturity":{"kind":"decimal","optional":true,"scale":2},"month_end":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"month_end"},"product":{"kind":"enum","optional":true,"values":["lc","import_bill","da","dp","tb","ba","bad","if","if_after_lc_or_da","pif","twc","oaf","apf","psil","psbl","ofcl","mctf","tradepay","packing","fbep","dbep","ecr","badd","stl","term","efs","lis","tbl","ma","property","bg","sg","awb","sblc","fx","card","cash"]},"reference":{"kind":"text","optional":true},"start_date":{"kind":"date","optional":true},"supplier":{"kind":"text","optional":true},"tenor_days":{"kind":"int","optional":true}},"record_label":"record.bank_code + '' · '' + (record.reference != null ? record.reference : ''—'')"}'::jsonb);

select bolt_history_register('purchase_order','{"audit":true,"fields":{"amount":{"kind":"sum","of":"lines.amount"},"currency":{"default":"USD","kind":"currency"},"invoice_count":{"kind":"count","of":"invoices"},"invoiced_amount":{"kind":"sum","of":"invoices.amount"},"is_cancelled":{"default":false,"kind":"bool"},"lc_links":{"kind":"count","of":"financings","where":{"is_lc":{"eq":true}}},"lc_requested":{"default":false,"kind":"bool"},"notes":{"kind":"text","optional":true},"po_date":{"kind":"date"},"po_number":{"kind":"text","max":60},"purchaser":{"kind":"text","optional":true},"quantity":{"kind":"sum","of":"lines.quantity"},"salesperson":{"kind":"text","optional":true},"ship_to_country":{"kind":"text","optional":true},"supplier":{"inverse":"purchase_orders","kind":"ref","to":"supplier"}},"record_label":"record.po_number","unique":[{"fields":["po_number"],"import_key":true,"name":"po_number"}]}'::jsonb);

select bolt_history_register('facility_form','{"audit":true,"fields":{"amount":{"kind":"decimal","optional":true,"scale":2},"buyer":{"kind":"text","optional":true},"currency":{"default":"USD","kind":"currency"},"customer_po_number":{"kind":"text","optional":true},"documents_presentation_days":{"kind":"int","min":0,"optional":true},"expected_arrival":{"kind":"text","optional":true},"facility_required":{"default":"tt","kind":"enum","values":["tt","lc"]},"freight":{"kind":"text","optional":true},"intended_period_of_sales":{"kind":"text","optional":true},"latest_shipment_date":{"kind":"date","optional":true},"lc_expiry_date":{"kind":"date","optional":true},"partial_shipment":{"default":false,"kind":"bool"},"pay_by_date":{"kind":"date","optional":true},"payment_terms":{"kind":"text","optional":true},"po_date":{"kind":"date","optional":true},"po_number":{"kind":"text","max":60},"product_description":{"kind":"text","optional":true},"projected_sales":{"kind":"text","optional":true},"purchase_order":{"inverse":"facility_forms","kind":"ref","on_delete":"set_null","optional":true,"to":"purchase_order"},"purpose":{"kind":"text","optional":true},"read_note":{"kind":"text","optional":true},"remarks":{"kind":"text","optional":true},"requested_by":{"kind":"text","optional":true},"ship_date":{"kind":"date","optional":true},"shipment_from":{"kind":"text","optional":true},"shipment_to":{"kind":"text","optional":true},"shipping_terms":{"kind":"text","optional":true},"transhipment":{"default":false,"kind":"bool"},"vendor":{"kind":"text","optional":true}},"record_label":"record.po_number","search":{"text":["po_number","vendor","customer_po_number"]}}'::jsonb);

select bolt_history_register('facility_attachment','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"form":{"inverse":"attachments","kind":"ref","on_delete":"cascade","to":"facility_form"},"kind":{"default":"other","kind":"enum","values":["proforma","purchase_order","customer_po","planning_detail","other"]},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

select bolt_history_register('invoice','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"bank_bill_number":{"kind":"text","optional":true},"currency":{"default":"USD","kind":"currency"},"drawdown":{"inverse":"invoices","kind":"ref","on_delete":"set_null","optional":true,"to":"drawdown"},"invoice_date":{"kind":"date"},"invoice_number":{"kind":"text","max":60},"notes":{"kind":"text","optional":true},"po":{"inverse":"invoices","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"record.invoice_number","unique":[{"fields":["po","invoice_number"],"name":"invoice_per_po"}]}'::jsonb);

select bolt_history_register('invoice_line','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"invoice":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"invoice"},"po_line":{"inverse":"invoice_lines","kind":"ref","on_delete":"restrict","to":"po_line"},"quantity":{"kind":"decimal","min":0,"scale":3}},"record_label":"record.po_line.item"}'::jsonb);

select bolt_history_register('po_document','{"audit":true,"fields":{"file":{"accept":["application/pdf","image/jpeg","image/png"],"kind":"file","max":"10MiB"},"kind":{"default":"supporting","kind":"enum","values":["purchase_order","supporting","issued_lc","commercial_invoice","other"]},"notes":{"kind":"text","optional":true},"po":{"inverse":"documents","kind":"ref","on_delete":"cascade","to":"purchase_order"},"title":{"kind":"text"}},"record_label":"record.title"}'::jsonb);

select bolt_history_register('po_financing','{"audit":true,"fields":{"drawdown":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"drawdown"},"is_lc":{"default":false,"kind":"bool"},"purchase_order":{"inverse":"financings","kind":"ref","on_delete":"cascade","to":"purchase_order"}},"record_label":"record.purchase_order.po_number + '' · '' + (record.drawdown.bank_reference != null ? record.drawdown.bank_reference : string(record.drawdown.product))","unique":[{"fields":["purchase_order","drawdown"],"name":"one_link"}]}'::jsonb);

select bolt_history_register('po_line','{"audit":true,"fields":{"amount":{"kind":"decimal","min":0,"scale":2},"invoiced_quantity":{"kind":"sum","of":"invoice_lines.quantity"},"item":{"kind":"text"},"po":{"inverse":"lines","kind":"ref","on_delete":"cascade","to":"purchase_order"},"quantity":{"kind":"decimal","min":0,"scale":3}},"record_label":"record.item"}'::jsonb);

select bolt_history_register('supplier','{"audit":true,"fields":{"aliases":{"kind":"text","many":true,"optional":true},"country":{"kind":"text","optional":true},"is_active":{"default":true,"kind":"bool"},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms":{"kind":"text","optional":true},"products":{"kind":"text","optional":true},"relationship_since":{"kind":"date","optional":true}},"record_label":"record.name","search":{"text":["name","aliases"]},"unique":[{"fields":["name"],"import_key":true,"name":"supplier_name"}]}'::jsonb);

select bolt_history_register('supplier_bank','{"audit":true,"fields":{"bank":{"inverse":"eligible_suppliers","kind":"ref","on_delete":"cascade","to":"bank"},"supplier":{"inverse":"eligible_banks","kind":"ref","on_delete":"cascade","to":"supplier"}},"record_label":"record.bank.code","unique":[{"fields":["supplier","bank"],"name":"one_per_pair"}]}'::jsonb);

update bolt_history_current set active=false where active and not (model=any(array['approval_request','bank','bank_contact','bank_document','drawdown','drawdown_charge','facility','facility_attachment','facility_fee','facility_form','fx_rate','invoice','invoice_line','letter_of_offer','month_end','month_end_line','po_document','po_financing','po_line','purchase_order','sub_limit','supplier','supplier_bank','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','watch_point']::text[]));
