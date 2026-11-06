-- 0020_schema.sql: 4 step(s), from 7524b280a1fb3a56a22aa51323d1033ed5b8383e144f99f9d648ae0f2a966405 to 37ca962ab035f5a04c2f905565d9046d460b3d43d404ff5af7da0b1870ceef09.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:sys_user.store_row_rules (additive)
drop trigger if exists store_row_rules on "sys_user";

-- step create:column:sys_user.last_seen (additive)
-- operational risk: access-exclusive-lock
alter table "sys_user" add column "last_seen" timestamptz;

-- step create:constraint:sys_user.sys_user__ck__9658c5b5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "sys_user" where (isfinite("last_seen")) is false' into n;
	if n > 0 then raise exception 'sys_user__ck__9658c5b5 refuses % existing row(s)', n; end if;
end $store$;
alter table "sys_user" add constraint "sys_user__ck__9658c5b5" check (isfinite("last_seen"));

-- step replace:trigger:sys_user.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "sys_user" for each row execute function store_row_rules('{"audit":false,"fields":{"active":["active"],"admin":["admin"],"created_at":["created_at"],"email":["email"],"kind":["kind"],"last_seen":["last_seen"],"name":["name"],"party":["party"],"phone":["phone"],"revision":["revision"],"signup":["signup"],"team":["team"],"telegram":["telegram"]},"key":["id"],"parents":[],"states":{}}');
