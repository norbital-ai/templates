-- 0015_schema.sql: 5 step(s), from cf0c30590985789e13e1b5ee618c6938c9ea39ae536cfab90b46b46d235a435d to 2e9c9ae2abad87b5a4345c7c1d59e6947cee9d1d95ac00c27a629d4e3a7d9f7e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:trigger:roster_entry.store_row_rules (additive)
drop trigger if exists store_row_rules on "roster_entry";

-- step replace:history:schema:roster_entry (additive)
select bolt_history_register('roster_entry','{"audit":true,"fields":{"actual_worked_intervals":{"kind":"list","of":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"kind":"list","of":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"end":{"kind":"instant","optional":true},"start":{"kind":"instant"}},"kind":"object"},"optional":true,"was":"worked_intervals"},"consent":{"help":"The signed per-day consent for night work and overtime while raising a child under 12 months. Pregnancy never takes consent.","kind":"json","optional":true,"shape":{"fields":{"night_work":{"kind":"bool"},"overtime":{"kind":"bool"},"reference":{"kind":"text"}},"kind":"object"}},"employment_id":{"inverse":"roster_entry","kind":"ref","to":"employee_contract"},"findings":{"default":[],"kind":"json"},"overtime_as_time_off":{"default":false,"help":"The worker takes this day''s planned overtime as time off: the run pays no overtime for it and owes its hours on the leave row that takes overtime as time off.","kind":"bool"},"payroll_run_id":{"kind":"ref","onDelete":"setNull","optional":true,"to":"payroll_run"},"planned_overtime_intervals":{"kind":"list","of":{"fields":{"break_minutes":{"kind":"number","min":0,"optional":true},"breaks":{"kind":"list","of":{"fields":{"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"end":{"kind":"instant"},"start":{"kind":"instant"}},"kind":"object"},"optional":true},"shift_definition_id":{"kind":"ref","onDelete":"restrict","optional":true,"to":"shift_definition"},"work_date":{"kind":"date"}},"nativeRules":2,"recordLabel":"record.work_date","unique":[{"fields":["employment_id","work_date"]}]}'::jsonb);

-- step create:column:roster_entry.overtime_as_time_off (additive)
-- operational risk: access-exclusive-lock
alter table "roster_entry" add column "overtime_as_time_off" boolean default false;

-- step create:notNull:roster_entry.overtime_as_time_off (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "roster_entry" where "overtime_as_time_off" is null' into n;
	if n > 0 then raise exception 'notNull:roster_entry.overtime_as_time_off refuses % existing row(s)', n; end if;
end $store$;
alter table "roster_entry" alter column "overtime_as_time_off" set not null;

-- step replace:trigger:roster_entry.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "roster_entry" for each row execute function store_row_rules('{"audit":true,"fields":{"actual_worked_intervals":["actual_worked_intervals"],"consent":["consent"],"employment_id":["employment_id"],"findings":["findings"],"overtime_as_time_off":["overtime_as_time_off"],"payroll_run_id":["payroll_run_id"],"planned_overtime_intervals":["planned_overtime_intervals"],"shift_definition_id":["shift_definition_id"],"work_date":["work_date"]},"key":["id"],"parents":[],"states":{}}');
