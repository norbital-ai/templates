-- 0012_schema.sql: 5 step(s), from 2812ec28da477072abf21f6b8e507f7652556c3896441f94be30f03aba811de8 to 13b85291d5e47f24d3a33e2f6138790d9a642d7eacd6e5792047ad2a5ca9ed9a.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:employee_profile.store_row_rules (additive)
drop trigger if exists store_row_rules on "employee_profile";

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"cumulative_service":{"default":false,"help":"Service counts every stint at the employer, rehires included. Off, only the current unbroken stint counts: the statutory continuous service.","kind":"bool"},"documents":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","multiple":true,"optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_last_match_at":{"kind":"instant","optional":true},"face_match_count":{"default":0,"kind":"int","min":0},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"invitation_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","label":"Source reference","optional":true},"user_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"}},"nativeRules":2,"recordLabel":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"]},{"fields":["user_id"]}]}'::jsonb);

-- step create:column:employee_profile.cumulative_service (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "cumulative_service" boolean default false;

-- step create:notNull:employee_profile.cumulative_service (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where "cumulative_service" is null' into n;
	if n > 0 then raise exception 'notNull:employee_profile.cumulative_service refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" alter column "cumulative_service" set not null;

-- step replace:trigger:employee_profile.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "employee_profile" for each row execute function store_row_rules('{"audit":true,"fields":{"address":["address"],"cumulative_service":["cumulative_service"],"documents":["documents"],"email":["email"],"face_consent_at":["face_consent_at"],"face_embedding":["face_embedding"],"face_enrolled_at":["face_enrolled_at"],"face_enrollment_status":["face_enrollment_status"],"face_last_match_at":["face_last_match_at"],"face_match_count":["face_match_count"],"face_photo":["face_photo"],"invitation_id":["invitation_id"],"location":["location"],"name":["name"],"phone":["phone"],"source_reference":["source_reference"],"user_id":["user_id"]},"key":["id"],"parents":[],"states":{}}');
