-- 0003_schema.sql: 9 step(s), from 837f089e718d79aeb561868021a41ba9e3fa6e61be2093834379d6c090e96a68 to 0c9273c8cef15405f63ffd7b80bf35e1f217af989b332bb302b1b1a0508d4f29.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.

-- step drop:constraint:entity_change.entity_change__ck__dda23d17 (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__ck__dda23d17";

-- step drop:column:entity_change.overtime_full_award_percent (destructive)
-- accept: drop:column:entity_change.overtime_full_award_percent
-- operational risk: access-exclusive-lock
alter table "entity_change" drop column if exists "overtime_full_award_percent" cascade;

-- step replace:history:schema:entity (additive)
select bolt_history_register('entity','{"audit":true,"fields":{"bank":{"kind":"custom","of":"bank","optional":true},"code":{"kind":"text","optional":true},"late_notice_minutes":{"kind":"int","min":1,"optional":true},"late_notice_policies":{"kind":"enum","many":true,"optional":true,"values":["supervisor","manager","hr_controller","hr_manager","senior_management"]},"name":{"kind":"text"},"registered_address":{"kind":"text","optional":true},"representative_name":{"kind":"text","optional":true},"settings_code":{"kind":"text"},"source_reference":{"kind":"text","optional":true},"time_zone":{"kind":"text","optional":true}},"record_label":"record.name","search":{"text":["code","name"]},"unique":[{"fields":["code"],"name":"code"}]}'::jsonb);

-- step replace:history:schema:entity_change (additive)
select bolt_history_register('entity_change','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"entity_id":{"inverse":"changes","kind":"ref","on_delete":"cascade","to":"entity"},"final_pay_loan_floor_percent":{"kind":"int","max":100,"min":0,"optional":true},"pay_methods":{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true},"statutory_parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["entity_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step create:column:entity.late_notice_minutes (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "late_notice_minutes" int;

-- step create:column:entity.late_notice_policies (additive)
-- operational risk: access-exclusive-lock
alter table "entity" add column "late_notice_policies" text[];

-- step create:constraint:entity.entity__ck__c745e358 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity" where ("late_notice_minutes" >= 1) is false' into n;
	if n > 0 then raise exception 'entity__ck__c745e358 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity" add constraint "entity__ck__c745e358" check ("late_notice_minutes" >= 1);

-- step create:constraint:entity.entity__ck__8e3518d2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity" where (not jsonb_path_exists(to_jsonb("late_notice_policies"), ''strict $[*] ? (@.type() != "string")'') and "late_notice_policies" <@ array[''supervisor'', ''manager'', ''hr_controller'', ''hr_manager'', ''senior_management'']::text[]) is false' into n;
	if n > 0 then raise exception 'entity__ck__8e3518d2 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity" add constraint "entity__ck__8e3518d2" check (not jsonb_path_exists(to_jsonb("late_notice_policies"), 'strict $[*] ? (@.type() != "string")') and "late_notice_policies" <@ array['supervisor', 'manager', 'hr_controller', 'hr_manager', 'senior_management']::text[]);

-- step create:index:entity.entity__gin__47add8c5 (additive)
-- operational risk: writes-blocked, table-scan
create index "entity__gin__47add8c5" on "entity" using gin ("late_notice_policies");
