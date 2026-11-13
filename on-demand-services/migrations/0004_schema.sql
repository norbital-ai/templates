-- 0004_schema.sql: 31 step(s), from 9d546c195273c67aa5590aeaf0546464810af137b51bdbcaea9f23732ad9fcb3 to be6f55601d49edad37010702e89017ae00d61707f819db6df4c768dd542a438e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:index:booking_helpers.booking_helpers__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "booking_helpers__gin__73732636";

-- step drop:index:helper_time_off.helper_time_off__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_time_off__gin__73732636";

-- step drop:index:openings.openings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "openings__gin__73732636";

-- step replace:index:helper_warnings.helper_warnings__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "helper_warnings__gin__73732636";

-- step replace:index:drive_times.drive_times__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "drive_times__gin__73732636";

-- step drop:column:booking_helpers.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop column if exists "bolt_record_label" cascade;

-- step drop:column:booking_helpers.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "booking_helpers" drop column if exists bolt_search cascade;

-- step drop:column:helper_time_off.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop column if exists "bolt_record_label" cascade;

-- step drop:column:helper_time_off.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "helper_time_off" drop column if exists bolt_search cascade;

-- step drop:column:helper_warnings.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists "bolt_record_label" cascade;

-- step drop:column:openings.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "openings" drop column if exists "bolt_record_label" cascade;

-- step drop:column:openings.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "openings" drop column if exists bolt_search cascade;

-- step replace:column:helper_warnings.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "helper_warnings" drop column if exists bolt_search cascade;

-- step replace:column:drive_times.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "drive_times" drop column if exists "bolt_record_label" cascade;

-- step replace:column:drive_times.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "drive_times" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_booking_helpers_304cae28 (additive)
drop function if exists "bolt_record_label_booking_helpers_304cae28"(int) cascade;

-- step drop:function:bolt_record_label_drive_times_9cc16d6b (additive)
drop function if exists "bolt_record_label_drive_times_9cc16d6b"(int) cascade;

-- step drop:function:bolt_record_label_helper_time_off_1ce14547 (additive)
drop function if exists "bolt_record_label_helper_time_off_1ce14547"(text) cascade;

-- step drop:function:bolt_record_label_helper_warnings_1ce14547 (additive)
drop function if exists "bolt_record_label_helper_warnings_1ce14547"(text) cascade;

-- step drop:function:bolt_record_label_openings_92b43434 (additive)
drop function if exists "bolt_record_label_openings_92b43434"(date) cascade;

-- step create:function:bolt_record_label_drive_times_f87133b7 (additive)
create function "bolt_record_label_drive_times_f87133b7"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['leg']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('leg', to_jsonb("leg")) AS j FROM (SELECT $1 AS "leg") label_inputs) label_row) label_value$record_label$;

-- step replace:column:helper_warnings.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "helper_warnings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("reason"::text, ''))) stored;

-- step replace:column:drive_times.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drive_times" add column "bolt_record_label" text generated always as ("bolt_record_label_drive_times_f87133b7"("leg")) stored;

-- step replace:column:drive_times.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "drive_times" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_drive_times_f87133b7"("leg"), ''))) stored;

-- step replace:history:schema:booking_helpers (additive)
select bolt_history_register('booking_helpers','{"audit":true,"fields":{"booking":{"inverse":"preferred_helpers","kind":"ref","owned":true,"to":"bookings"},"helper":{"inverse":"preferred_by","kind":"ref","to":"helpers"},"rank":{"kind":"int","max":5,"min":1}},"record_label":"record.booking.number + '' · '' + record.helper.name","unique":[{"fields":["booking","helper"],"name":"one_rank_per_helper"}]}'::jsonb);

-- step replace:history:schema:helper_warnings (additive)
select bolt_history_register('helper_warnings','{"audit":true,"fields":{"helper":{"inverse":"warnings","kind":"ref","to":"helpers"},"issued_at":{"kind":"instant"},"letter":{"accept":["application/pdf"],"kind":"file","max":"2MiB","optional":true},"notes":{"kind":"text","optional":true},"reason":{"kind":"enum","values":["no_response","declined_without_mc"]},"visit":{"kind":"ref","on_delete":"set_null","optional":true,"to":"visits"}},"indexes":[{"on":["issued_at"]}],"record_label":"record.helper.name + '' · '' + string(record.issued_at)","search":{"text":["helper","visit","reason"]}}'::jsonb);

-- step replace:history:schema:drive_times (additive)
select bolt_history_register('drive_times','{"audit":true,"fields":{"leg":{"hidden":true,"kind":"text"},"minutes":{"kind":"int","min":0}},"record_label":"record.leg","unique":[{"fields":["leg"],"name":"leg"}]}'::jsonb);

-- step replace:history:schema:helper_time_off (additive)
select bolt_history_register('helper_time_off','{"audit":true,"fields":{"helper":{"inverse":"time_off","kind":"ref","owned":true,"to":"helpers"},"period":{"kind":"period","of":"date"},"reason":{"kind":"enum","values":["leave","medical","other"]}},"no_overlap":[{"key":["helper"],"name":"one_absence","period":"period"}],"record_label":"record.helper.name + '' · '' + string(record.period.from)"}'::jsonb);

-- step replace:history:schema:openings (additive)
select bolt_history_register('openings','{"audit":true,"fields":{"day":{"kind":"date"},"service":{"inverse":"openings","kind":"ref","owned":true,"to":"services"},"starts":{"hidden":true,"kind":"text","many":true}},"record_label":"record.service.name + '' · '' + string(record.day)","unique":[{"fields":["service","day"],"name":"one_per_day"}]}'::jsonb);

-- step replace:index:helper_warnings.helper_warnings__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "helper_warnings__gin__73732636" on "helper_warnings" using gin (bolt_search);

-- step replace:index:drive_times.drive_times__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "drive_times__gin__73732636" on "drive_times" using gin (bolt_search);
