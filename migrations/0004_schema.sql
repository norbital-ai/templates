-- 0004_schema.sql: 4 step(s), from 7d177ff11a4c070bed19b551ba6af4121e1f13d8d54981f5823e48335ed56f59 to f82b40d74b62ea2e4e6b4770e7bf3f04e06b30fce03cefe26dea27b0f7a2f071.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:trigger:job_assignments.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "job_assignments";

-- step replace:index:job_assignments.job_assignments__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "job_assignments__gin__73732636";

-- step drop:column:job_assignments.search_text (destructive)
-- accept: drop:column:job_assignments.search_text
-- reviewed: a derived search copy of the title and site; `search.text` now reads the site link
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "job_assignments" drop column if exists "search_text" cascade;

-- step replace:column:job_assignments.bolt_search (backfill)
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
alter table "job_assignments" drop column if exists bolt_search cascade;
alter table "job_assignments" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("title"::text, '') || ' ' || coalesce("nature"::text, '') || ' ' || coalesce("summary"::text, ''))) stored;

-- step replace:trigger:job_assignments.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "job_assignments" for each row execute function store_row_rules('{"audit":true,"fields":{"amount_charged":["amount_charged"],"assignee_contact":["assignee_contact"],"assignee_user_id":["assignee_user_id"],"completed_at":["completed_at"],"description":["description"],"dispatched_at":["dispatched_at"],"external_ref":["external_ref"],"location":["location"],"location_address":["location_address"],"nature":["nature"],"scheduled_for":["scheduled_for"],"site_id":["site_id"],"source_message_id":["source_message_id"],"status":["status"],"summary":["summary"],"suspicion_checked_at":["suspicion_checked_at"],"title":["title"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:index:job_assignments.job_assignments__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
create index "job_assignments__gin__73732636" on "job_assignments" using gin (bolt_search);
