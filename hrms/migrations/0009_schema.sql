-- 0009_schema.sql: 3 step(s), from fac22c5ab5c55a519d3c1bc49572ec640e409a17e255c850b1c5237c19cf6efa to 8d5f426ba24088ec96b31bbbee029d4346f8a37422a197f1a84f2311f87b61a0.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:obligation.obligation__uq__b1d77ab4 (additive)
-- operational risk: access-exclusive-lock
alter table "obligation" drop constraint if exists "obligation__uq__b1d77ab4";

-- step replace:history:schema:obligation (additive)
select bolt_history_register('obligation','{"audit":true,"fields":{"due_on":{"kind":"date","optional":true},"employee_id":{"kind":"ref","optional":true,"to":"employee_profile"},"employment_id":{"kind":"ref","optional":true,"to":"employment"},"entity_id":{"inverse":"obligations","kind":"ref","to":"entity"},"evidence":{"accept":["application/pdf","image/*"],"kind":"file","max":"20MiB","optional":true},"fulfilled_on":{"kind":"date","optional":true},"occurrence_key":{"kind":"text"},"state":{"initial":"OPEN","kind":"state","states":{"FULFILLED":{"to":[]},"OPEN":{"to":["FULFILLED","WAIVED"]},"WAIVED":{"to":["OPEN"]}}},"title":{"kind":"text"},"waiver_reason":{"kind":"text","optional":true}},"locks":{"fulfilled_task":{"where":{"state":{"eq":"FULFILLED"}}},"waived_task":{"except":["waiver_reason","state"],"where":{"state":{"eq":"WAIVED"}}}},"record_label":"record.title","unique":[{"fields":["occurrence_key"],"import_key":true,"name":"one_occurrence"}]}'::jsonb);

-- step create:constraint:obligation.obligation__uq__db9e6024 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "obligation" where "occurrence_key" is not null group by "occurrence_key" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'obligation__uq__db9e6024 refuses % existing row(s)', n; end if;
end $store$;
alter table "obligation" add constraint "obligation__uq__db9e6024" unique ("occurrence_key");
