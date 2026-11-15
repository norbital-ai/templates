-- 0004_schema.sql: 3 step(s), from 93a1bd2bd198617bcbf1a25ec4288137036ca3d8ab4b593082e70ba044b133ec to cb957048dfa9b28435232f76a84751396a73a2fcd8ec3d0c2790f104990143a0.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:constraint:entity_change.entity_change__ck__88a9ce0a (additive)
-- operational risk: access-exclusive-lock
alter table "entity_change" drop constraint if exists "entity_change__ck__88a9ce0a";

-- step replace:history:schema:entity_change (additive)
select bolt_history_register('entity_change','{"audit":true,"fields":{"clears":{"kind":"text","many":true,"optional":true},"effective_from":{"kind":"date"},"entity_id":{"inverse":"changes","kind":"ref","on_delete":"cascade","to":"entity"},"final_pay_loan_floor_percent":{"kind":"int","max":100,"min":0,"optional":true},"overtime_full_award_percent":{"kind":"int","max":100,"min":1,"optional":true},"pay_methods":{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true},"statutory_parameters":{"kind":"json","optional":true,"shape":{"kind":"record","of":{"kind":"json"}}}},"record_label":"record.effective_from","unique":[{"fields":["entity_id","effective_from"],"name":"one_change"}]}'::jsonb);

-- step data:entity_change.pay_methods (data)
-- hazard: the shape of entity_change.pay_methods changed; rows written under the old shape may not decode under the new one.
-- Transform them here (an UPDATE over entity_change); the check below counts the rows the new shape still refuses.
-- step check:entity_change.pay_methods (validating)
do $store$ declare n bigint; begin
	execute 'select count(*) from "entity_change" where "pay_methods" is not null and store_json_valid("pay_methods", ''{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true}''::jsonb) is not true' into n;
	if n > 0 then raise exception 'the shape of entity_change.pay_methods refuses % existing row(s)', n; end if;
end $store$;

-- step create:constraint:entity_change.entity_change__ck__5b4de9d0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "entity_change" where (("pay_methods" is null or store_json_valid("pay_methods", ''{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'entity_change__ck__5b4de9d0 refuses % existing row(s)', n; end if;
end $store$;
alter table "entity_change" add constraint "entity_change__ck__5b4de9d0" check (("pay_methods" is null or store_json_valid("pay_methods", '{"fields":{"benefit_exclusion":{"kind":"enum","optional":true,"values":["POOLED","EXCESS_TAXED"]},"contribution_split":{"kind":"enum","optional":true,"values":["EVEN","FIRST_RUN"]},"health_billing":{"kind":"enum","optional":true,"values":["CURRENT","ARREARS"]},"night_differential_basis":{"kind":"enum","optional":true,"values":["WORKED","CLOCK_SPAN","WHOLE_NIGHT"]},"overtime_hour_basis":{"kind":"enum","optional":true,"values":["STATUTORY","CONTRACT_WEEKLY"]},"paid_leave":{"kind":"text","many":true,"optional":true},"rest_day_hourly_multiplier":{"kind":"number","min":1,"optional":true}},"kind":"object","optional":true}'::jsonb) is true));
