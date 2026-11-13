-- 0004_schema.sql: 11 step(s), from 378b6341d443d916467598425bcfd0af916245184b9bb212f15c21e1206d1d0e to 00d7a5f559093d3795c08627eecebf542cc40904746a5b8e958eeab296766af0.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:index:photo_evidence.photo_evidence__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "photo_evidence__gin__73732636";

-- step drop:notNull:photo_evidence.summary (additive)
-- operational risk: access-exclusive-lock
alter table "photo_evidence" alter column "summary" drop not null;

-- step drop:column:photo_evidence.summary (destructive)
-- accept: drop:column:photo_evidence.summary
-- operational risk: access-exclusive-lock
alter table "photo_evidence" drop column if exists "summary" cascade;

-- step replace:column:photo_evidence.bolt_record_label (backfill)
-- operational risk: access-exclusive-lock
alter table "photo_evidence" drop column if exists "bolt_record_label" cascade;

-- step replace:column:photo_evidence.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "photo_evidence" drop column if exists bolt_search cascade;

-- step drop:function:bolt_record_label_photo_evidence_6fde649e (additive)
drop function if exists "bolt_record_label_photo_evidence_6fde649e"(text) cascade;

-- step create:function:bolt_record_label_photo_evidence_3f25a34a (additive)
create function "bolt_record_label_photo_evidence_3f25a34a"(jsonb) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['source', 'kind']), 'null'::jsonb) = to_jsonb('workspace_upload'::text)))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['source', 'kind']), 'null'::jsonb) = to_jsonb('workspace_upload'::text))) #>> '{}') END)::boolean IS TRUE THEN to_jsonb('Workspace upload'::text) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['source', 'kind']), 'null'::jsonb) = to_jsonb('workspace_upload'::text)))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['source', 'kind']), 'null'::jsonb) = to_jsonb('workspace_upload'::text))) #>> '{}') END)::boolean IS FALSE THEN (CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['source', 'sent_at']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['source', 'sent_at']) IS NOT NULL)) #>> '{}') END)::boolean IS TRUE THEN coalesce((label_row.j #> ARRAY['source', 'sent_at']), 'null'::jsonb) WHEN (CASE WHEN jsonb_typeof(to_jsonb(((label_row.j #> ARRAY['source', 'sent_at']) IS NOT NULL))) = 'boolean' THEN (to_jsonb(((label_row.j #> ARRAY['source', 'sent_at']) IS NOT NULL)) #>> '{}') END)::boolean IS FALSE THEN to_jsonb('Message photo'::text) ELSE 'null'::jsonb END) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('source', to_jsonb("source")) AS j FROM (SELECT $1 AS "source") label_inputs) label_row) label_value$record_label$;

-- step replace:column:photo_evidence.bolt_record_label (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "photo_evidence" add column "bolt_record_label" text generated always as ("bolt_record_label_photo_evidence_3f25a34a"("source")) stored;

-- step replace:column:photo_evidence.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "photo_evidence" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_photo_evidence_3f25a34a"("source"), ''))) stored;

-- step replace:history:schema:photo_evidence (additive)
select bolt_history_register('photo_evidence','{"audit":true,"fields":{"flags":{"kind":"enum","many":true,"values":["exact_duplicate","visual_duplicate","metadata_anomaly","edited_metadata","low_quality","missing_geolocation","location_mismatch"]},"inspection_claimed_at":{"hidden":true,"kind":"instant","optional":true},"inspection_failed_at":{"hidden":true,"kind":"instant","optional":true},"inspection_failure_reason":{"hidden":true,"kind":"text","optional":true},"job_assignment_id":{"inverse":"photo_evidence","kind":"ref","optional":true,"to":"job_assignments"},"matched_evidence_ids":{"hidden":true,"kind":"text","many":true},"perceptual_embedding":{"dim":256,"hidden":true,"kind":"vector","metric":"l2"},"photo":{"accept":["image/jpeg","image/png","image/heic","image/heif","application/octet-stream"],"kind":"file","max":"20MiB"},"scene_embedding":{"dim":256,"hidden":true,"kind":"vector","metric":"cosine","optional":true},"sha256":{"hidden":true,"kind":"text"},"source":{"kind":"custom","of":"photo_source"},"source_key":{"hidden":true,"kind":"text"}},"record_label":"record.source.kind == ''workspace_upload'' ? ''Workspace upload'' : (has(record.source.sent_at) ? record.source.sent_at : ''Message photo'')","search":{"indexes":{"pdq":{"description":"Photos nearest a PDQ vector: near-duplicates of the same pixels.","dim":256,"field":"perceptual_embedding","input":{"vector":{"kind":"number","many":true}},"metric":"l2"},"scene":{"description":"Photos nearest a scene embedding: the same place photographed again, cropped or re-shot.","dim":256,"field":"scene_embedding","input":{"vector":{"kind":"number","many":true}},"metric":"cosine"}},"text":[]},"unique":[{"fields":["source_key"],"name":"source_key"}]}'::jsonb);

-- step replace:index:photo_evidence.photo_evidence__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "photo_evidence__gin__73732636" on "photo_evidence" using gin (bolt_search);
