-- 0003_schema.sql: 29 step(s), from 5fa2f814d5c4dc63ee30325a538f7221a9c1859a40c8fc4b793e7763a83c984e to 7d177ff11a4c070bed19b551ba6af4121e1f13d8d54981f5823e48335ed56f59.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step drop:trigger:variation_requests.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "variation_requests";

-- step drop:index:variation_requests.variation_requests__gin__73732636 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "variation_requests__gin__73732636";

-- step drop:index:photo_evidence.photo_evidence__ix__5cfa74ea (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "photo_evidence__ix__5cfa74ea";

-- step drop:index:variation_requests.variation_requests__ix__7181b4fd (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop index if exists "variation_requests__ix__7181b4fd";

-- step replace:trigger:job_assignments.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "job_assignments";

-- step replace:trigger:photo_evidence.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "photo_evidence";

-- step drop:fk:photo_evidence.photo_evidence__fk__d5f52bf0 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "photo_evidence" drop constraint if exists "photo_evidence__fk__d5f52bf0";

-- step drop:fk:variation_requests.variation_requests__fk__3c162ea4 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop constraint if exists "variation_requests__fk__3c162ea4";

-- step drop:constraint:job_assignments.job_assignments__ck__9aeea2cf (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "job_assignments" drop constraint if exists "job_assignments__ck__9aeea2cf";

-- step drop:constraint:variation_requests.variation_requests__ck__e5be4ef3 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop constraint if exists "variation_requests__ck__e5be4ef3";

-- step drop:constraint:variation_requests.variation_requests__ck__c7c4e239 (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop constraint if exists "variation_requests__ck__c7c4e239";

-- step drop:constraint:variation_requests.variation_requests__uq__8633295c (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop constraint if exists "variation_requests__uq__8633295c";

-- step drop:notNull:variation_requests.description (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" alter column "description" drop not null;

-- step drop:notNull:variation_requests.requested_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" alter column "requested_at" drop not null;

-- step drop:notNull:variation_requests.title (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" alter column "title" drop not null;

-- step drop:notNull:variation_requests.job_assignment_id (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" alter column "job_assignment_id" drop not null;

-- step replace:default:job_assignments.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "job_assignments" alter column "status" drop default;

-- step drop:column:variation_requests.amount (destructive)
-- accept: drop:column:variation_requests.amount
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "amount" cascade;

-- step drop:column:variation_requests.description (destructive)
-- accept: drop:column:variation_requests.description
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "description" cascade;

-- step drop:column:variation_requests.requested_at (destructive)
-- accept: drop:column:variation_requests.requested_at
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "requested_at" cascade;

-- step drop:column:variation_requests.source_message_id (destructive)
-- accept: drop:column:variation_requests.source_message_id
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "source_message_id" cascade;

-- step drop:column:variation_requests.title (destructive)
-- accept: drop:column:variation_requests.title
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "title" cascade;

-- step drop:column:variation_requests.bolt_search (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists bolt_search cascade;

-- step drop:column:photo_evidence.variation_request_id (destructive)
-- accept: drop:column:photo_evidence.variation_request_id
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "photo_evidence" drop column if exists "variation_request_id" cascade;

-- step drop:column:variation_requests.job_assignment_id (destructive)
-- accept: drop:column:variation_requests.job_assignment_id
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "variation_requests" drop column if exists "job_assignment_id" cascade;

-- step drop:table:variation_requests (destructive)
-- accept: drop:table:variation_requests
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
drop table if exists "variation_requests" cascade;

-- step create:column:job_assignments.assignee_contact (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "job_assignments" add column "assignee_contact" text;

-- step replace:default:job_assignments.status (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "job_assignments" alter column "status" set default 'pending'::text;

-- step create:constraint:job_assignments.job_assignments__ck__1825dbe6 (validating)
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- A job is pending until completed: the former unassigned and assigned statuses are both pending.
update "job_assignments" set "status" = 'pending' where "status" in ('unassigned', 'assigned');
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "job_assignments" where ("status" in (''pending'', ''completed'')) is false' into n;
	if n > 0 then raise exception 'job_assignments__ck__1825dbe6 refuses % existing row(s)', n; end if;
end $store$;
alter table "job_assignments" add constraint "job_assignments__ck__1825dbe6" check ("status" in ('pending', 'completed'));

-- step replace:trigger:job_assignments.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "job_assignments" for each row execute function store_row_rules('{"audit":true,"fields":{"amount_charged":["amount_charged"],"assignee_contact":["assignee_contact"],"assignee_user_id":["assignee_user_id"],"completed_at":["completed_at"],"description":["description"],"dispatched_at":["dispatched_at"],"external_ref":["external_ref"],"location":["location"],"location_address":["location_address"],"nature":["nature"],"scheduled_for":["scheduled_for"],"search_text":["search_text"],"site_id":["site_id"],"source_message_id":["source_message_id"],"status":["status"],"summary":["summary"],"suspicion_checked_at":["suspicion_checked_at"],"title":["title"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:trigger:photo_evidence.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "photo_evidence" for each row execute function store_row_rules('{"audit":true,"fields":{"flags":["flags"],"inspection_claimed_at":["inspection_claimed_at"],"inspection_failed_at":["inspection_failed_at"],"inspection_failure_reason":["inspection_failure_reason"],"job_assignment_id":["job_assignment_id"],"matched_evidence_ids":["matched_evidence_ids"],"perceptual_embedding":["perceptual_embedding"],"photo":["photo"],"scene_embedding":["scene_embedding"],"sha256":["sha256"],"source":["source"],"source_key":["source_key"],"summary":["summary"]},"key":["id"],"parents":[],"states":{}}');

-- step replace:engine:audit:photo_evidence (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists bolt_audit_mark on "photo_evidence";
create trigger bolt_audit_mark before insert or update or delete on "photo_evidence" for each row execute function bolt_audit_mark('[]','[["job_assignment_id","job_assignments"]]');
drop trigger if exists bolt_audit on "photo_evidence";
create trigger bolt_audit after insert or update or delete on "photo_evidence" for each row execute function bolt_audit('[]','[["job_assignment_id","job_assignments"]]');
