-- 0002_schema.sql: 4 step(s), from c24f4b2246f5ac9c3f851b1d0306d27a5424efb222374ec782cd79fb87bc66b3 to d166ad46a0ebbcd361eede76525b2ccb28af1e230a25da15788e6261e75c9ff4.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:history:schema:employee_profile (additive)
select bolt_history_register('employee_profile','{"audit":true,"fields":{"address":{"kind":"text","optional":true},"bank":{"kind":"custom","of":"bank","optional":true},"birth_city":{"kind":"text","optional":true},"cumulative_service":{"default":false,"kind":"bool"},"date_of_birth":{"kind":"date","optional":true},"documents":{"accept":["application/pdf","image/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"email":{"format":"email","kind":"text","optional":true},"face_consent_at":{"kind":"instant","optional":true},"face_embedding":{"dim":1024,"kind":"vector","metric":"cosine","optional":true},"face_enrolled_at":{"kind":"instant","optional":true},"face_enrollment_status":{"default":"NONE","kind":"enum","values":["NONE","PENDING","APPROVED","SUSPENDED"]},"face_photo":{"accept":["image/jpeg","image/png"],"kind":"file","max":"5MiB","optional":true},"gender":{"kind":"enum","optional":true,"values":["MALE","FEMALE"]},"identity_number":{"kind":"text","optional":true},"invitation_id":{"kind":"ref","on_delete":"set_null","optional":true,"to":"sys_invitation"},"location":{"kind":"point","optional":true},"name":{"kind":"text"},"number":{"kind":"seq","pattern":"HR-{0000}"},"phone":{"format":"phone","kind":"text","optional":true},"source_reference":{"kind":"text","optional":true},"user_id":{"kind":"ref","on_delete":"restrict","optional":true,"to":"sys_user"}},"record_label":"record.name","search":{"semantic":{"dim":1536,"fields":["address"],"model":"default"},"text":["name","email","phone"]},"unique":[{"fields":["invitation_id"],"name":"invitation_id"},{"fields":["user_id"],"name":"user_id"}]}'::jsonb);

-- step create:column:employee_profile.number (additive)
-- operational risk: access-exclusive-lock
alter table "employee_profile" add column "number" text;

-- data: people already here take the next numbers in the order they were filed, and the counter starts after them
update "employee_profile" p set "number" = 'HR-' || lpad(n.rank::text, 4, '0')
from (select id, row_number() over (order by id) as rank from "employee_profile") n
where p.id = n.id and p."number" is null;
do $data$ begin
	if exists (select 1 from "employee_profile") then
		insert into bolt_seq (model, field, scope, value)
		select 'employee_profile', 'number', '["HR-",""]', count(*)::int from "employee_profile"
		on conflict (model, field, scope) do update set value = greatest(bolt_seq.value, excluded.value);
	end if;
end $data$;

-- step create:notNull:employee_profile.number (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "employee_profile" where "number" is null' into n;
	if n > 0 then raise exception 'notNull:employee_profile.number refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" alter column "number" set not null;

-- step create:constraint:employee_profile.employee_profile__uq__268a00e8 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "employee_profile" group by "number" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'employee_profile__uq__268a00e8 refuses % existing row(s)', n; end if;
end $store$;
alter table "employee_profile" add constraint "employee_profile__uq__268a00e8" unique nulls not distinct ("number") deferrable initially immediate;
