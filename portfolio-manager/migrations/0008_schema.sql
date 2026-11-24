-- 0008_schema.sql: 3 step(s), from 67b0086ebe47eee2f25d107b744806551308774638418fc7774f8264ce050b8d to fce04561373dd54613274213e9b6bf45e0f8f6cb3ac1f846d795412b78a91be3.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:sys_user.sys_user__ck__8405d565 (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" drop constraint if exists "sys_user__ck__8405d565";

-- step replace:history:schema:sys_user (additive)
select bolt_history_register('sys_user','{"check":{"admin_staff":{"or":[{"admin":{"eq":false}},{"kind":{"eq":"staff"}}]}},"computed":{"party_id":{"expr":{"json_text":[{"field":"party"},"id"]},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"active":{"default":true,"kind":"bool"},"admin":{"default":false,"kind":"bool"},"created_at":{"default":{"var":"now"},"kind":"instant"},"discord":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"kind":{"default":"staff","kind":"enum","values":["staff","external","anonymous"]},"last_seen":{"kind":"instant","optional":true},"name":{"kind":"text"},"party":{"kind":"json","optional":true},"phone":{"kind":"text","optional":true},"preferences":{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"email_notifications":{"kind":"bool","optional":true},"locale":{"kind":"text","max":35,"optional":true},"sounds":{"kind":"bool","optional":true}},"kind":"object"}},"revision":{"default":1,"kind":"int"},"signup":{"default":false,"kind":"bool"},"slack":{"kind":"text","optional":true},"team":{"format":"team","kind":"text","optional":true},"telegram":{"kind":"text","optional":true}},"indexes":[{"on":[{"lower":"email"}],"unique":true},{"on":["phone_key"],"unique":true}],"key":"text","record_label":"record.name","search":{"text":["name","email"]}}'::jsonb);

-- step data:sys_user.preferences (data)
-- hazard: the shape of sys_user.preferences changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over sys_user); the check below counts the rows the new shape still refuses.
-- step check:sys_user.preferences (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "sys_user" where "preferences" is null or store_json_valid("preferences", ''{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"email_notifications":{"kind":"bool","optional":true},"locale":{"kind":"text","max":35,"optional":true},"sounds":{"kind":"bool","optional":true}},"kind":"object"}}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of sys_user.preferences refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:sys_user.sys_user__ck__5ef80452 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where (("preferences" is null or store_json_valid("preferences", ''{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"email_notifications":{"kind":"bool","optional":true},"locale":{"kind":"text","max":35,"optional":true},"sounds":{"kind":"bool","optional":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__5ef80452 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__5ef80452" check (("preferences" is null or store_json_valid("preferences", '{"default":{},"kind":"json","shape":{"fields":{"appearance":{"kind":"enum","optional":true,"values":["light","dark","system"]},"email_notifications":{"kind":"bool","optional":true},"locale":{"kind":"text","max":35,"optional":true},"sounds":{"kind":"bool","optional":true}},"kind":"object"}}'::jsonb) is true));
