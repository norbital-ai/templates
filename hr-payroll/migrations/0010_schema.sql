-- 0010_schema.sql: 46 step(s), from f46f9424cc17931f73640b300778d987ae2472df2cfdaeb642509c30d4c04367 to dd6b2001a4b77e235868da3ab6d95f457211cbe6cffca4c5dcd5905939b2229d.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:index:statutory_change.statutory_change__ix__9442f833 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "statutory_change__ix__9442f833";

-- step replace:trigger:holiday.store_row_rules (additive)
drop trigger if exists store_row_rules on "holiday";

-- step replace:trigger:statutory_change.store_row_rules (additive)
drop trigger if exists store_row_rules on "statutory_change";

-- step drop:fk:statutory_change.statutory_change__fk__d42a73ec (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__fk__d42a73ec";

-- step drop:constraint:statutory_change.statutory_change__ck__eeef1ebb (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__eeef1ebb";

-- step drop:constraint:statutory_change.statutory_change__ck__2869228f (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__2869228f";

-- step drop:constraint:statutory_change.statutory_change__ck__928cafd6 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__928cafd6";

-- step drop:constraint:statutory_change.statutory_change__ck__cc788915 (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop constraint if exists "statutory_change__ck__cc788915";

-- step drop:notNull:statutory_change.source_urls (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "source_urls" drop not null;

-- step drop:notNull:statutory_change.status (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "status" drop not null;

-- step drop:default:statutory_change.status (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" alter column "status" drop default;

-- step create:function:bolt_record_label_statutory_finding_06f5fc13 (additive)
create function "bolt_record_label_statutory_finding_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row) label_value$record_label$;

-- step create:function:bolt_record_label_statutory_source_06f5fc13 (additive)
create function "bolt_record_label_statutory_source_06f5fc13"(text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT (coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) #>> '{}') AS value FROM (SELECT jsonb_build_object('title', to_jsonb("title")) AS j FROM (SELECT $1 AS "title") label_inputs) label_row) label_value$record_label$;

-- step create:table:statutory_finding (additive)
create table "statutory_finding" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"jurisdiction_code" text not null,
	"instrument_key" text not null,
	"title" text not null,
	"fit" text not null,
	"families" jsonb not null,
	"summary" text,
	"announced_on" date,
	"status" text default 'PROPOSED' not null,
	"source_urls" jsonb not null,
	"source_quote" text,
	"verified_on" date,
	"research_run_id" text,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_statutory_finding_06f5fc13"("title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_statutory_finding_06f5fc13"("title"), ''))) stored,
	"verified_by" text,
	constraint "statutory_finding__ck__19a56580" check ("fit" in ('VALUE', 'ROW', 'STRUCTURAL')),
	constraint "statutory_finding__ck__0b1f3faa" check (("families" is null or store_json_valid("families", '{"kind":"list","of":{"kind":"text"}}'::jsonb) is true)),
	constraint "statutory_finding__ck__eeef1ebb" check (isfinite("announced_on")),
	constraint "statutory_finding__ck__928cafd6" check ("status" in ('APPLIED', 'CONFIRMED', 'PROPOSED', 'REJECTED')),
	constraint "statutory_finding__ck__2869228f" check (("source_urls" is null or store_json_valid("source_urls", '{"kind":"list","of":{"kind":"text"}}'::jsonb) is true)),
	constraint "statutory_finding__ck__cc788915" check (isfinite("verified_on")),
	constraint "statutory_finding__uq__90d60db4" unique nulls not distinct ("jurisdiction_code", "instrument_key") deferrable initially immediate
);

-- step create:table:statutory_source (additive)
create table "statutory_source" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"jurisdiction_code" text not null,
	"family" text,
	"title" text not null,
	"url" text not null,
	"origin" text default 'PERSON'::text not null,
	"replaces_url" text,
	"status" text default 'PROPOSED' not null,
	"last_checked_on" date,
	"research_run_id" text,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_statutory_source_06f5fc13"("title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_statutory_source_06f5fc13"("title"), ''))) stored,
	constraint "statutory_source__ck__0d87ec61" check ("url" ~ '^https?://\S+$'),
	constraint "statutory_source__ck__d65a408b" check ("origin" in ('REFERENCE', 'AGENT', 'PERSON')),
	constraint "statutory_source__ck__0566d2b6" check ("replaces_url" ~ '^https?://\S+$'),
	constraint "statutory_source__ck__4bd08479" check ("status" in ('ACTIVE', 'PROPOSED', 'RETIRED')),
	constraint "statutory_source__ck__d9ec03c5" check (isfinite("last_checked_on")),
	constraint "statutory_source__uq__4e17639c" unique nulls not distinct ("jurisdiction_code", "url") deferrable initially immediate
);

-- step replace:history:schema:holiday (additive)
select bolt_history_register('holiday','{"audit":true,"fields":{"date":{"kind":"date"},"entity_id":{"inverse":"holiday","kind":"ref","to":"entity"},"given_to":{"default":"EVERYONE","kind":"enum","values":["EVERYONE","ONLY_IF_OFF_ON_REPLACED_DATE"]},"kind":{"default":"PUBLIC_HOLIDAY","kind":"enum","values":["PUBLIC_HOLIDAY","SPECIAL_HOLIDAY","SUBSTITUTE","DOUBLE_HOLIDAY","DOUBLE_SPECIAL","MAKEUP_WORKDAY"]},"name":{"kind":"text"},"published_at":{"hidden":true,"kind":"instant","optional":true},"replaces":{"kind":"date","optional":true}},"nativeRules":2,"recordLabel":"record.date"}'::jsonb);

-- step replace:history:schema:statutory_change (additive)
select bolt_history_register('statutory_change','{"audit":true,"fields":{"applied_version_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"jurisdiction_settings"},"baseline_version_id":{"inverse":"statutory_changes","kind":"ref","onDelete":"restrict","to":"jurisdiction_settings"},"effective_from":{"kind":"date","optional":true},"family":{"kind":"text"},"field_path":{"kind":"text"},"finding_id":{"inverse":"changes","kind":"ref","onDelete":"cascade","to":"statutory_finding"},"jurisdiction_code":{"kind":"text"},"new_value":{"kind":"json","optional":true},"notes":{"kind":"text","optional":true},"old_value":{"kind":"json","optional":true},"row_code":{"kind":"text","optional":true}},"nativeRules":2,"recordLabel":"record.field_path","unique":[{"fields":["finding_id","family","row_code","field_path","effective_from"]}]}'::jsonb);

-- step create:column:holiday.kind (additive)
-- operational risk: access-exclusive-lock
alter table "holiday" add column "kind" text default 'PUBLIC_HOLIDAY'::text;

-- step create:column:statutory_change.finding_id (additive)
-- operational risk: access-exclusive-lock
alter table "statutory_change" add column "finding_id" uuid;

-- Backfill: each earlier change becomes its own finding (same id), keeping its review, sources and provenance.
insert into "statutory_finding" ("id", "jurisdiction_code", "instrument_key", "title", "fit", "families", "announced_on", "status", "source_urls", "source_quote", "verified_on", "verified_by", "research_run_id", "notes")
select c."id", c."jurisdiction_code", 'change-' || c."id", concat_ws(' ', c."family", c."row_code", c."field_path"),
	case when c."field_path" = '$row' then 'ROW' else 'VALUE' end, jsonb_build_array(c."family"), c."announced_on", c."status",
	coalesce(c."source_urls", '[]'::jsonb), c."source_quote", c."verified_on", c."verified_by", c."research_run_id", c."notes"
from "statutory_change" c;
update "statutory_change" set "finding_id" = "id";

-- step drop:column:statutory_change.announced_on (destructive)
-- accept: drop:column:statutory_change.announced_on
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "announced_on" cascade;

-- step drop:column:statutory_change.research_run_id (destructive)
-- accept: drop:column:statutory_change.research_run_id
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "research_run_id" cascade;

-- step drop:column:statutory_change.source_quote (destructive)
-- accept: drop:column:statutory_change.source_quote
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "source_quote" cascade;

-- step drop:column:statutory_change.source_urls (destructive)
-- accept: drop:column:statutory_change.source_urls
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "source_urls" cascade;

-- step drop:column:statutory_change.status (destructive)
-- accept: drop:column:statutory_change.status
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "status" cascade;

-- step drop:column:statutory_change.verified_on (destructive)
-- accept: drop:column:statutory_change.verified_on
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "verified_on" cascade;

-- step drop:column:statutory_change.verified_by (destructive)
-- accept: drop:column:statutory_change.verified_by
-- operational risk: access-exclusive-lock
alter table "statutory_change" drop column if exists "verified_by" cascade;

-- step create:history:schema:statutory_finding (additive)
select bolt_history_register('statutory_finding','{"audit":true,"fields":{"announced_on":{"kind":"date","optional":true},"families":{"kind":"list","of":{"kind":"text"}},"fit":{"kind":"enum","values":["VALUE","ROW","STRUCTURAL"]},"instrument_key":{"kind":"text"},"jurisdiction_code":{"kind":"text"},"notes":{"kind":"text","optional":true},"research_run_id":{"kind":"text","optional":true},"source_quote":{"kind":"text","optional":true},"source_urls":{"kind":"list","of":{"kind":"text"}},"status":{"initial":"PROPOSED","kind":"state","states":{"APPLIED":{"edit":"none","to":[]},"CONFIRMED":{"edit":["status","notes"],"to":["APPLIED","REJECTED"]},"PROPOSED":{"edit":["title","fit","families","summary","announced_on","source_urls","source_quote","notes","verified_on","verified_by","status"],"to":["CONFIRMED","REJECTED"]},"REJECTED":{"edit":"none","to":[]}}},"summary":{"kind":"text","optional":true},"title":{"kind":"text"},"verified_by":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"},"verified_on":{"kind":"date","optional":true}},"nativeRules":2,"recordLabel":"record.title","unique":[{"fields":["jurisdiction_code","instrument_key"]}]}'::jsonb);

-- step create:history:schema:statutory_source (additive)
select bolt_history_register('statutory_source','{"audit":true,"fields":{"family":{"kind":"text","optional":true},"jurisdiction_code":{"kind":"text"},"last_checked_on":{"kind":"date","optional":true},"notes":{"kind":"text","optional":true},"origin":{"default":"PERSON","kind":"enum","values":["REFERENCE","AGENT","PERSON"]},"replaces_url":{"format":"url","kind":"text","optional":true},"research_run_id":{"kind":"text","optional":true},"status":{"initial":"PROPOSED","kind":"state","states":{"ACTIVE":{"edit":"all","to":["RETIRED"]},"PROPOSED":{"edit":"all","to":["ACTIVE","RETIRED"]},"RETIRED":{"edit":["status","notes"],"to":["ACTIVE"]}}},"title":{"kind":"text"},"url":{"format":"url","kind":"text"}},"nativeRules":2,"recordLabel":"record.title","unique":[{"fields":["jurisdiction_code","url"]}]}'::jsonb);

-- step create:notNull:holiday.kind (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holiday" where "kind" is null' into n;
	if n > 0 then raise exception 'notNull:holiday.kind refuses % existing row(s)', n; end if;
end $store$;
alter table "holiday" alter column "kind" set not null;

-- step create:notNull:statutory_change.finding_id (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "statutory_change" where "finding_id" is null' into n;
	if n > 0 then raise exception 'notNull:statutory_change.finding_id refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_change" alter column "finding_id" set not null;

-- step create:constraint:holiday.holiday__ck__e39ee6e9 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "holiday" where ("kind" in (''PUBLIC_HOLIDAY'', ''SPECIAL_HOLIDAY'', ''SUBSTITUTE'', ''DOUBLE_HOLIDAY'', ''DOUBLE_SPECIAL'', ''MAKEUP_WORKDAY'')) is false' into n;
	if n > 0 then raise exception 'holiday__ck__e39ee6e9 refuses % existing row(s)', n; end if;
end $store$;
alter table "holiday" add constraint "holiday__ck__e39ee6e9" check ("kind" in ('PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'SUBSTITUTE', 'DOUBLE_HOLIDAY', 'DOUBLE_SPECIAL', 'MAKEUP_WORKDAY'));

-- step create:constraint:statutory_change.statutory_change__uq__4b6ab814 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "statutory_change" group by "finding_id", "family", "row_code", "field_path", "effective_from" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'statutory_change__uq__4b6ab814 refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_change" add constraint "statutory_change__uq__4b6ab814" unique nulls not distinct ("finding_id", "family", "row_code", "field_path", "effective_from") deferrable initially immediate;

-- step create:fk:statutory_finding.statutory_finding__fk__d42a73ec (additive)
alter table "statutory_finding" add constraint "statutory_finding__fk__d42a73ec" foreign key ("verified_by") references "sys_user" ("id") on delete restrict on update restrict;

-- step create:fk:statutory_change.statutory_change__fk__8b56e43d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "statutory_change" c where c."finding_id" is not null and not exists (select 1 from "statutory_finding" p where p."id" = c."finding_id")' into n;
	if n > 0 then raise exception 'statutory_change__fk__8b56e43d refuses % existing row(s)', n; end if;
end $store$;
alter table "statutory_change" add constraint "statutory_change__fk__8b56e43d" foreign key ("finding_id") references "statutory_finding" ("id") on delete cascade on update restrict;

-- step replace:trigger:holiday.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "holiday" for each row execute function store_row_rules('{"audit":true,"fields":{"date":["date"],"entity_id":["entity_id"],"given_to":["given_to"],"kind":["kind"],"name":["name"],"published_at":["published_at"],"replaces":["replaces"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:statutory_change.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_change" for each row execute function store_row_rules('{"audit":true,"fields":{"applied_version_id":["applied_version_id"],"baseline_version_id":["baseline_version_id"],"effective_from":["effective_from"],"family":["family"],"field_path":["field_path"],"finding_id":["finding_id"],"jurisdiction_code":["jurisdiction_code"],"new_value":["new_value"],"notes":["notes"],"old_value":["old_value"],"row_code":["row_code"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['adhoc_catalog','adhoc_catalog_entry','allowance_catalog','claim_catalog','claim_catalog_entry','employee_balance','employee_contract','employee_profile','entity','entity_profile_version','holiday','jurisdiction_settings','leave_catalog','leave_catalog_entry','ledger_entry','loan_catalog','loan_catalog_entry','loan_repayment_entry','obligation','overtime_catalog','payroll_run','payslip','registered_effect','registered_rule','roster_entry','shift_definition','shift_pattern','statutory_change','statutory_contribution_catalog','statutory_finding','statutory_source','subtotal','work_interruption_catalog','work_interruption_catalog_entry','workplace_case_catalog','workplace_case_catalog_entry']::text[]));

-- step replace:engine:audit:statutory_change (additive)
drop trigger if exists bolt_audit_mark on "statutory_change";
create trigger bolt_audit_mark before insert or update or delete on "statutory_change" for each row execute function bolt_audit_mark('[]','[["applied_version_id","jurisdiction_settings"],["baseline_version_id","jurisdiction_settings"],["finding_id","statutory_finding"]]');
drop trigger if exists bolt_audit on "statutory_change";
create trigger bolt_audit after insert or update or delete on "statutory_change" for each row execute function bolt_audit('[]','[["applied_version_id","jurisdiction_settings"],["baseline_version_id","jurisdiction_settings"],["finding_id","statutory_finding"]]');

-- step create:trigger:statutory_finding.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_finding" for each row execute function store_row_rules('{"audit":true,"fields":{"announced_on":["announced_on"],"families":["families"],"fit":["fit"],"instrument_key":["instrument_key"],"jurisdiction_code":["jurisdiction_code"],"notes":["notes"],"research_run_id":["research_run_id"],"source_quote":["source_quote"],"source_urls":["source_urls"],"status":["status"],"summary":["summary"],"title":["title"],"verified_by":["verified_by"],"verified_on":["verified_on"]},"key":["id"],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"APPLIED":{"edit":"none","to":[]},"CONFIRMED":{"edit":["status","notes"],"to":["APPLIED","REJECTED"]},"PROPOSED":{"edit":["title","fit","families","summary","announced_on","source_urls","source_quote","notes","verified_on","verified_by","status"],"to":["CONFIRMED","REJECTED"]},"REJECTED":{"edit":"none","to":[]}}}}}');

-- step create:index:statutory_finding.statutory_finding__gin__73732636 (additive)
create index "statutory_finding__gin__73732636" on "statutory_finding" using gin (bolt_search);

-- step create:trigger:statutory_source.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "statutory_source" for each row execute function store_row_rules('{"audit":true,"fields":{"family":["family"],"jurisdiction_code":["jurisdiction_code"],"last_checked_on":["last_checked_on"],"notes":["notes"],"origin":["origin"],"replaces_url":["replaces_url"],"research_run_id":["research_run_id"],"status":["status"],"title":["title"],"url":["url"]},"key":["id"],"parents":[],"states":{"status":{"initial":"PROPOSED","states":{"ACTIVE":{"edit":"all","to":["RETIRED"]},"PROPOSED":{"edit":"all","to":["ACTIVE","RETIRED"]},"RETIRED":{"edit":["status","notes"],"to":["ACTIVE"]}}}}}');

-- step create:index:statutory_source.statutory_source__gin__73732636 (additive)
create index "statutory_source__gin__73732636" on "statutory_source" using gin (bolt_search);

-- step create:index:statutory_finding.statutory_finding__ix__9442f833 (additive)
create index "statutory_finding__ix__9442f833" on "statutory_finding" ("verified_by");

-- step create:index:statutory_change.statutory_change__ix__db9feb63 (additive)
-- operational risk: writes-blocked, table-scan
create index "statutory_change__ix__db9feb63" on "statutory_change" ("finding_id");

-- step create:engine:audit:statutory_finding (additive)
drop trigger if exists bolt_audit_mark on "statutory_finding";
create trigger bolt_audit_mark before insert or update or delete on "statutory_finding" for each row execute function bolt_audit_mark('[]','[["verified_by","sys_user"]]');
drop trigger if exists bolt_audit on "statutory_finding";
create trigger bolt_audit after insert or update or delete on "statutory_finding" for each row execute function bolt_audit('[]','[["verified_by","sys_user"]]');

-- step create:engine:audit:statutory_source (additive)
drop trigger if exists bolt_audit_mark on "statutory_source";
create trigger bolt_audit_mark before insert or update or delete on "statutory_source" for each row execute function bolt_audit_mark('[]','[]');
drop trigger if exists bolt_audit on "statutory_source";
create trigger bolt_audit after insert or update or delete on "statutory_source" for each row execute function bolt_audit('[]','[]');
