-- 0003_schema.sql: 8 step(s), from 377f2a4188ddf0ea447c0be4201c93ff7ba2a992992cf3938f1a04a125b8d1df to 9a93066d533981dc085e934e2e772eb555566c5cab1d015cc694a3800a695649.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:index:jobs.jobs__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "jobs__gin__73732636";

-- step replace:index:projects.projects__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "projects__gin__73732636";

-- step replace:index:site_locations.site_locations__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "site_locations__gin__73732636";

-- step replace:index:workers.workers__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "workers__gin__73732636";

-- step replace:column:jobs.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "jobs" drop column if exists bolt_search cascade;

-- step replace:column:projects.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "projects" drop column if exists bolt_search cascade;

-- step replace:column:site_locations.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "site_locations" drop column if exists bolt_search cascade;

-- step replace:column:workers.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "workers" drop column if exists bolt_search cascade;

-- step replace:column:jobs.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "jobs" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("job_title"::text, '') || ' ' || coalesce("job_number"::text, ''))) stored;

-- step replace:column:projects.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "projects" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("project_name"::text, '') || ' ' || coalesce("project_number"::text, ''))) stored;

-- step replace:column:site_locations.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "site_locations" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("location_code"::text, '') || ' ' || coalesce("location_name"::text, ''))) stored;

-- step replace:column:workers.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "workers" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("worker_name"::text, '') || ' ' || coalesce("worker_number"::text, ''))) stored;

-- step replace:index:jobs.jobs__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "jobs__gin__73732636" on "jobs" using gin (bolt_search);

-- step replace:index:projects.projects__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "projects__gin__73732636" on "projects" using gin (bolt_search);

-- step replace:index:site_locations.site_locations__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "site_locations__gin__73732636" on "site_locations" using gin (bolt_search);

-- step replace:index:workers.workers__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "workers__gin__73732636" on "workers" using gin (bolt_search);
