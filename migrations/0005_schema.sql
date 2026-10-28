-- 0005_schema.sql: 6 step(s), from 7d86a117d04f4ee9c1ea59d6dbb26cddd88f2bc134be3eb481b387ed2bb79b1e to 172d64f0373b16cef656a104211a138f81602d981bafd07a61889d7a776e8a11.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step create:column:adhoc_catalog_entry.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "adhoc_catalog_entry" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("label"::text, ''))) stored;

-- step create:column:claim_catalog_entry.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "claim_catalog_entry" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("label"::text, ''))) stored;

-- step create:column:leave_catalog_entry.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "leave_catalog_entry" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("reference"::text, '') || ' ' || coalesce("label"::text, ''))) stored;

-- step create:index:adhoc_catalog_entry.adhoc_catalog_entry__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "adhoc_catalog_entry__gin__73732636" on "adhoc_catalog_entry" using gin (bolt_search);

-- step create:index:claim_catalog_entry.claim_catalog_entry__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "claim_catalog_entry__gin__73732636" on "claim_catalog_entry" using gin (bolt_search);

-- step create:index:leave_catalog_entry.leave_catalog_entry__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "leave_catalog_entry__gin__73732636" on "leave_catalog_entry" using gin (bolt_search);
