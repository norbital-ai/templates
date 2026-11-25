-- 0005_schema.sql: 9 step(s), from 0fd13f0d53a708289a7f8522fb67477519d56b992d47a258b8e8d43eb635ae14 to c18dbf4b4a774a2b223a0e794c6cca6ec1850bb8ea9166113f932dde6d34c4a2.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:index:contacts.contacts__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__gin__73732636";

-- step replace:column:contacts.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "bolt_record_label" cascade;

-- step replace:column:contacts.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_contacts_fc5d1c62 (additive)
drop function if exists "bolt_record_label_contacts_fc5d1c62"(text, text) cascade;

-- step create:function:bolt_record_label_contacts_7127ea8f (additive)
create or replace function "bolt_record_label_contacts_7127ea8f"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['company_name']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['company_name']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['company_name']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['full_name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['company_name']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['company_name']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['full_name']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('company_name', to_jsonb("company_name"), 'full_name', to_jsonb("full_name")) AS j FROM (SELECT $1 AS "company_name", $2 AS "full_name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step replace:column:contacts.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "contacts" add column "bolt_record_label" text generated always as ("bolt_record_label_contacts_7127ea8f"("company_name", "full_name")) stored;

-- step replace:column:contacts.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "contacts" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contacts_7127ea8f"("company_name", "full_name"), '') || ' ' || coalesce("full_name"::text, '') || ' ' || coalesce("company_name"::text, '') || ' ' || coalesce("phone"::text, '') || ' ' || coalesce("email"::text, '') || ' ' || coalesce("registration_no"::text, ''))) stored;

-- step replace:history:schema:contacts (additive)
select bolt_history_register('contacts','{"audit":true,"computed":{"email_key":{"expr":{"lower":{"field":"email"}},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"company_name":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"full_name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms_days":{"kind":"int","max":180,"min":0,"optional":true},"phone":{"format":"phone","kind":"text","optional":true},"project_id":{"inverse":"contacts","kind":"ref","on_delete":"set_null","optional":true,"to":"projects"},"registration_no":{"kind":"text","optional":true},"role":{"default":"subcontractor","kind":"enum","values":["subcontractor","supplier","main_contractor","client","consultant","architect","qs","site_engineer","project_manager"]},"status":{"default":"active","kind":"enum","values":["active","inactive"]},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]}},"indexes":[{"on":["email_key"]},{"on":["phone_key"]},{"on":["trade_specialty","role"]}],"record_label":"record.company_name != null ? record.company_name + '' · '' + record.full_name : record.full_name","search":{"text":["full_name","company_name","phone","email","registration_no"]}}'::jsonb);

-- step replace:index:contacts.contacts__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "contacts__gin__73732636" on "contacts" using gin (bolt_search);
