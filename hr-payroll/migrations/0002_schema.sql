-- 0002_schema.sql: 3 step(s), from 44d4227e35798d81d184a62a2aa360840a2e7f9080e180673a774fb5e2ab4eaa to d1239326a645d949df3e74c53eb5ea53005b44275753254ea2621373d7b29960.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:trigger:employment_profile.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
drop trigger if exists store_row_rules on "employment_profile";

-- step drop:constraint:employment_profile.employment_profile__ck__f980109d (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "employment_profile" drop constraint if exists "employment_profile__ck__f980109d";

-- step drop:column:employment_profile.anonymised_at (destructive)
-- accept: drop:column:employment_profile.anonymised_at
-- The anonymisation feature is removed; the stamp has no reader.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "employment_profile" drop column if exists "anonymised_at" cascade;

-- step replace:trigger:employment_profile.store_row_rules (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
create trigger store_row_rules before insert or update or delete on "employment_profile" for each row execute function store_row_rules('{"audit":true,"fields":{"address":["address"],"before":["before"],"children":["children"],"date_of_birth":["date_of_birth"],"email":["email"],"face_consent_at":["face_consent_at"],"face_embedding":["face_embedding"],"face_enrolled_at":["face_enrolled_at"],"face_enrollment_status":["face_enrollment_status"],"face_last_match_at":["face_last_match_at"],"face_match_count":["face_match_count"],"face_photo":["face_photo"],"facts":["facts"],"gender":["gender"],"identity_number":["identity_number"],"invitation_id":["invitation_id"],"location":["location"],"marital_status":["marital_status"],"name":["name"],"nationality":["nationality"],"phone":["phone"],"user_id":["user_id"]},"key":["id"],"parents":[],"states":{}}');
