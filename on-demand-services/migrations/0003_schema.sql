-- 0003_schema.sql: 12 step(s), from d1bf7c6cd44fb5d8727dcc464cd1df3bf534443ce6a2a9710adbd38d6a10885d to 50c7237f032f76aa891d59f515fff7d8a0f19fe5e226cae7cd95d2fe36c20a74.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step create:column:booking_requests.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "booking_requests" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("phone"::text, '') || ' ' || coalesce("address"::text, ''))) stored;

-- step create:column:bookings.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "bookings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("number"::text, ''))) stored;

-- step create:column:customer_notices.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "customer_notices" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("subject"::text, ''))) stored;

-- step create:column:helper_warnings.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "helper_warnings" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("reason"::text, ''))) stored;

-- step create:column:services.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "services" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("name"::text, ''))) stored;

-- step create:column:visits.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "visits" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("number"::text, '') || ' ' || coalesce("address"::text, ''))) stored;

-- step create:index:booking_requests.booking_requests__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "booking_requests__gin__73732636" on "booking_requests" using gin (bolt_search);

-- step create:index:bookings.bookings__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "bookings__gin__73732636" on "bookings" using gin (bolt_search);

-- step create:index:customer_notices.customer_notices__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "customer_notices__gin__73732636" on "customer_notices" using gin (bolt_search);

-- step create:index:helper_warnings.helper_warnings__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "helper_warnings__gin__73732636" on "helper_warnings" using gin (bolt_search);

-- step create:index:services.services__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "services__gin__73732636" on "services" using gin (bolt_search);

-- step create:index:visits.visits__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "visits__gin__73732636" on "visits" using gin (bolt_search);
