-- 0009_schema.sql: 2 step(s), from 637c9d050ac883d17f7fced66f730afdd5bc7c1e472a749db7c75bce7362f321 to f46f9424cc17931f73640b300778d987ae2472df2cfdaeb642509c30d4c04367.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.

-- step drop:notNull:employee_profile.user_id (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" alter column "user_id" drop not null;

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_last_match_at":{"kind":"instant","optional":true},"face_match_count":{"default":0,"kind":"int","min":0},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"first_hired_on":{"help":"The first day this person joined the employer group. Company service stays with the person across entity and jurisdiction transfers.","kind":"date","optional":true},"invitation_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","label":"Source reference","optional":true},"user_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"sys_user"}},"nativeRules":2,"recordLabel":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"]},{"fields":["user_id"]}]}'::jsonb);
